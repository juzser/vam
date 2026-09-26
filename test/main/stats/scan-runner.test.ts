/**
 * `runStatsScanInWorker` — the main-thread half of the worker hand-off. The
 * real `node:worker_threads` spawn is exercised by the app harness
 * (`electron-vite build && vitest run --config vitest.app.config.ts`, see
 * `test/electron/stats-worker.test.ts`); here the worker itself is an
 * injected fake, so this test is about the PROTOCOL — never about a real OS
 * thread.
 *
 * TWO MESSAGES, NOT ONE. `worker.ts` always sends exactly one `'stats'`
 * message once the file fold is done (its own `prsCreated` already resolved,
 * OR `{kind:'loading'}` if the concurrent PR fetch has not settled yet), and
 * — ONLY when it sent `'loading'` — exactly one following `'prs'` message
 * once that fetch settles. `runStatsScanInWorker` resolves its OWN promise
 * the moment `'stats'` arrives (so the screen can render token stats without
 * waiting on `gh`), and hands back a SECOND promise (`prsUpdate`) the caller
 * awaits separately for the follow-up — `null` when there is nothing to wait
 * for, because `'stats'` already carried a settled answer.
 */
import { describe, expect, it } from 'vitest';
import { runStatsScanInWorker, type WorkerLike } from '../../../src/main/stats/scan-runner.js';
import type { PrsCreated, StatsSnapshot } from '../../../src/shared/stats.js';

const snapshot = (prsCreated: PrsCreated): StatsSnapshot => ({
  generatedAt: '2026-09-27T00:00:00.000Z',
  trackingSinceIso: null,
  agentsSpawned: 0,
  activeMs: 0,
  prsCreated,
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
});

/** A fake `Worker`: records what it was told, and lets a test fire whichever
 *  event the real worker would have fired, as many times as it likes. */
function fakeWorker() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  let terminated = false;
  const worker: WorkerLike = {
    on: (event, listener) => {
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

function start(fake: ReturnType<typeof fakeWorker>) {
  return runStatsScanInWorker({
    workerPath: '/fake/worker.cjs',
    home: '/home/op',
    timeZone: 'UTC',
    cachePath: '/cache.json',
    now: () => 0,
    createWorker: () => fake.worker,
  });
}

describe('runStatsScanInWorker', () => {
  it('resolves ok with a null prsUpdate when the stats message already carries a settled prsCreated', async () => {
    const fake = fakeWorker();
    const promise = start(fake);
    fake.fire('message', { kind: 'stats', snapshot: snapshot({ kind: 'ok', count: 3 }) });
    const outcome = await promise;
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('unreachable');
    expect(outcome.snapshot.prsCreated).toEqual({ kind: 'ok', count: 3 });
    expect(outcome.prsUpdate).toBeNull();
    // nothing more is coming -- terminate right away.
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.wasTerminated()).toBe(true);
  });

  it('resolves ok with a live prsUpdate when the stats message says loading, and does not terminate yet', async () => {
    const fake = fakeWorker();
    const promise = start(fake);
    fake.fire('message', { kind: 'stats', snapshot: snapshot({ kind: 'loading' }) });
    const outcome = await promise;
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('unreachable');
    expect(outcome.snapshot.prsCreated).toEqual({ kind: 'loading' });
    expect(outcome.prsUpdate).not.toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.wasTerminated()).toBe(false); // the 'prs' message has not arrived yet

    fake.fire('message', { kind: 'prs', prsCreated: { kind: 'ok', count: 9 } });
    const prsCreated = await outcome.prsUpdate;
    expect(prsCreated).toEqual({ kind: 'ok', count: 9 });
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.wasTerminated()).toBe(true); // NOW nothing more is coming
  });

  it('resolves an error outcome when the worker posts one', async () => {
    const fake = fakeWorker();
    const promise = start(fake);
    fake.fire('message', { kind: 'error', message: 'disk exploded' });
    const outcome = await promise;
    expect(outcome).toEqual({ kind: 'error', message: 'disk exploded' });
  });

  it('resolves an error outcome when the worker itself errors', async () => {
    const fake = fakeWorker();
    const promise = start(fake);
    fake.fire('error', new Error('worker crashed'));
    const outcome = await promise;
    expect(outcome).toEqual({ kind: 'error', message: 'worker crashed' });
  });

  it('resolves an error outcome for a non-zero exit that never posted a message', async () => {
    const fake = fakeWorker();
    const promise = start(fake);
    fake.fire('exit', 1);
    const outcome = await promise;
    expect(outcome.kind).toBe('error');
  });

  it('ignores a later event once the main outcome has already settled', async () => {
    const fake = fakeWorker();
    const promise = start(fake);
    fake.fire('message', { kind: 'stats', snapshot: snapshot({ kind: 'ok', count: 1 }) });
    fake.fire('exit', 1); // a clean-ish exit AFTER a successful message — not an error
    const outcome = await promise;
    expect(outcome.kind).toBe('ok');
  });

  it('a pending prsUpdate resolves to a safe "unavailable", never hangs, if the worker exits before its "prs" message', async () => {
    const fake = fakeWorker();
    const promise = start(fake);
    fake.fire('message', { kind: 'stats', snapshot: snapshot({ kind: 'loading' }) });
    const outcome = await promise;
    if (outcome.kind !== 'ok') throw new Error('unreachable');
    fake.fire('exit', 1); // died before ever sending 'prs'
    const prsCreated = await outcome.prsUpdate;
    expect(prsCreated).toEqual({
      kind: 'unavailable',
      hint: 'connect GitHub in Settings → Integrations',
      reason: 'error',
    });
  });
});
