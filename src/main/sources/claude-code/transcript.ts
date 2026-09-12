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
 * largest is 157 MB. Nothing the CANVAS draws needs the beginning: the branch,
 * the title, the newest turns and the current tool call are all re-stated near
 * the end. So this function is written to work on a byte suffix and to
 * tolerate the consequences of one -- a first line cut mid-token, and a window
 * that may open in the middle of a turn whose prompt is off-screen.
 *
 * IT IS NO LONGER ONLY A TAIL. `history.ts` runs this same function over EARLIER
 * windows of the same file, on demand, so the operator can scroll back through
 * a session the tail shows a third of. That is why the window's own position
 * is now an argument (`windowStart`) rather than an unknown: identity has to
 * survive the window moving, and nothing on the line that opens a turn is both
 * present and constant across the window's possible cuts. See `turnFingerprint`.
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

/** One parsed line, and where in the FILE it begins. */
type Located = {
  readonly line: Line;
  /**
   * The absolute byte offset of this line, or `null` when the caller did not
   * say where its window begins -- see `summarizeTranscript`'s `windowStart`.
   */
  readonly start: number | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function parseLines(tail: string, windowStart: number | null): Located[] {
  const out: Located[] = [];
  // Offsets are counted in BYTES, not characters: one emoji in a prompt would
  // otherwise put every line after it in the wrong place, and an id minted
  // from the wrong place is exactly the bug this counting exists to fix.
  //
  // The count is only sound because the caller hands over a window that begins
  // on a whole line (`window.ts`); a leading fragment would decode to U+FFFD
  // and re-encode to a different length. A caller that cannot promise that
  // passes `null` and gets the content-derived id below instead.
  let at = 0;
  for (const raw of tail.split('\n')) {
    const start = windowStart === null ? null : windowStart + at;
    at += Buffer.byteLength(raw, 'utf8') + 1;
    if (raw.trim() === '') continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === 'object' && value !== null) out.push({ line: value as Line, start });
    } catch {
      // A partial or non-JSON line is data we do not have, not an error. The
      // LAST line of a tail is routinely one: the file is being appended to.
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

/**
 * One `{type:'tool_use'}` part, as the name a person reads.
 *
 * The tool's own `description` where it wrote one, because `Bash` alone says
 * nothing and `Bash: run the tests` is the whole of what a progress row is
 * for. Cut at `ACTIVITY_LIMIT`: 228 labels in the measured corpus run past 80
 * characters and the longest is 1,057, and neither the activity line nor a
 * progress row draws more than one line of it anyway.
 */
function toolUseLabel(part: Line): string {
  const input = part['input'];
  const description =
    typeof input === 'object' && input !== null ? str((input as Line)['description']) : null;
  const name = str(part['name']) ?? 'tool';
  return `${name}${description === null ? '' : `: ${description}`}`.slice(0, ACTIVITY_LIMIT);
}

/** Every `{type:'tool_use'}` part of an assistant message, in order. */
function toolUses(line: Line): readonly Line[] {
  const message = line['message'];
  if (typeof message !== 'object' || message === null) return [];
  const content = (message as Line)['content'];
  if (!Array.isArray(content)) return [];
  const parts: Line[] = [];
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as Line;
    if (p['type'] === 'tool_use') parts.push(p);
  }
  return parts;
}

/**
 * The FIRST tool call of an assistant message, if any -- the activity line.
 *
 * First, not last, and unchanged now that a turn keeps all of them: `activity`
 * is one phrase for "what is it doing", and a line carrying three parallel
 * calls has no single answer. The turn's `steps` is where all three are.
 */
function toolUse(line: Line): string | null {
  const first = toolUses(line)[0];
  return first === undefined ? null : toolUseLabel(first);
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

/**
 * WHICH calls this line reports as failed, by `tool_use_id`.
 *
 * The other half of `toolErrors`, and deliberately a second reading of the
 * same parts rather than one function returning both: the COUNT must keep
 * counting failures that name a call vam never read (a window that opened
 * between a call and its result), and a function that returned only matched
 * ids would quietly shrink it.
 *
 * Matching by id is a reading and not a heuristic -- measured over the 77 real
 * session transcripts, all 1,221 `is_error:true` results named a
 * `tool_use_id` that matches a call in the same file.
 */
function failedToolUseIds(line: Line): readonly string[] {
  const message = line['message'];
  if (typeof message !== 'object' || message === null) return [];
  const content = (message as Line)['content'];
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as Line;
    if (p['type'] !== 'tool_result' || p['is_error'] !== true) continue;
    const id = str(p['tool_use_id']);
    if (id !== null) ids.push(id);
  }
  return ids;
}

/**
 * One tool call while it is still being read, before it becomes a `TurnStep`.
 *
 * It carries the PROVIDER's `tool_use.id` because that is what a result names
 * itself against; the id the renderer sees is vam's own, minted from the turn
 * and the call's position once the turn has an id at all (see `idOf` below).
 * A list keyed on a value vam does not mint collapses two rows the day one
 * repeats.
 */
type ReadCall = { readonly toolUseId: string | null; readonly label: string; failed: boolean };

/** `2m`, `6h`, `3d` -- the compact form the sidebar right-aligns. */
export function compactAge(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * A short, content-derived fingerprint of a turn's own prompt. THE FALLBACK
 * identity, used only when the caller cannot say where its window begins;
 * `idOf` below prefers the turn's absolute position and explains why.
 *
 * WHY CONTENT, NOT POSITION. `id` used to be `${prefix}:${index}`, counted
 * from the newest end of the kept window -- so appending one turn shifted
 * every earlier turn's index, and the same id string named a DIFFERENT turn
 * on the next poll. That was invisible while nothing remembered an id
 * across two parses of the file; it stopped being invisible the moment the
 * detail panel let an operator sit on a historical turn and the canvas's own
 * step focus does the equivalent by slot. The one thing every turn genuinely
 * owns, independent of where the window happens to be cut, is its own prompt
 * -- so identity is derived from that instead of from a place in a list.
 *
 * WHY A HASH OF `input` ALONE IS NOT ENOUGH: two turns can carry the exact
 * same words (an operator resending "continue"), so this is combined with
 * `idOf`'s own rank -- the count of same-fingerprint turns strictly BEFORE
 * this one, oldest-first, within THIS SAME PARSE. Ranking from the oldest
 * end rather than the newest is deliberate: a turn's rank depends only on
 * turns before it, so appending ANY new turn never changes it.
 *
 * WHAT IT STILL CANNOT DO, and why it is no longer the primary scheme: if one
 * of two same-input turns falls out of the byte window entirely, the
 * survivor's rank -- and so its id -- shifts. Paging backwards moves the
 * window ON PURPOSE, so that is no longer a narrow residual; measured against
 * the real corpus (35 transcripts over 300 KB, each parsed at 64 KiB, 128 KiB,
 * 512 KiB and 4 MiB), 28 of 296 turn appearances changed id when only the
 * window size changed.
 *
 * sha256 mirrors `project-id.ts`'s own digest -- the same move for the same
 * reason: a stable id that carries no raw content. Not a security boundary --
 * collisions are handled by `idOf`'s rank, not prevented by hash width -- so
 * a short slice is enough.
 */
function turnFingerprint(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

/**
 * The mark that separates a positional id from the fingerprint form, and the
 * one `turnStartOf` reads back. `:` alone would be ambiguous -- the prefix is
 * a session id and the fingerprint form already uses two of them.
 */
const OFFSET_MARK = '@';

/**
 * The absolute byte offset an id (or a cursor) names, or `null` for one that
 * names no position at all.
 *
 * Deliberately beside the minting site so the two cannot drift: `history.ts`
 * pages backwards by reading a position back out of the id of the oldest turn
 * it has, and an id format that changed here without changing there would turn
 * every "load more" into a silent refusal.
 *
 * It accepts BOTH shapes a caller can hold: a decision id
 * (`<prefix>:@<offset>`) and a bare cursor (`@<offset>`) this endpoint handed
 * out for a page that contained no turn to name.
 */
export function turnStartOf(id: string): number | null {
  const mark = id.lastIndexOf(OFFSET_MARK);
  if (mark === -1) return null;
  // Everything before the mark must be the prefix and its separator, or
  // nothing at all -- so an `@` inside a session id cannot be read as an
  // offset marker.
  if (mark !== 0 && id[mark - 1] !== ':') return null;
  const digits = id.slice(mark + 1);
  if (!/^\d+$/.test(digits)) return null;
  const offset = Number(digits);
  return Number.isSafeInteger(offset) ? offset : null;
}

/**
 * Whether a cursor NAMES A TURN the caller already holds, as opposed to being a
 * bare position this endpoint handed back for a page that had no turn to name.
 *
 * The difference decides whether a backward read may return the turn that is
 * open at the cursor: a caller holding that turn must not be handed it twice,
 * and a caller holding nothing there must not have it withheld. The two shapes
 * are the two `turnStartOf` accepts -- `<prefix>:@<offset>` and `@<offset>` --
 * so the distinction is carried by the id itself and cannot be lost in transit.
 */
export function cursorNamesATurn(cursor: string): boolean {
  return turnStartOf(cursor) !== null && cursor.lastIndexOf(OFFSET_MARK) > 0;
}

export function summarizeTranscript(
  tail: string,
  decisionIdPrefix: string,
  /**
   * The absolute byte offset `tail` begins at, or `null` for a caller that
   * does not know. Only a window trimmed to a whole line may pass a number
   * (`window.ts` says why), and passing the wrong one would mint ids that
   * disagree with every other read of the same file.
   */
  windowStart: number | null = null,
): TranscriptFacts {
  const located = parseLines(tail, windowStart);
  const lines = located.map((l) => l.line);

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
  //
  // `calls` is the turn's working, oldest first. It is a MUTABLE array held by
  // reference: the record itself is replaced by a spread every time the answer
  // grows, and a list rebuilt on each of those would be quadratic in a turn
  // that made 2,144 calls -- the largest in the measured corpus. The spread
  // copies the reference, so a push reaches whichever record is current.
  // `failed` is likewise set in place when the result arrives.
  const turns: {
    input: string;
    output: string | null;
    errors: number;
    start: number | null;
    calls: ReadCall[];
  }[] = [];

  for (const { line, start } of located) {
    branch = str(line['gitBranch']) ?? branch;

    const type = line['type'];
    if (type === 'ai-title') aiTitle = str(line['aiTitle']) ?? aiTitle;
    else if (type === 'agent-name') agentName = str(line['agentName']) ?? agentName;
    else if (type === 'last-prompt') {
      const prompt = str(line['lastPrompt']);
      // Re-emitted constantly, and an unchanged value is the same turn:
      // measured across the whole corpus, 21,604 of 22,668 `last-prompt` lines
      // repeat the turn that is already open.
      if (prompt !== null && turns.at(-1)?.input !== prompt) {
        turns.push({ input: prompt, output: null, errors: 0, start, calls: [] });
      }
    } else if (type === 'assistant') {
      const text = messageText(line);
      if (text !== null) {
        const open = turns.at(-1);
        if (open !== undefined) turns[turns.length - 1] = { ...open, output: text };
      }
      activity = toolUse(line) ?? activity;
      // THE TURN'S WORKING, on the same attribution rule the count below
      // keeps: a call belongs to the turn that was open when it was made, and
      // a call made before any prompt in the window is charged to nothing --
      // putting it under the NEXT prompt would draw working under a turn that
      // had not started.
      const working = turns.at(-1);
      if (working !== undefined) {
        for (const part of toolUses(line)) {
          working.calls.push({
            toolUseId: str(part['id']),
            label: toolUseLabel(part),
            failed: false,
          });
        }
      }
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
      // AND WHICH CALL IT WAS, where vam read the call. A result naming a call
      // outside the window marks nothing and still counts above -- which is
      // why the count is not derived from this list.
      if (open !== undefined) {
        for (const id of failedToolUseIds(line)) {
          for (const call of open.calls) if (call.toolUseId === id) call.failed = true;
        }
      }
    }
  }

  // IDS, MINTED OLDEST-FIRST, OVER THE FULL LIST -- before the byte budget
  // below ever slices it. A turn's id may depend only on itself and on turns
  // strictly BEFORE it, never on how many exist after it, or appending a turn
  // would keep renumbering everything that already existed.
  //
  // WHERE THE TURN BEGINS IS THE IDENTITY, when the caller said where its
  // window begins. A transcript is append-only, so the byte offset of a line
  // is fixed the moment it is written: the same turn is `<prefix>:@<offset>`
  // in the 128 KiB tail `load()` reads, in a 4 MiB page read on demand, and in
  // every later poll of a file that has since grown. That is what makes a
  // page's overlap with the tail dedupable and an operator's selected turn
  // survive scrolling back.
  //
  // WHY NOT A FIELD THE CLI ALREADY WRITES, which is the obvious question and
  // was measured before this was written, against the 77 real SESSION
  // transcripts on this machine -- not the 863 subagent sidechains beside them,
  // which vam never opens:
  //
  //  - `type:'last-prompt'` -- the only line that opens a turn here -- carries
  //    NO `uuid` (0 of 224 in the tails sampled). It carries `leafUuid`, on
  //    100% of them, and that names the conversation leaf at the moment the
  //    line was written, not the turn: 21,592 of 21,604 re-emissions of an
  //    already-open turn carry a DIFFERENT one.
  //  - `promptId` (on 100% of `type:'user'` lines) is finer-grained than a
  //    turn: keyed on the one in scope when the turn opened, 55 of 296 turn
  //    appearances disagreed across window sizes -- worse than the fingerprint
  //    scheme's own 28.
  //  - The operator's own `user` line CAN be matched to a turn by text, but
  //    only for 884 of 1,064 turns, and a window opening between that line and
  //    the first `last-prompt` line would then identify the same turn two
  //    different ways.
  //
  // WHY THIS IS NOT THE POSITIONAL SCHEME THAT WAS REMOVED: that one counted
  // turns from the newest end of a window, so it moved whenever the file grew
  // or the window changed. This is an offset into an append-only file, which
  // is the one position in this data that never moves.
  //
  // THE RESIDUAL, stated because it is real: `last-prompt` re-emits, so a
  // window that opens in the MIDDLE of a turn opens that turn at a re-emission
  // and gives it that line's offset. Only the oldest turn of a window can be
  // affected, and `history.ts` drops exactly that one turn from a page rather
  // than hand out an id it cannot promise.
  const rank = new Map<string, number>();
  const idOf = (turn: { readonly input: string; readonly start: number | null }): string => {
    if (turn.start !== null) return `${decisionIdPrefix}:${OFFSET_MARK}${turn.start}`;
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
      // The turn's working, on the same rule: always a list, empty included.
      // Ids are the TURN's plus the call's position, so they are unique within
      // the turn by construction whatever the provider wrote. Nothing caps the
      // length here -- the window is the budget, as it is for `MAX_DECISIONS`
      // -- and the column decides how many rows it draws.
      steps: turn.calls.map((call, index) => ({
        id: `${turn.id}:s${index}`,
        label: call.label,
        failed: call.failed,
      })),
    }));

  // Read off the SAME parsed lines: the questions are a second reading of one
  // pass over the window, not a second read of the file.
  return { aiTitle, branch, activity, decisions, questions: collectQuestions(lines) };
}
