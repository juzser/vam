/**
 * `registerUpdateIpc`: pull-based, throttled in HOURS, and offline here --
 * the check is a stub, so no request leaves this file.
 */

import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { MIN_CHECK_INTERVAL_MS, registerUpdateIpc } from '../../src/main/update/ipc.js';
import { createUpdateApi } from '../../src/preload/api.js';
import type { UpdateStatus } from '../../src/shared/update.js';

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(channel, listener);
    },
    invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error(`no handler for ${channel}`);
      return handler({}, ...args);
    },
  };
}

const AVAILABLE: UpdateStatus = {
  kind: 'available',
  version: '0.1.0',
  url: 'https://github.com/juzser/vam/releases/tag/v0.1.0',
};

describe('registerUpdateIpc', () => {
  it('checks nothing until the renderer asks', async () => {
    const check = vi.fn(async () => AVAILABLE);
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(ipcMain, check);
    expect(check).not.toHaveBeenCalled();

    expect(await ipcMain.invoke(CHANNELS.updateCheck)).toEqual(AVAILABLE);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('is measured in hours, not renders: repeat asks are served from the last answer', async () => {
    const check = vi.fn(async () => AVAILABLE);
    const ipcMain = fakeIpcMain();
    let now = 1_000;
    registerUpdateIpc(ipcMain, check, () => now);

    await ipcMain.invoke(CHANNELS.updateCheck);
    for (let i = 0; i < 20; i += 1) await ipcMain.invoke(CHANNELS.updateCheck);
    expect(check).toHaveBeenCalledTimes(1);

    now += MIN_CHECK_INTERVAL_MS;
    await ipcMain.invoke(CHANNELS.updateCheck);
    expect(check).toHaveBeenCalledTimes(2);
    expect(MIN_CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it('throttles a failing check too, so a broken network is not asked twice a render', async () => {
    const check = vi.fn(
      async (): Promise<UpdateStatus> => ({ kind: 'unknown', reason: 'network' }),
    );
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(ipcMain, check, () => 0);

    expect(await ipcMain.invoke(CHANNELS.updateCheck)).toEqual({
      kind: 'unknown',
      reason: 'network',
    });
    await ipcMain.invoke(CHANNELS.updateCheck);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('answers a value even when the check throws unexpectedly', async () => {
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(ipcMain, async () => {
      throw new Error('boom');
    });
    expect(await ipcMain.invoke(CHANNELS.updateCheck)).toEqual({
      kind: 'unknown',
      reason: 'network',
    });
  });

  it('crosses the bridge bare, with no envelope to unwrap', async () => {
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(ipcMain, async () => AVAILABLE);
    const api = createUpdateApi(ipcMain);
    expect(await api.check()).toEqual(AVAILABLE);
  });
});
