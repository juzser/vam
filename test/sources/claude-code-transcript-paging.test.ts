/**
 * Turn identity that does not move when the window does, and the backward read
 * that makes moving the window the point.
 *
 * Every fixture here is built in this file. The operator's real transcripts are
 * never read, and no home path, session id or transcript content from the
 * machine running this reaches a fixture -- the shapes below were MEASURED
 * against the real corpus and then written out from scratch.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTranscriptHistory } from '../../src/main/sources/claude-code/history.js';
import {
  loadClaudeCodeProjects,
  readClaudeCodeHistory,
} from '../../src/main/sources/claude-code/source.js';
import { summarizeTranscript, turnStartOf } from '../../src/main/sources/claude-code/transcript.js';
import { readTranscriptWindow, readWindowOf } from '../../src/main/sources/claude-code/window.js';

const jsonl = (...lines: unknown[]) => `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
const userPrompt = (text: string) => ({ type: 'last-prompt', lastPrompt: text });
const reply = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

/**
 * A transcript with a REPEATED prompt: "continue" is sent twice with another
 * turn in between, which is the exact shape the fingerprint+rank scheme cannot
 * survive a moving window on -- drop the older "continue" out of the window and
 * the survivor's rank falls from 1 to 0.
 */
const TRANSCRIPT = jsonl(
  userPrompt('continue'),
  reply('did a'),
  userPrompt('something else'),
  reply('did b'),
  userPrompt('continue'),
  reply('did c'),
  userPrompt('and again'),
  reply('did d'),
);

/** The byte offset of the line that opens the turn whose prompt is `text`. */
function offsetOfPrompt(text: string): number {
  const needle = JSON.stringify(userPrompt(text));
  const at = TRANSCRIPT.indexOf(needle);
  expect(at).toBeGreaterThan(-1);
  return Buffer.byteLength(TRANSCRIPT.slice(0, at));
}

describe('turn identity is independent of where the window was cut', () => {
  /**
   * THE ACCEPTANCE CRITERION. Paging backwards moves the window on purpose, so
   * an id that depends on how much of the file the parse happened to see would
   * rename the operator's selected turn under them and would make the overlap
   * between a page and the tail undedupable.
   */
  it('gives a turn the same id in a full read and in a suffix that cut the older half', () => {
    const cut = offsetOfPrompt('something else');
    const whole = summarizeTranscript(TRANSCRIPT, 'sess-1', 0).decisions;
    const suffix = summarizeTranscript(TRANSCRIPT.slice(cut), 'sess-1', cut).decisions;

    // Both lists run newest first and both end at the same byte, so the k-th
    // entry of each is the same turn -- which is what makes comparing their
    // ids meaningful rather than a lookup that could match the wrong one.
    expect(suffix).toHaveLength(3);
    expect(whole).toHaveLength(4);
    for (let k = 0; k < suffix.length; k++) {
      expect(suffix[k]?.input).toBe(whole[k]?.input);
      expect(suffix[k]?.id).toBe(whole[k]?.id);
    }
    // The turn that makes it hard is the SECOND "continue" (index 1 from the
    // newest end): its rank depended on an occurrence the suffix cannot see.
    expect(suffix[1]?.input).toBe('continue');
  });

  /**
   * The offsets ids are minted from are BYTE offsets. A prompt with an emoji in
   * it is longer in bytes than in JavaScript characters, so counting characters
   * would place every line after it wrongly -- by an amount that differs with
   * the window, which is precisely the disagreement this scheme exists to end.
   */
  it('agrees across windows even when a prompt is not ASCII', () => {
    const wide = jsonl(
      userPrompt('ship it 🚀 now'),
      reply('done'),
      userPrompt('the second ask'),
      reply('did a'),
      userPrompt('the third ask'),
      reply('did b'),
    );
    const cutAt = wide.indexOf(JSON.stringify(userPrompt('the second ask')));
    const cut = Buffer.byteLength(wide.slice(0, cutAt));
    const whole = summarizeTranscript(wide, 'sess-1', 0).decisions;
    const suffix = summarizeTranscript(wide.slice(cutAt), 'sess-1', cut).decisions;
    expect(suffix).toHaveLength(2);
    for (let k = 0; k < suffix.length; k++) {
      expect(suffix[k]?.id).toBe(whole[k]?.id);
    }
    // And the offset really is a byte offset into the file, not a char index.
    expect(turnStartOf(whole.at(-1)?.id ?? '')).toBe(0);
    expect(turnStartOf(whole[1]?.id ?? '')).toBe(cut);
  });

  it('still mints an id when the caller cannot say where its window begins', () => {
    // The fallback path, kept for a window with no absolute anchor: two turns
    // with the same words still get different ids.
    const facts = summarizeTranscript(TRANSCRIPT, 'sess-1');
    const repeated = facts.decisions.filter((d) => d.input === 'continue');
    expect(repeated).toHaveLength(2);
    expect(repeated[0]?.id).not.toBe(repeated[1]?.id);
  });

  it('mints an id a cursor can be read back out of, and refuses one that has none', () => {
    const facts = summarizeTranscript(TRANSCRIPT, 'sess-1', 0);
    const oldest = facts.decisions.at(-1);
    expect(turnStartOf(oldest?.id ?? '')).toBe(offsetOfPrompt('continue'));
    // The fingerprint form carries no position, and saying so is the point.
    expect(
      turnStartOf(summarizeTranscript(TRANSCRIPT, 'sess-1').decisions[0]?.id ?? ''),
    ).toBeNull();
    expect(turnStartOf('@nonsense')).toBeNull();
    expect(turnStartOf('@-1')).toBeNull();
  });
});

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

