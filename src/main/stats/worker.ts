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
 * `loadCacheStore`/`saveCacheStore`, `readGhPrsCreated`) is already unit
 * tested with injected dependencies elsewhere in this directory. What THIS
 * file does that nothing else can — really spawn as a worker thread and
 * really load the real filesystem — is proven by the app-level harness
 * (`test/electron/stats-worker.test.ts`), not here.
 *
 * ONE MESSAGE OUT, EVER: `{kind:'done', snapshot}` on success, `{kind:
 * 'error', message}` on anything this catch cannot recover from. Never a
 * throw across the thread boundary — an uncaught exception in a worker
 * becomes an `'error'` event the runner already handles, but the message
 * would be Node's own generic stack trace rather than a sentence naming
 * what actually went wrong.
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { readGhPrsCreated } from './gh-prs.js';
import { loadCacheStore, saveCacheStore } from './incremental-cache.js';
import { readLinesFrom } from './line-stream.js';
import { type FileAggregate, runFullScan, type ScanDeps } from './scan.js';

type WorkerInput = {
  readonly home: string;
  readonly timeZone: string;
  readonly cachePath: string;
  readonly now: number;
};

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
    fetchPrsCreated: readGhPrsCreated(),
    cache,
  };
  const { snapshot, cache: nextCache } = await runFullScan(deps);
  await saveCacheStore((path, text) => writeFile(path, text), input.cachePath, nextCache);
  parentPort?.postMessage({ kind: 'done', snapshot });
}

if (parentPort !== null) {
  main(workerData as WorkerInput).catch((error: unknown) => {
    parentPort?.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
