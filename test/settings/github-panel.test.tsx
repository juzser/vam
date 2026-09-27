// @vitest-environment happy-dom

/**
 * Settings -> Integrations -> GitHub: status, Connect/Disconnect through a
 * pane, and the per-project repo picker.
 *
 * Operator: "add an Integrations section in Settings, to connect a GitHub
 * account and select a repo." vam stores no token of its own -- `gh` keeps it
 * in the Keychain -- so every act here is a read of `gh`'s own answer or a
 * write main types into a pane the operator watches.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubApi } from '../../src/preload/api.js';
import { EMPTY_PREFS, setProjectPrRepo } from '../../src/renderer/prefs/prefs.js';
import { GithubPanel, type GithubPanelProps } from '../../src/renderer/settings/GithubPanel.js';
import type { GithubAuthStatus } from '../../src/shared/github.js';

afterEach(cleanup);

const status = () => document.querySelector('[data-github-status]')?.textContent ?? '';
const recheck = () => document.querySelector<HTMLButtonElement>('[data-github-recheck]');
const connect = () => document.querySelector<HTMLButtonElement>('[data-github-connect]');
const disconnect = () => document.querySelector<HTMLButtonElement>('[data-github-disconnect]');
const disconnectConfirm = () =>
  document.querySelector<HTMLButtonElement>('[data-github-disconnect-confirm]');
const disconnectCancel = () =>
  document.querySelector<HTMLButtonElement>('[data-github-disconnect-cancel]');
const copyCommand = () => document.querySelector<HTMLButtonElement>('[data-github-copy-command]');
const paneText = () => document.querySelector('[data-github-pane]')?.textContent ?? '';
const scopesWarning = () =>
  document.querySelector('[data-github-scopes-warning]')?.textContent ?? '';
const repoCurrent = () => document.querySelector('[data-github-repo-current]')?.textContent ?? '';
const repoClear = () => document.querySelector<HTMLButtonElement>('[data-github-repo-clear]');
const repoChange = () => document.querySelector<HTMLButtonElement>('[data-github-repo-change]');
const searchInput = () => document.querySelector<HTMLInputElement>('[data-github-repo-search]');
const searchButton = () =>
  document.querySelector<HTMLButtonElement>('[data-github-repo-search-button]');
const candidateButtons = () => [
  ...document.querySelectorAll<HTMLButtonElement>('[data-github-repo-candidate]'),
];

const LOGGED_OUT: GithubAuthStatus = { kind: 'logged-out' };

function fakeApi(over: Partial<GithubApi> = {}): GithubApi {
  return {
    authStatus: vi.fn(async () => LOGGED_OUT),
    connectStart: vi.fn(async () => null),
    connectRead: vi.fn(async () => ({ kind: 'none' }) as const),
    reposList: vi.fn(async () => ({ kind: 'ok', repos: [] }) as const),
    orgsList: vi.fn(async () => ({ kind: 'ok', orgs: [] }) as const),
    projectRemotes: vi.fn(async () => []),
    ...over,
  };
}

const PROJECTS: GithubPanelProps['projects'] = [{ id: 'p1', source: 'claude-code', name: 'vam' }];

function setup(over: Partial<GithubPanelProps> = {}) {
  const onChange = vi.fn();
  const props: GithubPanelProps = {
    api: fakeApi(),
    active: true,
    prefs: EMPTY_PREFS,
    onChange,
    projects: PROJECTS,
    ...over,
  };
  render(<GithubPanel {...props} />);
  return { onChange, props };
}

describe('status', () => {
  it('asks once on mount, and draws the answer', async () => {
    const api = fakeApi({
      authStatus: vi.fn(
        async () =>
          ({
            kind: 'logged-in',
            accounts: [
              {
                host: 'github.com',
                login: 'octocat',
                active: true,
                tokenSource: 'keyring',
                scopes: ['repo'],
                missingScopes: [],
              },
            ],
          }) satisfies GithubAuthStatus,
      ),
    });
    setup({ api });
    await waitFor(() => expect(status()).toMatch(/octocat/));
    expect(api.authStatus).toHaveBeenCalledTimes(1);
  });

  it('says gh is missing, with nothing further to press', async () => {
    const api = fakeApi({
      authStatus: vi.fn(
        async () => ({ kind: 'cli-missing', message: 'not found' }) satisfies GithubAuthStatus,
      ),
    });
    setup({ api });
    await waitFor(() => expect(status().toLowerCase()).toMatch(/not installed|gh/));
    expect(connect()).toBeNull();
  });

  it('says not logged in, and offers Connect', async () => {
    setup();
    await waitFor(() => expect(status().toLowerCase()).toMatch(/not logged in/));
    expect(connect()).not.toBeNull();
  });

  it('re-checks on request', async () => {
    const api = fakeApi();
    setup({ api });
    await waitFor(() => expect(api.authStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(recheck() as HTMLElement);
    await waitFor(() => expect(api.authStatus).toHaveBeenCalledTimes(2));
  });

  it('warns about a missing scope the PR features need', async () => {
    const api = fakeApi({
      authStatus: vi.fn(
        async () =>
          ({
            kind: 'logged-in',
            accounts: [
              {
                host: 'github.com',
                login: 'octocat',
                active: true,
                tokenSource: 'keyring',
                scopes: ['gist'],
                missingScopes: ['repo'],
              },
            ],
          }) satisfies GithubAuthStatus,
      ),
    });
    setup({ api });
    await waitFor(() => expect(scopesWarning()).toMatch(/repo/));
  });

  it('draws no scopes warning when nothing is missing', async () => {
    const api = fakeApi({
      authStatus: vi.fn(
        async () =>
          ({
            kind: 'logged-in',
            accounts: [
              {
                host: 'github.com',
                login: 'octocat',
                active: true,
                tokenSource: 'keyring',
                scopes: ['repo', 'read:org', 'gist'],
                missingScopes: [],
              },
            ],
          }) satisfies GithubAuthStatus,
      ),
    });
    setup({ api });
    await waitFor(() => expect(status()).toMatch(/octocat/));
    expect(document.querySelector('[data-github-scopes-warning]')).toBeNull();
  });
});

describe('Connect', () => {
  it('starts the pane and shows its screen while it runs', async () => {
    const api = fakeApi({
      connectStart: vi.fn(async () => null),
      connectRead: vi.fn(
        async () => ({ kind: 'ok', text: 'a device code', authKind: 'login' }) as const,
      ),
    });
    setup({ api });
    await waitFor(() => expect(connect()).not.toBeNull());
    fireEvent.click(connect() as HTMLElement);
    await waitFor(() => expect(api.connectStart).toHaveBeenCalledWith('login'));
    await waitFor(() => expect(paneText()).toContain('a device code'));
  });

  it('re-checks status once the pane reports it ended', async () => {
    let reads = 0;
    const api = fakeApi({
      connectStart: vi.fn(async () => null),
      connectRead: vi.fn(async () => {
        reads += 1;
        return reads === 1
          ? ({ kind: 'ok', text: 'signing in', authKind: 'login' } as const)
          : ({ kind: 'ended' } as const);
      }),
    });
    setup({ api });
    await waitFor(() => expect(connect()).not.toBeNull());
    fireEvent.click(connect() as HTMLElement);
    await waitFor(() => expect(paneText()).toContain('signing in'));
    await waitFor(() => expect(api.authStatus).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  it('offers Copy command with the exact fixed string', async () => {
    const copyText = vi.fn(async () => true);
    setup({ copyText });
    await waitFor(() => expect(copyCommand()).not.toBeNull());
    fireEvent.click(copyCommand() as HTMLElement);
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('gh auth login --web -h github.com'));
  });
});

describe('Disconnect', () => {
  const LOGGED_IN: GithubAuthStatus = {
    kind: 'logged-in',
    accounts: [
      {
        host: 'github.com',
        login: 'octocat',
        active: true,
        tokenSource: 'keyring',
        scopes: ['repo'],
        missingScopes: [],
      },
    ],
  };

  it('never runs without a confirm', async () => {
    const api = fakeApi({ authStatus: vi.fn(async () => LOGGED_IN) });
    setup({ api });
    await waitFor(() => expect(disconnect()).not.toBeNull());
    fireEvent.click(disconnect() as HTMLElement);
    expect(api.connectStart).not.toHaveBeenCalled();
    expect(disconnectConfirm()).not.toBeNull();
  });

  it('cancel leaves the account alone', async () => {
    const api = fakeApi({ authStatus: vi.fn(async () => LOGGED_IN) });
    setup({ api });
    await waitFor(() => expect(disconnect()).not.toBeNull());
    fireEvent.click(disconnect() as HTMLElement);
    fireEvent.click(disconnectCancel() as HTMLElement);
    expect(disconnectConfirm()).toBeNull();
    expect(api.connectStart).not.toHaveBeenCalled();
  });

  it('confirm runs `gh auth logout` in a pane', async () => {
    const api = fakeApi({
      authStatus: vi.fn(async () => LOGGED_IN),
      connectStart: vi.fn(async () => null),
    });
    setup({ api });
    await waitFor(() => expect(disconnect()).not.toBeNull());
    fireEvent.click(disconnect() as HTMLElement);
    fireEvent.click(disconnectConfirm() as HTMLElement);
    await waitFor(() => expect(api.connectStart).toHaveBeenCalledWith('logout'));
  });
});

describe('the per-project repo picker', () => {
  it('says which repo a project reads from, and offers no control with no project', async () => {
    setup({ projects: [] });
    await waitFor(() => expect(status()).not.toBe(''));
    expect(document.querySelector('[data-github-repo-current]')).toBeNull();
  });

  it('reads "this project’s own" when nothing is overridden', async () => {
    setup();
    await waitFor(() => expect(repoCurrent()).toMatch(/own/i));
    expect(repoClear()).toBeNull();
  });

  it('names the override, and offers Clear once one is set', async () => {
    const prefs = setProjectPrRepo(EMPTY_PREFS, 'claude-code', 'p1', '/Users/x/code/other-vam');
    setup({ prefs });
    await waitFor(() => expect(repoCurrent()).toMatch(/other-vam/));
    expect(repoClear()).not.toBeNull();
  });

  it('Clear writes the prefs back to unset', async () => {
    const prefs = setProjectPrRepo(EMPTY_PREFS, 'claude-code', 'p1', '/Users/x/code/other-vam');
    const { onChange } = setup({ prefs });
    await waitFor(() => expect(repoClear()).not.toBeNull());
    fireEvent.click(repoClear() as HTMLElement);
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]?.[0];
    expect(next.prRepos['claude-code']?.p1).toBeUndefined();
  });

  it('shows the project’s own remotes as the first suggestions', async () => {
    const api = fakeApi({
      projectRemotes: vi.fn(async () => [{ name: 'origin', repo: 'juzser/vam' }]),
    });
    setup({ api });
    fireEvent.click(repoChange() as HTMLElement);
    await waitFor(() =>
      expect(candidateButtons().map((b) => b.textContent)).toContain('juzser/vam'),
    );
  });

  it('picking the project’s own remote clears the override', async () => {
    const api = fakeApi({
      projectRemotes: vi.fn(async () => [{ name: 'origin', repo: 'juzser/vam' }]),
    });
    const prefs = setProjectPrRepo(EMPTY_PREFS, 'claude-code', 'p1', '/elsewhere');
    const { onChange } = setup({ api, prefs });
    fireEvent.click(repoChange() as HTMLElement);
    await waitFor(() => expect(candidateButtons().length).toBeGreaterThan(0));
    fireEvent.click(candidateButtons()[0] as HTMLElement);
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.prRepos['claude-code']?.p1).toBeUndefined();
  });

  it('picking a different repo opens the directory chooser and stores what was picked', async () => {
    const api = fakeApi({
      reposList: vi.fn(async () => ({ kind: 'ok', repos: ['juzser/blacksmith'] }) as const),
    });
    const chooseDirectory = vi.fn(async () => '/Users/x/code/blacksmith');
    const { onChange } = setup({ api, chooseDirectory });
    fireEvent.click(repoChange() as HTMLElement);
    fireEvent.change(searchInput() as HTMLElement, { target: { value: 'juzser' } });
    fireEvent.click(searchButton() as HTMLElement);
    await waitFor(() => expect(api.reposList).toHaveBeenCalledWith('juzser'));
    await waitFor(() =>
      expect(candidateButtons().map((b) => b.textContent)).toContain('juzser/blacksmith'),
    );
    fireEvent.click(
      candidateButtons().find((b) => b.textContent === 'juzser/blacksmith') as HTMLElement,
    );
    await waitFor(() => expect(chooseDirectory).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const next = onChange.mock.calls.at(-1)?.[0];
      expect(next.prRepos['claude-code']?.p1).toBe('/Users/x/code/blacksmith');
    });
  });

  it('a cancelled directory chooser writes nothing', async () => {
    const api = fakeApi({
      reposList: vi.fn(async () => ({ kind: 'ok', repos: ['juzser/blacksmith'] }) as const),
    });
    const chooseDirectory = vi.fn(async () => null);
    const { onChange } = setup({ api, chooseDirectory });
    fireEvent.click(repoChange() as HTMLElement);
    fireEvent.change(searchInput() as HTMLElement, { target: { value: 'juzser' } });
    fireEvent.click(searchButton() as HTMLElement);
    await waitFor(() =>
      expect(candidateButtons().map((b) => b.textContent)).toContain('juzser/blacksmith'),
    );
    fireEvent.click(
      candidateButtons().find((b) => b.textContent === 'juzser/blacksmith') as HTMLElement,
    );
    await waitFor(() => expect(chooseDirectory).toHaveBeenCalledTimes(1));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('validates a search owner before it leaves this component: an empty search does nothing', async () => {
    const api = fakeApi();
    setup({ api });
    fireEvent.click(repoChange() as HTMLElement);
    fireEvent.click(searchButton() as HTMLElement);
    expect(api.reposList).not.toHaveBeenCalled();
  });
});
