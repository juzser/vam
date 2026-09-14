/**
 * WHAT THE OPERATOR SAID TO A SUBAGENT, WHICH THE SESSION'S OWN TRANSCRIPT
 * NEVER HEARD.
 *
 * `source.ts` reads `<slug>/<sessionId>.jsonl` and stated, in its own header,
 * why it read nothing else: "SUBAGENTS ARE NOT SESSIONS ... work happening
 * *under* a session ... rows are things the operator owns." The conclusion
 * still holds -- a subagent is not a row -- but its premise, that a subagent
 * is work nobody talks to, is false for an operator who converses with one.
 * Reported from use: a live session's row showed an IN from hours earlier.
 *
 * MEASURED BEFORE THIS WAS BUILT, on this machine's real transcripts:
 *
 *  - the session's own file had gone quiet nine minutes before, while the
 *    agent's was being written continuously;
 *  - of the 43 text-bearing `user` lines in the session's last 4 MB, ZERO were
 *    operator prompts -- every one was a task notification
 *    (`promptSource: "system"`), a meta line, or a CLI envelope;
 *  - the operator's four most recent messages appeared in that file exactly
 *    zero times, and all of them were in the agent's.
 *
 * ── WHY `transcript.ts` CANNOT SIMPLY BE POINTED AT THAT FILE ────────────
 * It would get both ends wrong, which is the whole reason this module exists:
 *
 *  - The first `user` line of a subagent transcript is the TASK BRIEF written
 *    by the parent agent. It is `isMeta: false` with no `promptSource` -- the
 *    exact shape `transcript.ts` classifies as an operator prompt -- so the
 *    row would show a seven-thousand-character agent brief as the operator's
 *    own words.
 *  - The operator's real message arrives `isMeta: true`, which
 *    `transcript.ts` EXCLUDES. The one line that matters is the one line it
 *    would skip.
 *
 * ── THREE ENVELOPES, ONE OPERATOR ───────────────────────────────────────
 * Counted over a real 42 MB agent transcript, the `isMeta` user lines are of
 * exactly three kinds: "The user sent a new message while you were working",
 * "The coordinator sent a message while you were working", and "[SYSTEM
 * NOTIFICATION - NOT USER INPUT]". The second is another AGENT and the third
 * says what it is in its own first four words. Only the first is a person, and
 * a row that showed either of the others as the operator's prompt would be two
 * different things drawn as one.
 *
 * ── AND IT IS ANCHORED, NEVER CONTAINED ─────────────────────────────────
 * While this defect was being measured, a shell command whose output quoted
 * the envelope was recorded as a tool result, and a substring search reported
 * five operator messages that did not exist. The structural test found one.
 * That is not a one-off: of the 58 lines across the whole corpus that mention
 * the envelope, 44 are real handoffs and 14 are not -- 8 `assistant` lines, 1
 * `attachment`, and 5 `user` lines without `isMeta`. All 44 real ones carry
 * `isMeta: true`, start with the envelope, and are timestamped.
 *
 * So every rule here matches a line's SHAPE and the START of its text. The one
 * place a raw substring is used is the walk's prefilter in `readOperatorTurn`,
 * which decides only whether a window is worth parsing and never whether a
 * line counts.
 *
 * MAIN-PROCESS ONLY in effect -- it is pure over text, but its reader is
 * driven by the filesystem source `source.ts` injects.
 */

import { join } from 'node:path';
import type { Decision } from '../../../renderer/domain/model.js';
import type { AgentRoster } from './agent-roster.js';
import { extractCommands } from './commands.js';
import {
  failedToolUseIds,
  type ReadCall,
  type TranscriptFacts,
  type Line as TranscriptLine,
  toolErrors,
  toolUseLabel,
  toolUses,
} from './transcript.js';
import { fileTranscriptSource, type TranscriptSource } from './window.js';

/** The one envelope that is the operator speaking inside an agent's thread. */
export const OPERATOR_HANDOFF = 'The user sent a new message while you were working:';

/**
 * The explanation Claude Code appends after the operator's words. Stripped,
 * because it is addressed to the agent and says nothing to a person reading a
 * row -- and because it is three times longer than most messages, so leaving
 * it in would push the words it wraps out of every truncation.
 */
