/**
 * `registerUsageIpc`: only a `UsageSnapshot` crosses, and a `getSnapshot`
 * that throws unexpectedly still answers a value, never an unhandled
 * rejection.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { registerUsageIpc } from '../../../src/main/usage/ipc.js';

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
