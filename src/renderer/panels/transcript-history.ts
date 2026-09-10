/**
 * THE JOIN: the column that draws a session, and the pager that can read
 * further back into it.
 *
 * Two halves shipped apart and neither one moved on its own. `DetailPanel.tsx`
 * draws every turn `entry.session.decisions` carries as one scroll region, and
 * says at its top edge that this is as far back as vam has READ -- because the
 * poll opens the newest `TAIL_BYTES` of a transcript and no more. `history.ts`
 * (main) and `TranscriptPage` (shared) can step that window backwards. This
 * module is what turns one into the other, and it holds the two facts that are
 * genuinely hard about doing so:
 *
 *  1. THE MERGE. The poll never stops. While an operator sits scrolled back
 *     reading turn 12 of 63, `entry.session.decisions` is rebuilt every ten
 *     seconds, with new turns at its front. `columnOf` is what joins that live
 *     list to the pages walked back from it, and its rule is one line: THE
 *     POLL OWNS THE LIVE REGION, the pager owns everything older, and a turn
 *     the poll still carries is never drawn from the pager's copy.
 *
 *     THAT RULE COSTS SOMETHING AND THE COST IS NAMED. The tail is a BYTE
 *     window, so a turn can fall off its old end -- measured, on five of the
 *     six largest transcripts on the operator's machine the tail holds one
 *     turn -- and this merge lets it go, which leaves the column drawing the
 *     turns either side of it. The alternative was tried: keep every turn ever
 *     drawn and let the poll only refresh their content. It is WORSE, and not
 *     marginally. `Canvas.tsx` paints a prompt optimistically the moment it is
 *     sent (`vam-pending-N`) and then RETRACTS it -- replaced by the source's
 *     own turn when the write lands, removed outright when it is refused --
 *     and neither retraction is distinguishable, from these two arrays alone,
 *     from the byte window sliding. Retaining would therefore leave a phantom
 *     prompt above the real one on every send, which is a defect an operator
 *     meets several times an hour rather than a turn ageing quietly out of the
 *     bottom of a column they are reading the top of. It is also the behaviour
 *     the column already ships and states: a turn gone from the window is
 *     reported as gone ("the turn you were reading has scrolled out of what vam
 *     can see"), never substituted, and `decisions` is what that judgement is
 *     made against.
 *
 *  2. THE WALK. A window with no complete turn in it is NOT the end of the
 *     session -- at ~2.5 MB of transcript per turn on the largest session here
 *     it is the ORDINARY answer -- so one gesture may have to ask several
 *     times. `walkOlder` does that asking, collapses the blank steps into one
 *     answer of exactly `TranscriptPage`'s shape, and stops at a cap that
 *     reports "there is more" rather than an end.
 *
 * PURE, AND THE REASON IS THE E2E GUARD. Nothing here touches the DOM: the half
 * of this feature a unit test cannot see -- what `scrollHeight` did, which
 * element stayed under the reader's eye -- is measured in a real browser by
 * `e2e/transcript-column-shots.mjs`. Keeping the data half honest and testable
 * here is what stops that guard from being asked to prove arithmetic as well as
 * layout.
 */

import type { HistoryCursor, TranscriptPage } from '../../shared/history.js';
import type { Decision } from '../domain/model.js';
import type { TranscriptReader } from '../sources/history-reader.js';
import type { SourceError } from '../sources/port.js';

/**
 * How many BLANK windows one gesture may walk before it stops and hands the
 * decision back.
 *
 * The arithmetic, because a cap picked by feel is a cap nobody can defend: one
 * request already widens internally up to `MAX_HISTORY_READ_BYTES` (8 MiB,
 * `main/sources/claude-code/history.ts`) before it answers blank, so this is a
 * bound of 3 x 8 MiB = 24 MiB of transcript read for one scroll to the top.
 * That is a lot to spend without saying anything, and it is bounded, which the
 * alternative -- "keep asking until something comes back" -- is not: a source
 * that answered blank forever would spin a request loop with nothing on screen
 * to stop it.
 *
 * STOPPING IS NOT AN ENDING, and that distinction is the whole point of the
 * cap being safe to have: the answer a stopped walk returns still carries its
 * cursor, so the column says "there is more" and offers the same control again.
 * Nothing here can turn an exhausted budget into "the session begins here".
 */
