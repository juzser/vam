/**
 * KEEPING AN OPEN `AskUserQuestion` IN VIEW PAST THE TAIL WINDOW THAT MISSES IT.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 *
 * `tail.ts`'s widening read stops the moment it holds the raw material of ONE
 * turn (`holdsATurn`) -- any `user` line and any `assistant` line, wherever
 * they are. That rule was written for the Response view's decisions, and it
 * is right for them: a turn's prompt and reply are what the pane draws, and
 * the window should stop reading the moment it has one.
 *
 * It is the WRONG rule for a pending question. An `AskUserQuestion` is a
 * `tool_use` on an `assistant` line, same as any other tool call, so nothing
 * marks it as special to the stop condition. A burst of ordinary conversation
 * AFTER the question -- more tool calls, more replies, none of them the
 * answer -- satisfies `holdsATurn` on its own, on the newest step alone, and
 * the read stops there. The question's own line, further back, is never
 * read. `collectQuestions` (`questions.ts`) only sees what is IN the window;
 * a `tool_use` outside it is not a question vam read and found closed, it is
 * a question vam never asked the file about. The card the Response view was
 * showing goes silently blank while the session is still waiting.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * A transcript is append-only, so "is there a newer `AskUserQuestion` than
 * the one I last knew about, and has IT been answered" is a question whose
 * answer only ever needs the bytes written SINCE the last time it was asked.
 * This module keeps exactly that: for one transcript path, the byte offset
 * through which it has already looked (`consumedThrough`) and the newest
 * `AskUserQuestion` it found still open, if any. Each poll hands over the
 * file's current size; the module reads only `[consumedThrough, size)` --
 * typically the single line Claude Code just appended -- and folds it into
 * the state it already had. A file that has not grown since the last look
 * costs no read at all.
 *
 * THE FIRST LOOK AT A FILE has no `consumedThrough` to start from, and is the
 * one case this cannot make free: it reads the last `QUESTION_SCAN_CAP_BYTES`
 * (the operator's 2-4 MiB, at the upper end so a slow-to-answer question
 * still fits) in ONE bounded read -- not stepped, unlike `tail.ts`'s widening,
 * because this runs once per session's whole lifetime in this process rather
 * than once per poll, and a fixed generous cap costs less to reason about
 * than a loop that pays for itself only over many polls it will not get.
 * Whatever lies before that cap is a question this module cannot see, on the
 * same terms `tail.ts`'s own ceiling is a valve and not a promise.
 *
 * A LINE STRADDLING A WINDOW BOUNDARY is data not yet read, never data
 * mis-read: `[from, to)` is trimmed to whatever complete lines it holds
 * (`window.ts`, `lastIndexOf('\n')` here) and `consumedThrough` stops at the
 * last one, so the SAME bytes are re-offered next time rather than a half
 * line being parsed or a line being skipped. The common cause is the file
 * itself being mid-append; the fix is not reading past what is actually
 * there yet.
 *
 * A FILE SMALLER THAN WHAT WAS ALREADY CONSUMED is impossible for an
 * append-only log that has not been touched -- so it is read as evidence that
 * this is not the same file continuing (truncated, or a new session's
 * transcript landing on a reused path), and the cached state for that path is
 * thrown away and rebuilt from the bounded cap, exactly as a first look
 * would. The same rebuild fires when the size matches but the mtime moved
 * BACKWARD: nothing about a byte count alone proves continuity, and a clock
 * that went backward is proof it did not.
 *
 * ── WHAT IT MERGES INTO, AND WHAT IT NEVER OVERRIDES ─────────────────────
 *
 * `mergeOpenQuestion` is the only place this module's finding reaches the
 * facts a poll actually returns, and it is deliberately conservative: if the
 * tail window ALREADY produced a question for the same `tool_use` id -- the
 * common case, where the window is wide enough on its own -- that reading
 * wins, unchanged. This module's answer is appended only when the window has
 * nothing at all for that id, which is exactly the case the window cannot be
 * trusted for. It is never asked to CLOSE a question the window opened, and a
 * question this module finds already answered contributes nothing (`open` is
 * `null`) rather than a stale, already-closed card.
 */

import type { AgentQuestion } from '../../../renderer/domain/model.js';
import { contentParts, nextEffectiveId, questionsFromToolUse } from './questions.js';
import { parseTranscriptLines } from './transcript.js';
import type { TranscriptSource, TranscriptWindow } from './window.js';

