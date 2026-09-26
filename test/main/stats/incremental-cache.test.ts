/**
 * The incremental cache's own DECISION: given what was recorded last time and
 * what `fs.stat` says right now, does a re-scan skip this file, read only the
 * bytes appended since, or read it whole? Pure — no filesystem here; the real
 * appended-bytes read is exercised end to end in `scan.test.ts` against a
 * real temp file.
 */
import { describe, expect, it } from 'vitest';
import {
  CACHE_VERSION,
  emptyCacheStore,
  loadCacheStore,
  planRead,
  saveCacheStore,
} from '../../../src/main/stats/incremental-cache.js';

const entry = (
  over: Partial<{ size: number; mtimeMs: number; ino: number; offset: number }> = {},
) => ({
  size: 1000,
  mtimeMs: 111,
  ino: 7,
  offset: 1000,
  state: null,
  ...over,
});

describe('planRead', () => {
  it('reads the whole file when there is no prior entry at all', () => {
    expect(planRead(undefined, { size: 500, mtimeMs: 1, ino: 1 })).toEqual({ kind: 'full' });
  });

  it('skips a file whose size and mtime are unchanged', () => {
    const prev = entry();
    expect(planRead(prev, { size: 1000, mtimeMs: 111, ino: 7 })).toEqual({ kind: 'skip' });
  });

  it('reads only the appended bytes of a GROWN file, from the previous offset', () => {
    const prev = entry({ offset: 900 });
    expect(planRead(prev, { size: 1400, mtimeMs: 222, ino: 7 })).toEqual({
      kind: 'append',
      fromByte: 900,
    });
  });

  it('reads the whole file again when it SHRANK', () => {
    const prev = entry();
    expect(planRead(prev, { size: 300, mtimeMs: 222, ino: 7 })).toEqual({ kind: 'full' });
  });

  it('reads the whole file again when the inode changed — REPLACED, not appended', () => {
    const prev = entry();
    expect(planRead(prev, { size: 2000, mtimeMs: 222, ino: 99 })).toEqual({ kind: 'full' });
  });

  it('reads the whole file again when the size is unchanged but the content moved (mtime changed) — same-size overwrite is not an append', () => {
    const prev = entry();
    expect(planRead(prev, { size: 1000, mtimeMs: 333, ino: 7 })).toEqual({ kind: 'full' });
  });
});

describe('loadCacheStore / saveCacheStore', () => {
  it('round-trips a store through the injected read/write functions', async () => {
    let written = '';
    const store = {
      version: CACHE_VERSION,
      files: { '/a.jsonl': entry() },
    };
    await saveCacheStore(
      async (_path, text) => {
        written = text;
      },
      '/cache.json',
      store,
    );
    const loaded = await loadCacheStore(async () => written, '/cache.json');
    expect(loaded).toEqual(store);
  });

  it('falls back to an empty store when the file cannot be read at all', async () => {
    const loaded = await loadCacheStore(async () => {
      throw new Error('ENOENT');
    }, '/missing.json');
    expect(loaded).toEqual(emptyCacheStore());
  });

  it('falls back to an empty store for corrupt JSON, rather than throwing', async () => {
    const loaded = await loadCacheStore(async () => '{not json', '/cache.json');
    expect(loaded).toEqual(emptyCacheStore());
  });

  it('falls back to an empty store for a version this build does not recognise', async () => {
    const loaded = await loadCacheStore(
      async () => JSON.stringify({ version: CACHE_VERSION + 1, files: {} }),
      '/cache.json',
    );
    expect(loaded).toEqual(emptyCacheStore());
  });

  // CACHE_VERSION WAS BUMPED 1 -> 2 the day `claude-usage-line.ts` grew a
  // dedup key: every cache written by the OLD scanner is quietly INFLATED
  // (a streamed message's repeated lines were each folded again), and there
  // is no way to repair one in place without re-reading every file it
  // names. Pinned to the literal shipped number, not `CACHE_VERSION - 1`,
  // so this test still means "the specific cache real machines have on
  // disk today" after the next bump moves `CACHE_VERSION` again.
  it('discards a real version-1 cache from before the dedup fix, forcing a full rebuild', async () => {
    expect(CACHE_VERSION).toBeGreaterThan(1);
    const loaded = await loadCacheStore(
      async () =>
        JSON.stringify({
          version: 1,
          files: { '/a.jsonl': entry() },
        }),
      '/cache.json',
    );
    expect(loaded).toEqual(emptyCacheStore());
  });
});
