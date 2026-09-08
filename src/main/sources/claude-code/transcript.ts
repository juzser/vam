/**
 * Turning the TAIL of one Claude Code transcript into the few facts the canvas
 * draws: the branch, the newest turns, the current tool call, and a fallback
 * name.
 *
 * Pure -- it is handed a string and returns data -- so every rule below is
 * testable against a fixture instead of against the operator's home
 * directory. The file walk and the byte budget live in `source.ts`.
 *
 * IT DERIVES NO STATUS. It used to: mtime plus the shape of the last message
 * gave a plausible-looking `running`/`waiting`, and it was a guess. The CLI
 * knows which processes are alive, so status comes from `agents.ts` and this
 * module does not offer a second opinion that could disagree with it.
 *
 * WHY ONLY A TAIL. A transcript is an append-only JSONL log and the operator's
 * largest is 165 MB / 75k lines. Nothing here needs the beginning: the branch,
 * the title, the newest turns and the current tool call are all re-stated near
 * the end. So this function is written to work on a byte suffix and to
 * tolerate the consequences of one -- a first line cut mid-token, and a window
 * that may open in the middle of a turn whose prompt is off-screen.
 *
 * The type-only import of the renderer's model is required: main may name the
 * renderer's types, never load its code.
 */

import { createHash } from 'node:crypto';
import type { AgentQuestion, Decision } from '../../../renderer/domain/model.js';
import { extractCommands } from './commands.js';
import { collectQuestions } from './questions.js';

/**
 * How many turns the window can hold, worst case.
 *
 * NOT the canvas's slot count -- `selectors.ts`'s `VISIBLE_DECISION_COUNT` is
 * that, a display decision with nothing to do with parsing. This used to be
 * `MAX_DECISIONS = 3`, borrowed straight from the canvas's three step slots,
 * and it silently discarded every turn past the newest three before
 * `session.decisions` ever left this file: a fourth request pushed the first
 * answer out of vam's model entirely -- not scrolled away, not collapsed,
 * never loaded.
 *
 * The real budget already exists one file over: `source.ts`'s `TAIL_BYTES`
 * (128 KiB = 131072 bytes) is the whole of what this function is ever
 * handed, so the number of turns the window could possibly carry is already
 * bounded by that byte budget divided by the smallest line able to open one
 * -- `{"type":"last-prompt","lastPrompt":"x"}`, 39 bytes on the wire plus its
 * newline, 40 total. 131072 / 40 = 3276.8, floored to 3276. A real
 * transcript's lines run to hundreds of bytes each and most of the window is
 * spent on assistant text besides, so no real session is expected to reach
 * this; it is a BACKSTOP against a pathological or adversarial tail, sized to
 * hold every turn the window can possibly contain rather than an arbitrary
 * smaller one.
 */
const MAX_DECISIONS = 3276;

/** One line's worth of meaning, per `Session.activity`. */
const ACTIVITY_LIMIT = 80;

export type TranscriptFacts = {
  /** The generated session title, used only when the CLI reports no name. */
  readonly aiTitle: string | null;
  readonly branch: string | null;
  /** The newest tool call, for the activity line. */
  readonly activity: string | null;
  /** Newest first, at most `MAX_DECISIONS`. */
  readonly decisions: readonly Decision[];
  /**
   * Every `AskUserQuestion` in the window, oldest first, each open or
   * answered by the rule in `questions.ts`. Empty is the common case.
   */
  readonly questions: readonly AgentQuestion[];
};

export const EMPTY_FACTS: TranscriptFacts = {
  aiTitle: null,
  branch: null,
  activity: null,
  decisions: [],
  questions: [],
};

type Line = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function parseLines(tail: string): Line[] {
  const out: Line[] = [];
  // The first line of a byte suffix is almost always a fragment. It is not
  // special-cased -- it simply fails to parse, like any other damaged line.
  for (const raw of tail.split('\n')) {
    if (raw.trim() === '') continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === 'object' && value !== null) out.push(value as Line);
    } catch {
      // A partial or non-JSON line is data we do not have, not an error.
    }
  }
  return out;
}

