/**
 * The Stats scan's incremental cache — keyed per file by (path, size, mtime,
 * inode, and a HEAD-BYTES FINGERPRINT), so a full re-scan of
 * `~/.claude/projects` and `~/.codex/sessions` pays for the WHOLE tree only
 * once. Every later scan reads only what changed:
 *
 *  - unchanged (size, mtime and the head fingerprint all match) -- `'skip'`,
 *    nothing read;
 *  - grown, with the SAME head fingerprint -- `'append'`, read only from the
 *    byte offset the last scan stopped at;
 *  - shrank -- always `'full'`: a shorter file can never be a continuation
 *    of a longer one this scan already folded;
 *  - the inode changed, OR the head fingerprint no longer matches -- `'full'`,
 *    the file is a different one now (truncated, rotated, replaced) and
 *    nothing before this scan can be trusted;
 *  - same size but a different mtime -- also `'full'`, conservatively: a
 *    same-length in-place rewrite is indistinguishable from a replacement
 *    without reading more than the head, and treating it as an append would
 *    silently keep stale aggregated tokens for content that is no longer on
 *    disk.
 *
 * THE INODE ALONE IS NOT ENOUGH. Measured on real CI (Linux, ext4/overlayfs):
 * deleting and recreating a file can be handed the SAME inode number by the
 * filesystem — legal, common, and exactly the blind spot a same-inode
 * check misses if that is the ONLY signal "this is still the same file"
 * rests on. The head fingerprint (a hash of the first few KiB, read once per
 * file per scan — cheap, bounded, never the whole file) is the second,
 * content-based signal that catches a replacement wearing the old file's
 * inode: a GROWN or same-size file whose head no longer matches what was
 * last read is a different file, whatever the inode says.
 *
 * THE WINDOW MUST BE STABLE ACROSS GROWTH, OR A SMALL FILE'S OWN LEGITIMATE
 * APPEND LOOKS LIKE A REPLACEMENT. `planRead` takes the CURRENT fingerprint
 * as its own argument rather than reading it off a `FileStat` computed
 * blindly from today's size, because the comparison is only meaningful when
 * both sides cover the SAME leading byte range: `scan.ts` computes it over
 * `min(HEAD_FINGERPRINT_BYTES, prev.size)` -- the file's PREVIOUSLY KNOWN
 * size, capped -- so an append past that boundary (a file growing from 200
 * bytes to 2KB, say) never shifts the window being compared, while a
 * replacement's genuinely different bytes inside that same window still get
 * caught regardless of the file's current size. `headFingerprintOf` is the
 * pure hash `scan.ts` calls on whatever head bytes it reads for that
 * purpose.
 *
 * `offset` is bytes FULLY CONSUMED, not the file's size at last read — the
 * line reader (`scan.ts`) may stop short of EOF when the trailing line is
 * still a partial write, exactly as `claude-code/tail.ts` already does for
 * the live tail; the next scan resumes from there rather than re-reading a
 * line it already folded into the aggregate.
 *
 * Renderer-unsafe on purpose: this module has no filesystem calls of its own
 * (`planRead` and `headFingerprintOf` are both pure), but
 * `loadCacheStore`/`saveCacheStore` take injected read/write functions so
 * main can hand them real `fs/promises` calls while a test hands them an
 * in-memory fake — the same injection discipline `usage/reader.ts` and
 * `usage/codex-reader.ts` already use.
 */

import { createHash } from 'node:crypto';

export type FileStat = {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
};

/** How many leading bytes a fingerprint covers — enough to catch almost any
 *  real replacement (a different session, a different day's rollout) at the
 *  cost of one small, bounded read per file per scan, never the whole file.
 *  Exported so `scan.ts`'s real `statOf` reads exactly this many bytes,
 *  never a number invented at the call site and liable to drift from what
 *  this module actually compares. */
export const HEAD_FINGERPRINT_BYTES = 4096;

/** A cheap, non-cryptographic content fingerprint — SHA-256 only because
 *  Node's `crypto` module makes it free to reach for, not because this
 *  guards against a hostile actor engineering a collision. Pure: the same
 *  bytes always hash the same way, so this needs no fixture beyond a
 *  `Uint8Array` to be fully tested. */
