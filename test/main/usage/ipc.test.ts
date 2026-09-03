/**
 * `registerUsageIpc`: only a `UsageSnapshot` crosses, and a `getSnapshot`
 * that throws unexpectedly still answers a value, never an unhandled
 * rejection.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { MIN_READ_INTERVAL_MS, registerUsageIpc } from '../../../src/main/usage/ipc.js';
import { createUsageApi } from '../../../src/preload/api.js';

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

describe('registerUsageIpc', () => {
  it('answers with exactly the snapshot getSnapshot returned, no envelope', async () => {
    const ipcMain = fakeIpcMain();
    const snapshot = {
      kind: 'ok' as const,
      windows: {
        fiveHour: { kind: 'known' as const, percent: 40, resetsAt: '2026-09-03T11:40:00Z' },
        sevenDay: { kind: 'known' as const, percent: 30, resetsAt: '2026-09-07T06:00:00Z' },
      },
      observedAt: '2026-09-03T10:00:00Z',
    };
    registerUsageIpc(ipcMain, async () => snapshot);

    const result = await ipcMain.invoke(CHANNELS.usageGet);

    expect(result).toEqual(snapshot);
    // No `ok`/`value`/`error` envelope keys -- a bare UsageSnapshot only.
    expect(Object.keys(result as object).sort()).toEqual(['kind', 'observedAt', 'windows']);
  });

  it('answers unavailable rather than throwing when getSnapshot itself throws', async () => {
    const ipcMain = fakeIpcMain();
    registerUsageIpc(ipcMain, async () => {
      throw new Error('unexpected');
    });

    const result = await ipcMain.invoke(CHANNELS.usageGet);

    expect(result).toEqual({ kind: 'unknown', reason: 'unavailable' });
  });
});

/**
 * The cadence lives HERE, not in the renderer.
 *
 * A security audit found the handler had no floor of any kind: the renderer's
 * five-minute poll was a convention, and `window.api.usage.get()` in a loop
 * would have driven one `security` subprocess and one authenticated request to
 * Anthropic per call. The renderer cannot be the thing that decides how often
 * the operator's Keychain is read.
 */