describe('readWindowOf', () => {
  it('drops the partial first line of a window that does not begin at byte 0', () => {
    const bytes = Buffer.from('alpha\nbeta\ngamma\n', 'utf8');
    const window = readWindowOf(bytes, 8, bytes.length);
    expect(window.text).toBe('gamma\n');
    expect(window.start).toBe(11);
  });

  it('keeps a whole line when the window happens to begin exactly on one', () => {
    const bytes = Buffer.from('alpha\nbeta\ngamma\n', 'utf8');
    const window = readWindowOf(bytes, 6, bytes.length);
    expect(window.text).toBe('beta\ngamma\n');
    expect(window.start).toBe(6);
  });

  it('keeps everything when the window begins at byte 0', () => {
    const bytes = Buffer.from('alpha\nbeta\n', 'utf8');
    expect(readWindowOf(bytes, 0, bytes.length)).toEqual({ text: 'alpha\nbeta\n', start: 0 });
  });

  it('reports an empty window, not a fragment, when no line begins inside it', () => {
    const bytes = Buffer.from('one very long line with no newline at all', 'utf8');
    const window = readWindowOf(bytes, 5, 20);
    expect(window.text).toBe('');
    expect(window.start).toBe(20);
  });

  /**
   * The offsets are BYTE offsets, and the fixture is deliberately not ASCII:
   * counting characters would put every line after this one in the wrong place
   * and the ids minted from them would not match across windows.
   */
  it('counts bytes, not characters', () => {
    const bytes = Buffer.from('héllo\nworld\n', 'utf8');
    const window = readWindowOf(bytes, 3, bytes.length);
    expect(window.text).toBe('world\n');
    expect(window.start).toBe(7);
  });
});

