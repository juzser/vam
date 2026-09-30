/**
 * `registerUpdateIpc`: thin handlers over the controller. The controller is a
 * fake in every test here, so nothing touches the network or the disk.
 */

import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import type { UpdateController } from '../../src/main/update/controller.js';
import { registerUpdateIpc } from '../../src/main/update/ipc.js';
import type { UpdateStatus } from '../../src/shared/update.js';

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    handlers,
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
  version: '0.2.0',
  notesUrl: 'https://github.com/juzser/vam/releases/tag/v0.2.0',
};

function fakeController(status: UpdateStatus = AVAILABLE) {
  let autoCheck = true;
  const controller = {
    getStatus: vi.fn(() => status),
    check: vi.fn(async () => status),
    download: vi.fn(async () => status),
    dismiss: vi.fn(async () => ({ kind: 'idle' }) as UpdateStatus),
    setAutoCheck: vi.fn(async (b: boolean) => {
      autoCheck = b;
    }),
    getAutoCheck: vi.fn(() => autoCheck),
    getLastCheckAt: vi.fn((): number | null => 1_700_000_000_000),
    openNotes: vi.fn(async () => true),
  };
  return { controller: controller as unknown as UpdateController, spies: controller };
}

describe('registerUpdateIpc', () => {
  it('registers exactly the update channels, and not the removed recheck', () => {
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(ipcMain, fakeController().controller);
    expect([...ipcMain.handlers.keys()].sort()).toEqual(
      [
        CHANNELS.updateGetStatus,
        CHANNELS.updateCheck,
        CHANNELS.updateDownload,
        CHANNELS.updateDismiss,
        CHANNELS.updateGetAutoCheck,
        CHANNELS.updateSetAutoCheck,
        CHANNELS.updateGetLastCheck,
        CHANNELS.updateOpen,
      ].sort(),
    );
    expect(Object.keys(CHANNELS)).not.toContain('updateRecheck');
  });

  it('getStatus reads the status without checking anything', async () => {
    const ipcMain = fakeIpcMain();
    const { controller, spies } = fakeController();
    registerUpdateIpc(ipcMain, controller);
    expect(await ipcMain.invoke(CHANNELS.updateGetStatus)).toEqual(AVAILABLE);
    expect(spies.check).not.toHaveBeenCalled();
  });

  it('check is always a MANUAL check', async () => {
    const ipcMain = fakeIpcMain();
    const { controller, spies } = fakeController();
    registerUpdateIpc(ipcMain, controller);
    expect(await ipcMain.invoke(CHANNELS.updateCheck, { manual: false })).toEqual(AVAILABLE);
    expect(spies.check).toHaveBeenCalledWith({ manual: true });
  });

  it('download and dismiss answer the resulting status and take no arguments', async () => {
    const ipcMain = fakeIpcMain();
    const { controller, spies } = fakeController();
    registerUpdateIpc(ipcMain, controller);
    expect(await ipcMain.invoke(CHANNELS.updateDownload, 'https://evil.invalid/x')).toEqual(
      AVAILABLE,
    );
    expect(spies.download).toHaveBeenCalledWith();
    expect(await ipcMain.invoke(CHANNELS.updateDismiss)).toEqual({ kind: 'idle' });
  });

  it('a controller that rejects never breaks the channel', async () => {
    const ipcMain = fakeIpcMain();
    const { controller, spies } = fakeController();
    spies.check.mockRejectedValueOnce(new Error('boom'));
    spies.download.mockRejectedValueOnce(new Error('boom'));
    registerUpdateIpc(ipcMain, controller);
    expect(await ipcMain.invoke(CHANNELS.updateCheck)).toEqual(AVAILABLE);
    expect(await ipcMain.invoke(CHANNELS.updateDownload)).toEqual(AVAILABLE);
  });

  it('getLastCheck answers the stored time of the last check', async () => {
    const ipcMain = fakeIpcMain();
    registerUpdateIpc(ipcMain, fakeController().controller);
    expect(await ipcMain.invoke(CHANNELS.updateGetLastCheck)).toBe(1_700_000_000_000);
  });

  it('auto-check round-trips a boolean and refuses anything else', async () => {
    const ipcMain = fakeIpcMain();
    const { controller, spies } = fakeController();
    registerUpdateIpc(ipcMain, controller);
    expect(await ipcMain.invoke(CHANNELS.updateGetAutoCheck)).toBe(true);
    expect(await ipcMain.invoke(CHANNELS.updateSetAutoCheck, false)).toBe(false);
    expect(spies.setAutoCheck).toHaveBeenCalledWith(false);
    expect(await ipcMain.invoke(CHANNELS.updateSetAutoCheck, 'no')).toBe(false);
    expect(spies.setAutoCheck).toHaveBeenCalledTimes(1);
  });

  it('open asks the controller for the release notes and takes no URL from the renderer', async () => {
    const ipcMain = fakeIpcMain();
    const { controller, spies } = fakeController();
    registerUpdateIpc(ipcMain, controller);
    expect(await ipcMain.invoke(CHANNELS.updateOpen, 'https://example.invalid/evil')).toBe(true);
    expect(spies.openNotes).toHaveBeenCalledWith();
  });
});
