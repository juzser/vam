/**
 * THE MODEL A SESSION'S LAST TURN ACTUALLY RAN ON, read out of its transcript.
 *
 * WHY THERE IS A SECOND SOURCE AT ALL. `main/terminal/model.ts` reads the
 * model off the CLI's own painted footer, which is correct and is also
 * OPERATOR-CONFIGURABLE: `~/.claude/settings.json` may set `statusLine` to a
 * command of the operator's own, and then the line vam matches is simply not
 * on the screen. Measured on the machine this was written for -- a status
 * line replaced by `bash ~/.claude/statusline-command.sh`, emitting raw JSON
 * across several lines -- the footer reader answers "I cannot tell" forever
 * and the button wears the word `model` for the life of the session. A control
 * whose one fact can be switched off by an unrelated setting is a control that
 * needs a second way to know.
 *
 * ── WHAT WAS MEASURED, over the 94 transcripts under `~/.claude/projects`
 * on 2026-09-19 ──────────────────────────────────────────────────────────
 *
 *  - `message.model` is carried by `assistant` lines and by NOTHING else:
 *    10,910 occurrences in the last 4 MiB of each file, every one of them on
 *    a line of `type: "assistant"`.
 *  - five distinct values: `claude-opus-5` (10,489), `claude-fable-5-1`
 *    (363), `claude-sonnet-5` (40), `<synthetic>` (14) and
 *    `claude-haiku-4-5-20251001` (4).
 *  - `<synthetic>` is the CLI's own marker for an assistant line it wrote
 *    ITSELF without calling the API -- an interrupt, an error. Its `usage`
 *    counts are all zero. It is not a model, and on 2 of the 3 files whose
 *    NEWEST model value it is, the turn above it ran on `claude-opus-5`.
 *  - with a 32 KiB first step, 84 of the 94 answer on the first read and 79
 *    answer at all; the other 15 are sessions with no `assistant` line in
 *    them, which is `unknown` and must stay `unknown`.
 *  - TWO of them can only be answered by widening: `3ef16391-…` and
 *    `cf8fff9e-…` carry a 131,880-byte `attachment` line ELEVEN lines from
 *    the end -- larger than the 128 KiB window `load()` reads -- with the
 *    session's only `assistant` line directly above it. A single-window read
 *    of either answers `null` while the file plainly says `claude-fable-5-1`.
 *    That is this repo's own measured trap (`claude-code-tail-window.test.ts`)
 *    arriving at a second reader, and the reason this one steps.
 *
 * EVERY FIXTURE HERE IS INVENTED, which is this directory's rule
 * (`claude-code-tail-window.test.ts` states it): the shapes above were
 * measured against the real corpus and then written out from scratch. No
 * transcript content, session id, home path or user name from the machine
 * running this reaches a fixture.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_TAIL_READ_BYTES } from '../../src/main/sources/claude-code/tail.js';
import {
  displayModelName,
  MODEL_WINDOW_BYTES,
  modelIdOnLine,
  readSessionModelFromTranscript,
  readTranscriptModel,
} from '../../src/main/sources/claude-code/transcript-model.js';

const jsonl = (...lines: unknown[]) => `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;

/** An assistant line, the shape every one of the 10,910 measured ones has. */
const answered = (model: string, text = 'on it') => ({
  type: 'assistant',
  timestamp: '2026-09-19T09:01:00.000Z',
  message: { role: 'assistant', model, content: [{ type: 'text', text }] },
});

/** A prompt. It carries no `model`, which is the measured fact. */
const asked = (text: string) => ({
  type: 'user',
  timestamp: '2026-09-19T09:00:00.000Z',
  message: { role: 'user', content: [{ type: 'text', text }] },
});