/** The `{type:'text'}` parts of a message, joined; `null` if it has none. */
function messageText(line: Line): string | null {
  const message = line['message'];
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as Line)['content'];
  if (typeof content === 'string') return str(content);
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((p): p is Line => typeof p === 'object' && p !== null)
    .filter((p) => p['type'] === 'text')
    .map((p) => str(p['text']) ?? '')
    .join('\n')
    .trim();
  return text === '' ? null : text;
}

/** The first `{type:'tool_use'}` part of an assistant message, if any. */
function toolUse(line: Line): string | null {
  const message = line['message'];
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as Line)['content'];
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as Line;
    if (p['type'] !== 'tool_use') continue;
    const input = p['input'];
    const description =
      typeof input === 'object' && input !== null ? str((input as Line)['description']) : null;
    const name = str(p['name']) ?? 'tool';
    return `${name}${description === null ? '' : `: ${description}`}`.slice(0, ACTIVITY_LIMIT);
  }
  return null;
}

/**
 * How many `tool_result` parts of this line report a FAILED call.
 *
 * `is_error` is written on the result itself, so this is read and not
 * inferred: nothing here guesses failure from output that merely looks like
 * an error. Verified against the operator's real transcripts before it was
 * written -- across 190 files carrying one, all 506 occurrences of
 * `is_error:true` sat on a `tool_result` part of a `type:'user'` line, with
 * no exceptions in either direction.
 *
 * `=== true` rather than truthy, and the same move `deliver.ts` makes on the
 * same field: a string, a 1, or a missing value are damaged or adversarial
 * data, and a failure badge is not worth guessing for. It counts PARTS, not
 * lines, because one result line can carry several.
 */
function toolErrors(line: Line): number {
  const message = line['message'];
  if (typeof message !== 'object' || message === null) return 0;
  const content = (message as Line)['content'];
  if (!Array.isArray(content)) return 0;
  let failed = 0;
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as Line;
    if (p['type'] === 'tool_result' && p['is_error'] === true) failed += 1;
  }
  return failed;
}

