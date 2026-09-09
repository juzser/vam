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
 *     seconds -- with new turns at its front and, because the tail is a BYTE
 *     window, with old ones falling off its back. Measured on the operator's
 *     own machine: on five of the six largest transcripts the tail holds
 *     exactly ONE turn, so every new turn evicts the previous one. A column
 *     that drew `decisions` alone would therefore lose turns it had already
 *     drawn, one per poll, under the reader's eye. `mergeColumn` is the answer:
 *     the column is everything vam has read for this session, in one order,
 *     with the poll's copy winning on content and never on membership.
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
import type { SourceError } from '../sources/port.js';

/** The port's own `history` member, narrowed to what this module needs. */
export type TranscriptReader = (
  sessionId: string,
  cursor: HistoryCursor | null,
) => Promise<TranscriptPage>;

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
 * Everything vam has read for one session, newest first -- the poll's tail and
 * every page walked back from it, in one order.
 *
 * Called during render with the poll's latest `decisions`, and it returns the
 * SAME ARRAY when nothing changed. That identity is load-bearing: the caller
 * writes the answer back into state during render (React's documented way to
 * adjust state when props change), and a function that minted a fresh array
 * every time would make that an infinite loop.
 *
 * THREE RULES, and the order between them is the ordering of the column:
 *  - a turn the poll still carries is taken FROM the poll, so a streaming
 *    answer on the newest turn stays live;
 *  - a turn the poll has DROPPED is kept where it is, because the tail sliding
 *    forward is not the operator losing a turn they were reading;
 *  - a turn the poll carries that the column does not is NEW, and a new turn is
 *    the newest thing there is, so it goes to the front.
 */
export function mergeColumn(
  column: readonly Decision[],
  decisions: readonly Decision[],
): readonly Decision[] {
  const fresh = new Map(decisions.map((d) => [d.id, d]));
  let changed = false;
  const kept = column.map((held) => {
    const live = fresh.get(held.id);
    if (live === undefined || live === held) return held;
    changed = true;
    return live;
  });
  const held = new Set(kept.map((d) => d.id));
  const arrived = decisions.filter((d) => !held.has(d.id));
  if (arrived.length === 0) return changed ? kept : column;
  return [...arrived, ...kept];
}

/**
 * A page of older turns, joined onto the older end of the column.
 *
 * DEDUPED, AND NOT BECAUSE THE SOURCE IS DISTRUSTED. #283 already fixed the
 * overlap this would otherwise produce -- the tail cannot drop its own oldest
 * turn, so it hands out a cursor that NAMES that turn, and the read withholds
 * whatever turn the cursor's line belongs to. This filter is the cheap
 * assertion that protects that fix: a page that ever did return a turn already
 * on screen would put one prompt in the column twice under two ids nothing can
 * reconcile, and that is a defect an operator would have to notice for us.
 */
export function appendOlder(
  column: readonly Decision[],
  turns: readonly Decision[],
): readonly Decision[] {
  const held = new Set(column.map((d) => d.id));
  const added = turns.filter((d) => !held.has(d.id));
  return added.length === 0 ? column : [...column, ...added];
}

/**
 * What the next step back must be asked for.
 *
 * TWO SHAPES, ONE OF THEM NOT OURS TO INVENT. `HistoryCursor` is opaque to
 * every caller (`shared/history.ts`), and exactly two things may be passed: a
 * cursor a previous page handed back, or the id of a turn already on screen --
 * "page the transcript before this". The first step back has no page behind it,
 * so it passes the id of the OLDEST turn the column holds, which is the one the
 * contract expects and the one #283's overlap fix is keyed on. Inventing a
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