describe('readTranscriptHistory', () => {
  const page = async (cursor: string | null, reader = readerOf(TRANSCRIPT)) =>
    await readTranscriptHistory(reader, 'sess-1', cursor);

  it('reads the whole of a transcript smaller than one window and says it reached the start', async () => {
    const answer = await page(null);
    expect(answer.kind).toBe('page');
    if (answer.kind !== 'page') return;
    expect(answer.reachedStart).toBe(true);
    expect(answer.cursor).toBeNull();
    expect(answer.turns.map((t) => t.input)).toEqual([
      'and again',
      'continue',
      'something else',
      'continue',
    ]);
  });

  it('returns only turns older than the cursor', async () => {
    const whole = summarizeTranscript(TRANSCRIPT, 'sess-1', 0);
    const secondContinue = whole.decisions.find((d) => d.input === 'continue');
    const answer = await page(secondContinue?.id ?? null);
    expect(answer.kind).toBe('page');
    if (answer.kind !== 'page') return;
    expect(answer.turns.map((t) => t.input)).toEqual(['something else', 'continue']);
    expect(answer.reachedStart).toBe(true);
  });

  it('reports the start of the file as a positive fact, never as an empty page', async () => {
    const answer = await page(`@${offsetOfPrompt('continue')}`);
    expect(answer.kind).toBe('page');
    if (answer.kind !== 'page') return;
    expect(answer.turns).toEqual([]);
    // Empty AND at the start: the two facts are carried separately, so an
    // empty page on its own can never be read as "the session began here".
    expect(answer.reachedStart).toBe(true);
    expect(answer.cursor).toBeNull();
  });

  it('walks a transcript to its start in pages, returning every turn exactly once', async () => {
    // A window far smaller than the transcript, so the walk really pages.
    const reader = readerOf(TRANSCRIPT);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let step = 0; step < 20; step++) {
      const answer = await readTranscriptHistory(reader, 'sess-1', cursor, 64);
      expect(answer.kind).toBe('page');
      if (answer.kind !== 'page') return;
      seen.push(...answer.turns.map((t) => t.id));
      if (answer.reachedStart) {
        cursor = null;
        break;
      }
      expect(answer.cursor).not.toBeNull();
      cursor = answer.cursor;
    }
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    const whole = summarizeTranscript(TRANSCRIPT, 'sess-1', 0);
    expect(new Set(seen)).toEqual(new Set(whole.decisions.map((d) => d.id)));
  });

  /**
   * MEASURED: in the five largest transcripts on this machine a single line
   * (a tool result) can exceed 128 KiB on its own, so a window can legitimately
   * contain no complete turn at all. Reporting that as "no more history" would
   * make vam claim the session began there.
   */
  it('keeps stepping back when a window holds no complete turn, rather than calling it the start', async () => {
    const filler = { type: 'user', message: { role: 'user', content: 'x'.repeat(4000) } };
    const text = jsonl(userPrompt('the first ask'), reply('answered'), filler, filler, filler);
    const reader = readerOf(text);
    const answer = await readTranscriptHistory(reader, 'sess-1', null, 64);
    expect(answer.kind).toBe('page');
    if (answer.kind !== 'page') return;
    expect(answer.turns.map((t) => t.input)).toEqual(['the first ask']);
    expect(answer.reachedStart).toBe(true);
  });

  /**
   * The budget is a BOUND, not a tripwire. Checked after the fact it is neither:
   * measured against the operator's 157 MB transcript, an after-the-fact check
   * let one request read 15.9 MB against a stated 8 MiB.
   */
  it('never spends more than its budget on one request', async () => {
    const filler = { type: 'user', message: { role: 'user', content: 'x'.repeat(4000) } };
    const text = jsonl(userPrompt('the first ask'), ...Array.from({ length: 40 }, () => filler));
    const reader = readerOf(text);
    await readTranscriptHistory(reader, 'sess-1', null, 64, 200);
    const spent = reader.reads.reduce((total, r) => total + (r.to - r.from), 0);
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(200);
  });

  it('never reports a budget it ran out of as the start of the session', async () => {
    const filler = { type: 'user', message: { role: 'user', content: 'x'.repeat(4000) } };
    const text = jsonl(userPrompt('the first ask'), ...Array.from({ length: 40 }, () => filler));
    const reader = readerOf(text);
    // A budget far smaller than the file: the read gives up before byte 0.
    const answer = await readTranscriptHistory(reader, 'sess-1', null, 64, 200);
    expect(answer.kind).toBe('page');
    if (answer.kind !== 'page') return;
    expect(answer.turns).toEqual([]);
    expect(answer.reachedStart).toBe(false);
    // "Ask again" -- the one thing that distinguishes this from the start.
    expect(answer.cursor).not.toBeNull();
  });

  it('does not re-read from the end on every step', async () => {
    const reader = readerOf(TRANSCRIPT);
    const first = await readTranscriptHistory(reader, 'sess-1', null, 64);
    expect(first.kind).toBe('page');
    if (first.kind !== 'page' || first.cursor === null) return;
    reader.reads.length = 0;
    await readTranscriptHistory(reader, 'sess-1', first.cursor, 64);
    expect(reader.reads.length).toBeGreaterThan(0);
    for (const read of reader.reads) {
      expect(read.to).toBeLessThanOrEqual(turnStartOf(first.cursor) ?? -1);
    }
  });

  /**
   * THE SHAPE REAL TRANSCRIPTS ACTUALLY HAVE, and the one the fixtures above do
   * not: `last-prompt` is re-emitted throughout a turn -- measured, 21,604 of
   * 22,668 lines carrying a prompt repeat the turn already open. A window that
   * opens between a turn's first line and one of its re-emissions therefore
   * opens that turn at the WRONG line, and would give it an id no other read of
   * the file agrees with. This is what the dropped oldest turn is for, and
   * without a re-emitting fixture nothing here can tell.
   */
  it('does not hand back a turn twice when a window opens mid-turn', async () => {
    const reemitting = jsonl(
      userPrompt('the first ask'),
      reply('a1'),
      userPrompt('the first ask'),
      reply('a2'),
      userPrompt('the first ask'),
      reply('a3'),
      userPrompt('the second ask'),
      reply('b1'),
      userPrompt('the second ask'),
      reply('b2'),
      userPrompt('the third ask'),
      reply('c1'),
      userPrompt('the third ask'),
      reply('c2'),
    );
    const whole = summarizeTranscript(reemitting, 'sess-1', 0).decisions;
    expect(whole.map((d) => d.input)).toEqual(['the third ask', 'the second ask', 'the first ask']);

    // Windows small enough to open between a turn's own re-emissions.
    for (const bytes of [90, 130, 200, 320]) {
      const reader = readerOf(reemitting);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let step = 0; step < 60; step++) {
        const answer = await readTranscriptHistory(reader, 'sess-1', cursor, bytes);
        expect(answer.kind, `window ${bytes}`).toBe('page');
        if (answer.kind !== 'page') return;
        seen.push(...answer.turns.map((t) => t.id));
        if (answer.reachedStart) {
          cursor = null;
          break;
        }
        cursor = answer.cursor;
      }
      expect(cursor, `window ${bytes} never reached the start`).toBeNull();
      // No turn twice, no turn under an id the file's own read never mints,
      // and none missing.
      expect(new Set(seen).size, `window ${bytes} repeated a turn`).toBe(seen.length);
      expect(new Set(seen), `window ${bytes} disagreed with the whole read`).toEqual(
        new Set(whole.map((d) => d.id)),
      );
    }
  });

  it('tells a failed read apart from a page with nothing older', async () => {
    const broken = {
      size: async () => {
        throw new Error('no such file');
      },
      read: async () => ({ text: '', start: 0 }),
    };
    const answer = await readTranscriptHistory(broken, 'sess-1', null);
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error.kind).toBe('unreachable');
    expect(answer.error.code).toBe('transcript-unreadable');
  });

  it('refuses a cursor it cannot read a position out of', async () => {
    const answer = await page('not-a-cursor');
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error).toMatchObject({ kind: 'refused', code: 'invalid-cursor' });
  });

  it('refuses a cursor past the end of the file rather than answering an empty page', async () => {
    const answer = await page('@999999');
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error).toMatchObject({ kind: 'unreachable', code: 'cursor-past-end' });
  });
});

