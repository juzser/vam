/**
 * The Stats scan's incremental cache — keyed per file by (path, size, mtime,
 * inode), so a full re-scan of `~/.claude/projects` and `~/.codex/sessions`
 * pays for the WHOLE tree only once. Every later scan reads only what
 * changed:
 *
 *  - unchanged (size and mtime both match) -- `'skip'`, nothing read;
 *  - grown (size increased, same inode) -- `'append'`, read only from the
 *    byte offset the last scan stopped at;
 *  - shrank, or the inode changed -- `'full'`, the file is a different one
 *    now (truncated, rotated, replaced) and nothing before this scan can be
 *    trusted;
 *  - same size but a different mtime -- also `'full'`, conservatively: a
 *    same-length in-place rewrite is indistinguishable from a replacement
 *    without hashing the whole file, and treating it as an append would
 *    silently keep stale aggregated tokens for content that is no longer on
 *    disk.
 *
 * `offset` is bytes FULLY CONSUMED, not the file's size at last read — the
 * line reader (`scan.ts`) may stop short of EOF when the trailing line is
 * still a partial write, exactly as `claude-code/tail.ts` already does for
 * the live tail; the next scan resumes from there rather than re-reading a
 * line it already folded into the aggregate.
 *
 * Renderer-unsafe on purpose: this module has no filesystem calls of its own
 * (`planRead` is pure), but `loadCacheStore`/`saveCacheStore` take injected
 * read/write functions so main can hand them real `fs/promises` calls while
 * a test hands them an in-memory fake — the same injection discipline
 * `usage/reader.ts` and `usage/codex-reader.ts` already use.
 */

export type FileStat = {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
};

export type CacheEntry<T> = {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
  readonly offset: number;
  /** The per-file aggregate this scan has folded so far — opaque to this
   *  module, whatever shape `scan.ts` needs to resume from. */
  readonly state: T;
};

export type ReadPlan =
  | { readonly kind: 'skip' }
  | { readonly kind: 'append'; readonly fromByte: number }
  | { readonly kind: 'full' };

export function planRead<T>(prev: CacheEntry<T> | undefined, stat: FileStat): ReadPlan {
  if (prev === undefined) return { kind: 'full' };
  if (prev.ino !== stat.ino) return { kind: 'full' };
  if (stat.size < prev.size) return { kind: 'full' };
  if (stat.size === prev.size) {
    return prev.mtimeMs === stat.mtimeMs ? { kind: 'skip' } : { kind: 'full' };
  }
  return { kind: 'append', fromByte: prev.offset };
}

export const CACHE_VERSION = 1;

export type CacheStore<T> = {
  readonly version: number;
  readonly files: Readonly<Record<string, CacheEntry<T>>>;
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
