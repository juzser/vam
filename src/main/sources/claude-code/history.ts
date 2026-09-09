/**
 * Reading EARLIER parts of one transcript, on demand.
 *
 * `source.ts`'s `load()` reads the last `TAIL_BYTES` of each live session and
 * nothing more, and that budget is not negotiable -- it is what keeps a
 * ten-second poll costing kilobytes whatever is on disk. But the tail is a
 * small share of the sessions that matter.
 *
 * MEASURED, AND THE DENOMINATOR IS THE POINT. There are 940 `.jsonl` files
 * under this machine's transcript root and 863 of them are subagent sidechains
 * vam never opens; the sessions it does open number 77. Across those: p50
 * 182 KB, p75 4.9 MB, p90 44.1 MB, max 157.3 MB, and 34 of 77 (44%) fit inside
 * the 128 KiB window entirely. So the distribution is BIMODAL, and it is the
 * large end that this module exists for -- of the six largest, five show
 * exactly ONE turn in the tail: 157.3 MB shows 1 of 63 turns, 138.7 MB 1 of
 * 262, 133.3 MB 1 of 61, 122.1 MB 1 of 89, 57.7 MB 1 of 11, 54.9 MB 2 of 91.
 * Scrolling back is therefore a SEPARATE read, asked for by a person, and this
 * module is it.
 *
 * FOUR RULES, all of them load-bearing:
 *
 *  1. The window is trimmed to a whole line before anything parses it, and it
 *     reports the offset it really begins at (`window.ts`). That is what lets
 *     `summarizeTranscript` mint an id that is the same in every window, which
 *     is what makes a page's overlap with the tail dedupable.
 *  2. A window with no complete turn in it is NOT the end of history. At
 *     ~2.5 MB of transcript per turn on the largest session here, a 128 KiB
 *     window holding nothing whole is the NORMAL case there rather than an
 *     edge one -- and a single tool-result line can exceed the window on its
 *     own besides. So an empty window widens and tries again rather than
 *     answering "nothing older".
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
 * exactly once, with the id every other read of the file agrees on. The single
 * exception is the exhausted-budget step below, which has no kept turn to end
 * at and so must hand its head turn over rather than lose it.
 *
 * THE TAIL IS THE OTHER HALF OF THAT, and it is why the cursor carries whether
 * it names a turn. `load()` CANNOT drop its own oldest turn -- on five of the
 * six largest transcripts here the tail holds exactly one, so dropping it would
 * empty the canvas -- so the tail hands out a re-emission offset for that turn
 * in 27 of the 35 real transcripts larger than a tail. A page that returned the
 * same turn at its real opening would put one prompt on screen twice under two
 * ids nothing can reconcile. So a cursor that NAMES a turn makes this read take
 * in the cursor's own line and withhold whatever turn that line belongs to.
 * Measured over those 35 transcripts, walking from the tail to byte 0: every
 * turn covered exactly once, none twice and none lost.
 */

