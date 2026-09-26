/**
 * `registerStatsIpc` — one channel, `vam:stats:scan`, called by BOTH the
 * screen's own mount (`stats.get()`) and its refresh button (`stats.
 * refresh()`): the operator's own rule is "compute only while the screen is
 * open, plus on an explicit refresh", and both of those really do mean "run
 * the scan again", so there is exactly one action behind them, not two.
 *
 * Concurrent callers join the one scan already running (the SAME "second
 * caller gets the first's promise" shape `usage/ipc.ts`'s `registerCachedRead`
 * uses) — never a time floor, unlike usage: there is no Keychain or network
 * call here to protect, only a filesystem scan the incremental cache already
 * makes cheap on repeat.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { registerStatsIpc } from '../../../src/main/stats/ipc.js';
import type { StatsSnapshot } from '../../../src/shared/stats.js';

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(channel, listener);
    },
    invoke: (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error(`no handler for ${channel}`);
      return handler({}, ...args);
    },
  };
}

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

describe('registerStatsIpc', () => {
  it('answers the scan result, bare, with no envelope', async () => {
    const ipcMain = fakeIpcMain();
    registerStatsIpc(ipcMain, async () => ({ kind: 'ok', snapshot: SNAPSHOT }));
    const result = await ipcMain.invoke(CHANNELS.statsScan);
    expect(result).toEqual({ kind: 'ok', snapshot: SNAPSHOT });
  });

  it('runs a fresh scan on every call — no interval floor', async () => {
    const runScan = vi.fn(async () => ({ kind: 'ok' as const, snapshot: SNAPSHOT }));
    const ipcMain = fakeIpcMain();
    registerStatsIpc(ipcMain, runScan);
    await ipcMain.invoke(CHANNELS.statsScan);
    await ipcMain.invoke(CHANNELS.statsScan);
    expect(runScan).toHaveBeenCalledTimes(2);
  });

  it('joins two concurrent callers into the SAME scan rather than starting two', async () => {
    let resolveScan: (() => void) | undefined;
    const runScan = vi.fn(
      () =>
        new Promise<{ kind: 'ok'; snapshot: StatsSnapshot }>((resolve) => {
          resolveScan = () => resolve({ kind: 'ok', snapshot: SNAPSHOT });
        }),
    );
    const ipcMain = fakeIpcMain();
    registerStatsIpc(ipcMain, runScan);

    const first = ipcMain.invoke(CHANNELS.statsScan);
    const second = ipcMain.invoke(CHANNELS.statsScan);
    expect(runScan).toHaveBeenCalledTimes(1);
    resolveScan?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ kind: 'ok', snapshot: SNAPSHOT });
    expect(secondResult).toEqual({ kind: 'ok', snapshot: SNAPSHOT });
  });

  it('answers an error outcome rather than throwing when the scan itself throws', async () => {
    const ipcMain = fakeIpcMain();
    registerStatsIpc(ipcMain, async () => {
      throw new Error('unexpected');
    });
    const result = await ipcMain.invoke(CHANNELS.statsScan);
    expect(result).toEqual({ kind: 'error', message: 'the stats scan failed unexpectedly' });
  });
});
