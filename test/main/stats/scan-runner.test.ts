/**
 * `runStatsScanInWorker` — the main-thread half of the worker hand-off. The
 * real `node:worker_threads` spawn is exercised by the app harness
 * (`electron-vite build && vitest run --config vitest.app.config.ts`, see
 * `test/electron/stats-worker.test.ts`); here the worker itself is an
 * injected fake, so this test is about the PROTOCOL — done/error/exit — and
 * never about a real OS thread.
 */
import { describe, expect, it } from 'vitest';
import { runStatsScanInWorker, type WorkerLike } from '../../../src/main/stats/scan-runner.js';
import type { StatsSnapshot } from '../../../src/shared/stats.js';

const SNAPSHOT: StatsSnapshot = {
  generatedAt: '2026-09-27T00:00:00.000Z',
  trackingSinceIso: null,
  agentsSpawned: 0,
  activeMs: 0,
  prsCreated: { kind: 'unavailable', hint: 'x' },
  usageOverview: { totalTokens: 0, estCostUsd: null, activeDays: 0, cacheSharePercent: 0 },
  heatmap: [],
  tokenMix: {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  },
  providers: [],
  malformedLines: 0,
  priceTableAsOf: '2026-01-15',
};

/** A fake `Worker`: records what it was told, and lets a test fire whichever
 *  event the real worker would have fired. */
function fakeWorker() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  let terminated = false;
  const worker: WorkerLike = {
    once: (event, listener) => {
      if (listeners[event] === undefined) listeners[event] = [];
      listeners[event].push(listener as (...args: unknown[]) => void);
    },
    terminate: async () => {
      terminated = true;
      return 0;
    },
  };
  return {
    worker,
    fire: (event: string, ...args: unknown[]) => {
      for (const listener of listeners[event] ?? []) listener(...args);
    },
    wasTerminated: () => terminated,
  };
}

describe('runStatsScanInWorker', () => {
  it('resolves ok with the snapshot the worker posts, and terminates the worker', async () => {
    const fake = fakeWorker();
    const promise = runStatsScanInWorker({
      workerPath: '/fake/worker.cjs',
      home: '/home/op',
      timeZone: 'UTC',
      cachePath: '/cache.json',
      now: () => 0,
      createWorker: () => fake.worker,
    });
    fake.fire('message', { kind: 'done', snapshot: SNAPSHOT });
    const outcome = await promise;
    expect(outcome).toEqual({ kind: 'ok', snapshot: SNAPSHOT });
    // `terminate()` is called asynchronously after resolving; give it a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.wasTerminated()).toBe(true);
  });

  it('resolves an error outcome when the worker posts one', async () => {
    const fake = fakeWorker();
    const promise = runStatsScanInWorker({
      workerPath: '/fake/worker.cjs',
      home: '/home/op',
      timeZone: 'UTC',
      cachePath: '/cache.json',
      now: () => 0,
      createWorker: () => fake.worker,
    });
    fake.fire('message', { kind: 'error', message: 'disk exploded' });
    const outcome = await promise;
    expect(outcome).toEqual({ kind: 'error', message: 'disk exploded' });
  });

  it('resolves an error outcome when the worker itself errors', async () => {
    const fake = fakeWorker();
    const promise = runStatsScanInWorker({
      workerPath: '/fake/worker.cjs',
      home: '/home/op',
      timeZone: 'UTC',
      cachePath: '/cache.json',
      now: () => 0,
      createWorker: () => fake.worker,
    });
    fake.fire('error', new Error('worker crashed'));
    const outcome = await promise;
    expect(outcome).toEqual({ kind: 'error', message: 'worker crashed' });
  });

  it('resolves an error outcome for a non-zero exit that never posted a message', async () => {
    const fake = fakeWorker();
    const promise = runStatsScanInWorker({
      workerPath: '/fake/worker.cjs',
      home: '/home/op',
      timeZone: 'UTC',
      cachePath: '/cache.json',
      now: () => 0,
      createWorker: () => fake.worker,
    });
    fake.fire('exit', 1);
    const outcome = await promise;
    expect(outcome.kind).toBe('error');
  });

  it('ignores a later event once the outcome has already settled', async () => {
    const fake = fakeWorker();
    const promise = runStatsScanInWorker({
      workerPath: '/fake/worker.cjs',
      home: '/home/op',
      timeZone: 'UTC',
      cachePath: '/cache.json',
      now: () => 0,
      createWorker: () => fake.worker,
    });
    fake.fire('message', { kind: 'done', snapshot: SNAPSHOT });
    fake.fire('exit', 1); // a clean exit AFTER a successful message — not an error
    const outcome = await promise;
    expect(outcome).toEqual({ kind: 'ok', snapshot: SNAPSHOT });
  });
});