export const MAX_BLANK_STEPS = 3;

/**
 * THE WHOLE COLUMN, newest first: the poll's live list, then every turn walked
 * back from it that the poll is not already carrying.
 *
 * A DERIVATION, NOT STATE, and that is most of what makes this safe. `older` is
 * the only thing the pane has to remember and it changes exactly when a page
 * lands; the live half is used EXACTLY as the poll delivered it, which is what
 * keeps a streaming answer on the newest turn live, and what keeps
 * `Canvas.tsx`'s optimistic paint -- and its retraction -- the poll's business
 * rather than this module's.
 *
 * THE FILTER IS THE OVERLAP GUARD, and it protects a fix rather than doubting
 * it. PR 283 made the cursor say whether it names a turn the caller already
 * holds, so the source withholds the overlapping turn; this is the cheap
 * assertion beside that, and it also covers the case nobody planned for -- a
 * paged turn that LATER re-enters the tail, which would otherwise put one
 * prompt in the column twice under two ids nothing can reconcile.
 */
export function columnOf(
  decisions: readonly Decision[],
  older: readonly Decision[],
): readonly Decision[] {
  if (older.length === 0) return decisions;
  const live = new Set(decisions.map((d) => d.id));
  return [...decisions, ...older.filter((d) => !live.has(d.id))];
}

/**
 * A page of older turns, joined onto the older end of the history the pane
 * already holds. Newest first throughout, so a page goes on the END.
 *
 * Deduped against what is held for the same reason `columnOf` dedupes against
 * the live list: one turn, one block, whatever the source hands over.
 */
export function appendOlder(
  older: readonly Decision[],
  turns: readonly Decision[],
): readonly Decision[] {
  const held = new Set(older.map((d) => d.id));
  const added = turns.filter((d) => !held.has(d.id));
  return added.length === 0 ? older : [...older, ...added];
}

/**
 * What the next step back must be asked for.
 *
 * TWO SHAPES, ONE OF THEM NOT OURS TO INVENT. `HistoryCursor` is opaque to
 * every caller (`shared/history.ts`), and exactly two things may be passed: a
 * cursor a previous page handed back, or the id of a turn already on screen --
 * "page the transcript before this". The first step back has no page behind it,
 * so it passes the id of the OLDEST turn the column holds, which is the one the
 * contract expects and the one PR 283's overlap fix is keyed on. Inventing a
 * cursor of our own, or passing `null` (which main reads as "from the newest
 * end"), would both re-read what is already on screen.
 */
export function cursorToAsk(
  handedBack: HistoryCursor | null,
  column: readonly Decision[],
): HistoryCursor | null {
  if (handedBack !== null) return handedBack;
  return column.at(-1)?.id ?? null;
}

/** One gesture's answer: a `TranscriptPage` plus how many windows it took. */
export type HistoryWalk =
  | {
      readonly kind: 'page';
      readonly turns: readonly Decision[];
      readonly cursor: HistoryCursor | null;
      readonly reachedStart: boolean;
      readonly steps: number;
    }
  | { readonly kind: 'unavailable'; readonly error: SourceError; readonly steps: number };

/**
 * ONE STEP BACK, which may be several reads.
 *
 * The four answers of `TranscriptPage` survive this function intact -- it
 * collapses only the one that means "ask again":
 *
 *  1. turns  -> returned, with the cursor for the step after it.
 *  2. start  -> returned, and nothing further is asked.
 *  3. blank with a cursor -> asked again with that cursor, up to
 *     `MAX_BLANK_STEPS`; past the cap the blank page is returned WITH its
 *     cursor, which still says "there is more".
 *  4. unavailable -> returned, and nothing further is asked. A source that
 *     could not read is not a source to ask three more times.
 *
 * `sessionId` is passed through rather than closed over so that the caller can
 * check, when this resolves, that the answer is still about the session on
 * screen.
 *
 * THE CATCH IS NOT DECORATION. The port promises `history` never rejects and
 * every source vam assembles keeps that promise; the member is optional
 * precisely so a source built by hand (a demo fixture, a test) can exist, and
 * an unhandled rejection from one of those would leave the column reading
 * forever with nothing on screen to say why.
 */