import type { HistoryCursor, TranscriptPage } from '../../../shared/history.js';
import type { SourceError } from '../../ipc/channels.js';
import { cursorNamesATurn, summarizeTranscript, turnStartOf } from './transcript.js';
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
  // Does the cursor name a turn the caller already holds, or is it a bare
  // position this endpoint handed back for a page that had no turn to name?
  // The answer decides whether the turn open AT the cursor may be returned.
  const namesATurn = cursor !== null && cursorNamesATurn(cursor);
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

  let spent = 0;
  /**
   * THE CURSOR'S OWN LINE, read before anything else, and only when the cursor
   * names a turn the caller already holds.
   *
   * Without it this read cannot tell the two things that line can be apart, and
   * they need opposite treatment: if it OPENED the caller's turn, the newest
   * turn before it is a different turn the caller does not have and must be
   * returned; if it merely RE-EMITTED an already-open turn -- which 21,604 of
   * 22,668 real `last-prompt` lines do -- then the newest turn before it IS the
   * caller's turn, and returning it puts the same prompt on screen twice under
   * two ids no dedupe can reconcile. That is not hypothetical: `load()`'s tail
   * cannot drop its own oldest turn (on the six largest transcripts here the
   * tail holds exactly one turn, so dropping it would empty the canvas), so the
   * tail's oldest id is a re-emission offset roughly three times in four.
   *
   * Reading it costs one `read` per request, and `end` never moves within a
   * request, so it is read once and not once per widening step.
   */
  let past = '';
  if (namesATurn) {
    let peek = Math.max(1, windowBytes);
    for (;;) {
      const to = Math.min(size, end + peek);
      let over: Awaited<ReturnType<TranscriptSource['read']>>;
      try {
        over = await source.read(end, to);
      } catch (error) {
        return unavailable(
          'unreachable',
          'transcript-unreadable',
          error instanceof Error ? error.message : String(error),
        );
      }
      spent += to - end;
      // A newline after it, or the end of the file, is what makes the line
      // WHOLE -- and only a whole line can be parsed to see what it did.
      const ends = over.text.indexOf('\n');
      if (ends !== -1 || to >= size) {
        // THAT LINE AND NOTHING AFTER IT. Whatever else the peek happened to
        // catch is content the caller already has, and parsing it would only
        // make "did a turn open AT the cursor" harder to ask.
        past = ends === -1 ? over.text : over.text.slice(0, ends + 1);
        break;
      }
      peek *= 2;
      if (spent + Math.min(size - end, peek) > budgetBytes) {
        // A single line longer than the whole budget. vam cannot tell what that
        // line did, so it says so rather than guessing: guessing one way hands
        // out a turn twice, guessing the other drops one silently.
        return unavailable(
          'unreachable',
          'cursor-line-too-large',
          `the line at ${end} does not end within the ${budgetBytes} bytes vam may read for one page`,
        );
      }
    }
  }

  let window = Math.max(1, windowBytes);
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
    // The window and the cursor's line are CONTIGUOUS -- the first ends exactly
    // where the second begins -- so they parse as one window and every offset
    // in it is still absolute.
    const { decisions } = summarizeTranscript(read.text + past, decisionIdPrefix, read.start);
    // Whatever opens at or after the cursor is the caller's own turn, or newer
    // than it. Either way the caller has it.
    const before = decisions.filter((turn) => (turnStartOf(turn.id) ?? 0) < end);
    const openedAtCursor = decisions.some((turn) => turnStartOf(turn.id) === end);
    // ...and when NOTHING opened there, the cursor's line continued a turn that
    // began earlier, so the newest turn before it is that same turn -- and the
    // caller's turn goes on reaching back past this window.
    const spansTheWindow = namesATurn && !openedAtCursor;
    const mine = spansTheWindow ? before.slice(1) : before;

    if (from === 0) {
      // The window began at byte 0, so every turn in it began in it too --
      // including the oldest, which is the one a later window could not vouch
      // for. This is the ONLY thing that reports the start of a session.
      return { kind: 'page', turns: mine, cursor: null, reachedStart: true };
    }

    // `mine` is newest first, so the last entry is the oldest turn -- the one
    // whose opening this window did not see. See the note at the top.
    const kept = mine.slice(0, -1);
    const oldestKept = kept.at(-1);
    if (oldestKept !== undefined) {
      return { kind: 'page', turns: kept, cursor: oldestKept.id, reachedStart: false };
    }
    // No whole turn in this window: widen and look again, rather than call a
    // window that was too small the beginning of the session. The budget is
    // checked against what the WIDER read would cost, before paying it.
    const wider = window * 2;
    if (spent + (end - Math.max(0, end - wider)) > budgetBytes) {
      // Out of budget, NOT out of history.
      //
      // THE STEP LANDS ON A LINE START -- where this window's first WHOLE line
      // began, not where the window was asked to begin. A line that straddles
      // the requested start is parseable by neither window: this one trims
      // past it as a fragment, and the next one ends before it finishes and
      // truncates it. Measured on a fixture with 50-byte lines, stepping to
      // the requested start lost the turn opening at byte 578 outright. The
      // region skipped by landing later is exactly the region this window
      // already parsed, so nothing is passed over unread. When no line began
      // in the window at all -- a range wholly inside one enormous line -- the
      // requested start is the only offset that still makes progress.
      //
      // IT RETURNS WHAT IT HAS, head turn included -- the one place that turn
      // is not dropped. Everywhere else dropping it costs nothing because the
      // next step ends at the oldest turn this one KEPT and so still contains
      // it; here there is no kept turn to end at, so the next step would end
      // before it and it would be lost. Its id may be a re-emission offset,
      // and that is handled by the same rule as the tail's: the cursor below
      // names it, so the next step withholds the turn spanning it.
      //
      // THE CURSOR KEEPS THE PREFIX, because that is the bit
      // `cursorNamesATurn` reads and this is the one place it could be
      // dropped. A window with no whole turn in it is a window the caller's
      // turn SPANS, so the next step must still withhold it -- handing back a
      // bare position here let a later page return that turn a second time,
      // which is the tail->page duplicate in its second disguise.
      const step = read.text === '' ? from : read.start;
      const oldest = mine.at(-1);
      return {
        kind: 'page',
        turns: mine,
        // The prefix travels on only while the caller's turn REALLY reaches
        // back past here. Carrying it whenever the incoming cursor had one was
        // wrong in the other direction: a caller whose turn began at the cursor
        // holds nothing older, and the next step would then withhold a turn it
        // had never been given.
        cursor: oldest?.id ?? (spansTheWindow ? `${decisionIdPrefix}:@${step}` : `@${step}`),
        reachedStart: false,
      };
    }
    window = wider;
  }
}
