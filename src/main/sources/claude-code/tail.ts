/**
 * THE LIVE VIEW'S READ OF ONE TRANSCRIPT: a window sized by what it FOUND, not
 * by a byte count alone.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 *
 * Reported from use: the Response view said "this turn ended without an
 * answer" while the Terminal tab beside it held the agent's full reply. Not a
 * poll delay and not an optimistic paint -- a paint draws a different sentence
 * (`optimistic.ts`).
 *
 * `load()` read the last 128 KiB of each live transcript and nothing more, and
 * `window.ts` drops the first, partial line of any window that does not begin
 * at byte 0. That is correct and it is also the whole bug, because a single
 * LINE can be larger than the whole window. Measured over the 85 session
 * transcripts on the machine this was written for -- read WHOLE, streaming,
 * because a tail read cannot see this at all: the offending line is cut in
 * half, fails `JSON.parse` and is skipped in silence, so a tail-reading
 * measurement reports zero and is confidently wrong. 670 single lines exceed
 * 131,072 bytes, across 23 files, in three families:
 *
 *   - `attachment` / `prompt_snapshot`  411 lines, 346..9,888 bytes OVER it
 *   - `user` with a large tool result   258 lines, 554..1,225,858 over
 *   - `attachment` / `queued_command`     1 line,          253,707 over
 *
 * The first family is the systematic one: its payload is capped near 128 KiB
 * before JSON overhead, so it clears a 128 KiB window almost every time. Two
 * of the 85 files had a tail holding ZERO `user` and ZERO `assistant` lines
 * while the file itself held one of each. With no conversational line in the
 * window the only thing left able to open a turn is the `last-prompt` marker,
 * and that branch has no answer to give -- so the pane drew a confident
 * sentence about a turn vam had never read.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * Read backwards a step at a time and STOP AS SOON AS THE WINDOW HOLDS THE RAW
 * MATERIAL OF A TURN -- at least one `user` line and at least one `assistant`
 * line. The byte ceiling below is a safety valve underneath that rule, not the
 * rule itself.
 *
 * EACH STEP ENDS WHERE THE PREVIOUS ONE BEGAN, at the offset the previous
 * window's first WHOLE line really started at. That is the same step
 * `history.ts` takes when its budget runs out, and it is what makes this
 * linear: nothing is read twice, so widening costs what it covers. The obvious
 * alternative -- re-reading from the end at double the size -- pays a factor of
 * two and, at ten seconds a poll, pays it forever.
 *
 * THE STEPS ARE PARSED SEPARATELY AND NEVER GLUED. A turn's id is the byte
 * offset of the line that named it, which is what lets the tail's overlap with
 * a history page be deduped. Concatenating two ranges into one string would
 * shift every offset past the join by however much was skipped between them --
 * and skipping is exactly what stepping past an oversized line does. So each
 * range is parsed with its own absolute start (`parseTranscriptLines`) and the
 * parsed lines are concatenated in file order instead.
 *
 * AN OVERSIZED LINE CANNOT END THE SEARCH. A step landing wholly inside one
 * line yields no whole line at all -- `window.ts` answers an empty window and
 * the range's own start -- and the read steps past it to the requested start
 * and carries on. It contributes NOTHING to the parsed window, which is the
 * other half of "bounded": a 1.29 MiB tool result costs bytes off the ceiling
 * and not one byte of retained text or parse. It is not content a turn needs
 * anyway; a turn needs its prompt and its answer, and a megabyte of tool
 * result is neither.
 *
 * ── WHAT IT COSTS ─────────────────────────────────────────────────────────
 *
 * WORST CASE PER SESSION PER POLL: `MAX_TAIL_READ_BYTES` (2 MiB) plus one
 * probe byte per step (`window.ts` reads one byte before each range to find
 * the line boundary), so 2 MiB + 16 bytes across at most 16 steps. The ceiling
 * is checked BEFORE each widening, so it is a bound and not a tripwire --
 * `history.ts` checked after once and let a request read twice its budget.
 *
 * COMMON CASE, MEASURED over those same 85 transcripts: 83 of them satisfy the
 * stop rule on the FIRST step and pay 131,073 bytes, which is exactly what the
 * single fixed read cost before this existed. Two widen; the most expensive
 * needed four steps and 421,608 bytes, and none reached the ceiling. That is
 * the property that matters most here after correctness: `load()` runs every
 * `SOURCE_POLL_INTERVAL_MS` for every live session, so a fix that widened on
 * ordinary transcripts would be a regression wearing a fix's clothes.
 *
 * THIS IS STILL THE LIVE VIEW'S BUDGET AND NOTHING ELSE'S. Scrolling back is a
 * separate on-demand read (`history.ts`) asked for by a person, and it does not
 * widen this.
 */

