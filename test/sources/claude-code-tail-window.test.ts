/**
 * A TRANSCRIPT LINE LARGER THAN THE READ WINDOW, and the turn it used to hide.
 *
 * Reported from use: the Response view said "this turn ended without an
 * answer" while the Terminal tab beside it held the agent's full reply.
 *
 * MEASURED, over the 85 session transcripts on the machine this was written
 * on -- read WHOLE, not through a tail, because a tail read cannot see this
 * defect at all: the offending line is cut in half by the window, fails
 * `JSON.parse`, and is skipped in silence. 670 single lines are larger than
 * the whole 128 KiB window, across 23 files, in three families:
 *
 *   - `attachment` / `prompt_snapshot`   411 lines, 346..9,888 bytes OVER it
 *   - `user` carrying a big tool result  258 lines, 554..1,225,858 bytes over
 *   - `attachment` / `queued_command`      1 line,          253,707 over
 *
 * The first family is the systematic one: the payload is capped near 128 KiB
 * before JSON overhead, so it clears a 128 KiB window almost every time. Two
 * of the 85 files had a tail holding ZERO `user` and ZERO `assistant` lines
 * while the file itself held both -- and with no conversational line in the
 * window the only thing left able to open a turn is the `last-prompt` marker,
 * whose branch pushes a turn with `output: null`. That turn is the sentence
 * the operator was shown.
 *
 * EVERY FIXTURE HERE IS INVENTED. The shapes were measured against the real
 * corpus and then written out from scratch; no transcript content, session id,
 * home path or user name from the machine running this reaches a fixture.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LiveAgent } from '../../src/main/sources/claude-code/agents.js';
import { loadClaudeCodeProjects } from '../../src/main/sources/claude-code/source.js';
import {
  MAX_TAIL_READ_BYTES,
  readLiveTail,
  TAIL_WINDOW_BYTES,
} from '../../src/main/sources/claude-code/tail.js';
import { readWindowOf } from '../../src/main/sources/claude-code/window.js';

const NOW = Date.parse('2026-09-16T09:05:00.000Z');

const jsonl = (...lines: unknown[]) => `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;

const marker = (text: string) => ({ type: 'last-prompt', lastPrompt: text });
const asked = (text: string) => ({
  type: 'user',
  promptSource: 'typed',
  timestamp: '2026-09-16T09:00:00.000Z',
  message: { role: 'user', content: [{ type: 'text', text }] },
});
const answered = (text: string) => ({
  type: 'assistant',
  timestamp: '2026-09-16T09:01:00.000Z',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

/**
 * One line of exactly `bytes` bytes, in the shape of the family that causes
 * this: an `attachment` whose `prompt_snapshot` payload runs past the window.
 *
 * The filler is a repeated ASCII character, so one character is one byte and
 * the length is exact. Invented -- a real snapshot carries the operator's
 * files, which is precisely why none of one is reproduced here.
 */
function oversizedLine(bytes: number): string {
  const envelope = JSON.stringify({
    type: 'attachment',
    attachment: { type: 'prompt_snapshot', content: '' },
  });
  const filler = bytes - envelope.length;
  expect(filler).toBeGreaterThan(0);
  return JSON.stringify({
    type: 'attachment',
    attachment: { type: 'prompt_snapshot', content: 'x'.repeat(filler) },
  });
}

/** A reader over one in-memory transcript, so no test here opens a file. */
function readerOf(text: string) {
  const bytes = Buffer.from(text, 'utf8');
  return {
    reads: [] as { from: number; to: number }[],
    size: async () => bytes.length,
    read: async function (
      this: { reads: { from: number; to: number }[] },
      from: number,
      to: number,
    ) {
      this.reads.push({ from, to });
      return readWindowOf(bytes, from, to);
    },
  };
}

/** The bytes the BUDGET counts: the ranges asked for, probe bytes excluded. */
const rangeBytesOf = (reader: ReturnType<typeof readerOf>) =>
  reader.reads.reduce((sum, r) => sum + (r.to - r.from), 0);

/**
 * Every byte that actually left the disk, probe bytes included -- `window.ts`
 * reads one byte before each range to find the line boundary, so the real cost
 * is the budget plus one per step and `tail.ts` says exactly that.
 */
const bytesReadBy = (reader: ReturnType<typeof readerOf>) =>
  reader.reads.reduce((sum, r) => sum + (r.to - (r.from === 0 ? 0 : r.from - 1)), 0);

/**
 * The operator's session, in the order the real one is written: the turn
 * first, then the snapshot that buries it, then the small metadata lines the
 * window is left holding.
 */
