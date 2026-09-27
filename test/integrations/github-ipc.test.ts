/**
 * The bridge between Settings -> Integrations -> GitHub and the six reads/
 * writes that make it work. Every argument is validated here -- the renderer
 * is the least trusted process in this app -- before it reaches any of the
 * `github-*.ts` readers this wires together.
 */
import { describe, expect, it, vi } from 'vitest';
import { registerGithubIntegrationIpc } from '../../src/main/integrations/ipc.js';
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

function wire(over: Partial<Parameters<typeof registerGithubIntegrationIpc>[1]> = {}) {
  const ipcMain = fakeIpcMain();
  registerGithubIntegrationIpc(ipcMain, {
    authStatus: vi.fn().mockResolvedValue({ kind: 'logged-out' }),
    connectStart: vi.fn().mockResolvedValue(null),
    connectRead: vi.fn().mockResolvedValue({ kind: 'none' }),
    reposList: vi.fn().mockResolvedValue({ kind: 'ok', repos: [] }),
    orgsList: vi.fn().mockResolvedValue({ kind: 'ok', orgs: [] }),
    projectRemotes: vi.fn().mockResolvedValue([]),
    ...over,
  });
  return ipcMain;
}

describe('githubAuthStatus', () => {
  it('answers whatever the injected reader answers', async () => {
    const ipcMain = wire({
      authStatus: vi.fn().mockResolvedValue({ kind: 'logged-in', accounts: [] }),
    });
    expect(await ipcMain.invoke(CHANNELS.githubAuthStatus)).toEqual({
      kind: 'logged-in',
      accounts: [],
    });
  });
});

describe('githubConnectStart', () => {
  it('accepts exactly login or logout', async () => {
    const connectStart = vi.fn().mockResolvedValue(null);
    const ipcMain = wire({ connectStart });
    expect(await ipcMain.invoke(CHANNELS.githubConnectStart, 'login')).toBeNull();
    expect(connectStart).toHaveBeenCalledWith('login');
  });

  it('refuses anything that is not the two known kinds, before it reaches the pane', async () => {
    const connectStart = vi.fn().mockResolvedValue(null);
    const ipcMain = wire({ connectStart });
    for (const bad of ['delete', 'LOGIN', '', 7, null, undefined]) {
      const result = await ipcMain.invoke(CHANNELS.githubConnectStart, bad);
      expect(result, JSON.stringify(bad)).toMatchObject({ kind: 'refused' });
    }
    expect(connectStart).not.toHaveBeenCalled();
  });
});

describe('githubReposList', () => {
  it('passes a string owner through', async () => {
    const reposList = vi.fn().mockResolvedValue({ kind: 'ok', repos: ['juzser/vam'] });
    const ipcMain = wire({ reposList });
    expect(await ipcMain.invoke(CHANNELS.githubReposList, 'juzser')).toEqual({
      kind: 'ok',
      repos: ['juzser/vam'],
    });
    expect(reposList).toHaveBeenCalledWith('juzser');
  });

  it('refuses a non-string owner before it reaches gh argv', async () => {
    const reposList = vi.fn().mockResolvedValue({ kind: 'ok', repos: [] });
    const ipcMain = wire({ reposList });
    for (const bad of [7, null, undefined, {}, []]) {
      const result = await ipcMain.invoke(CHANNELS.githubReposList, bad);
      expect(result, JSON.stringify(bad)).toMatchObject({ kind: 'error' });
    }
    expect(reposList).not.toHaveBeenCalled();
  });
});

describe('githubProjectRemotes', () => {
  it('refuses a non-string project id', async () => {
    const projectRemotes = vi.fn().mockResolvedValue([]);
    const ipcMain = wire({ projectRemotes });
    expect(await ipcMain.invoke(CHANNELS.githubProjectRemotes, 7)).toEqual([]);
    expect(projectRemotes).not.toHaveBeenCalled();
  });
});

describe('the two-argument channels never reach for more than they need', () => {
  it('githubConnectRead and githubOrgsList take no argument at all', async () => {
    const connectRead = vi.fn().mockResolvedValue({ kind: 'none' });
    const orgsList = vi.fn().mockResolvedValue({ kind: 'ok', orgs: [] });
    const ipcMain = wire({ connectRead, orgsList });
    await ipcMain.invoke(CHANNELS.githubConnectRead);
    await ipcMain.invoke(CHANNELS.githubOrgsList);
    expect(connectRead).toHaveBeenCalledWith();
    expect(orgsList).toHaveBeenCalledWith();
  });
});