describe('registerUsageIpc rate limiting', () => {
  const ok = (at: string) => ({
    kind: 'ok' as const,
    windows: { fiveHour: { kind: 'unknown' as const }, sevenDay: { kind: 'unknown' as const } },
    observedAt: at,
  });

  it('reads once for a burst of calls, serving the rest from the last reading', async () => {
    const ipcMain = fakeIpcMain();
    let reads = 0;
    // The clock never moves in this test -- that IS the test: 500 calls inside
    // the floor must produce one read.
    const now = 1_000_000;
    registerUsageIpc(
      ipcMain,
      async () => {
        reads += 1;
        return ok(`read-${reads}`);
      },
      () => now,
    );

    const results = [];
    for (let i = 0; i < 500; i += 1) {
      results.push(await ipcMain.invoke(CHANNELS.usageGet));
    }

    expect(reads).toBe(1);
    expect(new Set(results.map((r) => (r as { observedAt: string }).observedAt))).toEqual(
      new Set(['read-1']),
    );
  });

  it('collapses calls that arrive while a read is still in flight', async () => {
    const ipcMain = fakeIpcMain();
    let reads = 0;
    // Declared with a no-op default rather than `null`: TypeScript cannot see
    // that a Promise executor runs synchronously, so the `null` form narrows
    // to `never` at the call site and fails `typecheck:test` while vitest
    // stays green over it.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    registerUsageIpc(ipcMain, async () => {
      reads += 1;
      await gate;
      return ok('slow');
    });

    // Five callers, none awaited yet: the first starts the read, the rest must
    // join it rather than starting their own.
    const pending = [0, 1, 2, 3, 4].map(() => ipcMain.invoke(CHANNELS.usageGet));
    release();
    const results = await Promise.all(pending);

    expect(reads).toBe(1);
    expect(results.every((r) => (r as { observedAt: string }).observedAt === 'slow')).toBe(true);
  });

  it('reads again once the floor has elapsed', async () => {
    const ipcMain = fakeIpcMain();
    let reads = 0;
    let now = 1_000_000;
    registerUsageIpc(
      ipcMain,
      async () => {
        reads += 1;
        return ok(`read-${reads}`);
      },
      () => now,
    );

    await ipcMain.invoke(CHANNELS.usageGet);
    now += MIN_READ_INTERVAL_MS - 1;
    await ipcMain.invoke(CHANNELS.usageGet);
    expect(reads).toBe(1);

    now += 1;
    const fresh = await ipcMain.invoke(CHANNELS.usageGet);
    expect(reads).toBe(2);
    expect((fresh as { observedAt: string }).observedAt).toBe('read-2');
  });

  it('throttles a FAILING read too, and recovers once the floor elapses', async () => {
    // The security-relevant half. Caching only successes would leave a
    // permanently broken Keychain spawning one subprocess per call -- a
    // smaller version of the hole rather than a closed one -- while a floor
    // that never expired would hide a Keychain that came back.
    const ipcMain = fakeIpcMain();
    let reads = 0;
    let now = 1_000_000;
    registerUsageIpc(
      ipcMain,
      async () => {
        reads += 1;
        throw new Error('boom');
      },
      () => now,
    );

    for (let i = 0; i < 100; i += 1) {
      expect(await ipcMain.invoke(CHANNELS.usageGet)).toEqual({
        kind: 'unknown',
        reason: 'unavailable',
      });
    }
    expect(reads).toBe(1);

    now += MIN_READ_INTERVAL_MS;
    await ipcMain.invoke(CHANNELS.usageGet);
    expect(reads).toBe(2);
  });
});

/**
 * The preload half, end to end over a fake channel pair.
 *
 * A test-quality audit found `createUsageApi` had no direct coverage: it was
 * mocked around in the Canvas test and shallow-checked for key presence in
 * the launch harness, so the one line that actually names the channel was
 * asserted by nothing. A typo in `CHANNELS.usageGet` on either side would
 * have left every other test green.
 */
describe('createUsageApi over a real channel pair', () => {
  it('reaches the registered handler and returns its snapshot unchanged', async () => {
    const ipcMain = fakeIpcMain();
    const snapshot = {
      kind: 'ok' as const,
      windows: {
        fiveHour: { kind: 'known' as const, percent: 40, resetsAt: '2026-09-03T11:40:00Z' },
        sevenDay: { kind: 'known' as const, percent: 30, resetsAt: '2026-09-07T06:00:00Z' },
      },
      observedAt: '2026-09-03T10:00:00Z',
    };
    registerUsageIpc(ipcMain, async () => snapshot);

    // The preload's own object, built over an invoker that speaks to the
    // handler registered above -- not a stub standing in for it.
    const usage = createUsageApi({
      invoke: async (channel: string, ...args: unknown[]) => ipcMain.invoke(channel, ...args),
    });

    expect(typeof usage.get).toBe('function');
    await expect(usage.get()).resolves.toEqual(snapshot);
  });

  it('asks the usage channel and no other', async () => {
    const asked: string[] = [];
    const usage = createUsageApi({
      invoke: async (channel: string) => {
        asked.push(channel);
        return { kind: 'unknown', reason: 'unavailable' };
      },
    });

    await usage.get();

    // What this catches, stated precisely: `createUsageApi` invoking a
    // DIFFERENT channel than the handler registers -- pointing it at
    // `CHANNELS.load` turns both tests in this block red. What it does NOT
    // catch is renaming `CHANNELS.usageGet` itself, since both sides read the
    // one constant; that rename is a refactor no test here should oppose.
    expect(asked).toEqual([CHANNELS.usageGet]);
  });
});
