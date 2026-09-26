/**
 * THE STATS SCAN'S WORKER-THREAD ENTRY POINT — a real `node:worker_threads`
 * worker, bundled as its own main-process entry
 * (`electron.vite.config.ts`'s `statsWorker` input, emitted as
 * `out/main/statsWorker.cjs`) so `check-bundle-externals.mjs` can prove it
 * ships with no `node_modules` dependency the packaged asar lacks — see that
 * script's own header for the defect class this guards.
 *
 * DELIBERATELY THIN. Every side effect here is a plain `node:fs` call — no
 * `electron` import anywhere in this file or anything it reaches — because a
 * worker thread spawned off Electron's main process does not carry the main
 * process's module bindings, and because it keeps this file untestable-by-
 * design (it is glue) while everything it calls (`runFullScan`,
 * `loadCacheStore`/`saveCacheStore`, `readGhPrsCreated`, `isPrsCacheFresh`)
 * is already unit tested with injected dependencies elsewhere in this
 * directory. What THIS file does that nothing else can — really spawn as a
 * worker thread and really load the real filesystem — is proven by the
 * app-level harness (`test/electron/stats-worker.test.ts`), not here.
 *
 * TWO MESSAGES, NOT ONE. The file fold and the PR-count fetch run
 * CONCURRENTLY, never one after the other — a warm scan's fold can finish
 * in ~100ms while `gh` is still on the wire, and the operator's own
 * instruction is that token stats must not wait on it. So:
 *
 *  1. `{kind: 'stats', snapshot}` is sent the moment the fold is done. If
 *     the PR fetch (started BEFORE the fold, see below) has ALREADY
 *     settled by then, `snapshot.prsCreated` carries the real answer and
 *     this is the ONLY message this scan will ever send. Otherwise it
 *     carries `{kind: 'loading'}` (scan.ts's own placeholder — that module
 *     never calls `gh` itself) and a SECOND message follows once the fetch
 *     settles.
 *  2. `{kind: 'prs', prsCreated}` — sent only after a `'stats'` message
 *     that said `'loading'`, once the PR fetch resolves.
 *  3. `{kind: 'error', message}` in place of `'stats'` for anything the
 *     catch below could not recover from. Never a throw across the thread
 *     boundary — an uncaught exception in a worker becomes an `'error'`
 *     EVENT `scan-runner.ts` already handles, but the message would be
 *     Node's own generic stack trace rather than a sentence naming what
 *     actually went wrong.
 *
 * STARTING THE PR FETCH BEFORE THE FOLD KNOWS ITS OWN ANSWER. The fetch
 * needs a since-date, and the fold is the thing that computes one
 * (`trackingSinceIso`, the earliest timestamp across every file). Waiting
 * for the fold would make "concurrent" a lie. Instead this reads the
 * PREVIOUS scan's own cached since-date (`pr-count-cache.ts`'s
 * `PrsCacheEntry.sinceDate`, persisted in the SAME cache file) and starts
 * the fetch with THAT — in practice always identical to what this fold is
 * about to derive, because the earliest transcript timestamp on a machine
 * essentially never gets EARLIER between two scans minutes apart. On the
 * rare scan where it does (a still-older file appears), the query used a
 * date one fold newer than ideal — a filter very slightly narrower than
 * "since tracking truly began", never a wrong COUNT for the window it did
 * ask about, and the cache entry this scan writes carries the FOLD's own
 * (now corrected) date forward for every scan after it. The one case with
 * no previous entry to guess from at all — a machine's first-ever scan —
 * pays the honest cost of waiting for the fold before it can ask `gh`
 * anything; that scan is already the slowest one for reasons that have
 * nothing to do with PRs (nothing is cached yet).
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import type { PrsCreated } from '../../shared/stats.js';
import { readGhPrsCreated, toDateOnly } from './gh-prs.js';
import { type CacheStore, loadCacheStore, saveCacheStore } from './incremental-cache.js';
import { readLinesFrom } from './line-stream.js';
import { isPrsCacheFresh, type PrsCacheEntry, readPrsCacheEntry } from './pr-count-cache.js';
import { type FileAggregate, runFullScan, type ScanDeps } from './scan.js';

type WorkerInput = {
  readonly home: string;
  readonly timeZone: string;
  readonly cachePath: string;
  readonly now: number;
  /** Set by the explicit Refresh button alone — bypasses the PR count's own
   *  TTL. `get()` on mount always passes `false`/omits it. */
  readonly forceRefresh?: boolean;
};

