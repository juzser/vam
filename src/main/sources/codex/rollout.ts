/**
 * WHAT A CODEX THREAD WAS ASKED AND WHAT CAME BACK, from its rollout file.
 *
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl`: append-only, one
 * JSON object per line, oldest first. The same family as
 * `~/.claude/projects/<slug>/<sessionId>.jsonl`, so the same reader discipline
 * applies and is applied -- a bounded tail, read BACKWARDS a step at a time,
 * with a line that will not parse skipped rather than failing the read.
 * `claude-code/tail.ts` solved this problem last week and its header is worth
 * reading; the shape of the widening loop below is its shape.
 *
 * ── WHICH LINES A TURN IS READ FROM, AND WHY NOT THE OBVIOUS ONES ─────────
 *
 * Measured on this machine, a rollout carries BOTH of these for one exchange:
 *
 *   response_item / message        role=user       role=assistant
 *   event_msg     / item_completed item.type=UserMessage / AgentMessage
 *
 * The obvious choice is the first, and it is wrong. `response_item/message`
 * with `role: "user"` is not what the operator typed: on one measured thread
 * it carried an injected `<recommended_plugins>` catalogue, and the
 * `developer` role beside it carried the skills instructions and the
 * multi-agent preamble. A reader keyed on it would show an operator a prompt
 * they never wrote -- the same defect Claude Code's injected
 * `system-reminder` blocks cause, one source along.
 *
 * `event_msg/item_completed` carries the CONVERSATION as Codex itself
 * distinguishes it, keyed by `turn_id`, and the injected context is not in it.
 * Measured over the 60 most recent visible threads: 60 of 60 carry at least
 * one `UserMessage` item, so this is not a shape that only new rollouts have.
 *
 * ── WHAT IS NOT HERE ──────────────────────────────────────────────────────
 *
 * Liveness. `threads` has no status and no pid column, the writer locks were
 * stale for finished threads, and `a-second-source.md` §Experiments says so.
 * Nothing in this file infers "still running" from a turn with no answer: a
 * turn whose answer is missing is a turn whose answer vam did not read, which
 * is exactly what `Decision.output === null` already means.
 */

import type { Decision, TurnStep } from '../../../renderer/domain/model.js';
import type { TranscriptSource } from '../claude-code/window.js';

/**
 * One step, and the first one. 128 KiB, the window `claude-code/tail.ts`
 * reads, kept deliberately the same: the two sources poll on the same tick and
 * a Codex tail that cost more would be the poll's new cost.
 */
export const TAIL_WINDOW_BYTES = 128 * 1024;

/**
 * What one thread's tail may read IN TOTAL, per poll, across every step.
 *
 * A VALVE, NOT THE RULE. Measured over the 40 most recent rollouts on the
 * machine this was written for: 4 single lines exceed 128 KiB and the largest
 * is 1,903,452 bytes -- a tool result, which is neither a prompt nor an
 * answer and contributes nothing to a turn. 4 MiB clears that line with a
 * whole step to spare, so even the worst measured line can be stepped over
 * and still leave a window to find the turn above it.
 */
export const MAX_TAIL_READ_BYTES = 4 * 1024 * 1024;

/** At most this many turns come back from one read. The canvas draws three. */
export const MAX_TURNS = 8;

/** The activity line's own limit, matching what the canvas can draw. */
const MAX_LABEL = 80;

export type RolloutFacts = {
  /** NEWEST FIRST, the order `Session.decisions` is in. */
  readonly decisions: readonly Decision[];
  /** The newest tool call in the window, for the activity line. */
  readonly activity: string | null;
  /**
   * TRUE WHEN EVERY BYTE VAM WAS ALLOWED TO READ HELD NO CONVERSATION.
   *
   * The state `claude-code/tail.ts` exists for: a window with no message in it
   * is not a thread that said nothing, and the difference must not be flattened
   * into "this turn ended without an answer".
   */
  readonly starved: boolean;
};

export const EMPTY_FACTS: RolloutFacts = { decisions: [], activity: null, starved: true };

type Line = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * One window's whole lines, parsed, UNPARSEABLE ONES SKIPPED.
 *
 * A tail read cuts its first line in half by construction, and a rollout is
 * appended to while vam reads it, so a line that will not parse is ORDINARY
 * and must never fail the read. `window.ts` already trims the leading partial
 * line; this covers the trailing one and anything else.
 */
export function parseRolloutLines(text: string): readonly Line[] {
  const lines: Line[] = [];
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isObject(parsed)) lines.push(parsed);
    } catch {
      // Deliberately silent. See above: this is the common case at both ends
      // of a window, not an error about the transcript.
    }
  }
  return lines;
}