const buriedTurn = (over: number) =>
  jsonl(asked('what is left to do on the release'), answered('three things are left')) +
  `${oversizedLine(over)}\n` +
  jsonl(
    { type: 'ai-title', aiTitle: 'release checklist' },
    { type: 'agent-name', agentName: 'claude-code' },
    marker('what is left to do on the release'),
  );

describe('a transcript line larger than the read window', () => {
  /**
   * THE OPERATOR'S BUG, end to end and at the real byte size: a turn WITH an
   * answer, buried under one line longer than the 128 KiB window `load()`
   * reads. Against the code this replaces the decision comes back with
   * `output: null`, which the Response view captions "this turn ended without
   * an answer" -- beside a Terminal tab holding the answer below.
   *
   * At full size deliberately. Every other test in this file shrinks the
   * window so its fixture can be read, and a shrunken window cannot prove the
   * shipped constant is the one that was too small.
   */
  describe('through loadClaudeCodeProjects, at the shipped window size', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'vam-tail-'));
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    const agent = (): LiveAgent => ({
      key: 'sess-1#100',
      sessionId: 'sess-1',
      pid: null,
      name: 'demo',
      cwd: '/w/alpha',
      status: 'running',
      kind: 'interactive',
      startedAt: null,
    });

    it('reports the answer that sits above a line bigger than the whole window', async () => {
      mkdirSync(join(root, 'proj'), { recursive: true });
      writeFileSync(
        join(root, 'proj', 'sess-1.jsonl'),
        buriedTurn(TAIL_WINDOW_BYTES + 808),
        'utf8',
      );

      const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
      const decision = project?.sessions[0]?.decisions[0];

      expect(decision?.input).toBe('what is left to do on the release');
      expect(decision?.output).toBe('three things are left');
      expect(decision?.unread).toBeUndefined();
    });
  });

  /**
   * The same defect at a window small enough to write a fixture for, so the
   * rules below can be stated one at a time. `readLiveTail` takes its step and
   * its budget as arguments for exactly the reason `readTranscriptHistory`
   * does: a fixture that had to be 2 MiB to exercise the ceiling would be a
   * fixture nobody reads.
   */
  describe('readLiveTail', () => {
    const STEP = 4096;

    it('widens past a line larger than one step and finds the turn above it', async () => {
      const reader = readerOf(buriedTurn(STEP + 200));
      const tail = await readLiveTail(reader, 'sess-1', STEP);

      expect(tail.starved).toBe(false);
      expect(tail.facts.decisions).toHaveLength(1);
      expect(tail.facts.decisions[0]?.output).toBe('three things are left');
    });

    /**
     * THE COMMON CASE PAYS WHAT IT ALWAYS PAID. `load()` runs every
     * `SOURCE_POLL_INTERVAL_MS` for every live session, so a widening read
     * that widened on a normal transcript would be a regression dressed as a
     * fix. Measured over the 85 real transcripts here, 83 satisfy the stop
     * rule on the first step.
     */
    it('reads one step and stops when the first window already holds a turn', async () => {
      const reader = readerOf(
        jsonl(asked('run the tests'), answered('all green'), marker('run the tests')),
      );
      const tail = await readLiveTail(reader, 'sess-1', STEP);

      expect(reader.reads).toHaveLength(1);
      expect(tail.facts.decisions[0]?.output).toBe('all green');
    });

    /**
     * A line ten times the window -- the `user`-with-a-tool-result family,
     * whose largest measured member is 1,356,930 bytes. It must cost the read
     * a bounded amount and let it CONTINUE past, not end the search: the
     * turn above it is the one the operator is looking at.
     */
    it('steps through a line many times the step size rather than stopping at it', async () => {
      const reader = readerOf(buriedTurn(STEP * 10 + 7));
      const tail = await readLiveTail(reader, 'sess-1', STEP);

      expect(tail.starved).toBe(false);
      expect(tail.facts.decisions[0]?.output).toBe('three things are left');
    });

    /**
     * THE CEILING IS A VALVE, NOT THE RULE -- but it is a real bound, and a
     * read that hits it stops. Checked BEFORE each widening rather than after,
     * so what is spent never passes it (`history.ts` made the same mistake
     * once and let a request read twice its budget).
     */
    it('stops at the budget and never spends more than it', async () => {
      const reader = readerOf(buriedTurn(STEP * 40));
      const budget = STEP * 4;
      const tail = await readLiveTail(reader, 'sess-1', STEP, budget);

      expect(rangeBytesOf(reader)).toBeLessThanOrEqual(budget);
      // And the whole real cost, which is the budget plus one probe byte per
      // step -- the number `tail.ts` commits to, asserted rather than trusted.
      expect(bytesReadBy(reader)).toBeLessThanOrEqual(budget + reader.reads.length);
      expect(tail.starved).toBe(true);
    });

    /**
     * THE PART THAT MAKES THE SENTENCE TRUE. vam already KNEW it had parsed no
     * conversational line and drew a confident caption anyway. A window that
     * yields nothing has to say so.
     */
    it('reports starvation when every byte it may read holds no conversation', async () => {
      const reader = readerOf(buriedTurn(STEP * 40));
      const tail = await readLiveTail(reader, 'sess-1', STEP, STEP * 4);

      expect(tail.starved).toBe(true);
      // The marker still opens a turn -- that branch is correct and stays --
      // but every turn minted from a window that read no conversation carries
      // the reason its answer is missing.
      expect(tail.facts.decisions).not.toHaveLength(0);
      for (const decision of tail.facts.decisions) {
        expect(decision.output).toBeNull();
        expect(decision.unread).toBe(true);
      }
    });

    /**
     * THE `last-prompt` BRANCH IS NOT A LIAR, AND MUST NOT BE CALLED ONE.
     *
     * That branch exists for a real and common case: the operator's own line
     * is ABOVE the top of the window, so the marker opens the turn itself and
     * re-emits the prompt in full. On the six largest transcripts measured,
     * five show exactly one turn in the tail and it is this shape. Such a
     * window holds NO `user` line and holds the answer -- so a starvation test
     * that demanded both would brand it unreadable and print "vam could not
     * read the answer to this turn" over the answer itself. That is this
     * defect inverted, and it is a one-character edit away.
     *
     * The stop rule may want both lines; the starvation REPORT may not. They
     * are different questions and this is the fixture that tells them apart.
     */
    it('does not call a window unreadable when it read the answer but not the prompt', async () => {
      const body =
        `${oversizedLine(STEP + 200)}\n` +
        jsonl(marker('what is left to do on the release'), answered('three things are left'));
      const reader = readerOf(body);
      const tail = await readLiveTail(reader, 'sess-1', STEP);

      // It looked for the prompt -- it widened, and it reached byte 0 doing so.
      expect(reader.reads.length).toBeGreaterThan(1);
      expect(reader.reads.at(-1)?.from).toBe(0);
      // ...and having found the ANSWER, it reports a reading, not a refusal.
      expect(tail.starved).toBe(false);
      expect(tail.facts.decisions[0]?.output).toBe('three things are left');
      expect(tail.facts.decisions[0]?.unread).toBeUndefined();
    });

    /** A window that DID read conversation is not starved, and says nothing. */
    it('marks no turn unread when it read conversation', async () => {
      const reader = readerOf(buriedTurn(STEP + 200));
      const tail = await readLiveTail(reader, 'sess-1', STEP);

      expect(tail.starved).toBe(false);
      for (const decision of tail.facts.decisions) expect(decision.unread).toBeUndefined();
    });

    /**
     * A SHORT FILE IS NOT A STARVED ONE. Reaching byte 0 is the whole
     * transcript: whatever was not found there does not exist, and widening
     * cannot be asked to find it. The read stops without spending the budget.
     */
    it('stops at byte 0 rather than re-reading a file it has already read whole', async () => {
      const reader = readerOf(jsonl(marker('nothing has answered yet')));
      const tail = await readLiveTail(reader, 'sess-1', STEP);

      expect(reader.reads).toHaveLength(1);
      expect(tail.starved).toBe(true);
      expect(tail.facts.decisions[0]?.unread).toBe(true);
    });

    /**
     * OFFSETS SURVIVE THE WIDENING, and nothing here is more load-bearing.
     * A turn's id is the byte offset of the line that named it, and that is
     * what makes the tail's overlap with a history page dedupable. A widening
     * read that glued its steps into one string would shift every offset past
     * the join -- so the steps are parsed as SEPARATE windows, each carrying
     * the offset it really begins at.
     */
    it('mints the same turn id widening as a single read of the whole file does', async () => {
      const body = buriedTurn(STEP + 200);
      const widened = await readLiveTail(readerOf(body), 'sess-1', STEP);
      const whole = await readLiveTail(readerOf(body), 'sess-1', Buffer.byteLength(body) * 2);

      expect(widened.facts.decisions[0]?.id).toBe(whole.facts.decisions[0]?.id);
      expect(widened.facts.decisions[0]?.id).toMatch(/^sess-1:@\d+$/);
    });

    /**
     * The two constants, asserted because a comment is not a bound. The step
     * is the window `load()` has always read; the ceiling clears the largest
     * single line measured on this machine (1,356,930 bytes) with a whole step
     * to spare.
     */
    it('ships a step of 128 KiB and a ceiling that clears the largest measured line', () => {
      expect(TAIL_WINDOW_BYTES).toBe(128 * 1024);
      expect(MAX_TAIL_READ_BYTES).toBeGreaterThan(1_356_930 + TAIL_WINDOW_BYTES);
    });
  });
});
