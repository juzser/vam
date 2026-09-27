/**
 * `readLinesFrom` — the scan's own streaming line reader: a real file on
 * disk, read from a byte offset to EOF, one complete line at a time, with a
 * trailing partial line (the ordinary shape of a file still being appended
 * to) left UNCONSUMED rather than guessed at.
 *
 * Real temp files throughout — this is exactly the boundary the incremental
 * cache's offset accounting depends on, and a fake stream would not exercise
 * the chunk-boundary handling a real 1 MiB+ file does.
 */
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLinesFrom } from '../../../src/main/stats/line-stream.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vam-stats-line-stream-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): Promise<string> {
  const path = join(dir, name);
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(path);
    stream.on('error', reject);
    stream.on('finish', () => resolve(path));
    stream.end(content);
  });
}

describe('readLinesFrom', () => {
  it('reads every complete line from the given byte offset', async () => {
    const path = await writeFile('a.jsonl', 'one\ntwo\nthree\n');
    const lines: string[] = [];
    const result = await readLinesFrom(path, 0, (line) => lines.push(line));
    expect(lines).toEqual(['one', 'two', 'three']);
    expect(result.bytesConsumed).toBe(Buffer.byteLength('one\ntwo\nthree\n', 'utf8'));
  });

  it('starts at the given offset, skipping bytes already read', async () => {
    const content = 'one\ntwo\nthree\n';
    const path = await writeFile('a.jsonl', content);
    const offset = Buffer.byteLength('one\n', 'utf8');
    const lines: string[] = [];
    await readLinesFrom(path, offset, (line) => lines.push(line));
    expect(lines).toEqual(['two', 'three']);
  });

  it('leaves a trailing line with no newline UNCONSUMED — the ordinary shape of a file being appended to', async () => {
    const path = await writeFile('a.jsonl', 'one\ntwo\npartial-tail-no-newline');
    const lines: string[] = [];
    const result = await readLinesFrom(path, 0, (line) => lines.push(line));
    expect(lines).toEqual(['one', 'two']);
    expect(result.bytesConsumed).toBe(Buffer.byteLength('one\ntwo\n', 'utf8'));
  });

  it('handles a multi-byte UTF-8 character sitting across a chunk boundary', async () => {
    // Force a tiny highWaterMark so a real chunk boundary lands mid-line,
    // and put a multi-byte character (emoji, 4 bytes in UTF-8) right there.
    const filler = 'x'.repeat(64);
    const content = `${filler}\n🎉 emoji line\nlast\n`;
    const path = await writeFile('a.jsonl', content);
    const lines: string[] = [];
    const result = await readLinesFrom(path, 0, (line) => lines.push(line), { highWaterMark: 68 });
    expect(lines).toEqual([filler, '🎉 emoji line', 'last']);
    expect(result.bytesConsumed).toBe(Buffer.byteLength(content, 'utf8'));
  });

  it('streams a file spanning several megabytes without buffering the whole file at once', async () => {
    const line = 'y'.repeat(1000);
    const lineCount = 3000; // ~3 MB
    const content = `${Array.from({ length: lineCount }, () => line).join('\n')}\n`;
    const path = await writeFile('big.jsonl', content);
    let count = 0;
    const result = await readLinesFrom(path, 0, () => {
      count += 1;
    });
    expect(count).toBe(lineCount);
    expect(result.bytesConsumed).toBe(Buffer.byteLength(content, 'utf8'));
  });

  it('rejects for a missing file — a low-level primitive; the scan orchestrator decides what a missing file means', async () => {
    const lines: string[] = [];
    await expect(
      readLinesFrom(join(dir, 'missing.jsonl'), 0, (line) => lines.push(line)),
    ).rejects.toThrow();
  });
});