/**
 * One line of exactly `bytes` bytes, in the family that causes the starvation:
 * an `attachment` whose `prompt_snapshot` payload runs past the window. Copied
 * in shape from `claude-code-tail-window.test.ts`, which measured it.
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
  const reads: { from: number; to: number }[] = [];
  return {
    reads,
    bytes: () => bytes.length,
    source: {
      size: async () => bytes.length,
      read: async (from: number, to: number) => {
        reads.push({ from, to });
        const end = Math.max(0, Math.min(to, bytes.length));
        const start = Math.max(0, Math.min(from, end));
        const probe = start === 0 ? 0 : start - 1;
        const slice = bytes.subarray(probe, end);
        if (start === 0) return { text: slice.toString('utf8'), start: 0 };
        const first = slice.indexOf(0x0a);
        if (first === -1) return { text: '', start: end };
        return { text: slice.subarray(first + 1).toString('utf8'), start: probe + first + 1 };
      },
    },
  };
}

describe('which lines carry a model, and which only look as though they do', () => {
  it('takes it off an assistant line', () => {
    expect(modelIdOnLine(answered('claude-opus-5'))).toBe('claude-opus-5');
  });

  it('refuses every other line type, because no other type carries one', () => {
    // Measured: all 10,910 `message.model` values in the corpus sit on
    // `assistant` lines. A `model` field anywhere else is a field this reader
    // has never seen and must not start believing.
    expect(modelIdOnLine(asked('go'))).toBeNull();
    expect(modelIdOnLine({ type: 'user', message: { model: 'claude-opus-5' } })).toBeNull();
    expect(modelIdOnLine({ type: 'summary', message: { model: 'claude-opus-5' } })).toBeNull();
  });

  it('refuses `<synthetic>`, which is the CLI writing a line the API never served', () => {
    // 14 in the corpus. It is a marker, not a model; a button wearing it
    // would be a word no operator can act on.
    expect(modelIdOnLine(answered('<synthetic>'))).toBeNull();
  });

  it('refuses by SHAPE and not by a list of names', () => {
    // The rule `model.ts` states for the footer, kept here: a parser that
    // believed only the five aliases would answer "I cannot tell" on the day
    // the CLI shipped the sixth. An id vam has never seen is taken; a value
    // that is not id-shaped at all is not.
    expect(modelIdOnLine(answered('claude-quartz-9'))).toBe('claude-quartz-9');
    expect(modelIdOnLine(answered('Opus 5'))).toBeNull();
    expect(modelIdOnLine(answered(''))).toBeNull();
    expect(modelIdOnLine(answered('claude--opus'))).toBeNull();
    expect(modelIdOnLine(answered('-claude-opus-5'))).toBeNull();
    expect(modelIdOnLine({ type: 'assistant', message: { model: 5 } })).toBeNull();
    expect(modelIdOnLine({ type: 'assistant' })).toBeNull();
    expect(modelIdOnLine(null)).toBeNull();
  });
});

describe('the name the button wears for an id', () => {
  it('reads the id the way the CLI prints its own footer', () => {
    // The footer's shape is `<Model> <Version>` (`main/terminal/model.ts`), so
    // a transcript-sourced name is derived INTO that shape: the two sources
    // then agree, the picker's tick rule keeps working across both, and a
    // session whose footer comes and goes does not rename its own button.
    expect(displayModelName('claude-opus-5')).toBe('Opus 5');
    expect(displayModelName('claude-sonnet-5')).toBe('Sonnet 5');
    expect(displayModelName('claude-fable-5-1')).toBe('Fable 5.1');
  });

  it('drops an eight-digit date, because a date is not a version', () => {
    // `fixtures/demo.ts` carries the measurement this is held against:
    // `/model claude-sonnet-4-5-20250929` paints `Sonnet 4.5` on the footer.
    expect(displayModelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5');
    expect(displayModelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
  });

  it('derives a name it has never seen, with no vocabulary to consult', () => {
    expect(displayModelName('claude-quartz-9')).toBe('Quartz 9');
    expect(displayModelName('claude-opus-6')).toBe('Opus 6');
  });

  it('shows the id itself rather than a plausible wrong name', () => {
    // THE HONEST REFUSAL. `claude-3-5-sonnet-20241022` is the older API naming
    // -- family AFTER the numbers -- and the rule above would read `Claude`
    // out of it, which is a name the operator could act on and a wrong one.
    // An alphabetic segment after the version means this is not the shape that
    // was measured, so nothing is derived and the id is shown whole.
    expect(displayModelName('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
    expect(displayModelName('claude-opus-5-preview')).toBe('claude-opus-5-preview');
    expect(displayModelName('5-1')).toBe('5-1');
  });

  it('names a model with no version at all', () => {
    expect(displayModelName('claude-opus')).toBe('Opus');
  });
});

describe('reading one transcript backwards for its newest model', () => {
  it('answers the model of the NEWEST assistant line, not the first it meets', async () => {
    const { source } = readerOf(
      jsonl(
        asked('one'),
        answered('claude-sonnet-5'),
        asked('two'),
        answered('claude-opus-5'),
        asked('three'),
      ),
    );
    expect(await readTranscriptModel(source)).toBe('claude-opus-5');
  });

  it('reads one window and stops when that window answers', async () => {
    const { source, reads } = readerOf(jsonl(asked('one'), answered('claude-opus-5')));
    expect(await readTranscriptModel(source)).toBe('claude-opus-5');
    expect(reads).toHaveLength(1);
  });

  it('skips a line that fails JSON.parse rather than giving up on the window', async () => {
    // A measuring tool in this repo once inherited exactly this bug and
    // reported a confident zero. A half-written last line is what an
    // append-only log looks like mid-write.
    const { source } = readerOf(
      `${jsonl(asked('one'), answered('claude-opus-5'))}{"type":"assistant","mess`,
    );
    expect(await readTranscriptModel(source)).toBe('claude-opus-5');
  });

  it('steps past a line larger than the whole window, and finds the turn above it', async () => {
    // THE TRAP, WITH THE MEASURED SHAPE. Two real transcripts carry a
    // 131,880-byte `attachment` eleven lines from the end with the session's
    // only assistant line directly above it. A single-window read answers
    // null; this one steps to where the line began and carries on.
    const step = 4 * 1024;
    const { source } = readerOf(
      `${jsonl(asked('one'), answered('claude-fable-5-1'))}${oversizedLine(step * 3 + 500)}\n${jsonl(
        { type: 'last-prompt', lastPrompt: 'next' },
        { type: 'cost-state', cost: 1 },
      )}`,
    );
    expect(await readTranscriptModel(source, step)).toBe('claude-fable-5-1');
  });

  it('and that oversized line costs bytes, never a wrong answer or a loop', async () => {
    const step = 4 * 1024;
    const { source, reads } = readerOf(
      `${jsonl(answered('claude-opus-5'))}${oversizedLine(step * 4 + 7)}\n`,
    );
    expect(await readTranscriptModel(source, step)).toBe('claude-opus-5');
    // Every read moved the boundary down; a step that did not make progress
    // is the shape that spins forever.
    const tos = reads.map((r) => r.to);
    expect(new Set(tos).size).toBe(tos.length);
  });

  it('answers null when the file holds no assistant line at all', async () => {
    // 15 of the 94 measured transcripts are exactly this, and the button
    // keeps the word it wore before. `unknown` stays reachable.
    const { source } = readerOf(jsonl(asked('one'), { type: 'last-prompt', lastPrompt: 'one' }));
    expect(await readTranscriptModel(source)).toBeNull();
  });

  it('answers null for an empty transcript, and reads nothing at all', async () => {
    const { source, reads } = readerOf('');
    expect(await readTranscriptModel(source)).toBeNull();
    expect(reads.every((r) => r.to === r.from)).toBe(true);
  });

  it('answers null when the only model in the file is `<synthetic>`', async () => {
    // One real transcript is this: 57 KB in which the CLI answered itself and
    // the API never served a turn. There is no model to name.
    const { source } = readerOf(jsonl(asked('one'), answered('<synthetic>')));
    expect(await readTranscriptModel(source)).toBeNull();
  });

  it('gives up at the budget rather than reading a whole transcript', async () => {
    const step = 1024;
    const { source, reads } = readerOf(
      `${jsonl(answered('claude-opus-5'))}${'x'.repeat(200 * 1024)}\n`,
    );
    expect(await readTranscriptModel(source, step, 8 * 1024)).toBeNull();
    expect(reads.reduce((n, r) => n + (r.to - r.from), 0)).toBeLessThanOrEqual(8 * 1024 + step);
  });

  it('is bounded by a window and a budget this repo already argued for', () => {
    expect(MODEL_WINDOW_BYTES).toBe(32 * 1024);
    expect(MAX_TAIL_READ_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('finding the row’s own transcript', () => {
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-model-transcript-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (slug: string, sessionId: string, text: string) => {
    mkdirSync(join(root, slug), { recursive: true });
    writeFileSync(join(root, slug, `${sessionId}.jsonl`), text);
  };

  it('finds it by session id, wherever the slug flattening put it', async () => {
    // THE SLUG IS NEVER PARSED. `sources/claude-code/source.ts` records that
    // it is a lossy flattening -- `/` and `.` both become `-` -- so the index
    // is walked and the id is the key.
    write('-Users-someone-work-my-notes', 'sess-1', jsonl(answered('claude-opus-5')));
    expect(await readSessionModelFromTranscript(root, 'sess-1')).toBe('Opus 5');
  });

  it('takes the session out of a row key, which is `<sessionId>#<pid>`', async () => {
    write('-slug', 'sess-1', jsonl(answered('claude-fable-5-1')));
    expect(await readSessionModelFromTranscript(root, 'sess-1#4242')).toBe('Fable 5.1');
  });

  it('answers null for a row with no transcript, and for a root that is not there', async () => {
    write('-slug', 'sess-1', jsonl(answered('claude-opus-5')));
    expect(await readSessionModelFromTranscript(root, 'sess-2')).toBeNull();
    expect(await readSessionModelFromTranscript(join(root, 'nowhere'), 'sess-1')).toBeNull();
  });

  it('answers null for a transcript that is empty on disk', async () => {
    write('-slug', 'sess-1', '');
    expect(await readSessionModelFromTranscript(root, 'sess-1')).toBeNull();
  });

  it('answers null rather than throwing when the file vanishes under it', async () => {
    // The index is names only and nothing is stat'd while it is built, so a
    // session removed between the walk and the read is an ordinary race. The
    // file IS in the index here -- otherwise this would pass without the
    // reader ever being reached, which is a test that cannot fail.
    write('-slug', 'sess-1', jsonl(answered('claude-opus-5')));
    let opened = 0;
    expect(
      await readSessionModelFromTranscript(root, 'sess-1', () => ({
        size: async () => {
          opened += 1;
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
        read: async () => ({ text: '', start: 0 }),
      })),
    ).toBeNull();
    expect(opened).toBe(1);
  });
});
