/**
 * `registerStatsIpc` — TWO channels behind the Stats screen's one bridge
 * member set (`stats.get`/`stats.refresh`/`stats.prs`):
 *
 *  - `vam:stats:scan` answers the fold's own `StatsResult` (`prsCreated` may
 *    be `{kind:'loading'}`) — called by BOTH the screen's mount (`get()`,
 *    `forceRefresh: false`) and its refresh button (`refresh()`,
 *    `forceRefresh: true`, which bypasses the PR count's own TTL).
 *  - `vam:stats:prs` answers the FOLLOW-UP `PrsCreated` for the scan that
 *    channel most recently ran, once it settles — the screen calls it only
 *    when `scan`'s own answer said `'loading'`.
 *
 * Concurrent `scan` callers join the one scan already running (the SAME
 * "second caller gets the first's promise" shape `usage/ipc.ts`'s
 * `registerCachedRead` uses) — never a time floor, unlike usage: there is no
 * Keychain or network call here to protect, only a filesystem scan the
 * incremental cache already makes cheap on repeat.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { registerStatsIpc } from '../../../src/main/stats/ipc.js';
import type { ScanOutcome } from '../../../src/main/stats/scan-runner.js';
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

const snapshot = (): StatsSnapshot => ({
  generatedAt: '2026-09-27T00:00:00.000Z',
  trackingSinceIso: null,
  agentsSpawned: 0,
  activeMs: 0,
  prsCreated: { kind: 'loading' },
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

describe('registerStatsIpc', () => {
  it('answers the scan result, bare, with no envelope', async () => {
    const ipcMain = fakeIpcMain();
    registerStatsIpc(ipcMain, async () => ({
      kind: 'ok',
      snapshot: { ...snapshot(), prsCreated: { kind: 'ok', count: 3 } },
      prsUpdate: null,
    }));
    const result = await ipcMain.invoke(CHANNELS.statsScan, { forceRefresh: false });
    expect(result).toEqual({
      kind: 'ok',
      snapshot: { ...snapshot(), prsCreated: { kind: 'ok', count: 3 } },
    });
  });

  it('runs a fresh scan on every call — no interval floor', async () => {
    const runScan = vi.fn(
      async (): Promise<ScanOutcome> => ({ kind: 'ok', snapshot: snapshot(), prsUpdate: null }),
    );
    const ipcMain = fakeIpcMain();
    registerStatsIpc(ipcMain, runScan);
    await ipcMain.invoke(CHANNELS.statsScan, { forceRefresh: false });
    await ipcMain.invoke(CHANNELS.statsScan, { forceRefresh: false });
    expect(runScan).toHaveBeenCalledTimes(2);
  });

  it('passes forceRefresh through to the runner — the Refresh button bypasses the TTL, get() never does', async () => {
    const runScan = vi.fn(
      async (_forceRefresh: boolean): Promise<ScanOutcome> => ({
        kind: 'ok',
        snapshot: snapshot(),
        prsUpdate: null,
      }),
    );
    const ipcMain = fakeIpcMain();
    registerStatsIpc(ipcMain, runScan);
    await ipcMain.invoke(CHANNELS.statsScan, { forceRefresh: false });
    await ipcMain.invoke(CHANNELS.statsScan, { forceRefresh: true });
    expect(runScan.mock.calls[0]?.[0]).toBe(false);
    expect(runScan.mock.calls[1]?.[0]).toBe(true);
  });

  it('joins two concurrent callers into the SAME scan rather than starting two', async () => {
    let resolveScan: (() => void) | undefined;
    const runScan = vi.fn(
      () =>
        new Promise<ScanOutcome>((resolve) => {
          resolveScan = () => resolve({ kind: 'ok', snapshot: snapshot(), prsUpdate: null });
        }),
    );
    const ipcMain = fakeIpcMain();
    registerStatsIpc(ipcMain, runScan);

    const first = ipcMain.invoke(CHANNELS.statsScan, { forceRefresh: false });
    const second = ipcMain.invoke(CHANNELS.statsScan, { forceRefresh: false });
    expect(runScan).toHaveBeenCalledTimes(1);
    resolveScan?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ kind: 'ok', snapshot: snapshot() });
    expect(secondResult).toEqual({ kind: 'ok', snapshot: snapshot() });
  });

  it('answers an error outcome rather than throwing when the scan itself throws', async () => {
    const ipcMain = fakeIpcMain();
    registerStatsIpc(ipcMain, async () => {
      throw new Error('unexpected');
    });
    const result = await ipcMain.invoke(CHANNELS.statsScan, { forceRefresh: false });
    expect(result).toEqual({ kind: 'error', message: 'the stats scan failed unexpectedly' });
  });

  describe('the "prs" follow-up channel', () => {
    it('answers the pending prsUpdate for the most recent scan, once it settles', async () => {
      let resolvePrs: ((v: { kind: 'ok'; count: number }) => void) | undefined;
      const prsUpdate = new Promise<{ kind: 'ok'; count: number }>((resolve) => {
        resolvePrs = resolve;
      });
      const ipcMain = fakeIpcMain();
      registerStatsIpc(ipcMain, async () => ({ kind: 'ok', snapshot: snapshot(), prsUpdate }));
      await ipcMain.invoke(CHANNELS.statsScan, { forceRefresh: false });

      const answer = ipcMain.invoke(CHANNELS.statsPrs);
      resolvePrs?.({ kind: 'ok', count: 12 });
      expect(await answer).toEqual({ kind: 'ok', prsCreated: { kind: 'ok', count: 12 } });
    });

    it('answers a safe unavailable when the last scan had nothing pending', async () => {
      const ipcMain = fakeIpcMain();
      registerStatsIpc(ipcMain, async () => ({
        kind: 'ok',
        snapshot: snapshot(),
        prsUpdate: null,
      }));
      await ipcMain.invoke(CHANNELS.statsScan, { forceRefresh: false });
      const answer = await ipcMain.invoke(CHANNELS.statsPrs);
      expect(answer).toEqual({
        kind: 'ok',
        prsCreated: {
          kind: 'unavailable',
          hint: 'connect GitHub in Settings → Integrations',
          reason: 'error',
        },
      });
    });

    it('answers the same safe unavailable when called before any scan ever ran', async () => {
      const ipcMain = fakeIpcMain();
      registerStatsIpc(ipcMain, async () => ({
        kind: 'ok',
        snapshot: snapshot(),
        prsUpdate: null,
      }));
      const answer = (await ipcMain.invoke(CHANNELS.statsPrs)) as {
        readonly kind: string;
        readonly prsCreated: { readonly kind: string };
      };
      expect(answer.kind).toBe('ok');
      expect(answer.prsCreated.kind).toBe('unavailable');
    });
  });
});