/** `2m`, `6h`, `3d` -- the compact form the sidebar right-aligns. */
export function compactAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * A short, content-derived fingerprint of a turn's own prompt.
 *
 * WHY CONTENT, NOT POSITION. `id` used to be `${prefix}:${index}`, counted
 * from the newest end of the kept window -- so appending one turn shifted
 * every earlier turn's index, and the same id string named a DIFFERENT turn
 * on the next poll. That was invisible while nothing remembered an id
 * across two parses of the file; it stopped being invisible the moment the
 * detail panel let an operator sit on a historical turn and the canvas's own
 * step focus does the equivalent by slot. Position counted from the START of
 * the file is not available either -- this function is handed only a byte
 * SUFFIX (`source.ts`'s `TAIL_BYTES`), so it has no absolute anchor to count
 * from. The one thing every turn genuinely owns, independent of where the
 * window happens to be cut, is its own prompt -- so identity is derived from
 * that instead of from a place in a list.
 *
 * WHY A HASH OF `input` ALONE IS NOT ENOUGH: two turns can carry the exact
 * same words (an operator resending "continue"), so this is combined with
 * `idOf`'s own rank -- the count of same-fingerprint turns strictly BEFORE
 * this one, oldest-first, within THIS SAME PARSE. Ranking from the oldest
 * end rather than the newest is deliberate and not symmetric with the
 * defect being fixed: a turn's rank depends only on turns before it, so
 * appending ANY new turn (matching or not) never changes it -- the common
 * case stays stable unconditionally. Ranking from the newest end would have
 * inherited the exact instability this function exists to remove, just
 * triggered by a duplicate arriving instead of by any turn arriving. The
 * residual this still cannot fix: if one of two same-input turns is old
 * enough to fall out of the byte window entirely (not merely off the
 * newest-`MAX_DECISIONS` slice below, which keeps every rank), the survivor's
 * rank -- and so its id -- can shift. That requires both a repeated prompt
 * and enough new content to push the earlier occurrence out of 128 KiB, a
 * narrower and later-arriving condition than "any turn arrived", which is
 * what made the old scheme fail on every poll.
 *
 * WHY NOT A FIELD THE CLI ALREADY WRITES (e.g. a per-line id): nothing this
 * file already reads carries one (see `Line`'s own shape, built from what
 * `messageText`/`toolUse`/`collectQuestions` use), and minting identity from
 * an undocumented field this codebase has never verified against a real
 * transcript would be a guess baked into parsing, not a fact read from it.
 *
 * sha256 mirrors `project-id.ts`'s own digest -- the same move for the same
 * reason: a stable id that carries no raw content. Not a security boundary --
 * collisions are handled by `idOf`'s rank, not prevented by hash width -- so
 * a short slice is enough.
 */
function turnFingerprint(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

export function summarizeTranscript(tail: string, decisionIdPrefix: string): TranscriptFacts {
  const lines = parseLines(tail);

  let branch: string | null = null;
  let aiTitle: string | null = null;
  let agentName: string | null = null;
  let activity: string | null = null;

  // Turns, oldest first. A prompt opens one; every later assistant text
  // overwrites that turn's answer, so what survives is the LAST thing the
  // session said before the operator spoke again -- its final response for
  // that turn, which is what `Decision.output` is defined to be. vam cannot
  // tell an interim narration from a final answer inside a turn still in
  // flight; it shows the newest text and lets `status` carry "still working".
  const turns: { input: string; output: string | null; errors: number }[] = [];

  for (const line of lines) {
    branch = str(line['gitBranch']) ?? branch;

    const type = line['type'];
    if (type === 'ai-title') aiTitle = str(line['aiTitle']) ?? aiTitle;
    else if (type === 'agent-name') agentName = str(line['agentName']) ?? agentName;
    else if (type === 'last-prompt') {
      const prompt = str(line['lastPrompt']);
      // Re-emitted on every resume, so an unchanged value is the same turn.
      if (prompt !== null && turns.at(-1)?.input !== prompt) {
        turns.push({ input: prompt, output: null, errors: 0 });
      }
    } else if (type === 'assistant') {
      const text = messageText(line);
      if (text !== null) {
        const open = turns.at(-1);
        if (open !== undefined) turns[turns.length - 1] = { ...open, output: text };
      }
      activity = toolUse(line) ?? activity;
    } else if (type === 'user') {
      // A tool result belongs to the turn that was OPEN when it arrived: it
      // comes after the prompt that opened that turn and before the next one.
      // With no open turn -- the window began mid-turn, its prompt off the top
      // -- it is charged to nothing. Attributing it to the next prompt would
      // blame a turn that had not started; attributing it to a turn vam never
      // read would mean inventing that turn. Dropping it is the same honesty
      // `turns read` already carries.
      const failed = toolErrors(line);
      const open = turns.at(-1);
      if (failed > 0 && open !== undefined) {
        turns[turns.length - 1] = { ...open, errors: open.errors + failed };
      }
    }
  }

  // IDS, MINTED OLDEST-FIRST, OVER THE FULL LIST -- before the byte budget
  // below ever slices it. `turnId` explains why: a turn's id has to depend
  // only on itself and on same-input turns strictly BEFORE it, never on how
  // many turns exist after it, or appending a turn (the whole point of this
  // fix) would keep renumbering everything that already existed.
  const rank = new Map<string, number>();
  const idOf = (turn: { readonly input: string }): string => {
    const fp = turnFingerprint(turn.input);
    const n = rank.get(fp) ?? 0;
    rank.set(fp, n + 1);
    return `${decisionIdPrefix}:${fp}:${n}`;
  };
  const decisions: readonly Decision[] = turns
    .map((turn) => ({ ...turn, id: idOf(turn) }))
    .slice(-MAX_DECISIONS)
    .reverse()
    .map((turn) => ({
      id: turn.id,
      label: agentName ?? 'claude-code',
      input: turn.input,
      output: turn.output,
      // Claude Code hands commands back as prose inside an answer, not as
      // structured data, so `commands.ts` reads the fenced blocks of that
      // answer under a rule tuned to accept nothing it cannot vouch for.
      // The prefix is the decision's OWN id, so no two decisions mint the
      // same command id -- the canvas finds a command by id to copy it.
      commands: turn.output === null ? [] : extractCommands(turn.output, turn.id),
      // Always answered, zero included: this source CAN report tool failures,
      // so zero here is a reading and not a shrug. Absent is reserved for a
      // source that cannot look (`Decision.errorCount` in `model.ts`).
      errorCount: turn.errors,
    }));

  // Read off the SAME parsed lines: the questions are a second reading of one
  // pass over the window, not a second read of the file.
  return { aiTitle, branch, activity, decisions, questions: collectQuestions(lines) };
}