describe('readClaudeCodeHistory, over a transcript on disk', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-history-'));
    mkdirSync(join(root, '-w-demo'));
    writeFileSync(join(root, '-w-demo', 'sess-1.jsonl'), TRANSCRIPT);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the file the ROW id names, splitting the pid off it', async () => {
    // The renderer holds `<sessionId>#<pid>` -- two processes can resume one
    // session -- and the transcript is per session.
    const answer = await readClaudeCodeHistory(root, 'sess-1#4321', null);
    expect(answer.kind).toBe('page');
    if (answer.kind !== 'page') return;
    expect(answer.turns.map((t) => t.input)).toEqual([
      'and again',
      'continue',
      'something else',
      'continue',
    ]);
  });

  it('mints the SAME ids the tail read does, which is what makes a page mergeable', async () => {
    const answer = await readClaudeCodeHistory(root, 'sess-1', null);
    expect(answer.kind).toBe('page');
    if (answer.kind !== 'page') return;
    const fromTail = summarizeTranscript(TRANSCRIPT, 'sess-1', 0).decisions;
    expect(answer.turns.map((t) => t.id)).toEqual(fromTail.map((t) => t.id));
  });

  it('says it could not find the session rather than answering an empty page', async () => {
    const answer = await readClaudeCodeHistory(root, 'no-such-session', null);
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error).toMatchObject({ kind: 'refused', code: 'unknown-session' });
  });
});