import type { Decision } from '../../../renderer/domain/model.js';
import {
  type Located,
  parseTranscriptLines,
  summarizeLines,
  type TranscriptFacts,
} from './transcript.js';
import type { TranscriptSource } from './window.js';

/**
 * One step, and the first one. 128 KiB -- the window `load()` has always read,
 * kept so that the 83-of-85 case pays exactly what it paid before.
 */
export const TAIL_WINDOW_BYTES = 128 * 1024;

/**
 * What one session's tail may read IN TOTAL, per poll, across every step.
 *
 * A VALVE, NOT THE RULE: no transcript in the measured corpus comes within a
 * fifth of it. It is sized to clear the largest single line on this machine --
 * 1,356,930 bytes -- with a whole step to spare, so even the worst measured
 * line can be stepped over and still leave a window to find the turn above it.
 */
export const MAX_TAIL_READ_BYTES = 2 * 1024 * 1024;

export type LiveTail = {
  readonly facts: TranscriptFacts;
  /**
   * TRUE WHEN EVERY BYTE VAM WAS ALLOWED TO READ HELD NO CONVERSATION -- no
   * `user` line and no `assistant` line anywhere in the widened window.
   *
   * This is the state that used to be invisible. vam knew it had parsed no
   * conversational line and drew "this turn ended without an answer" anyway; a
   * session vam cannot read is not a session whose turn ended without an
   * answer. Note what it is NOT: a window that read conversation and found no
   * answer in it is an ordinary reading, and is false here.
   */
  readonly starved: boolean;
};

/** Does this window hold the raw material of one turn -- a prompt and a reply? */
function holdsATurn(counts: { user: number; assistant: number }): boolean {
  return counts.user > 0 && counts.assistant > 0;
}

/**
 * One session's turns, from as much of the end of its transcript as it takes.
 *
 * `step` and `budget` are arguments for the reason every read in this directory
 * injects its own: a fixture that had to be 2 MiB to exercise the ceiling would
 * be a fixture nobody reads. Production passes neither.
 */
export async function readLiveTail(
  source: TranscriptSource,
  decisionIdPrefix: string,
  step: number = TAIL_WINDOW_BYTES,
  budget: number = MAX_TAIL_READ_BYTES,
): Promise<LiveTail> {
  const stride = Math.max(1, step);
  const size = await source.size();

  // Oldest first at the end -- `summarizeLines` reads positionally, so the
  // order it is handed is the order the file is in, never the order it was
  // read in. Steps go backwards; this list is unshifted, not pushed.
  const located: Located[] = [];
  const counts = { user: 0, assistant: 0 };
  let boundary = size;
  let spent = 0;

  for (;;) {
    const from = Math.max(0, boundary - stride);
    const window = await source.read(from, boundary);
    spent += boundary - from;

    if (window.text !== '') {
      const lines = parseTranscriptLines(window.text, window.start);
      for (const { line } of lines) {
        const type = line['type'];
        if (type === 'user') counts.user++;
        else if (type === 'assistant') counts.assistant++;
      }
      located.unshift(...lines);
    }

    if (holdsATurn(counts)) break;
    // BYTE 0 IS THE WHOLE TRANSCRIPT, and a positive fact rather than an
    // inference: what was not found here does not exist, and no amount of
    // widening can be asked to find it. A short session that has only been
    // asked a question lands here, and it is not starved by this read's
    // doing -- `starved` below still reports that vam read no conversation,
    // because it did not, and the pane must not claim the turn ended.
    if (from === 0) break;
    // The step lands where this window's first WHOLE line began. A line
    // straddling the requested start is parseable by neither window -- this
    // one trimmed past it, the next would truncate it -- so stepping to the
    // requested start would lose it. When NO line began in the window at all,
    // the range sits wholly inside one enormous line and the requested start
    // is the only offset that still makes progress: that line's content is
    // skipped, which is the point.
    boundary = window.text === '' ? from : window.start;
    if (spent + stride > budget) break;
  }

  const facts = summarizeLines(located, decisionIdPrefix);
  const starved = !(counts.user > 0 || counts.assistant > 0);
  if (!starved) return { facts, starved };
  // EVERY TURN THIS WINDOW MINTED CARRIES THE REASON ITS ANSWER IS MISSING.
  // The `last-prompt` branch that opened them is not wrong -- it exists to name
  // a turn whose prompt is above the window, and it re-emits the prompt in full
  // so the caption is real. What it cannot know is whether an answer exists,
  // and on a window with no conversation in it nothing else can either.
  const decisions: readonly Decision[] = facts.decisions.map((decision) => ({
    ...decision,
    unread: true,
  }));
  return { facts: { ...facts, decisions }, starved };
}