/**
 * What one session's tail may read to establish its FIRST state -- see the
 * module header. Sized like `tail.ts`'s `MAX_TAIL_READ_BYTES` (2 MiB): large
 * enough to clear the widest gap between a question and a slow answer
 * measured in this codebase's own corpus notes, and paid once per session
 * per process rather than once per poll.
 */
export const QUESTION_SCAN_CAP_BYTES = 4 * 1024 * 1024;

/** The newest `AskUserQuestion` a transcript's tail has not answered yet. */
export type OpenQuestion = {
  /** The call's own raw id, as the transcript wrote it -- what a `tool_result` names. */
  readonly toolUseId: string;
  /**
   * `toolUseId` run through `nextEffectiveId` -- identical to it unless
   * `toolUseId` is this transcript's 2nd or later occurrence of a repeated
   * id. `mergeOpenQuestion` keys its dedup check off THIS, never off
   * `toolUseId` raw, so a reused id's still-open occurrence is never mistaken
   * for one the tail window already covered under the same raw prefix.
   */
  readonly effectiveId: string;
  /** The absolute byte offset of the `tool_use` line that asked it. */
  readonly offset: number;
  /** Every question of that one call, oldest first, each still unanswered. */
  readonly questions: readonly AgentQuestion[];
};

type IndexState = {
  /** The offset through which this state accounts for every line. */
  readonly consumedThrough: number;
  readonly mtimeMs: number;
  readonly open: OpenQuestion | null;
  /**
   * How many times each raw `tool_use` id has been seen so far, so a repeat
   * arriving in a LATER poll's delta is still told apart from its earlier
   * occurrence -- see `nextEffectiveId` (`questions.ts`). Absent for a normal
   * transcript's ids, which never repeat, so this stays empty in the
   * overwhelmingly common case.
   */
  readonly occurrences: ReadonlyMap<string, number>;
};

/**
 * One process's memory of every live transcript's open-question state, keyed
 * by path. A `Map` and nothing more -- `source.ts` holds ONE of these for the
 * app's lifetime, the same pattern `PR_READER` and `BUILTIN_COMMANDS` use for
 * their own process-wide caches, and a test builds its own so two tests never
 * share state.
 */
export type QuestionIndex = Map<string, IndexState>;

