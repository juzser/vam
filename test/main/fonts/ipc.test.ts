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

  // THE UI FONT PICKER'S OWN CHANNEL (settings-views restructure, item G),
  // registered by the SAME call with its own injectable lister -- the
  // identical three claims as `fontsListMonospace` above, over the sibling
  // channel.
  describe('the sans channel', () => {
    it('registers a handler on the listSans channel', () => {
      const { ipcMain, handlers } = fakeIpcMain();
      registerFontsIpc(ipcMain);
      expect(handlers.has(CHANNELS.fontsListSans)).toBe(true);
    });

    it('answers the families the injected sans lister finds', async () => {
      const { ipcMain, handlers } = fakeIpcMain();
      registerFontsIpc(ipcMain, undefined, () => ['Futura', 'Optima']);
      const result = await handlers.get(CHANNELS.fontsListSans)?.({});
      expect(result).toEqual(['Futura', 'Optima']);
    });

    it('answers an empty list rather than throwing when the sans lister itself throws', async () => {
      const { ipcMain, handlers } = fakeIpcMain();
      registerFontsIpc(ipcMain, undefined, () => {
        throw new Error('no /System on this box');
      });
      await expect(handlers.get(CHANNELS.fontsListSans)?.({})).resolves.toEqual([]);
    });

    it('does not disturb the monospace lister’s own default when only the sans one is overridden', async () => {
      const { ipcMain, handlers } = fakeIpcMain();
      registerFontsIpc(
        ipcMain,
        () => ['Menlo'],
        () => ['Futura'],
      );
      expect(await handlers.get(CHANNELS.fontsListMonospace)?.({})).toEqual(['Menlo']);
      expect(await handlers.get(CHANNELS.fontsListSans)?.({})).toEqual(['Futura']);
    });
  });
});
