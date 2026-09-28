/**
 * The bridge between Settings -> Integrations -> GitLab and its three reads/
 * writes -- `github-ipc.test.ts`'s own corpus, mirrored: every argument is
 * validated here before it reaches `gitlab-status.ts`/`gitlab-pane.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { registerGitlabIntegrationIpc } from '../../src/main/integrations/gitlab-ipc.js';
import { CHANNELS } from '../../src/main/ipc/channels.js';

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(channel, listener);
    },
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error(`no handler for ${channel}`);
      return await handler({}, ...args);
    },
  };
}

function wire(over: Partial<Parameters<typeof registerGitlabIntegrationIpc>[1]> = {}) {
  const ipcMain = fakeIpcMain();
  registerGitlabIntegrationIpc(ipcMain, {
    authStatus: vi.fn().mockResolvedValue({ kind: 'logged-out' }),
    connectStart: vi.fn().mockResolvedValue(null),
    connectRead: vi.fn().mockResolvedValue({ kind: 'none' }),
    ...over,
  });
  return ipcMain;
}

describe('glabAuthStatus', () => {
  it('answers whatever the injected reader answers', async () => {
    const ipcMain = wire({
      authStatus: vi.fn().mockResolvedValue({ kind: 'logged-in', accounts: [] }),
    });
    expect(await ipcMain.invoke(CHANNELS.glabAuthStatus)).toEqual({
      kind: 'logged-in',
      accounts: [],
    });
  });
});

describe('glabConnectStart', () => {
  it('accepts exactly login or logout', async () => {
    const connectStart = vi.fn().mockResolvedValue(null);
    const ipcMain = wire({ connectStart });
    expect(await ipcMain.invoke(CHANNELS.glabConnectStart, 'login')).toBeNull();
    expect(connectStart).toHaveBeenCalledWith('login');
  });

  it('refuses anything that is not the two known kinds, before it reaches the pane', async () => {
    const connectStart = vi.fn().mockResolvedValue(null);
    const ipcMain = wire({ connectStart });
    for (const bad of ['delete', 'LOGIN', '', 7, null, undefined]) {
      const result = await ipcMain.invoke(CHANNELS.glabConnectStart, bad);
      expect(result, JSON.stringify(bad)).toMatchObject({ kind: 'refused' });
    }
    expect(connectStart).not.toHaveBeenCalled();
  });
});

describe('glabConnectRead takes no argument at all', () => {
  it('forwards to the injected reader with no arguments', async () => {
    const connectRead = vi.fn().mockResolvedValue({ kind: 'none' });
    const ipcMain = wire({ connectRead });
    await ipcMain.invoke(CHANNELS.glabConnectRead);
    expect(connectRead).toHaveBeenCalledWith();
  });
});