/** `[{type:'text'|'Text', text:'…'}]` -- both spellings are real in the corpus. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (!isObject(part)) continue;
    const value = part['text'];
    if (typeof value === 'string' && value !== '') parts.push(value);
  }
  return parts.join('\n').trim();
}

const clip = (value: string): string =>
  value.length <= MAX_LABEL ? value : `${value.slice(0, MAX_LABEL - 1)}…`;

/** The item shapes a turn is assembled from, and everything else is working. */
type Item = { readonly type: string; readonly content?: unknown };

function itemOf(line: Line): { item: Item; turnId: string | null } | null {
  if (line['type'] !== 'event_msg') return null;
  const payload = line['payload'];
  if (!isObject(payload) || payload['type'] !== 'item_completed') return null;
  const item = payload['item'];
  if (!isObject(item) || typeof item['type'] !== 'string') return null;
  const turnId = payload['turn_id'];
  return {
    item: item as unknown as Item,
    turnId: typeof turnId === 'string' && turnId !== '' ? turnId : null,
  };
}

/**
 * The turns in a window, newest first.
 *
 * A TURN IS OPENED BY A `UserMessage` AND CLOSED BY THE `AgentMessage` THAT
 * FOLLOWS IT. Codex keys both on `turn_id`, but the id is NOT what pairs them
 * here -- position is, because a window that begins mid-turn holds an answer
 * whose question is above the top of it, and dropping that answer would be the
 * same starvation bug `claude-code/tail.ts` was written for. An answer with no
 * question in the window is carried as a turn whose `input` says so.
 *
 * `decisionIdPrefix` namespaces the ids, so two threads' turns never collide
 * in a map keyed by decision id.
 */
export function turnsFromLines(lines: readonly Line[], decisionIdPrefix: string): RolloutFacts {
  type Open = {
    input: string;
    output: string | null;
    steps: TurnStep[];
    errorCount: number;
    promptedAt: string | null;
    latestAt: string | null;
    index: number;
  };
  const turns: Open[] = [];
  let current: Open | null = null;
  let activity: string | null = null;
  let sawMessage = false;
  let index = 0;

  const at = (line: Line): string | null => {
    const value = line['timestamp'];
    return typeof value === 'string' && value !== '' ? value : null;
  };

  for (const line of lines) {
    const found = itemOf(line);
    if (found === null) continue;
    const { item } = found;
    if (item.type === 'UserMessage') {
      sawMessage = true;
      index += 1;
      current = {
        input: textOf(item.content),
        output: null,
        steps: [],
        errorCount: 0,
        promptedAt: at(line),
        latestAt: at(line),
        index,
      };
      turns.push(current);
      continue;
    }
    if (item.type === 'AgentMessage') {
      sawMessage = true;
      const answer = textOf(item.content);
      if (current === null) {
        // An answer whose question is above the window. Said, never dropped.
        index += 1;
        current = {
          input: '',
          output: answer,
          steps: [],
          errorCount: 0,
          promptedAt: null,
          latestAt: at(line),
          index,
        };
        turns.push(current);
      } else {
        // A turn can answer more than once; the newest is the answer, and the
        // earlier ones are working that the Response view does not draw twice.
        current.output = current.output === null ? answer : `${current.output}\n\n${answer}`;
        current.latestAt = at(line) ?? current.latestAt;
      }
      continue;
    }
    // Everything else the thread did: commands, web searches, reasoning. Only
    // the ones with a name vam can print become steps.
    const step = labelOf(item);
    if (step === null) continue;
    activity = step.label;
    if (current === null) continue;
    current.latestAt = at(line) ?? current.latestAt;
    if (step.failed) current.errorCount += 1;
    current.steps.push({
      id: `${decisionIdPrefix}-${current.index}-step-${current.steps.length + 1}`,
      label: step.label,
      failed: step.failed,
    });
  }

  const decisions: Decision[] = turns
    .slice(-MAX_TURNS)
    .reverse()
    .map((turn) => ({
      id: `${decisionIdPrefix}-${turn.index}`,
      label: 'codex',
      input: turn.input,
      output: turn.output,
      commands: [],
      promptedAt: turn.promptedAt,
      latestAt: turn.latestAt,
      steps: turn.steps,
      // A READING, NOT AN ABSENCE: zero means vam looked at every call in the
      // window and none of them came back non-zero. See `Decision.errorCount`.
      errorCount: turn.errorCount,
    }));
  return { decisions, activity, starved: !sawMessage };
}

