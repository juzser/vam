/**
 * WHICH FILE A SESSION'S TURNS LIVE IN -- the one place that answers it.
 *
 * `~/.claude/projects/<slug>/<sessionId>.jsonl`, where `<slug>` is a LOSSY
 * flattening of the working directory: both `/` and `.` become `-`, so two
 * different directories can flatten onto the same slug and a slug cannot be
 * turned back into a path. It is therefore never parsed -- only walked, to
 * find which directory a session id's file is in. `source.ts` states that rule
 * for the source as a whole; this module is where it is kept.
 *
 * EXTRACTED BECAUSE THERE ARE FOUR READERS NOW, not two. Scrolling back
 * (`readClaudeCodeHistory`), opening one of a session's agents
 * (`readClaudeCodeAgentWork`), the live load itself and -- since the model
 * button gained a second source -- `transcript-model.ts`. The `#` rule below
 * is subtle enough that a second copy of it would be a second thing to get
 * wrong, which is what `source.ts` said when it had two callers.
 *
 * MAIN-PROCESS ONLY: it reads the filesystem, so the browser build cannot use
 * it and does not import it.
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where Claude Code keeps transcripts. Derived, never a literal home path. */
export const defaultTranscriptRoot = (): string => join(homedir(), '.claude', 'projects');

/**
 * A ceiling on how many resolved session paths one root's cache keeps. The
 * renderer polls every four seconds per open pane; without a bound the cache
 * would grow with every distinct session a long-lived process ever looked
 * up. Past the ceiling the oldest entries are evicted -- a lookup for an
 * evicted session simply costs one index refresh, same as a true miss.
 */
export const transcriptCacheCeiling = 200;

interface RootCache {
  /** sessionId -> resolved path, oldest-first (`Map` insertion order is an LRU order here). */
  readonly paths: Map<string, string>;
  /** The one in-flight `indexTranscripts` scan for this root, if any, shared by concurrent lookups. */
  inflight: Promise<Map<string, string>> | null;
}

const rootCaches = new Map<string, RootCache>();

function getRootCache(root: string): RootCache {
  let cache = rootCaches.get(root);
  if (!cache) {
    cache = { paths: new Map(), inflight: null };
    rootCaches.set(root, cache);
  }
  return cache;
}

/** Records/refreshes one session's path, evicting the oldest entries past the ceiling. */
function rememberPath(cache: RootCache, sessionId: string, path: string): void {
  cache.paths.delete(sessionId);
  cache.paths.set(sessionId, path);
  while (cache.paths.size > transcriptCacheCeiling) {
    const oldest = cache.paths.keys().next().value;
    if (oldest === undefined) break;
    cache.paths.delete(oldest);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Runs (or joins) one `indexTranscripts` scan for `root` and refreshes the cache from it. */
async function refreshIndex(root: string, cache: RootCache): Promise<Map<string, string>> {
  if (!cache.inflight) {
    cache.inflight = indexTranscripts(root).finally(() => {
      cache.inflight = null;
    });
  }
  const fresh = await cache.inflight;
  for (const [sessionId, path] of fresh) {
    rememberPath(cache, sessionId, path);
  }
  return fresh;
}

/** Test-only: clears every root's cache so a test starts cold. */
export function __resetTranscriptCacheForTests(): void {
  rootCaches.clear();
}

/** Test-only: the number of session paths currently cached for `root`. */
export function __transcriptCacheSizeForTests(root: string): number {
  return rootCaches.get(root)?.paths.size ?? 0;
}

/**
 * Where each session id's transcript lives, by walking the slug directories
 * once. Names only -- no file is opened and nothing is stat'd here, so an
 * index over 54 transcripts costs ten `readdir` calls.
 */
export async function indexTranscripts(root: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let dirs: string[];
  try {
    dirs = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    // No transcript root: Claude Code has never run for this user, or this is
    // a machine without it. Live sessions can still be listed, with no turns.
    return index;
  }
  for (const dir of dirs) {
    try {
      for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          index.set(entry.name.slice(0, -'.jsonl'.length), join(root, dir, entry.name));
        }
      }
    } catch {
      // A directory that vanished between the two reads.
    }
  }
  return index;
}

/**
 * Which FILE a row's turns live in, and which session that row is.
 *
 * A ROW IS A PROCESS AND A SESSION IS A FILE, so a row key is
 * `<sessionId>#<pid>` (`deliver.ts`) and two rows can share one transcript.
 * The index is consulted BEFORE the `#` is trusted, because a session id
 * containing one would otherwise be cut in half by a rule meant for the
 * suffix.
 *
 * CACHED, NOT TRUSTED: a per-root cache of resolved paths (bounded by
 * `transcriptCacheCeiling`) means a repeat lookup whose file still exists
 * costs one `stat`, not a rescan. A cache hit is validated by that `stat`
 * before being returned; a stale or absent entry falls through to one
 * `indexTranscripts` refresh, shared by any concurrent lookups against the
 * same root. There is no negative cache: a row with no transcript yet
 * refreshes on every call, since nothing was ever recorded for it to miss.
 */
export async function locateTranscript(
  root: string,
  rowId: string,
): Promise<{ readonly sessionId: string; readonly path: string | undefined }> {
  const cache = getRootCache(root);
  const hash = rowId.lastIndexOf('#');

  const cachedCandidate = cache.paths.has(rowId)
    ? rowId
    : hash === -1
      ? rowId
      : rowId.slice(0, hash);
  const cachedPath = cache.paths.get(cachedCandidate);
  if (cachedPath !== undefined && (await pathExists(cachedPath))) {
    rememberPath(cache, cachedCandidate, cachedPath);
    return { sessionId: cachedCandidate, path: cachedPath };
  }

  const fresh = await refreshIndex(root, cache);
  const sessionId = fresh.has(rowId) || hash === -1 ? rowId : rowId.slice(0, hash);
  const path = fresh.get(sessionId);
  if (path === undefined) cache.paths.delete(sessionId);
  return { sessionId, path };
}
