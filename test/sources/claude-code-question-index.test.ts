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
    expect(mergeOpenQuestion(windowQuestions, null)).toBe(windowQuestions);
  });

  it('appends the open question when the window never saw its tool_use', () => {
    const merged = mergeOpenQuestion([], {
      toolUseId: 'toolu_2',
      effectiveId: 'toolu_2',
      offset: 0,
      questions: [openOf('toolu_2')],
    });
    expect(merged.map((q) => q.id)).toEqual(['toolu_2:0']);
  });

  it('does not duplicate a question the window already represents', () => {
    const windowQuestions = [{ ...openOf('toolu_1'), answer: 'yes' }];
    const merged = mergeOpenQuestion(windowQuestions, {
      toolUseId: 'toolu_1',
      effectiveId: 'toolu_1',
      offset: 0,
      questions: [openOf('toolu_1')],
    });
    expect(merged).toBe(windowQuestions);
  });

  it('keeps the window questions first -- the open one is always the newest', () => {
    const windowQuestions = [openOf('toolu_1')];
    const merged = mergeOpenQuestion(windowQuestions, {
      toolUseId: 'toolu_2',
      effectiveId: 'toolu_2',
      offset: 10,
      questions: [openOf('toolu_2')],
    });
    expect(merged.map((q) => q.id)).toEqual(['toolu_1:0', 'toolu_2:0']);
  });

  /**
   * A REUSED raw id, disambiguated -- see `nextEffectiveId` in `questions.ts`.
   * The window already holds the FIRST occurrence, answered; the open one
   * IS the second, still waiting. Keying the merge's dedup check off the raw
   * `toolUseId` (as it used to) would read the window's first-occurrence id
   * as already covering this one -- same prefix, `toolu_mock_1:` -- and drop
   * the genuinely open second occurrence on the floor. Keying it off
   * `effectiveId` instead tells the two occurrences apart.
   */
  it("does not let a reused id's answered first occurrence swallow its open second", () => {
    const answeredFirst = { ...openOf('toolu_mock_1'), answer: 'first answer' };
    const openSecond = { ...openOf('toolu_mock_1'), id: 'toolu_mock_1#2:0' };
    const merged = mergeOpenQuestion([answeredFirst], {
      toolUseId: 'toolu_mock_1',
      effectiveId: 'toolu_mock_1#2',
      offset: 10,
      questions: [openSecond],
    });
    expect(merged.map((q) => q.id)).toEqual(['toolu_mock_1:0', 'toolu_mock_1#2:0']);
    // The merge never reopens what the window already settled.
    expect(merged[0]?.answer).toBe('first answer');
    expect(merged[1]?.answer).toBeNull();
  });
});
