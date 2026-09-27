/**
 * The incremental cache's own DECISION: given what was recorded last time and
 * what `fs.stat` (plus a head-bytes fingerprint) says right now, does a
 * re-scan skip this file, read only the bytes appended since, or read it
 * whole? Pure — no filesystem here; the real appended-bytes read is
 * exercised end to end in `scan.test.ts` against a real temp file.
 */
import { describe, expect, it } from 'vitest';
import {
  CACHE_VERSION,
  emptyCacheStore,
  headFingerprintOf,
  loadCacheStore,
  planRead,
  saveCacheStore,
} from '../../../src/main/stats/incremental-cache.js';

const FP_A = 'fp-a';
const FP_B = 'fp-b';

const entry = (
  over: Partial<{
    size: number;
    mtimeMs: number;
    ino: number;
    headFingerprint: string;
    offset: number;
  }> = {},
) => ({
  size: 1000,
  mtimeMs: 111,
  ino: 7,
  headFingerprint: FP_A,
  offset: 1000,
  state: null,
  ...over,
});

describe('planRead', () => {
  it('reads the whole file when there is no prior entry at all', () => {
    expect(planRead(undefined, { size: 500, mtimeMs: 1, ino: 1 }, FP_A)).toEqual({ kind: 'full' });
  });

  it('skips a file whose size, mtime and head fingerprint are all unchanged', () => {
    const prev = entry();
    expect(planRead(prev, { size: 1000, mtimeMs: 111, ino: 7 }, FP_A)).toEqual({ kind: 'skip' });
  });

  it('reads only the appended bytes of a GROWN file, from the previous offset, when the head still matches', () => {
    const prev = entry({ offset: 900 });
    expect(planRead(prev, { size: 1400, mtimeMs: 222, ino: 7 }, FP_A)).toEqual({
      kind: 'append',
      fromByte: 900,
    });
  });

  it('reads the whole file again when it SHRANK', () => {
    const prev = entry();
    expect(planRead(prev, { size: 300, mtimeMs: 222, ino: 7 }, FP_A)).toEqual({ kind: 'full' });
  });

  it('reads the whole file again when the inode changed — REPLACED, not appended', () => {
    const prev = entry();
    expect(planRead(prev, { size: 2000, mtimeMs: 222, ino: 99 }, FP_A)).toEqual({ kind: 'full' });
  });

  it('reads the whole file again when the size is unchanged but the content moved (mtime changed) — same-size overwrite is not an append', () => {
    const prev = entry();
    expect(planRead(prev, { size: 1000, mtimeMs: 333, ino: 7 }, FP_A)).toEqual({ kind: 'full' });
  });

  // THE INODE CAN BE REUSED. Measured on real CI (Linux, ext4/overlayfs): a
  // deleted-and-recreated file was handed the SAME inode number by the
  // filesystem — legal, common, and exactly the blind spot an
  // inode-only replace check misses. A GROWN file whose head bytes no
  // longer match what was last read is a DIFFERENT file wearing the old
  // one's inode, not a continuation of it, regardless of what the inode
  // says. `currentHeadFingerprint` is passed as the caller-computed value
  // this test controls directly -- see `planRead`'s own header for why the
  // window it was hashed over is the caller's responsibility, not
  // something this test needs a real file to produce.
  it('reads the whole file again when it GREW but the head fingerprint no longer matches, even with the SAME inode', () => {
    const prev = entry({ offset: 900 });
    expect(planRead(prev, { size: 1400, mtimeMs: 222, ino: 7 }, FP_B)).toEqual({ kind: 'full' });
  });

  // The same blind spot at the SAME size: a same-length replacement can
  // share both the inode and (by coincidence, or by construction in a test)
  // the mtime bucket's granularity -- the head fingerprint is the one check
  // here that is not fooled by any of that, because it is the only one that
  // reads real content.
  it('reads the whole file again at the SAME size when the head fingerprint no longer matches, even with the SAME inode and mtime', () => {
    const prev = entry();
    expect(planRead(prev, { size: 1000, mtimeMs: 111, ino: 7 }, FP_B)).toEqual({ kind: 'full' });
  });
});

describe('headFingerprintOf', () => {
  it('is a pure function of the bytes it is given', () => {
    const a = headFingerprintOf(new TextEncoder().encode('hello'));
    const b = headFingerprintOf(new TextEncoder().encode('hello'));
    expect(a).toBe(b);
  });

  it('differs for different bytes', () => {
    const a = headFingerprintOf(new TextEncoder().encode('hello'));
    const b = headFingerprintOf(new TextEncoder().encode('world'));
    expect(a).not.toBe(b);
  });

  it('differs for two inputs sharing a prefix but not a length — the whole slice it is handed is hashed, never just a shared prefix', () => {
    const a = headFingerprintOf(new TextEncoder().encode('hello'));
    const b = headFingerprintOf(new TextEncoder().encode('hello world'));
    expect(a).not.toBe(b); // still differs -- the whole slice is hashed, not just a shared prefix
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

  // CACHE_VERSION WAS BUMPED 2 -> 3 the day `planRead` grew the head
  // fingerprint: a version-2 entry has no `headFingerprint` field at all,
  // and trusting `undefined` as "matches" would silently readmit the exact
  // inode-reuse blind spot this bump exists to close.
  it('discards a real version-2 cache from before the head-fingerprint fix, forcing a full rebuild', async () => {
    expect(CACHE_VERSION).toBeGreaterThan(2);
    const loaded = await loadCacheStore(
      async () =>
        JSON.stringify({
          version: 2,
          files: { '/a.jsonl': { size: 1000, mtimeMs: 111, ino: 7, offset: 1000, state: null } },
        }),
      '/cache.json',
    );
    expect(loaded).toEqual(emptyCacheStore());
  });
});