export function headFingerprintOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export type CacheEntry<T> = {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
  readonly headFingerprint: string;
  readonly offset: number;
  /** The per-file aggregate this scan has folded so far — opaque to this
   *  module, whatever shape `scan.ts` needs to resume from. */
  readonly state: T;
};

export type ReadPlan =
  | { readonly kind: 'skip' }
  | { readonly kind: 'append'; readonly fromByte: number }
  | { readonly kind: 'full' };

/**
 * `currentHeadFingerprint` MUST be computed over the SAME window
 * `prev.headFingerprint` was — this module never assumes that on its own
 * (it has no size to derive a window from except `prev.size`, and cannot
 * read a file to check); see this file's own header for why the caller
 * owns that responsibility.
 */
export function planRead<T>(
  prev: CacheEntry<T> | undefined,
  stat: FileStat,
  currentHeadFingerprint: string,
): ReadPlan {
  if (prev === undefined) return { kind: 'full' };
  if (stat.size < prev.size) return { kind: 'full' };
  // Either signal alone can miss a replacement (an inode can be reused; two
  // different files can share a head by coincidence on a tiny or templated
  // file) -- either one FIRING is enough to call it replaced.
  const looksReplaced = prev.ino !== stat.ino || prev.headFingerprint !== currentHeadFingerprint;
  if (stat.size === prev.size) {
    if (looksReplaced) return { kind: 'full' };
    return prev.mtimeMs === stat.mtimeMs ? { kind: 'skip' } : { kind: 'full' };
  }
  if (looksReplaced) return { kind: 'full' };
  return { kind: 'append', fromByte: prev.offset };
}

/**
 * Bumped 1 -> 2 the day `claude-usage-line.ts` grew a `message.id` dedup
 * key: every cache a version-1 build wrote is INFLATED (a streamed
 * message's repeated lines were each folded again -- see that module's own
 * header for the measured 77% repeat rate), and there is no cheap way to
 * repair one of those files in place. Bumping this constant is the whole
 * fix for that: `isCacheStore` below refuses anything but an EXACT version
 * match, so every old cache silently becomes `emptyCacheStore()` on next
 * load, and the next scan reads every file whole rather than trusting a
 * single inflated byte of it.
 *
 * Bumped 2 -> 3 the day `planRead` grew the head fingerprint: a version-2
 * entry has no `headFingerprint` field at all, and trusting `undefined` as
 * "still matches" would silently readmit the exact inode-reuse blind spot
 * this bump exists to close. Every version-2 cache is discarded the same
 * way every version-1 one was.
 */
export const CACHE_VERSION = 3;

export type CacheStore<T> = {
  readonly version: number;
  readonly files: Readonly<Record<string, CacheEntry<T>>>;
  /** The PR count's own cache entry — see `pr-count-cache.ts`'s own header
   *  for why it lives here rather than a second file. Optional (rather than
   *  a schema bump of its own) so a cache written before this field existed
   *  still loads: `undefined` reads exactly like "no PR count cached yet",
   *  which is also true. Opaque to this module the same way `files`'
   *  per-file `state: T` is — `unknown` here rather than importing
   *  `PrsCacheEntry`, which would make this domain-agnostic module depend
   *  on `shared/stats.ts`. */
  readonly prs?: unknown;
};

export function emptyCacheStore<T>(): CacheStore<T> {
  return { version: CACHE_VERSION, files: {} };
}

function isCacheStore(value: unknown): value is CacheStore<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)['version'] === CACHE_VERSION &&
    typeof (value as Record<string, unknown>)['files'] === 'object' &&
    (value as Record<string, unknown>)['files'] !== null
  );
}

/**
 * Never throws: a missing file, an unreadable one, corrupt JSON or a
 * version this build does not recognise all fall back to an empty store —
 * losing the cache is a slower next scan, never a crash.
 */
export async function loadCacheStore<T>(
  readFile: (path: string) => Promise<string>,
  path: string,
): Promise<CacheStore<T>> {
  try {
    const text = await readFile(path);
    const parsed: unknown = JSON.parse(text);
    return isCacheStore(parsed) ? (parsed as CacheStore<T>) : emptyCacheStore<T>();
  } catch {
    return emptyCacheStore<T>();
  }
}

export async function saveCacheStore<T>(
  writeFile: (path: string, text: string) => Promise<void>,
  path: string,
  store: CacheStore<T>,
): Promise<void> {
  await writeFile(path, JSON.stringify(store));
}