/**
 * WHAT A NON-MESSAGE ITEM DID, and whether it failed -- or null when there is
 * nothing an operator could act on.
 *
 * THE THREE SHAPES ARE MEASURED, over the 12 most recent visible threads on
 * the machine this was written for, and they are all that appear there:
 *
 *   CommandExecution  command: ["/bin/zsh","-lc","<script>"]  exit_code: 0
 *   Extension         kind: "web.search"  query: "<terms>"
 *   Reasoning         summary_text: []  raw_content: []
 *
 * `Reasoning` gets NO LABEL on purpose: the word "Reasoning" is not something
 * an operator can act on, and the activity line is better left on the last
 * call that said something. An unrecognised fourth shape lands there too --
 * this is a private schema, and inventing a label for a shape vam has never
 * seen would put a made-up word on the activity line.
 *
 * FAILURE IS READ, NEVER INFERRED, on `TurnStep.failed`'s own rule: a
 * non-zero `exit_code` and nothing else. A call still running has no exit code
 * and is not marked, which is the same reading Claude Code's `is_error` gives
 * its own absence.
 */
function labelOf(item: Item): { readonly label: string; readonly failed: boolean } | null {
  const record = item as unknown as Record<string, unknown>;
  const exitCode = record['exit_code'];
  const failed = typeof exitCode === 'number' && exitCode !== 0;
  const command = record['command'];
  if (Array.isArray(command) || typeof command === 'string') {
    const words = Array.isArray(command) ? command.filter((w) => typeof w === 'string') : [command];
    if (words.length === 0) return null;
    // A LOGIN SHELL WRAPPER IS NOT THE COMMAND. Every measured
    // `CommandExecution` is `[<shell>, "-lc", "<script>"]`, and printing the
    // first two words would put `/bin/zsh -lc` on the activity line of every
    // call vam draws. The script is the part a person recognises.
    const flag = words[words.length - 2];
    const script = words[words.length - 1] as string;
    const text = flag === '-lc' || flag === '-c' ? script : words.join(' ');
    return text === '' ? null : { label: clip(text), failed };
  }
  const kind = record['kind'];
  const query = record['query'];
  if (typeof kind === 'string' && kind !== '') {
    return {
      label: clip(typeof query === 'string' && query !== '' ? `${kind}: ${query}` : kind),
      failed,
    };
  }
  return null;
}

/**
 * One thread's turns, from as much of the end of its rollout as it takes.
 *
 * `step` and `budget` are arguments for the reason every read in this tree
 * injects its own: a fixture that had to be 4 MiB to exercise the ceiling
 * would be a fixture nobody reads. Production passes neither.
 */
export async function readRolloutTail(
  source: TranscriptSource,
  decisionIdPrefix: string,
  step: number = TAIL_WINDOW_BYTES,
  budget: number = MAX_TAIL_READ_BYTES,
): Promise<RolloutFacts> {
  const stride = Math.max(1, step);
  const size = await source.size();
  // Oldest first at the end: `turnsFromLines` reads positionally, so the order
  // it is handed is the order the FILE is in, never the order it was read in.
  const collected: Line[] = [];
  let boundary = size;
  let spent = 0;
  let sawUser = false;
  let sawAgent = false;

  for (;;) {
    const from = Math.max(0, boundary - stride);
    const window = await source.read(from, boundary);
    spent += boundary - from;
    if (window.text !== '') {
      const lines = parseRolloutLines(window.text);
      for (const line of lines) {
        const found = itemOf(line);
        if (found?.item.type === 'UserMessage') sawUser = true;
        if (found?.item.type === 'AgentMessage') sawAgent = true;
      }
      collected.unshift(...lines);
    }
    // The stop rule is the raw material of one turn -- a question and an
    // answer -- exactly as `claude-code/tail.ts` states it. The byte ceiling
    // below is a valve underneath that rule, not the rule itself.
    if (sawUser && sawAgent) break;
    // BYTE 0 IS THE WHOLE ROLLOUT: what was not found here does not exist.
    if (from === 0) break;
    // The step lands where this window's first WHOLE line began. A window that
    // sits entirely inside one enormous line yields none, and the requested
    // start is then the only offset that still makes progress -- that line's
    // content is skipped, which is the point: a 1.9 MB tool result is neither
    // a prompt nor an answer.
    boundary = window.text === '' ? from : window.start;
    // Checked BEFORE the widening, so it is a bound and not a tripwire.
    if (spent + stride > budget) break;
  }

  return turnsFromLines(collected, decisionIdPrefix);
}
