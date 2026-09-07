/**
 * `registerMainErrorIpc`: the route from `src/main/errors/log.ts` (main's own
 * buffer) onto the bridge -- a plain pull for the backlog, and a
 * payload-free tick telling a renderer already up to ask again.
 *
 * REGISTERED INSIDE `createWindow()`, same as `registerStreamIpc`: it needs
 * THIS window's `webContents` to push to. That is not itself the ordering fix
 * -- `recordMainFailure` (`src/main/errors/log.ts`) already works with zero
 * subscribers, so nothing recorded before this call is lost. What this test
 * file covers is narrower: the handle answers the full, current backlog on
 * every call, and a push after registration ticks (never carries a payload).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMainErrorIpc } from '../../../src/main/errors/ipc.js';
import { clearMainFailures, recordMainFailure } from '../../../src/main/errors/log.js';
import { CHANNELS } from '../../../src/main/ipc/channels.js';

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

beforeEach(() => {
  clearMainFailures();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registerMainErrorIpc', () => {
  it('answers the current backlog on vam:errors:get, oldest first', async () => {
    recordMainFailure('start the remote endpoint', 'remote-port-in-use', 'port taken');
    const ipcMain = fakeIpcMain();
    registerMainErrorIpc(ipcMain, { send: vi.fn() });

    const answer = await ipcMain.invoke(CHANNELS.mainErrorsGet);
    expect(answer).toEqual([
      expect.objectContaining({ code: 'remote-port-in-use', message: 'port taken' }),
    ]);
  });

  it('answers the backlog recorded BEFORE registration -- the ordering case', async () => {
    // Recorded before `registerMainErrorIpc` is even called, exactly like a
    // remote-endpoint failure recorded before `createWindow()` runs.
    recordMainFailure('start the remote endpoint', 'remote-bind-failed', 'EACCES');
    const ipcMain = fakeIpcMain();
    registerMainErrorIpc(ipcMain, { send: vi.fn() });

    expect(await ipcMain.invoke(CHANNELS.mainErrorsGet)).toHaveLength(1);
  });

  it('ticks webContents.send, payload-free, on a failure recorded AFTER registration', async () => {
    const ipcMain = fakeIpcMain();
    const send = vi.fn();
    registerMainErrorIpc(ipcMain, { send });

    recordMainFailure('start the remote endpoint', 'remote-port-in-use', 'port taken');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(CHANNELS.mainErrorsChanged);
  });

  it('a second pull sees the same event and no duplicate', async () => {
    const ipcMain = fakeIpcMain();
    registerMainErrorIpc(ipcMain, { send: vi.fn() });
    recordMainFailure('a', 'code-a', 'one');

    const first = await ipcMain.invoke(CHANNELS.mainErrorsGet);
    const second = await ipcMain.invoke(CHANNELS.mainErrorsGet);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });
});
