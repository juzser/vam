/**
 * `registerUpdateIpc`: one check, at launch, and never again in the session.
 * The check is a stub in every test here, so no request leaves this file.
 */

import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { registerUpdateIpc } from '../../src/main/update/ipc.js';
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
  it('checks once at launch, before anything asks', () => {
    const check = vi.fn(async () => AVAILABLE);
    registerUpdateIpc(fakeIpcMain(), check);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('never checks again, however often the renderer asks', async () => {
    const check = vi.fn(async () => AVAILABLE);
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(ipcMain, check);

    for (let i = 0; i < 20; i += 1) {
      expect(await ipcMain.invoke(CHANNELS.updateCheck)).toEqual(AVAILABLE);
    }
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('does not wait for the check: registration returns while it is still running', async () => {
    let settle: ((status: UpdateStatus) => void) | undefined;
    const check = () =>
      new Promise<UpdateStatus>((resolve) => {
        settle = resolve;
      });
    const ipcMain = fakeIpcMain();

    registerUpdateIpc(ipcMain, check);
    // Reached with the check still in flight -- the window is created on this
    // same synchronous path, so anything awaited here would delay it.
    expect(settle).toBeDefined();

    const asked = ipcMain.invoke(CHANNELS.updateCheck);
    settle?.(AVAILABLE);
    expect(await asked).toEqual(AVAILABLE);
  });

  it('turns a failing check into a quiet value, never a startup error', async () => {
    const ipcMain = fakeIpcMain();
    const rejections: unknown[] = [];
    process.on('unhandledRejection', (reason) => rejections.push(reason));
    registerUpdateIpc(ipcMain, async () => {
      throw new Error('boom');
    });
    await new Promise((resolve) => setImmediate(resolve));
    process.removeAllListeners('unhandledRejection');

    expect(rejections).toEqual([]);
    expect(await ipcMain.invoke(CHANNELS.updateCheck)).toEqual({
      kind: 'unknown',
      reason: 'network',
    });
  });

  it('crosses the bridge bare, with no envelope to unwrap', async () => {
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(ipcMain, async () => AVAILABLE);
    expect(await createUpdateApi(ipcMain).check()).toEqual(AVAILABLE);
  });

  it('opens the release page the LAUNCH CHECK found, taking no URL from the renderer', async () => {
    const opened: string[] = [];
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(
      ipcMain,
      async () => AVAILABLE,
      async (url) => {
        opened.push(url);
      },
    );

    // Whatever a caller passes is ignored: the handler takes no argument.
    expect(await ipcMain.invoke(CHANNELS.updateOpen, 'https://example.invalid/evil')).toBe(true);
    expect(opened).toEqual([AVAILABLE.url]);
  });

  it('opens nothing when there is no newer release to open', async () => {
    const opened: string[] = [];
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(
      ipcMain,
      async () => ({ kind: 'none' }),
      async (url) => {
        opened.push(url);
      },
    );

    expect(await ipcMain.invoke(CHANNELS.updateOpen)).toBe(false);
    expect(opened).toEqual([]);
  });

  it('answers false when the shell refuses to open the page', async () => {
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(
      ipcMain,
      async () => AVAILABLE,
      async () => {
        throw new Error('no handler for https');
      },
    );
    expect(await ipcMain.invoke(CHANNELS.updateOpen)).toBe(false);
  });
});
