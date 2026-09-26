/**
 * THE STATS WORKER, AS A REAL `node:worker_threads` THREAD, against the
 * ACTUAL BUILT `out/main/statsWorker.cjs` — the one thing `scan-runner.test.ts`
 * cannot prove with its injected fake `Worker`, and the one thing `scan.
 * test.ts` cannot prove either, because it calls `runFullScan` in-process.
 *
 * Runs after `electron-vite build`, on `vitest.app.config.ts`'s own bargain
 * (`launch.test.ts`'s header): a real thread is not a unit, so it lives here
 * rather than in the default `vitest run`, which runs BEFORE the build even
 * produces `out/main/statsWorker.cjs` at all.
 *
 * A plain `node:worker_threads` `Worker` is enough — this needs no Electron
 * window at all, only the worker file `check-bundle-externals.mjs` already
 * proved carries no `node_modules` dependency the packaged asar would lack.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workerPath = path.join(repoRoot, 'out', 'main', 'statsWorker.cjs');

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'vam-stats-worker-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('the built stats worker', () => {
  it('exists — built by electron-vite before this suite runs', () => {
    expect(existsSync(workerPath)).toBe(true);
  });

  it('runs as a real worker thread against a real (empty) HOME and posts a snapshot', async () => {
    const cachePath = path.join(home, 'stats-cache.json');
    const worker = new Worker(workerPath, {
      workerData: { home, timeZone: 'UTC', cachePath, now: Date.now() },
    });
    const message = await new Promise<{ kind: string; snapshot?: unknown; message?: string }>(
      (resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      },
    );
    await worker.terminate();
    expect(message.kind).toBe('done');
    const snapshot = message.snapshot as {
      agentsSpawned: number;
      trackingSinceIso: string | null;
      usageOverview: { totalTokens: number };
    };
    expect(snapshot.agentsSpawned).toBe(0);
    expect(snapshot.trackingSinceIso).toBeNull();
    expect(snapshot.usageOverview.totalTokens).toBe(0);
    // The cache file the worker itself wrote, under the given path -- never
    // under `~/.claude`.
    expect(existsSync(cachePath)).toBe(true);
  });
});
