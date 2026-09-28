/**
 * THE RENDERER POLLS THE MODEL BUTTON EVERY FOUR SECONDS, per open pane, and
 * every poll used to call `locateTranscript`, which called `indexTranscripts`
 * -- a full `readdir` of the transcript root plus one per project directory
 * -- unconditionally. On a machine with 50 historical project directories
 * that is 51 `readdir` calls PER LOOKUP, repeated for a session whose file
 * never moves. This file proves the fix: a lookup whose cached path still
 * exists costs one `stat`, not a rescan; a miss or a vanished file costs one
 * shared index refresh; the cache never grows past its stated ceiling.
 *
 * `readdir` IS COUNTED THROUGH A REAL PASSTHROUGH MOCK, not a fake -- the
 * root is a real `mkdtemp` directory with real project subdirectories and
 * real `.jsonl` files, so the counts below are the actual number of
 * directory-listing syscalls the module issues, not a story about them.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readdirMock } = vi.hoisted(() => ({ readdirMock: vi.fn() }));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  readdirMock.mockImplementation(actual.readdir);
  return { ...actual, readdir: readdirMock };
});

import {
  __resetTranscriptCacheForTests,
  __transcriptCacheSizeForTests,
  indexTranscripts,
  locateTranscript,
  transcriptCacheCeiling,
} from '../../src/main/sources/claude-code/transcript-index.js';

let root: string;

/** `count` project directories, each holding `filesPerProject` `.jsonl` files. */
function seedProjects(base: string, count: number, filesPerProject: number): string[] {
  const sessionIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const dir = join(base, `-Users-x-project-${i}`);
    mkdirSync(dir);
    for (let j = 0; j < filesPerProject; j += 1) {
      const sessionId = `session-${i}-${j}`;
      writeFileSync(join(dir, `${sessionId}.jsonl`), '{}\n');
      sessionIds.push(sessionId);
    }
  }
  return sessionIds;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vam-transcript-index-'));
  readdirMock.mockClear();
  __resetTranscriptCacheForTests();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('locateTranscript caching (finding 67751ec1)', () => {
  it('does not rescan on repeat lookups for the same row', async () => {
    const sessionIds = seedProjects(root, 50, 2);
    const target = sessionIds.at(0);
    if (target === undefined) throw new Error('no seeded sessions');

    for (let i = 0; i < 4; i += 1) {
      const { path } = await locateTranscript(root, target);
      expect(path).toBeDefined();
    }

    // Under the null (HEAD, no cache): 4 * (1 + 50) = 204.
    // Under the fix: one index build (1 + 50 = 51), then three cache hits.
    expect(readdirMock).toHaveBeenCalledTimes(51);
  });

  it('never scans under the fix (regression guard against the null count)', async () => {
    seedProjects(root, 50, 2);
    expect(readdirMock).toHaveBeenCalledTimes(0);
  });

  it('refreshes and returns the new location when the cached file moved', async () => {
    mkdirSync(join(root, 'proj-a'));
    const original = join(root, 'proj-a', 'sess-1.jsonl');
    writeFileSync(original, '{}\n');

    const first = await locateTranscript(root, 'sess-1');
    expect(first.path).toBe(original);

    // Move the file to a new project directory -- same session id.
    rmSync(original);
    mkdirSync(join(root, 'proj-b'));
    const moved = join(root, 'proj-b', 'sess-1.jsonl');
    writeFileSync(moved, '{}\n');

    const second = await locateTranscript(root, 'sess-1');
    expect(second.path).toBe(moved);
    expect(second.path).not.toBe(original);
  });

  it('returns path: undefined, never the stale path, when the cached file vanishes', async () => {
    mkdirSync(join(root, 'proj-a'));
    const original = join(root, 'proj-a', 'sess-1.jsonl');
    writeFileSync(original, '{}\n');

    const first = await locateTranscript(root, 'sess-1');
    expect(first.path).toBe(original);

    rmSync(original);

    const second = await locateTranscript(root, 'sess-1');
    expect(second.path).toBeUndefined();
  });

  it('finds a session created after the first index, via one refresh', async () => {
    mkdirSync(join(root, 'proj-a'));
    writeFileSync(join(root, 'proj-a', 'sess-old.jsonl'), '{}\n');

    await locateTranscript(root, 'sess-old');
    readdirMock.mockClear();

    writeFileSync(join(root, 'proj-a', 'sess-new.jsonl'), '{}\n');
    const { path } = await locateTranscript(root, 'sess-new');

    expect(path).toBe(join(root, 'proj-a', 'sess-new.jsonl'));
    // One refresh: 1 root readdir + 1 project-dir readdir.
    expect(readdirMock).toHaveBeenCalledTimes(2);
  });

  it('coalesces four concurrent cold-cache lookups into one index scan', async () => {
    const sessionIds = seedProjects(root, 50, 2);
    const target = sessionIds.at(10);
    if (target === undefined) throw new Error('no seeded sessions');

    const results = await Promise.all([
      locateTranscript(root, target),
      locateTranscript(root, target),
      locateTranscript(root, target),
      locateTranscript(root, target),
    ]);

    for (const r of results) {
      expect(r.path).toBeDefined();
    }
    expect(readdirMock).toHaveBeenCalledTimes(51);
  });

  it('resolves <sessionId>#<pid> to the session, unchanged', async () => {
    mkdirSync(join(root, 'proj-a'));
    writeFileSync(join(root, 'proj-a', 'abc.jsonl'), '{}\n');

    const { sessionId, path } = await locateTranscript(root, 'abc#123');
    expect(sessionId).toBe('abc');
    expect(path).toBe(join(root, 'proj-a', 'abc.jsonl'));
  });

  it('resolves a session id that itself contains "#" whole, when the index has it', async () => {
    mkdirSync(join(root, 'proj-a'));
    writeFileSync(join(root, 'proj-a', 'abc#123.jsonl'), '{}\n');

    const { sessionId, path } = await locateTranscript(root, 'abc#123');
    expect(sessionId).toBe('abc#123');
    expect(path).toBe(join(root, 'proj-a', 'abc#123.jsonl'));
  });

  it('keeps indexTranscripts uncached: it always returns a fresh full index', async () => {
    mkdirSync(join(root, 'proj-a'));
    writeFileSync(join(root, 'proj-a', 'sess-1.jsonl'), '{}\n');

    await locateTranscript(root, 'sess-1');
    readdirMock.mockClear();

    const fresh = await indexTranscripts(root);
    expect(fresh.get('sess-1')).toBe(join(root, 'proj-a', 'sess-1.jsonl'));
    expect(readdirMock).toHaveBeenCalledTimes(2);
  });
});

describe('cache bound', () => {
  it('never keeps more than transcriptCacheCeiling entries', async () => {
    const total = transcriptCacheCeiling + 25;
    seedProjects(root, total, 1);

    await locateTranscript(root, 'session-0-0');

    expect(__transcriptCacheSizeForTests(root)).toBeLessThanOrEqual(transcriptCacheCeiling);
  });
});