export function createQuestionIndex(): QuestionIndex {
  return new Map();
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * `window`'s complete lines folded onto `initialOpen`, oldest first -- the one
 * pass both the cold-start read and every later delta share. A `tool_result`
 * matching the currently open question closes it; a NEW `AskUserQuestion`
 * `tool_use` replaces whatever was open, because only the newest one still
 * matters (Claude Code does not ask a second question while the first is
 * unanswered, and an older one this scan has no memory of is exactly a
 * question that was already closed by the time this state was built).
 *
 * Returns the offset through which `window` was actually usable: a window
 * whose tail is a line still being written contributes nothing for that
 * fragment, and the next call is handed the SAME bytes again alongside
 * whatever completed them.
 */
function foldQuestionWindow(
  initialOpen: OpenQuestion | null,
  initialOccurrences: ReadonlyMap<string, number>,
  window: TranscriptWindow,
): {
  open: OpenQuestion | null;
  occurrences: ReadonlyMap<string, number>;
  consumedThrough: number;
} {
  if (window.text === '')
    return { open: initialOpen, occurrences: initialOccurrences, consumedThrough: window.start };

  const lastNewline = window.text.lastIndexOf('\n');
  if (lastNewline === -1)
    return { open: initialOpen, occurrences: initialOccurrences, consumedThrough: window.start };

  const complete = window.text.slice(0, lastNewline + 1);
  const consumedThrough = window.start + Buffer.byteLength(complete, 'utf8');

  let open = initialOpen;
  const occurrences = new Map(initialOccurrences);
  for (const { line, start } of parseTranscriptLines(complete, window.start)) {
    for (const part of contentParts(line)) {
      if (part['type'] === 'tool_result') {
        const id = str(part['tool_use_id']);
        if (id !== null && open !== null && id === open.toolUseId) open = null;
      } else if (part['type'] === 'tool_use' && part['name'] === 'AskUserQuestion') {
        const id = str(part['id']);
        if (id === null) continue;
        const occurrence = (occurrences.get(id) ?? 0) + 1;
        occurrences.set(id, occurrence);
        const effectiveId = nextEffectiveId(id, occurrence);
        const questions = questionsFromToolUse(part, effectiveId);
        // A tool_use with nothing readable in it is the same as one vam never
        // saw -- readQuestion already drops what it cannot vouch for
        // (questions.ts), and an entry with zero questions would open a
        // record `mergeOpenQuestion` could not draw anything from.
        if (questions.length > 0)
          open = { toolUseId: id, effectiveId, offset: start ?? window.start, questions };
      }
    }
  }
  return { open, occurrences, consumedThrough };
}

/**
 * The newest open `AskUserQuestion` for one transcript, or `null` when its
 * newest one (within this module's bounded memory) has been answered or none
 * was ever asked. See the module header for the whole rule; this is the
 * entry point `source.ts` calls once per session per poll.
 *
 * `scanCapBytes` is an argument for the reason every bound in this directory
 * is one: a fixture that had to be megabytes to exercise the cold-start cap
 * would be a fixture nobody reads. Production passes none and gets
 * `QUESTION_SCAN_CAP_BYTES`.
 */
export async function readOpenQuestion(
  index: QuestionIndex,
  path: string,
  size: number,
  mtimeMs: number,
  source: TranscriptSource,
  scanCapBytes: number = QUESTION_SCAN_CAP_BYTES,
): Promise<OpenQuestion | null> {
  const cached = index.get(path);

  // NOT THE SAME FILE CONTINUING -- see the module header. Both conditions
  // are things an append-only log in normal use cannot do to itself, so both
  // are read as "start over", never patched around.
  if (
    cached !== undefined &&
    (size < cached.consumedThrough || (size === cached.consumedThrough && mtimeMs < cached.mtimeMs))
  ) {
    index.delete(path);
    return readOpenQuestion(index, path, size, mtimeMs, source, scanCapBytes);
  }

  // NOTHING NEW: the common case on every poll after the first, and the
  // entire point of keeping this state at all -- zero reads.
  if (cached !== undefined && size === cached.consumedThrough) return cached.open;

  const from = cached === undefined ? Math.max(0, size - scanCapBytes) : cached.consumedThrough;
  const window = await source.read(from, size);
  const { open, occurrences, consumedThrough } = foldQuestionWindow(
    cached?.open ?? null,
    cached?.occurrences ?? new Map(),
    window,
  );
  index.set(path, { consumedThrough, mtimeMs, open, occurrences });
  return open;
}

/**
 * The facts a poll actually reports, with `open` folded in ONLY where the
 * tail window has nothing for that `tool_use` id -- see the module header for
 * why the window always wins when it has an answer of its own. Pure, so it is
 * tested without a filesystem: `readOpenQuestion` is the only half of this
 * module that touches one.
 */
export function mergeOpenQuestion(
  windowQuestions: readonly AgentQuestion[],
  open: OpenQuestion | null,
): readonly AgentQuestion[] {
  if (open === null) return windowQuestions;
  // `effectiveId`, never `toolUseId` raw: a reused id's already-answered
  // first occurrence and still-open second occurrence share the raw prefix
  // but must not share this check -- see `OpenQuestion`'s own doc.
  const prefix = `${open.effectiveId}:`;
  if (windowQuestions.some((q) => q.id.startsWith(prefix))) return windowQuestions;
  // THE TWO PATHS CAN NUMBER THE SAME REUSED ID DIFFERENTLY. `collectQuestions`
  // (questions.ts) counts a `toolUseId`'s occurrences from only the bytes ITS
  // OWN (tail) window covers; this module counts from its own wider, persisted
  // scan. A raw id whose FIRST occurrence sits outside the tail window but
  // inside this module's scan is UNDERCOUNTED by the window: it draws what is
  // really the SAME occurrence this module found open as if it were the first
  // (no `#N` suffix) rather than the true, higher ordinal -- so the exact
  // `effectiveId` prefix above never matches, and the open question this
  // module found would otherwise be appended a second time under its own
  // numbering, drawing two cards for one open question
  // (`claude-code-question-index.test.ts`, `claude-code-question-window.
  // test.ts`).
  //
  // A raw id can have at most ONE occurrence open at a time -- Claude Code
  // never asks a second question under an id whose earlier occurrence is
  // still unanswered (`nextEffectiveId`'s own header) -- so an UNANSWERED
  // window entry sharing the raw id is always this SAME occurrence, however
  // the window's own count numbered it, never a genuinely different one: a
  // real earlier occurrence under that id would already be answered by the
  // time a later one opens, and so would never reach this branch (the exact
  // `effectiveId` prefix check above already returns early for it).
  const rawPrefix = open.toolUseId;
  const sameRawIdAlreadyOpenInWindow = windowQuestions.some(
    (q) =>
      q.answer === null && (q.id.startsWith(`${rawPrefix}:`) || q.id.startsWith(`${rawPrefix}#`)),
  );
  if (sameRawIdAlreadyOpenInWindow) return windowQuestions;
  return [...windowQuestions, ...open.questions];
}