export async function walkOlder(
  read: TranscriptReader,
  sessionId: string,
  cursor: HistoryCursor,
  maxBlankSteps: number = MAX_BLANK_STEPS,
): Promise<HistoryWalk> {
  let at: HistoryCursor = cursor;
  for (let steps = 1; ; steps += 1) {
    let answer: TranscriptPage;
    try {
      answer = await read(sessionId, at);
    } catch (reason) {
      return {
        kind: 'unavailable',
        error: {
          kind: 'unreachable',
          code: 'history-threw',
          message: reason instanceof Error ? reason.message : String(reason),
        },
        steps,
      };
    }
    if (answer.kind === 'unavailable') {
      return { kind: 'unavailable', error: answer.error, steps };
    }
    const { turns, cursor: next, reachedStart } = answer;
    if (turns.length > 0 || reachedStart || next === null || steps >= maxBlankSteps) {
      return { kind: 'page', turns, cursor: next, reachedStart, steps };
    }
    at = next;
  }
}

/**
 * WHERE THE COLUMN HAS GOT TO, walking back. Not what it DRAWS -- `moreState`
 * below is that, and the split is what keeps a source's absence and a source's
 * refusal from collapsing into one another.
 *
 * `cursor` is `null` in two completely different situations and the `phase`
 * beside it is what tells them apart: `rest` with a null cursor means nothing
 * has been asked yet (so the next ask derives from the oldest turn on screen),
 * and `start` with a null cursor means the beginning has been PROVEN and there
 * is nothing left to ask for. Deriving that difference from the cursor alone is
 * the exact mistake `shared/history.ts` carries both `cursor` and
 * `reachedStart` to prevent.
 */
export type PagerState = {
  readonly cursor: HistoryCursor | null;
  readonly phase: 'rest' | 'reading' | 'start' | 'failed';
  readonly error: SourceError | null;
};

/** Nothing asked yet, for a session just opened. */
export const RESTING_PAGER: PagerState = { cursor: null, phase: 'rest', error: null };

/**
 * Fold one walk's answer into the pager.
 *
 * THE CURSOR DOES NOT MOVE ON A FAILURE, and that is what makes the retry
 * control honest rather than decorative: a second press asks for exactly the
 * thing that failed, so a transient refusal is recoverable and a permanent one
 * says the same sentence again.
 */
export function applyWalk(pager: PagerState, walk: HistoryWalk): PagerState {
  if (walk.kind === 'unavailable') {
    return { cursor: pager.cursor, phase: 'failed', error: walk.error };
  }
  if (walk.reachedStart) return { cursor: null, phase: 'start', error: null };
  return { cursor: walk.cursor, phase: 'rest', error: null };
}

/**
 * What the boundary block offers, or `null` when it offers nothing.
 *
 * FOUR ANSWERS AND A SILENCE, kept apart on screen because they are four
 * different things to do about:
 *  - `available`   -- there is more, and vam can go and get it. A control.
 *  - `reading`     -- a walk is in flight. A status line, and NO control:
 *                     "absent, not dimmed" is the rule the block shipped under.
 *  - `unavailable` -- the last read failed, in the source's own words, plus a
 *                     control, because a retry asks the same thing again.
 *  - `unsupported` -- this source has no pager. A sentence and no control.
 *  - `null`        -- the start is proven; there is nothing left to ask for, so
 *                     there is nothing to ask with.
 *
 * THE START OUTRANKS THE ABSENCE. A source with no pager cannot reach `start`
 * today, and the order here is what keeps that from becoming a lie in the other
 * direction if one ever does: having proven the beginning, there is nothing
 * left to refuse.
 */
export function moreState(
  pager: PagerState,
  read: TranscriptReader | null,
): 'available' | 'reading' | 'unavailable' | 'unsupported' | null {
  if (pager.phase === 'start') return null;
  if (read === null) return 'unsupported';
  if (pager.phase === 'reading') return 'reading';
  return pager.phase === 'failed' ? 'unavailable' : 'available';
}