const HANDOFF_TRAILER = 'This is how Claude Code surfaces messages the user sends mid-turn';

/**
 * How much of an agent transcript one step reads. The same 128 KiB `source.ts`
 * spends on a session tail and `history.ts` on a page back, for the same
 * reason: it is the size at which a real transcript yields a turn without the
 * read being felt.
 */
export const AGENT_WINDOW_BYTES = 128 * 1024;

/**
 * How far back one agent may be walked, IN TOTAL, before the walk gives up.
 *
 * MEASURED by reading all 869 subagent transcripts on this machine end to end
 * -- 649 MB: exactly 2 of them carry an operator handoff at all, and the
 * newest one sits 3,367 bytes from the end in one and 1,505,373 bytes back in
 * the other. So a single 128 KiB window finds one of the two, and the one it
 * misses is the reported defect -- an agent that has written a megabyte and a
 * half of tool output since the operator last spoke. Two mebibytes reaches 2
 * of 2 and refuses to walk a 42 MB file.
 *
 * THIS IS THE BACKSTOP, NOT THE USUAL BOUND. The walk normally stops on the
 * CLOCK, at the moment the session itself last heard from the operator, which
 * in the common case is one window in. The budget binds in the shape this fix
 * exists for: a session whose own file has gone quiet while its agent writes
 * for hours, where everything the walk passes IS newer than the session's last
 * word and the clock never fires.
 *
 * WHAT THAT WORST CASE COSTS, MEASURED RATHER THAN FEARED. On the one session
 * here with a live agent -- a 151.5 MB transcript whose agent had written past
 * the whole budget -- the walk read 1.6 MiB and took 5.5, 5.5 and 10.1 ms over
 * three runs, against 85-162 ms for reading all 80 sessions and a poll that
 * comes round every 10 s (`useSourceModel.ts`). A session with no live agent
 * pays nothing at all: no readdir, no stat, no byte.
 */
export const MAX_AGENT_SCAN_BYTES = 2 * 1024 * 1024;

/**
 * How many of a session's live agents are opened in one poll, newest first.
 *
 * Measured on this machine: 19 of 80 sessions have a subagent directory, 869
 * agent transcripts in all (the largest directory holds 460), and at the
 * moment of measuring, 2 sessions had a running agent -- one each, and 17 had
 * none. Bucketing every agent's mtime into five-minute windows puts the
 * busiest moment any session ever had at 5 concurrent agents. Six opens covers
 * that, and the ordering means the ones skipped past it are the least recently
 * written.
 *
 * IT IS A CAP ON TOP OF A BUDGET, and it is not redundant: the budget cannot
 * bound what costs nothing, so a directory of empty or vanished transcripts
 * would be opened all the way down without it.
 */
export const MAX_LIVE_AGENTS_READ = 6;

/** What one window of an agent transcript says. Every field may be absent. */
export type WindowScan = {
  /** The newest operator handoff in this window. */
  readonly prompt: string | null;
  /** When they said it, ISO 8601. */
  readonly at: string | null;
  /** The newest assistant text after that handoff, or in the window if none. */
  readonly output: string | null;
  /** The newest tool call, for the activity line. */
  readonly activity: string | null;
  /** When the agent last did anything -- see `latestAt` on `SubagentTurn`. */
  readonly latestAt: string | null;
};

/** One turn of an operator's conversation with an agent. */
export type SubagentTurn = {
  /** The operator's own words, machinery stripped. */
  readonly prompt: string;
  /** When they said it, ISO 8601 -- what lets a caller compare two sources. */
  readonly at: string;
  /** What the agent has said SINCE, or null while it has not answered yet. */
  readonly output: string | null;
  /** The newest tool call, for the activity line. */
  readonly activity: string | null;
  /**
   * WHEN THE AGENT LAST DID ANYTHING, which is what stops the pinned prompt
   * from reading as the current question: `promptAgeNote` draws its line off
   * the GAP between these two clocks, and a turn an operator handed to an
   * agent is exactly the long-running kind it exists for.
   */
  readonly latestAt: string | null;
};

/**
 * A walk's result AND ITS PRICE. The byte count is returned rather than
 * logged because it is the thing that has to stay small: it is what a test
 * pins, and what lets a caller running several agents share one budget
 * between them instead of handing each its own.
 */
