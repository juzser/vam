/**
 * Reading EARLIER parts of one transcript, on demand.
 *
 * `source.ts`'s `load()` reads the last `TAIL_BYTES` of each live session and
 * nothing more, and that budget is not negotiable -- it is what keeps a
 * ten-second poll costing kilobytes against 814 MB of transcripts. But the tail
 * is a small share of a session: measured over 77 real transcripts, the median
 * is 387 KB and only 10% fit inside 128 KiB entirely, so the median session
 * shows about a third of itself and the largest (157 MB) shows a fraction of a
 * percent. Scrolling back is therefore a SEPARATE read, asked for by a person,
 * and this module is it.
 *
 * FOUR RULES, all of them load-bearing:
 *
 *  1. The window is trimmed to a whole line before anything parses it, and it
 *     reports the offset it really begins at (`window.ts`). That is what lets
 *     `summarizeTranscript` mint an id that is the same in every window, which
 *     is what makes a page's overlap with the tail dedupable.
 *  2. A window with no complete turn in it is NOT the end of history. One line
 *     can exceed the window -- measured, a single tool result runs past 128 KiB
 *     -- so an empty window widens and tries again rather than answering
 *     "nothing older".
 *  3. The beginning of the file is a positive fact, read off the window having
 *     begun at byte 0, and never inferred from an empty page.
 *  4. A read that FAILED is its own answer (`unavailable`), never an empty
 *     page. `pull-requests.ts` states the general form of this rule.
 *
 * THE OLDEST TURN OF A WINDOW IS DROPPED, and that is not a rounding error.
 * `last-prompt` re-emits the open turn constantly (21,604 of 22,668 lines in
 * the corpus), so a window that opens mid-turn opens that turn at a
 * re-emission and would give it an offset that is not where it began. Dropping
 * it costs nothing: the NEXT page back ends at the oldest turn this one kept,
 * so it contains the dropped turn's real beginning and returns it there --
 * exactly once, with the id every other read of the file agrees on.
 */

import type { HistoryCursor, TranscriptPage } from '../../../shared/history.js';
import type { SourceError } from '../../ipc/channels.js';
import { summarizeTranscript, turnStartOf } from './transcript.js';
import type { TranscriptSource } from './window.js';

/**
 * How much one step back reads. The same 128 KiB `source.ts` spends on a tail,
 * for the same reason: it is the size at which a real session yields turns
 * without the read being felt. It is a STARTING size -- a window with no whole
 * turn in it doubles, up to the budget below.
 */
export const HISTORY_WINDOW_BYTES = 128 * 1024;

/**
 * What ONE request may read, IN TOTAL, across every widening step -- checked
 * BEFORE each widening rather than after, so this is a bound and not a
 * tripwire. Measured against the operator's 157 MB transcript: the after-the-
 * fact check let a single request read 15.9 MB, twice what this says.
 *
 * A widening step re-reads what the previous one covered, so 8 MiB of budget
 * buys a widest single window of 4 MiB (128 KiB doubling six times sums to
 * 7.9 MiB). That factor of two is the price of not having to stitch windows
 * together across a line the first of them cut, and it is bounded; what is NOT
 * allowed is re-reading from EOF, which would make walking a session
 * quadratic. Every step here ends where the previous one began.
 *
 * Past the budget the request answers with an empty page AND a live cursor,
 * which says "there is more, ask again" -- the one thing an exhausted budget
 * must never be mistaken for.
 */
export const MAX_HISTORY_READ_BYTES = 8 * 1024 * 1024;

const unavailable = (kind: SourceError['kind'], code: string, message: string): TranscriptPage => ({
  kind: 'unavailable',
  error: { kind, code, message },
});

/**
 * The turns before `cursor`, newest first.
 *
 * `source` is injected rather than opened here, for the reason every
 * filesystem read in this directory is: a test reads an invented transcript and
 * never the operator's own. The two numeric arguments are injected for tests
 * too -- a fixture that had to be 8 MiB to exercise the budget would be a
 * fixture nobody reads.
 */
export async function readTranscriptHistory(
  source: TranscriptSource,
  decisionIdPrefix: string,
  cursor: HistoryCursor | null,
  windowBytes: number = HISTORY_WINDOW_BYTES,
  budgetBytes: number = MAX_HISTORY_READ_BYTES,
): Promise<TranscriptPage> {
  let size: number;
  try {
    size = await source.size();
  } catch (error) {
    // Deleted, renamed, or never there. NOT an empty page: vam did not read
    // the beginning of this session, it failed to read it at all.
    return unavailable(
      'unreachable',
      'transcript-unreadable',
      error instanceof Error ? error.message : String(error),
    );
  }

  let end = size;
  if (cursor !== null) {
    const at = turnStartOf(cursor);
    if (at === null) {
      return unavailable(
        'refused',
        'invalid-cursor',
        'that turn carries no position in the transcript, so vam cannot read what came before it',
      );
    }
    if (at > size) {
      // The file is shorter than the cursor: truncated, replaced, or a cursor
      // from a different session. Answering an empty page would say "nothing
      // older", which is a claim about a file vam is no longer looking at.
      return unavailable(
        'unreachable',
        'cursor-past-end',
        `the transcript is ${size} bytes and stops before the position asked for (${at})`,
      );
    }
    end = at;
  }
  if (end <= 0) {
    return { kind: 'page', turns: [], cursor: null, reachedStart: true };
  }

  let window = Math.max(1, windowBytes);
  let spent = 0;
  for (;;) {
    const from = Math.max(0, end - window);
    let read: Awaited<ReturnType<TranscriptSource['read']>>;
    try {
      read = await source.read(from, end);
    } catch (error) {
      return unavailable(
        'unreachable',
        'transcript-unreadable',
        error instanceof Error ? error.message : String(error),
      );
    }
    spent += end - from;
    const { decisions } = summarizeTranscript(read.text, decisionIdPrefix, read.start);

    if (from === 0) {
      // The window began at byte 0, so every turn in it began in it too --
      // including the oldest, which is the one a later window could not vouch
      // for. This is the ONLY thing that reports the start of a session.
      return { kind: 'page', turns: decisions, cursor: null, reachedStart: true };
    }

    // `decisions` is newest first, so the last entry is the oldest turn -- the
    // one whose opening this window did not see. See the note at the top.
    const kept = decisions.slice(0, -1);
    const oldestKept = kept.at(-1);
    if (oldestKept !== undefined) {
      return { kind: 'page', turns: kept, cursor: oldestKept.id, reachedStart: false };
    }
    // No whole turn in this window: widen and look again, rather than call a
    // window that was too small the beginning of the session. The budget is
    // checked against what the WIDER read would cost, before paying it.
    const wider = window * 2;
    if (spent + (end - Math.max(0, end - wider)) > budgetBytes) {
      // Out of budget, NOT out of history. The cursor is the start this step
      // asked for rather than where its first whole line landed: no turn can
      // begin in between (there is no line start there), so nothing is skipped
      // by stepping to it, and it is strictly older than `end`, so asking
      // again always makes progress.
      return { kind: 'page', turns: [], cursor: `@${from}`, reachedStart: false };
    }
    window = wider;
  }
}
