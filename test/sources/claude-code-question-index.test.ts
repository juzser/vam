/**
 * THE OPEN QUESTION THE TAIL WINDOW CANNOT SEE.
 *
 * `tail.ts`'s widening read stops the moment it holds the raw material of ONE
 * turn -- any `user` line and any `assistant` line, per `holdsATurn`. It never
 * widens specifically to keep an open `AskUserQuestion` in view: a burst of
 * ordinary conversation after the question satisfies that stop rule on its
 * own, so a poll can read a window that holds ZERO trace of a question still
 * waiting on the operator. The card in the Response view then reads as if the
 * session never asked -- silently, because `collectQuestions` only sees what
 * is IN the window, and a `tool_use` outside it is not data vam does not
 * have, it is data vam never asked for.
 *
 * THIS MODULE'S JOB is answering one question cheaply, every poll, without
 * rereading the file: is there a NEWER `AskUserQuestion` than whatever the
 * tail window found, and does it have an answer yet? An append-only file
 * makes that a bounded amount of NEW work per poll -- typically the one line
 * that was appended since the last one -- rather than a second widening scan.
 *
 * EVERY FIXTURE HERE IS INVENTED, in the same style as `claude-code-tail-
 * window.test.ts`: shapes measured against the real corpus, then written out
 * from scratch. No transcript content, session id or path from the machine
 * running this reaches a fixture.
 */

import { describe, expect, it } from 'vitest';
import {
  createQuestionIndex,
  foldQuestionWindow,
  mergeOpenQuestion,
  readOpenQuestion,
} from '../../src/main/sources/claude-code/question-index.js';
import { readWindowOf } from '../../src/main/sources/claude-code/window.js';
import type { AgentQuestion } from '../../src/renderer/domain/model.js';

