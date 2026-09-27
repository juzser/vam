/**
 * The renderer's one route into `main/zoom-state.ts`: the UI zoom preference,
 * pushed on every read and write of `prefs` (`activatePrefs`'s own "one
 * preference crosses into main" paragraph — `setPrRepos` is the precedent
 * this follows) and on every chord press.
 *
 * MAIN TRUSTS NOTHING THE RENDERER SENDS: the handler re-clamps through
 * `setZoomPercent` regardless of what the renderer already clamped, the same
 * rule `setPrRepoOverrides` states for its own argument.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import type { IpcMainLike } from '../../src/main/ipc/handlers.js';
import { registerZoomIpc } from '../../src/main/zoom-ipc.js';
import { currentZoomFactor, setZoomPercent } from '../../src/main/zoom-state.js';
import { DEFAULT_UI_ZOOM, UI_ZOOM_MAX } from '../../src/shared/ui-zoom.js';

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  };
  return { ipcMain, handlers };
}

describe('registerZoomIpc', () => {
  beforeEach(() => {
    setZoomPercent(DEFAULT_UI_ZOOM);
  });

  it('registers a handler on the setUiZoom channel', () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerZoomIpc(ipcMain);
    expect(handlers.has(CHANNELS.setUiZoom)).toBe(true);
  });

  it('clamps and stores the percent, so the NEXT window created reads it too', async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerZoomIpc(ipcMain);
    const sender = { setZoomFactor: vi.fn() };
    await handlers.get(CHANNELS.setUiZoom)?.({ sender }, 120);
    expect(currentZoomFactor()).toBe(1.2);
  });

  it('applies it to the CALLING window immediately, as a factor', async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerZoomIpc(ipcMain);
    const sender = { setZoomFactor: vi.fn() };
    await handlers.get(CHANNELS.setUiZoom)?.({ sender }, 130);
    expect(sender.setZoomFactor).toHaveBeenCalledWith(1.3);
  });

  it('re-clamps a value the renderer should already have clamped', async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerZoomIpc(ipcMain);
    const sender = { setZoomFactor: vi.fn() };
    await handlers.get(CHANNELS.setUiZoom)?.({ sender }, 99999);
    expect(sender.setZoomFactor).toHaveBeenCalledWith(UI_ZOOM_MAX / 100);
    expect(currentZoomFactor()).toBe(UI_ZOOM_MAX / 100);
  });

  it('answers ok, with no value — a preference push, not a read', async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerZoomIpc(ipcMain);
    const result = await handlers.get(CHANNELS.setUiZoom)?.(
      { sender: { setZoomFactor: vi.fn() } },
      100,
    );
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('does not throw when the event carries no sender at all', async () => {
    const { ipcMain, handlers } = fakeIpcMain();
    registerZoomIpc(ipcMain);
    await expect(handlers.get(CHANNELS.setUiZoom)?.({}, 100)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
  });
});