export type AgentScan = {
  readonly turn: SubagentTurn | null;
  readonly bytesRead: number;
};

const NOTHING: AgentScan = { turn: null, bytesRead: 0 };

/**
 * The operator's own words out of a handoff line, or `null` if this is not
 * one.
 *
 * `startsWith`, never `includes` -- see the header. The words are what lies
 * between the opening line and the trailer; a handoff carrying nothing between
 * them is not a message and is refused rather than shown as an empty prompt.
 */
export function operatorHandoff(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(OPERATOR_HANDOFF)) return null;
  const body = trimmed.slice(OPERATOR_HANDOFF.length);
  const end = body.indexOf(HANDOFF_TRAILER);
  const words = (end === -1 ? body : body.slice(0, end)).trim();
  return words.length === 0 ? null : words;
}

type Part = { readonly type?: string; readonly text?: string; readonly name?: string };

function textOf(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Part[])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');
}

function toolNameOf(message: unknown): string | null {
  const content = (message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return null;
  for (const part of content as Part[]) {
    if (part?.type === 'tool_use' && typeof part.name === 'string') return part.name;
  }
  return null;
}

type Line = {
  type?: string;
  isMeta?: boolean;
  timestamp?: string;
  message?: unknown;
} & TranscriptLine;

function parseLine(raw: string): Line | null {
  if (!raw.startsWith('{')) return null;
  try {
    return JSON.parse(raw) as Line;
  } catch {
    // A window is cut at a byte boundary and a truncated line is expected, not
    // exceptional. `history.ts` and `transcript.ts` both skip rather than
    // refuse, and a reader that threw here would cost the whole row.
    return null;
  }
}

/**
 * What one window of a subagent transcript says about the operator.
 *
 * ONE PASS, FORWARD. The prompt is the LAST handoff in the window and the
 * answer is the last assistant text AFTER it -- which is why the answer is
 * cleared when a newer handoff arrives rather than kept from the turn before.
 * `transcript.ts` learned that the expensive way: a prompt shown beside the
 * next turn's answer makes every turn in the pane describe the one after it.
 *
 * With no handoff in the window at all the answer and the activity are still
 * reported, because that is exactly what the TAIL of a file whose handoff is a
 * megabyte further back has to contribute.
 */
export function scanAgentWindow(window: string): WindowScan {
  let prompt: string | null = null;
  let at: string | null = null;
  let output: string | null = null;
  let activity: string | null = null;
  let latestAt: string | null = null;

  for (const raw of window.split('\n')) {
    const line = parseLine(raw);
    if (line === null) continue;
    if (line.type === 'user' && line.isMeta === true) {
      const words = operatorHandoff(textOf(line.message));
      if (words !== null) {
        prompt = words;
        at = typeof line.timestamp === 'string' ? line.timestamp : null;
        // A new ask opens a new turn: what the agent said about the LAST one
        // is not an answer to this one.
        output = null;
      }
      continue;
    }
    if (line.type !== 'assistant') continue;
    activity = toolNameOf(line.message) ?? activity;
    // EVERY assistant line counts, an answer as much as a tool call: both are
    // the agent doing something, on the rule `transcript.ts` keeps for a
    // session's own turns.
    if (typeof line.timestamp === 'string') latestAt = line.timestamp;
    const said = textOf(line.message).trim();
    if (said.length > 0) output = said;
  }
  return { prompt, at, output, activity, latestAt };
}

/**
 * WHERE THE NEXT STEP BACK ENDS, and the guarantee that there IS a next step.
 *
 * `trimToLineStart` normally answers a start INSIDE the range, the head of the
 * first whole line, and the next step ends there -- deliberately re-reading
 * the partial line it cut, which is the overlap `history.ts` pays for the same
 * reason. But a range holding no newline at all answers a start equal to its
 * END, and stepping to that is stepping to where the walk already was: the
 * loop spends nothing, moves nowhere, and no budget can end it. That is a
 * transcript whose line is longer than one window, which an agent's enormous
 * tool results make ordinary, and it hung the first run of the budget test.
 *
 * THE RESIDUAL, stated because it is real: skipping to `from` there means a
 * handoff line longer than one window can be cut at both ends and parsed at
 * neither, so it is missed. That is an operator message of more than 128 KiB.
 */
function stepBack(from: number, start: number, end: number): number {
  return start > from && start < end ? start : from;
}

/** The timestamp of a window's FIRST line -- its oldest, since a window begins on one. */
function oldestStampIn(window: string): string | null {
  const nl = window.indexOf('\n');
  const line = parseLine(nl === -1 ? window : window.slice(0, nl));
  return typeof line?.timestamp === 'string' ? line.timestamp : null;
}

/** Older than the horizon, by the clock, when both can be read. */
function precedes(stamp: string | null, horizon: string | null): boolean {
  if (stamp === null || horizon === null) return false;
  const a = Date.parse(stamp);
  const b = Date.parse(horizon);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

/**
 * The operator's newest words in ONE agent transcript, and what it cost.
 *
 * THE TAIL FIRST, THE WALK ONLY IF IT HAS TO. 867 of the 869 agent transcripts
 * here have never carried an operator message -- read end to end to be sure of
 * it -- so the common answer is "no" and it must be cheap: one window, and the
 * clock ends it.
 *
 * THE WALK LOCATES, IT DOES NOT PARSE. Each step back is searched as raw text
 * for the envelope and only a step that contains it is parsed -- so reaching a
 * handoff 1.5 MB back costs twelve buffer searches and ONE window of JSON,
 * not 1.5 MB of it. That prefilter is a superset by construction (a tool
 * result that merely quotes the envelope matches it), which is safe precisely
 * because it decides only whether to spend a parse: `scanAgentWindow` is what
 * decides whether a line counts, structurally, and a quoted mention fails it
 * and the walk continues.
 *
 * `horizon` is the moment the session itself last heard from the operator.
 * Nothing older can beat what the row already shows, so the walk stops there
 * -- which is why a session whose own prompt is fresh pays almost nothing, and
 * a session whose own prompt is stale (the defect's own shape) pays in
 * proportion to how stale it is.
 */
export async function readOperatorTurn(
  source: TranscriptSource,
  horizon: string | null,
  windowBytes: number = AGENT_WINDOW_BYTES,
  budgetBytes: number = MAX_AGENT_SCAN_BYTES,
): Promise<AgentScan> {
  let size: number;
  try {
    size = await source.size();
  } catch {
    // An agent transcript vanished or cannot be read. It costs this agent and
    // nothing else -- the rule `agent-roster.ts` keeps for the directory
    // beside it, and the session is live and still has a row.
    return NOTHING;
  }
  if (size <= 0) return NOTHING;

  let spent = 0;
  let tail: WindowScan;
  let end: number;
  try {
    const from = Math.max(0, size - windowBytes);
    const window = await source.read(from, size);
    // WHAT WAS READ, not what survived the trim: the budget is an I/O bound,
    // and the bytes a partial first line costs were still fetched.
    spent = size - from;
    end = stepBack(from, window.start, size);
    tail = scanAgentWindow(window.text);
    if (tail.prompt !== null) {
      return { turn: { ...tail, prompt: tail.prompt, at: tail.at ?? '' }, bytesRead: spent };
    }
    if (precedes(oldestStampIn(window.text), horizon)) return { turn: null, bytesRead: spent };
  } catch {
    return NOTHING;
  }

  while (end > 0 && spent < budgetBytes) {
    const from = Math.max(0, end - windowBytes);
    let text: string;
    let start: number;
    try {
      const window = await source.read(from, end);
      text = window.text;
      start = window.start;
    } catch {
      return { turn: null, bytesRead: spent };
    }
    spent += end - from;
    end = stepBack(from, start, end);
    if (text.includes(OPERATOR_HANDOFF)) {
      const found = scanAgentWindow(text);
      if (found.prompt !== null) {
        // The PROMPT is here and the ANSWER is in the tail: there is no newer
        // handoff between them, so everything the agent has said since is this
        // turn's, and the newest of it is what the tail already read.
        if (precedes(found.at, horizon)) return { turn: null, bytesRead: spent };
        return {
          turn: {
            prompt: found.prompt,
            at: found.at ?? '',
            output: tail.output,
            activity: tail.activity,
            latestAt: tail.latestAt,
          },
          bytesRead: spent,
        };
      }
    }
    if (precedes(oldestStampIn(text), horizon)) break;
  }
  return { turn: null, bytesRead: spent };
}

/** What the SESSION's own transcript already says the operator last asked. */
export type OwnPrompt = {
  /** Whether the session has a turn of its own at all. */
  readonly present: boolean;
  /** When that turn was asked, or null when the source cannot say. */
  readonly at: string | null;
};

/**
 * WHAT THE SESSION SAYS ABOUT ITS OWN NEWEST ASK, and the fallback that keeps
 * this whole change from being inert.
 *
 * `transcript.ts` leaves `promptedAt` null for a turn `last-prompt` opened
 * alone -- the operator's `user` line is above the top of the 128 KiB window
 * -- because that marker carries no clock at all (0 of 25,259 measured).
 * Refusing to compare there looked like the careful choice, and the corpus
 * said it was the inert one: of the 69 sessions here whose tail holds a turn,
 * 40 carry a dated newest prompt and 29 do NOT -- and the one session with a
 * live agent at the moment of measuring was one of the 29. The careful rule
 * would have done nothing for the case that reported the defect.
 *
 * SO THE FALLBACK IS `latestAt`, AND ITS DIRECTION IS THE POINT. A prompt
 * precedes its own turn's steps, so the newest step is an UPPER bound on when
 * the operator asked. Standing in for the question, it makes the agent's
 * message clear a HIGHER bar than the truth -- it can only refuse a turn that
 * deserved to win, never promote one that did not. All 29 carry it.
 */
export function ownPromptOf(facts: TranscriptFacts): OwnPrompt {
  const newest = facts.decisions[0];
  if (newest === undefined) return { present: false, at: null };
  return { present: true, at: newest.promptedAt ?? newest.latestAt ?? null };
}

/**
 * Whether an agent's turn is newer than what the session already shows.
 *
 * THE RULE THE OPERATOR APPROVED: the row shows the newest thing THE OPERATOR
 * said in this session, wherever they said it. So the row changes only when
 * the operator speaks -- never because two agents happen to be writing at
 * once, which is what makes "which agent wins" a question with no arbitration
 * in it: a person can only have spoken last once.
 *
 * AND "CANNOT TELL" LOSES. A turn opened by `last-prompt` alone carries no
 * clock -- 0 of 25,259 of those lines have a timestamp (`transcript.ts`) --
 * and displacing a prompt whose age is unknown would be guessing with the
 * operator's own words. A session with no turn at all has nothing to lose,
 * which is the reported case exactly: zero operator prompts in its window.
 */
export function agentTurnWins(own: OwnPrompt, turn: SubagentTurn): boolean {
  const mine = Date.parse(turn.at);
  if (!Number.isFinite(mine)) return false;
  if (!own.present) return true;
  if (own.at === null) return false;
  const theirs = Date.parse(own.at);
  return Number.isFinite(theirs) && mine > theirs;
}

/** An agent's turn, and which agent it was read from. */
export type LiveAgentTurn = SubagentTurn & { readonly agentId: string };

/**
 * The operator's newest words across a session's LIVE agents, under one shared
 * budget.
 *
 * ONE BUDGET BETWEEN THEM, not one each: a session running six agents must not
 * cost six times a session running one. The agents arrive newest-written
 * first, so what an exhausted budget skips is always the least recently
 * touched -- the least likely to be holding the newest thing a person said.
 */
export async function readLiveAgentTurn(
  agentIds: readonly string[],
  sourceFor: (id: string) => TranscriptSource,
  own: OwnPrompt,
  windowBytes: number = AGENT_WINDOW_BYTES,
  budgetBytes: number = MAX_AGENT_SCAN_BYTES,
): Promise<LiveAgentTurn | null> {
  let best: LiveAgentTurn | null = null;
  let left = budgetBytes;
  for (const id of agentIds.slice(0, MAX_LIVE_AGENTS_READ)) {
    if (left <= 0) break;
    // The horizon rises as candidates are found: once one agent has yielded a
    // turn, only something newer than THAT is worth walking back for.
    const horizon = best?.at ?? own.at;
    const scan = await readOperatorTurn(sourceFor(id), horizon, windowBytes, left);
    left -= scan.bytesRead;
    if (scan.turn === null) continue;
    if (!agentTurnWins(own, scan.turn)) continue;
    if (best === null || Date.parse(scan.turn.at) > Date.parse(best.at)) {
      // WHICH agent, carried out with it: the turn is drawn as the session's
      // own, but its id has to name the file it was read from or two agents
      // asked the same thing at the same moment would mint one id.
      best = { ...scan.turn, agentId: id };
    }
  }
  return best;
}

/**
 * The agent's turn, drawn as one of the session's own.
 *
 * NO SOURCE MARKER, AND THAT IS DELIBERATE. There is no badge saying "this
 * came from a subagent", because the row's claim is not "the session
 * transcript says this" -- it is "this is what you last asked, and this is
 * what has happened since", which is true. A marker would be vam explaining
 * its own filesystem layout to someone who asked what their session is doing.
 *
 * ABSENT, NOT ZERO, for `errorCount` and `steps`: `model.ts` reserves absence
 * for a source that cannot report a thing and zero for a reading. vam does not
 * count the agent window's tool failures and does not collect its calls, so
 * saying zero would be a claim it never checked.
 *
 * THE ID CANNOT COLLIDE with a session turn's. Those are `<prefix>:@<offset>`
 * or `<prefix>:<fingerprint>:<n>` (`transcript.ts`); this names the agent file
 * and the moment the operator spoke, so it is stable while that ask is the
 * newest and becomes a different id when they ask again -- which is what the
 * pane needs to keep a selection without pinning stale text under it.
 */
export function agentDecision(
  turn: LiveAgentTurn,
  idPrefix: string,
  facts: TranscriptFacts,
): Decision {
  const id = `${idPrefix}:${turn.agentId}@${turn.at}`;
  return {
    id,
    // The caption the session's own turns carry. A turn that named itself
    // differently would read as a different KIND of thing, which it is not.
    label: facts.decisions[0]?.label ?? 'claude-code',
    input: turn.prompt,
    output: turn.output,
    commands: turn.output === null ? [] : extractCommands(turn.output, id),
    promptedAt: turn.at,
    latestAt: turn.latestAt,
  };
}

/**
 * The session's facts, with the operator's newest words in front of them
 * wherever they were said.
 *
 * THE ROW IS STILL A SESSION and its own turns are still under this one: an
 * operator who walks over to an agent has not deleted what the session did
 * before that. Only the NEWEST turn can come from somewhere else, and only
 * when the operator themselves put it there.
 *
 * THE ACTIVITY MOVES WITH IT. A row showing one file's question over another
 * file's working would say two things at once, which is the defect this repo
 * keeps finding rather than one it should add.
 */
export async function withLiveAgentTurn(
  facts: TranscriptFacts,
  roster: AgentRoster,
  subagentsDir: string,
  idPrefix: string,
): Promise<TranscriptFacts> {
  // The roster is newest-written first and already knows which agents are
  // live -- the same set the `●N` badge counts, so the row and the Agents tab
  // can never disagree about which agents are running. Nothing here walks a
  // directory or stats a file: that read was already paid for the badge.
  const live = roster.agents.filter((a) => a.running).map((a) => a.id);
  if (live.length === 0) return facts;

  const own = ownPromptOf(facts);
  const turn = await readLiveAgentTurn(
    live,
    (id) => fileTranscriptSource(join(subagentsDir, `${id}.jsonl`)),
    own,
  );
  if (turn === null) return facts;
  return {
    ...facts,
    activity: turn.activity ?? facts.activity,
    decisions: [agentDecision(turn, idPrefix, facts), ...facts.decisions],
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * THE AGENTS PANE'S DETAIL SIDE: one subagent's work, as turns.
 *
 * The Agents tab was a flat list of rows -- a dot, a type, a description --
 * and the operator asked for the list to become a navigator with the selected
 * agent's work beside it, "with in/out/progress". Those are the three things a
 * `Decision` already carries, so this produces `Decision`s and the pane reuses
 * the turn renderer it has rather than growing a second one.
 *
 * WHY `summarizeTranscript` IS NOT WHAT RUNS HERE, measured before this was
 * written: of 250 of the 872 subagent transcripts on this machine, ZERO carry
 * a `type:'last-prompt'` line and it returns ZERO turns for all 250. That is
 * it being right, not wrong -- a turn there is opened by the operator's line
 * and NAMED by the marker after it, and an agent's thread has no markers, so
 * every turn it opens is correctly dropped as unnamed. Reusing it would have
 * drawn an empty pane for every agent on the machine.
 *
 * A TURN HERE IS OPENED BY WHAT WAS SAID *TO* THE AGENT, and there are exactly
 * two kinds of that: the TASK BRIEF the parent wrote, and an OPERATOR HANDOFF.
 * Everything else on a `user` line is a tool result, which is an answer to a
 * call and not a thing anyone said.
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Is this `user` line something said TO the agent, and what was said?
 *
 * `null` for a tool result, for the two envelopes that are not the operator,
 * and for a line with no text. The `isMeta` split is the whole classifier:
 * meta means the operator (or one of the impostors `operatorHandoff` refuses),
 * and non-meta means the parent's brief.
 */
function saidToAgent(line: Line): string | null {
  if (isToolResult(line)) return null;
  const text = textOf(line.message).trim();
  if (text === '') return null;
  return line.isMeta === true ? operatorHandoff(text) : text;
}

function isToolResult(line: Line): boolean {
  const content = (line.message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return false;
  return (content as Part[]).some((part) => part?.type === 'tool_result');
}

/**
 * One subagent's turns, OLDEST FIRST -- the order a pane reads top to bottom,
 * and the order `TranscriptPage` uses, rather than a session row's newest-first
 * `decisions`.
 *
 * THE ATTRIBUTION RULES ARE `transcript.ts`'s, because they were argued for
 * there and a second set of them would be a second set to get wrong: an answer
 * belongs to the turn that was OPEN, a call belongs to the turn that was open
 * when it was MADE, and work that happened before the window's first turn is
 * charged to NOTHING rather than to the turn that had not started.
 *
 * ZERO AND EMPTY ARE READINGS. `model.ts` reserves absence for a source that
 * cannot report a thing; this one looks at every line, so `errorCount` and
 * `steps` are always answered.
 */
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function agentTurns(window: string, idPrefix: string): readonly Decision[] {
  type Open = {
    input: string;
    promptedAt: string | null;
    latestAt: string | null;
    output: string | null;
    errors: number;
    calls: ReadCall[];
  };
  const turns: Open[] = [];

  for (const raw of window.split('\n')) {
    const line = parseLine(raw);
    if (line === null) continue;
    const stamp = typeof line.timestamp === 'string' ? line.timestamp : null;

    if (line.type === 'user') {
      const asked = saidToAgent(line);
      if (asked !== null) {
        turns.push({
          input: asked,
          promptedAt: stamp,
          latestAt: null,
          output: null,
          errors: 0,
          calls: [],
        });
        continue;
      }
      // A tool result belongs to the turn that was open when it arrived. With
      // no open turn -- the window began mid-run -- it is charged to nothing.
      const open = turns.at(-1);
      if (open === undefined) continue;
      open.errors += toolErrors(line);
      for (const id of failedToolUseIds(line)) {
        for (const call of open.calls) if (call.toolUseId === id) call.failed = true;
      }
      continue;
    }

    if (line.type !== 'assistant') continue;
    const open = turns.at(-1);
    if (open === undefined) continue;
    // WHEN THE TURN LAST DID ANYTHING: every assistant line counts, an answer
    // as much as a tool call -- both are the agent doing something.
    if (stamp !== null) open.latestAt = stamp;
    const text = textOf(line.message).trim();
    if (text !== '') open.output = text;
    for (const part of toolUses(line)) {
      open.calls.push({ toolUseId: str(part['id']), label: toolUseLabel(part), failed: false });
    }
  }

  return turns.map((turn, index) => {
    // POSITIONAL, AND BOUNDED TO ONE READ. A session turn's id is a byte
    // offset because two windows of the same file must agree on it; nothing
    // pages an agent, so there is no second window to agree with, and an index
    // within this read is unique by construction whatever the provider wrote.
    const id = `${idPrefix}:${index}`;
    return {
      id,
      label: idPrefix,
      input: turn.input,
      output: turn.output,
      commands: turn.output === null ? [] : extractCommands(turn.output, id),
      errorCount: turn.errors,
      promptedAt: turn.promptedAt,
      latestAt: turn.latestAt,
      steps: turn.calls.map((call, at) => ({
        id: `${id}:${at}`,
        label: call.label,
        failed: call.failed,
      })),
    };
  });
}