describe('readTranscriptWindow, against a real file', () => {
  let root: string;
  let path: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-window-'));
    path = join(root, 'transcript.jsonl');
    writeFileSync(path, TRANSCRIPT);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads a window whose first line is whole, and says where it begins', async () => {
    const cut = offsetOfPrompt('something else');
    const window = await readTranscriptWindow(path, cut - 5, Buffer.byteLength(TRANSCRIPT));
    expect(window.start).toBe(cut);
    expect(window.text.startsWith('{"type":"last-prompt","lastPrompt":"something else"}')).toBe(
      true,
    );
  });

  it('reads a whole small file when asked for more than there is', async () => {
    const window = await readTranscriptWindow(path, -1000, Buffer.byteLength(TRANSCRIPT));
    expect(window.start).toBe(0);
    expect(window.text).toBe(TRANSCRIPT);
  });
});

/**
 * THE COST CONTRACT `load()` MUST NOT LOSE. Paging exists so that scrolling
 * back is an on-demand read; the ten-second poll stays bounded by
 * `source.ts`'s `TAIL_BYTES` whatever the file's size. A `load()` that widened
 * to serve history would cost kilobytes-per-poll against 814 MB of transcripts
 * on this machine -- so this asserts what `load()` does NOT read.
 */
describe('the polling read is still a tail, and history is the only thing that steps back', () => {
  const ASKS = ['the first ask', 'the second ask', 'the third ask', 'the fourth ask'];
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-tail-budget-'));
    mkdirSync(join(root, '-w-demo'));
    // Four turns, each followed by ~60 KB of tool output: 240 KB in all, so
    // the 128 KiB tail `load()` reads can only reach the newest two.
    const filler = Array.from({ length: 60 }, () =>
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(1000) } }),
    ).join('\n');
    const block = (ask: string) => `${jsonl(userPrompt(ask), reply(`answered ${ask}`))}${filler}\n`;
    writeFileSync(join(root, '-w-demo', 'sess-1.jsonl'), ASKS.map(block).join(''));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const agent = {
    key: 'sess-1#100',
    sessionId: 'sess-1',
    pid: null,
    name: 'demo',
    cwd: '/w/demo',
    status: 'running' as const,
    kind: 'interactive' as const,
    startedAt: 0,
  };

  it('load() still sees only the tail, never the whole transcript', async () => {
    const projects = await loadClaudeCodeProjects(
      root,
      [agent],
      Date.now(),
      async () => null,
      join(root, 'no-sessions'),
    );
    const inputs = projects[0]?.sessions[0]?.decisions.map((d) => d.input) ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.length).toBeLessThan(ASKS.length);
    expect(inputs).toContain('the fourth ask');
    expect(inputs).not.toContain('the first ask');
  });

  it('and history is what reaches the turn load() cannot', async () => {
    const first = await readClaudeCodeHistory(root, 'sess-1#100', null);
    expect(first.kind).toBe('page');
    if (first.kind !== 'page') return;
    // Not the start of the file: the ancient turn is older than this window.
    expect(first.reachedStart).toBe(false);
    expect(first.cursor).not.toBeNull();

    const seen: string[] = [...first.turns.map((t) => t.input)];
    let cursor = first.cursor;
    for (let step = 0; step < 40 && cursor !== null; step++) {
      const next = await readClaudeCodeHistory(root, 'sess-1#100', cursor);
      expect(next.kind).toBe('page');
      if (next.kind !== 'page') return;
      seen.push(...next.turns.map((t) => t.input));
      cursor = next.reachedStart ? null : next.cursor;
    }
    expect(cursor).toBeNull();
    // Every turn, EXACTLY ONCE: a page and its neighbour must not both claim
    // one, and no page may drop one on the floor between them.
    expect(seen.slice().sort()).toEqual(ASKS.slice().sort());
  });
});
