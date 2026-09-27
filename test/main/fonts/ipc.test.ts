/**
 * The renderer's route to `list-monospace.ts` — a bare array, never an
 * `IpcResult`, for `clipboard/ipc.ts`'s own reason: the only thing a caller
 * can do with an enumeration failure is fall back to free text, which it
 * already does for an empty answer.
 */

import { describe, expect, it } from 'vitest';
import { registerFontsIpc } from '../../../src/main/fonts/ipc.js';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { IpcMainLike } from '../../../src/main/ipc/handlers.js';

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  };
  return { ipcMain, handlers };
}

describe('registerFontsIpc', () => {
  it('registers a handler on the listMonospace channel', () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerFontsIpc(ipcMain);
    expect(handlers.has(CHANNELS.fontsListMonospace)).toBe(true);
  });

  it('answers the families the injected lister finds', async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerFontsIpc(ipcMain, () => ['Fira Code', 'Menlo']);
    const result = await handlers.get(CHANNELS.fontsListMonospace)?.({});
    expect(result).toEqual(['Fira Code', 'Menlo']);
  });

  it('answers an empty list rather than throwing when the lister itself throws', async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerFontsIpc(ipcMain, () => {
      throw new Error('no /System on this box');
    });
    await expect(handlers.get(CHANNELS.fontsListMonospace)?.({})).resolves.toEqual([]);
  });
});