const jsonl = (...lines: unknown[]) => `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;

const ask = (id: string, questions: unknown) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] },
});

const answerLine = (id: string, content: unknown) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
});

const chatter = (n: number) => ({
  type: 'assistant',
  message: { content: [{ type: 'text', text: `filler ${n}` }] },
});

const PROVIDERS = {
  question: 'Which providers should vam support beyond Claude Code?',
  header: 'Providers',
  multiSelect: false,
  options: [{ label: 'Codex CLI', description: 'a second CLI agent' }],
};

/** `n` bytes of filler as complete JSONL lines, so a file can clear any cap. */
function fillerLines(bytes: number): string {
  let out = '';
  let i = 0;
  while (Buffer.byteLength(out, 'utf8') < bytes) {
    out += jsonl(chatter(i));
    i += 1;
  }
  return out;
}

/** One JSONL line of exactly `bytes` bytes, in the shape of an oversized tool result. */
function oversizedLine(bytes: number): string {
  const envelope = JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'text', text: '' }] },
  });
  const filler = bytes - envelope.length;
  expect(filler).toBeGreaterThan(0);
  return JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'text', text: 'x'.repeat(filler) }] },
  });
}

/** An in-memory transcript source, so no test here opens a file. */
function readerOf(text: string) {
  const bytes = Buffer.from(text, 'utf8');
  let calls = 0;
  return {
    get reads() {
      return calls;
    },
    bytes: () => bytes.length,
    size: async () => bytes.length,
    read: async (from: number, to: number) => {
      calls += 1;
      return readWindowOf(bytes, from, to);
    },
  };
}

const CAP = 4096;

/** A recording transcript source: every `read(from, to)` range, in order. */
function recordingSourceOf(text: string) {
  const bytes = Buffer.from(text, 'utf8');
  const ranges: { from: number; to: number }[] = [];
  return {
    ranges,
    bytes: () => bytes.length,
    size: async () => bytes.length,
    read: async (from: number, to: number) => {
      ranges.push({ from, to });
      return readWindowOf(bytes, from, to);
    },
  };
}

/** A fixed-length complete JSONL line, so many of them sum predictably. */
const shortLine = (n: number) =>
  `${JSON.stringify({ type: 'c', n: String(n).padStart(6, '0') })}\n`;
const SHORT_LINE_BYTES = Buffer.byteLength(shortLine(0), 'utf8');

/** One complete JSONL line of exactly `bytes` bytes, padded in a text field. */
function paddedLine(bytes: number): string {
  const prefix = '{"type":"p","t":"';
  const suffix = '"}';
  const padLen = bytes - prefix.length - suffix.length - 1; // -1 for the trailing newline
  expect(padLen).toBeGreaterThanOrEqual(0);
  return `${prefix}${'x'.repeat(padLen)}${suffix}\n`;
}

/** `total` bytes of complete JSONL filler lines, summed exactly. */
function fillerOfExactly(total: number): string {
  let count = Math.floor(total / SHORT_LINE_BYTES);
  let remainder = total - count * SHORT_LINE_BYTES;
  // A remainder too small to hold a padded line's own envelope borrows one
  // more short line's worth of room from the count above it.
  if (remainder > 0 && remainder < 24) {
    count -= 1;
    remainder += SHORT_LINE_BYTES;
  }
  let out = '';
  for (let i = 0; i < count; i += 1) out += shortLine(i);
  if (remainder > 0) out += paddedLine(remainder);
  return out;
}

/** An `AskUserQuestion` tool_use line, padded to exactly `bytes` bytes. */
function askLineOfExactly(id: string, bytes: number): string {
  const zero = ask(id, [{ ...PROVIDERS, options: [{ label: 'Codex CLI', description: '' }] }]);
  const baseLen = Buffer.byteLength(`${JSON.stringify(zero)}\n`, 'utf8');
  const padLen = bytes - baseLen;
  expect(padLen).toBeGreaterThan(0);
  const padded = ask(id, [
    { ...PROVIDERS, options: [{ label: 'Codex CLI', description: 'x'.repeat(padLen) }] },
  ]);
  const line = `${JSON.stringify(padded)}\n`;
  expect(Buffer.byteLength(line, 'utf8')).toBe(bytes);
  return line;
}

const maxRangeBytes = (ranges: { from: number; to: number }[]) =>
  Math.max(...ranges.map((r) => r.to - r.from));

describe('readOpenQuestion', () => {
  it('finds a question asked, then buried under more filler than the read window', async () => {
    const body = jsonl(ask('toolu_1', [PROVIDERS])) + fillerLines(CAP + 500);
    const reader = readerOf(body);
    const index = createQuestionIndex();

    const open = await readOpenQuestion(
      index,
      'sess-1',
      reader.bytes(),
      1,
      reader,
      CAP + 500 + 1024,
    );

    expect(open?.toolUseId).toBe('toolu_1');
    expect(open?.questions).toHaveLength(1);
    expect(open?.questions[0]?.answer).toBeNull();
    expect(open?.questions[0]?.question).toBe(PROVIDERS.question);
  });

  it('does not report a question open once its answer has landed, even buried under filler', async () => {
    const body =
      jsonl(ask('toolu_1', [PROVIDERS])) +
      fillerLines(CAP) +
      jsonl(answerLine('toolu_1', 'Codex CLI'));
    const reader = readerOf(body);
    const index = createQuestionIndex();

    const open = await readOpenQuestion(index, 'sess-1', reader.bytes(), 1, reader, CAP + 4096);

    expect(open).toBeNull();
  });

  it('is bounded by its own cap and never reads past it, even with no question at all', async () => {
    const body = fillerLines(CAP * 10);
    const reader = readerOf(body);
    const index = createQuestionIndex();

    const open = await readOpenQuestion(index, 'sess-1', reader.bytes(), 1, reader, CAP);

    expect(open).toBeNull();
    // ONE read: the bootstrap scan is a single bounded range, not a stepped
    // widen -- this runs once per cold session, never once per poll.
    expect(reader.reads).toBe(1);
  });

  it('gives every question of one tool_use its own id, sharing the call openness', async () => {
    const second = { ...PROVIDERS, question: 'Which one first?' };
    const body = jsonl(ask('toolu_1', [PROVIDERS, second]));
    const reader = readerOf(body);
    const index = createQuestionIndex();

    const open = await readOpenQuestion(index, 'sess-1', reader.bytes(), 1, reader, CAP);

    expect(open?.questions.map((q) => q.id)).toEqual(['toolu_1:0', 'toolu_1:1']);
  });

  it('does not close a question because some OTHER tool_result arrived', async () => {
    const body = jsonl(ask('toolu_1', [PROVIDERS]), answerLine('toolu_9', 'unrelated'));
    const reader = readerOf(body);
    const index = createQuestionIndex();

    const open = await readOpenQuestion(index, 'sess-1', reader.bytes(), 1, reader, CAP);

    expect(open?.toolUseId).toBe('toolu_1');
  });

  it('does not choke on one line far bigger than the step, and still finds the question beside it', async () => {
    const body = jsonl(ask('toolu_1', [PROVIDERS])) + `${oversizedLine(CAP * 3)}\n`;
    const reader = readerOf(body);
    const index = createQuestionIndex();

    // The whole body fits inside one generous cap -- the oversized line does
    // not prevent the tool_use beside it from being parsed; only a window
    // boundary landing INSIDE a line can do that, and a single bounded read
    // has no boundary in the middle.
    const open = await readOpenQuestion(index, 'sess-1', reader.bytes(), 1, reader, CAP * 10);

    expect(open?.toolUseId).toBe('toolu_1');
  });

  it('stays within its cap and answers nothing rather than throwing when one line alone exceeds it', async () => {
    const body = jsonl(ask('toolu_1', [PROVIDERS])) + `${oversizedLine(CAP * 10)}\n`;
    const reader = readerOf(body);
    const index = createQuestionIndex();

    await expect(
      readOpenQuestion(index, 'sess-1', reader.bytes(), 1, reader, CAP),
    ).resolves.not.toThrow();
    const open = await readOpenQuestion(index, 'sess-1', reader.bytes(), 1, reader, CAP);
    // The cap bounds the read regardless of the answer: this is the same
    // valve `tail.ts`'s MAX_TAIL_READ_BYTES is, not a promise to find
    // everything.
    expect(open).toBeNull();
  });

  describe('the cache', () => {
    it('costs zero reads when the file has not grown since the last check', async () => {
      const body = jsonl(ask('toolu_1', [PROVIDERS]));
      const reader = readerOf(body);
      const index = createQuestionIndex();

      const first = await readOpenQuestion(index, 'sess-1', reader.bytes(), 5, reader, CAP);
      const readsAfterFirst = reader.reads;
      const second = await readOpenQuestion(index, 'sess-1', reader.bytes(), 5, reader, CAP);

      expect(reader.reads).toBe(readsAfterFirst);
      expect(second).toEqual(first);
    });

    it('reads only the bytes appended since the last check, not the whole file again', async () => {
      const before = jsonl(ask('toolu_1', [PROVIDERS]));
      const reader = readerOf(before);
      const index = createQuestionIndex();
      await readOpenQuestion(index, 'sess-1', reader.bytes(), 1, reader, CAP);

      const appended = jsonl(answerLine('toolu_1', 'Codex CLI'));
      const grown = readerOf(before + appended);
      // Same index, a file that grew -- the read `grown` sees must start at
      // the offset the FIRST call already consumed through, not at 0.
      const seenFrom: number[] = [];
      const tracking = {
        size: grown.size,
        read: async (from: number, to: number) => {
          seenFrom.push(from);
          return grown.read(from, to);
        },
      };
      const open = await readOpenQuestion(
        index,
        'sess-1',
        Buffer.byteLength(before + appended, 'utf8'),
        2,
        tracking,
        CAP,
      );

      expect(open).toBeNull();
      expect(seenFrom).toEqual([Buffer.byteLength(before, 'utf8')]);
    });

    it('does not consume a partial trailing line, and completes it on the next read', async () => {
      const whole = jsonl(ask('toolu_1', [PROVIDERS]));
      const partial = whole + '{"type":"user","message":{"content":[{"type":"tool_res';
      const reader = readerOf(partial);
      const index = createQuestionIndex();

      const open = await readOpenQuestion(index, 'sess-1', reader.bytes(), 1, reader, CAP);
      expect(open?.toolUseId).toBe('toolu_1');

      // The line finishes writing -- the SAME bytes the partial read already
      // saw are re-read, plus what completed the line, because the cache must
      // not have advanced past a line it could not parse.
      const completed = whole + jsonl(answerLine('toolu_1', 'Codex CLI'));
      const grownReader = readerOf(completed);
      const after = await readOpenQuestion(
        index,
        'sess-1',
        Buffer.byteLength(completed, 'utf8'),
        2,
        grownReader,
        CAP,
      );
      expect(after).toBeNull();
    });

    it('rebuilds rather than crashing when the file is smaller than what was cached (truncated or rotated)', async () => {
      const before = jsonl(ask('toolu_1', [PROVIDERS])) + fillerLines(200);
      const bigReader = readerOf(before);
      const index = createQuestionIndex();
      await readOpenQuestion(index, 'sess-1', bigReader.bytes(), 5, bigReader, CAP);

      const after = 'not the same file at all\n';
      const smallReader = readerOf(after);
      await expect(
        readOpenQuestion(index, 'sess-1', smallReader.bytes(), 6, smallReader, CAP),
      ).resolves.not.toThrow();
      const rebuilt = await readOpenQuestion(
        index,
        'sess-1',
        smallReader.bytes(),
        6,
        smallReader,
        CAP,
      );
      expect(rebuilt).toBeNull();
    });

    it('disambiguates a reused tool_use id across two separate polls', async () => {
      const first = jsonl(ask('toolu_mock_1', [PROVIDERS]), answerLine('toolu_mock_1', 'first'));
      const reader1 = readerOf(first);
      const index = createQuestionIndex();
      await readOpenQuestion(index, 'sess-1', reader1.bytes(), 1, reader1, CAP);

      const secondAsk = { ...PROVIDERS, question: 'second ask' };
      const second = first + jsonl(ask('toolu_mock_1', [secondAsk]));
      const reader2 = readerOf(second);
      const open = await readOpenQuestion(
        index,
        'sess-1',
        Buffer.byteLength(second, 'utf8'),
        2,
        reader2,
        CAP,
      );

      // The occurrence count is carried in the index's own state, not
      // recomputed from scratch each poll -- the second ask, read alone in
      // this poll's delta, still gets told apart from the first.
      expect(open?.toolUseId).toBe('toolu_mock_1');
      expect(open?.effectiveId).toBe('toolu_mock_1#2');
      expect(open?.questions.map((q) => q.id)).toEqual(['toolu_mock_1#2:0']);
    });

    it('rebuilds when the size matches but the mtime moved backward -- a same-size replacement', async () => {
      const first = jsonl(ask('toolu_1', [PROVIDERS]));
      const firstReader = readerOf(first);
      const index = createQuestionIndex();
      const opened = await readOpenQuestion(
        index,
        'sess-1',
        firstReader.bytes(),
        100,
        firstReader,
        CAP,
      );
      expect(opened?.toolUseId).toBe('toolu_1');

      // A different session's transcript that happens to be exactly the same
      // length, written earlier -- same size, an OLDER mtime. Nothing about
      // the byte count alone says this is a different file; the clock does.
      const replacement = jsonl(ask('toolu_9', [PROVIDERS]));
      expect(Buffer.byteLength(replacement, 'utf8')).toBe(Buffer.byteLength(first, 'utf8'));
      const replacementReader = readerOf(replacement);

      const rebuilt = await readOpenQuestion(
        index,
        'sess-1',
        replacementReader.bytes(),
        50,
        replacementReader,
        CAP,
      );
      expect(rebuilt?.toolUseId).toBe('toolu_9');
    });
  });
});

/**
 * FINDING a5dda874: the catch-up scan chunks a large delta rather than
 * folding it in one unbounded read. See the module's chunking helpers.
 */
describe('readOpenQuestion -- chunked catch-up', () => {
  const SCAN_CAP = 1024;

  it('caps every incremental read range at the scan cap, even for a burst far bigger than it', async () => {
    const initial = fillerOfExactly(512);
    const index = createQuestionIndex();
    const firstReader = recordingSourceOf(initial);
    await readOpenQuestion(index, 'sess-1', firstReader.bytes(), 1, firstReader, SCAN_CAP);

    const growth = fillerOfExactly(SCAN_CAP * 3 + 1);
    const grown = initial + growth;
    const reader = recordingSourceOf(grown);
    await readOpenQuestion(index, 'sess-1', reader.bytes(), 2, reader, SCAN_CAP);

    // The report quotes this: the largest recorded range under the fix.
    expect(maxRangeBytes(reader.ranges)).toBeLessThanOrEqual(SCAN_CAP);
  });

  it('preserves the same open result and final consumedThrough as one whole fold, across several chunks', async () => {
    const initial = fillerOfExactly(200);
    const index = createQuestionIndex();
    const firstReader = recordingSourceOf(initial);
    await readOpenQuestion(index, 'sess-1', firstReader.bytes(), 1, firstReader, SCAN_CAP);
    const consumedAfterFirst = firstReader.bytes();

    // Chunk 1: the ask, sized to exactly fill one chunk on its own.
    const askChunk = askLineOfExactly('toolu_hist', SCAN_CAP);
    // Chunk 2: pure filler -- the question stays open across it.
    const middleChunk = fillerOfExactly(SCAN_CAP);
    // Chunk 3 (and a little more): the answer, then trailing filler.
    const answerL = `${JSON.stringify(answerLine('toolu_hist', 'Codex CLI'))}\n`;
    const tailChunk = fillerOfExactly(SCAN_CAP);
    const growth = askChunk + middleChunk + answerL + tailChunk;
    const grown = initial + growth;

    // The single-fold expectation, computed directly with `foldQuestionWindow`
    // over the WHOLE delta in one call.
    const wholeBytes = Buffer.from(grown, 'utf8');
    const wholeWindow = readWindowOf(wholeBytes, consumedAfterFirst, wholeBytes.length);
    const expected = foldQuestionWindow(null, new Map(), wholeWindow);

    const reader = recordingSourceOf(grown);
    const open = await readOpenQuestion(index, 'sess-1', reader.bytes(), 2, reader, SCAN_CAP);

    expect(reader.ranges.length).toBeGreaterThan(1); // several chunks really ran
    expect(open).toEqual(expected.open);
    expect(open).toBeNull(); // answered by the third chunk
    expect(index.get('sess-1')?.consumedThrough).toBe(expected.consumedThrough);
  });

  it('folds an AskUserQuestion line bigger than the cap whole, deciding the oversized-line case', async () => {
    const initial = fillerOfExactly(200);
    const index = createQuestionIndex();
    const firstReader = recordingSourceOf(initial);
    await readOpenQuestion(index, 'sess-1', firstReader.bytes(), 1, firstReader, SCAN_CAP);
    const consumedAfterFirst = firstReader.bytes();

    const shortBefore = fillerOfExactly(SCAN_CAP * 3);
    const bigLine = askLineOfExactly('toolu_big', SCAN_CAP * 2 + 37);
    const shortAfter = shortLine(9001) + shortLine(9002) + shortLine(9003);
    const growth = shortBefore + bigLine + shortAfter;
    const grown = initial + growth;

    const lineStart = consumedAfterFirst + Buffer.byteLength(shortBefore, 'utf8');
    const lineEnd = lineStart + Buffer.byteLength(bigLine, 'utf8'); // one past the line's own newline

    const wholeBytes = Buffer.from(grown, 'utf8');
    const wholeWindow = readWindowOf(wholeBytes, consumedAfterFirst, wholeBytes.length);
    const expected = foldQuestionWindow(null, new Map(), wholeWindow);

    const reader = recordingSourceOf(grown);
    const open = await readOpenQuestion(index, 'sess-1', reader.bytes(), 2, reader, SCAN_CAP);

    // (a) the same question surfaces as the single fold's -- same id, same
    // question, same options.
    expect(open).toEqual(expected.open);
    expect(open?.toolUseId).toBe('toolu_big');
    expect(open?.questions[0]?.question).toBe(PROVIDERS.question);

    // (b) the same final consumedThrough.
    expect(index.get('sess-1')?.consumedThrough).toBe(expected.consumedThrough);

    // (c) every recorded range is either within the cap, or lies entirely
    // inside the long line's own byte span. The report quotes this against
    // HEAD, where the one recorded range of about 5x the cap starts in the
    // short lines before it, failing this same assertion.
    for (const range of reader.ranges) {
      const withinCap = range.to - range.from <= SCAN_CAP;
      const withinLine = range.from >= lineStart && range.to <= lineEnd;
      expect(withinCap || withinLine).toBe(true);
    }
  });

  it('yields to the event loop before an unbounded catch-up resolves', async () => {
    const initial = fillerOfExactly(512);
    const index = createQuestionIndex();
    const firstReader = recordingSourceOf(initial);
    await readOpenQuestion(index, 'sess-1', firstReader.bytes(), 1, firstReader, SCAN_CAP);

    // Many chunks, not a handful: under CPU contention (the full suite runs
    // hundreds of files in parallel) a few `setImmediate` round trips can
    // race ahead of a 1 ms-clamped timer. A hundred-plus round trips cannot.
    const growth = fillerOfExactly(SCAN_CAP * 150 + 1);
    const grown = initial + growth;
    const reader = recordingSourceOf(grown);

    const order: string[] = [];
    setTimeout(() => order.push('timer'), 0);
    await readOpenQuestion(index, 'sess-1', reader.bytes(), 2, reader, SCAN_CAP);
    order.push('resolved');

    // The report quotes this order: under the fix the timer fires first.
    expect(order).toEqual(['timer', 'resolved']);
  });
});

describe('mergeOpenQuestion', () => {
  const openOf = (id: string): AgentQuestion => ({
    id: `${id}:0`,
    header: null,
    question: 'q',
    multiSelect: false,
    options: [{ label: 'a', description: null }],
    answer: null,
  });

  it('passes the window questions through untouched when there is no open question', () => {
    const windowQuestions = [openOf('toolu_1')];
    expect(mergeOpenQuestion(windowQuestions, null, new Map())).toBe(windowQuestions);
  });

  it('appends the open question when the window never saw its tool_use', () => {
    const merged = mergeOpenQuestion(
      [],
      {
        toolUseId: 'toolu_2',
        effectiveId: 'toolu_2',
        offset: 0,
        questions: [openOf('toolu_2')],
      },
      new Map(),
    );
    expect(merged.map((q) => q.id)).toEqual(['toolu_2:0']);
  });

  it('does not duplicate a question the window already represents', () => {
    const windowQuestions = [{ ...openOf('toolu_1'), answer: 'yes' }];
    // The window's own recorded offset for its one ask, and `open`'s own
    // offset below are the SAME physical ask -- offset 0.
    const windowOffsets = new Map([['toolu_1', 0]]);
    const merged = mergeOpenQuestion(
      windowQuestions,
      {
        toolUseId: 'toolu_1',
        effectiveId: 'toolu_1',
        offset: 0,
        questions: [openOf('toolu_1')],
      },
      windowOffsets,
    );
    expect(merged).toBe(windowQuestions);
  });

  it('keeps the window questions first -- the open one is always the newest', () => {
    const windowQuestions = [openOf('toolu_1')];
    const windowOffsets = new Map([['toolu_1', 0]]);
    const merged = mergeOpenQuestion(
      windowQuestions,
      {
        toolUseId: 'toolu_2',
        effectiveId: 'toolu_2',
        offset: 10,
        questions: [openOf('toolu_2')],
      },
      windowOffsets,
    );
    expect(merged.map((q) => q.id)).toEqual(['toolu_1:0', 'toolu_2:0']);
  });

  /**
   * A REUSED raw id, disambiguated -- see `nextEffectiveId` in `questions.ts`.
   * The window already holds the FIRST occurrence, answered, at its own
   * offset (5); the open one IS the second, still waiting, at a DIFFERENT
   * offset (50) -- a later ask under the same raw id. Matching by offset
   * (rather than by the raw id the two share, which an earlier version of
   * this function tried and an S2 retired -- see `mergeOpenQuestion`'s own
   * header) is what tells the two occurrences apart here.
   */
  it("does not let a reused id's answered first occurrence swallow its open second", () => {
    const answeredFirst = { ...openOf('toolu_mock_1'), answer: 'first answer' };
    const windowOffsets = new Map([['toolu_mock_1', 5]]);
    const openSecond = { ...openOf('toolu_mock_1'), id: 'toolu_mock_1#2:0' };
    const merged = mergeOpenQuestion(
      [answeredFirst],
      {
        toolUseId: 'toolu_mock_1',
        effectiveId: 'toolu_mock_1#2',
        offset: 50,
        questions: [openSecond],
      },
      windowOffsets,
    );
    expect(merged.map((q) => q.id)).toEqual(['toolu_mock_1:0', 'toolu_mock_1#2:0']);
    // The merge never reopens what the window already settled.
    expect(merged[0]?.answer).toBe('first answer');
    expect(merged[1]?.answer).toBeNull();
  });

  /**
   * THE TWO PATHS NUMBER THE SAME REUSED ID DIFFERENTLY, AND THE DEDUP MISSES
   * IT (cross-provider review finding). `collectQuestions` (questions.ts) --
   * the tail window's own reading -- counts a reused `toolUseId`'s
   * occurrences from only the bytes ITS OWN window covers; `readOpenQuestion`
   * counts from this module's wider, persisted scan. A `toolUseId` whose
   * FIRST occurrence sits outside the tail window but inside this module's
   * scan is undercounted by the window: it draws the window's OWN (second,
   * genuinely open) occurrence as `toolu_mock_1:0` -- no `#2` suffix, as if
   * it were the first -- while this module correctly names the very same
   * occurrence `toolu_mock_1#2:0`. BOTH readings are of the exact same
   * physical ask, though, so they carry the SAME offset (50) -- which is
   * what the merge now keys on, rather than the mismatched `effectiveId`
   * strings. `claude-code-question-window.test.ts` holds the full,
   * real-file version of this same scenario end to end.
   */
  it("does not double-draw a reused id when the window's own numbering undercounted it", () => {
    const windowQuestions = [openOf('toolu_mock_1')]; // window's own guess: 'toolu_mock_1:0', unanswered
    const windowOffsets = new Map([['toolu_mock_1', 50]]); // the one ask the window actually read
    const merged = mergeOpenQuestion(
      windowQuestions,
      {
        toolUseId: 'toolu_mock_1',
        effectiveId: 'toolu_mock_1#2', // this module's own, correctly-numbered finding for the SAME occurrence
        offset: 50, // the SAME physical ask the window already read, above
        questions: [{ ...openOf('toolu_mock_1'), id: 'toolu_mock_1#2:0' }],
      },
      windowOffsets,
    );
    expect(merged).toEqual(windowQuestions);
  });

  /**
   * THE S2 A RAW-ID-KEYED FIX (a prior version of this function) COST:
   * DATA LOSS, worse than the duplicate card it replaced. That version
   * treated any UNANSWERED window entry sharing `open`'s raw `toolUseId` as
   * already covering it, reasoning that a raw id has at most one open
   * occurrence at a time. Nothing in `collectQuestions` (questions.ts)
   * actually promises that -- its own header says so -- and this is the
   * shape that breaks the assumption: the window independently found an
   * OLDER ask under `toolu_mock_1` still open (its own tail read predates a
   * later one), and this module -- scanning the same file more currently --
   * found a GENUINELY DIFFERENT, newer ask under the SAME raw id, ALSO still
   * open (`readOpenQuestion` always reports only the newest live ask, so an
   * older one it no longer tracks does not make this module's finding wrong,
   * only incomplete on its own). The raw-id-keyed version read the window's
   * older open entry as already covering the newer one and silently dropped
   * the genuinely distinct, still-pending question. Offset does not make
   * that mistake: the two asks sit at different byte positions, so both
   * survive.
   */
  it('draws two cards when a reused raw id has two distinct, simultaneously open occurrences', () => {
    const olderOpen = openOf('toolu_mock_1'); // id 'toolu_mock_1:0', unanswered -- the window's own reading
    const windowOffsets = new Map([['toolu_mock_1', 5]]);
    const newerOpen = { ...openOf('toolu_mock_1'), id: 'toolu_mock_1#2:0' };
    const merged = mergeOpenQuestion(
      [olderOpen],
      {
        toolUseId: 'toolu_mock_1',
        effectiveId: 'toolu_mock_1#2',
        offset: 50, // a DIFFERENT, later ask under the same reused raw id
        questions: [newerOpen],
      },
      windowOffsets,
    );
    expect(merged.map((q) => q.id)).toEqual(['toolu_mock_1:0', 'toolu_mock_1#2:0']);
    expect(merged[0]?.answer).toBeNull();
    expect(merged[1]?.answer).toBeNull();
  });
});