type PrsFetchResult = { readonly sinceDate: string | null; readonly result: PrsCreated };

/** Wraps a promise with a synchronous `isSettled()` — the one primitive
 *  `main()` needs to answer "did the PR fetch finish before the fold did"
 *  without ever blocking on it: `isSettled()` only reads a flag a `.then`
 *  already scheduled onto the microtask queue flips, so checking it right
 *  after `await`-ing the fold tells the truth about which finished first. */
function trackSettlement<V>(promise: Promise<V>): {
  promise: Promise<V>;
  isSettled: () => boolean;
} {
  let settled = false;
  const wrapped = promise.then(
    (value) => {
      settled = true;
      return value;
    },
    (error: unknown) => {
      settled = true;
      throw error;
    },
  );
  return { promise: wrapped, isSettled: () => settled };
}

async function main(input: WorkerInput): Promise<void> {
  const cache = await loadCacheStore<FileAggregate>(
    (path) => readFile(path, 'utf8'),
    input.cachePath,
  );
  const deps: ScanDeps = {
    home: input.home,
    timeZone: input.timeZone,
    now: () => input.now,
    readdir: async (path) => {
      try {
        return await readdir(path);
      } catch {
        return [];
      }
    },
    isDirectory: async (path) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    },
    statOf: async (path) => {
      try {
        const s = await stat(path);
        return { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino };
      } catch {
        return null;
      }
    },
    readLines: readLinesFrom,
    cache,
  };

  const save = (store: CacheStore<FileAggregate>): Promise<void> =>
    saveCacheStore((path, text) => writeFile(path, text), input.cachePath, store);

  const prevPrs: PrsCacheEntry | undefined = readPrsCacheEntry(cache.prs);
  const fetchPrs = readGhPrsCreated();
  const forceRefresh = input.forceRefresh === true;
  const guessedSinceDate = prevPrs?.sinceDate ?? null;

  let early: { promise: Promise<PrsFetchResult>; isSettled: () => boolean } | null = null;
  if (
    prevPrs !== undefined &&
    !forceRefresh &&
    isPrsCacheFresh(prevPrs, guessedSinceDate, input.now)
  ) {
    // TTL-fresh: answer from the cache alone, no network call at all.
    early = trackSettlement(
      Promise.resolve({ sinceDate: prevPrs.sinceDate, result: prevPrs.result }),
    );
  } else if (prevPrs !== undefined) {
    // Stale, or an explicit refresh -- but there IS a since-date to reuse,
    // so the real call starts now, concurrently with the fold below.
    early = trackSettlement(
      fetchPrs(guessedSinceDate).then((result) => ({ sinceDate: guessedSinceDate, result })),
    );
  }
  // else: first-ever scan, nothing to guess from -- `early` stays null, and
  // the fetch starts only after the fold below knows a since-date.

  const { snapshot, cache: foldedCache } = await runFullScan(deps);

  const settlement: { promise: Promise<PrsFetchResult>; isSettled: () => boolean } =
    early ??
    trackSettlement(
      fetchPrs(toDateOnly(snapshot.trackingSinceIso)).then((result) => ({
        sinceDate: toDateOnly(snapshot.trackingSinceIso),
        result,
      })),
    );

  if (settlement.isSettled()) {
    const { sinceDate, result } = await settlement.promise;
    await save({ ...foldedCache, prs: { sinceDate, fetchedAtMs: input.now, result } });
    parentPort?.postMessage({ kind: 'stats', snapshot: { ...snapshot, prsCreated: result } });
    return;
  }

  // Not ready yet: save the FILE cache's gains right away (no reason they
  // should wait on a slow `gh`), carrying forward whatever PR entry already
  // existed until the real one lands, and tell the screen to render the
  // token stats it already has now, with the PR card still loading.
  await save(cache.prs === undefined ? foldedCache : { ...foldedCache, prs: cache.prs });
  parentPort?.postMessage({ kind: 'stats', snapshot });

  const { sinceDate, result } = await settlement.promise;
  await save({ ...foldedCache, prs: { sinceDate, fetchedAtMs: input.now, result } });
  parentPort?.postMessage({ kind: 'prs', prsCreated: result });
}

if (parentPort !== null) {
  main(workerData as WorkerInput).catch((error: unknown) => {
    parentPort?.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
