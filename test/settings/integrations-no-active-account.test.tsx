// @vitest-environment happy-dom

/**
 * Settings -> Integrations, a logged-in status with no active account
 * (operator decision, epic event #418). GitHub: logged-in accounts, none
 * active. GitLab: logged-in with an empty account list. Both draw a warning
 * pill and one prompt line instead of "Connected" with nothing under it.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubApi, GitlabApi } from '../../src/preload/api.js';
import { GithubPanel } from '../../src/renderer/settings/GithubPanel.js';
import { GitlabPanel } from '../../src/renderer/settings/GitlabPanel.js';
import type { GithubAuthStatus } from '../../src/shared/github.js';
import type { GitlabAuthStatus } from '../../src/shared/gitlab.js';

afterEach(cleanup);

const q = (sel: string) => document.querySelector(sel);

function ghAccount(login: string, active: boolean) {
  return {
    host: 'github.com',
    login,
    active,
    tokenSource: 'keyring',
    scopes: ['repo'],
    missingScopes: [],
  };
}

function renderGithub(status: GithubAuthStatus) {
  const api: GithubApi = {
    authStatus: vi.fn(async () => status),
    connectStart: vi.fn(async () => null),
    connectRead: vi.fn(async () => ({ kind: 'none' }) as const),
    reposList: vi.fn(async () => ({ kind: 'ok', repos: [] }) as const),
    orgsList: vi.fn(async () => ({ kind: 'ok', orgs: [] }) as const),
    projectRemotes: vi.fn(async () => []),
  };
  render(<GithubPanel api={api} active={true} />);
  return waitFor(() => expect(q('[data-github-status-pill]')).not.toBeNull());
}

function renderGitlab(status: GitlabAuthStatus) {
  const api: GitlabApi = {
    authStatus: vi.fn(async () => status),
    connectStart: vi.fn(async () => null),
    connectRead: vi.fn(async () => ({ kind: 'none' }) as const),
  };
  render(<GitlabPanel api={api} active={true} />);
  return waitFor(() => expect(q('[data-gitlab-status-pill]')).not.toBeNull());
}

describe('EC-71 no active account', () => {
  it('GitHub: logged-in accounts, none active', async () => {
    await renderGithub({
      kind: 'logged-in',
      accounts: [ghAccount('a', false), ghAccount('b', false)],
    });
    const pill = q('[data-github-status-pill]');
    expect(pill?.getAttribute('data-github-status-pill')).toBe('no-active-account');
    expect(pill?.textContent).toBe('No active account');
    expect(pill?.className).toContain('text-waiting');
    expect(pill?.className).toContain('border-waiting-tint');
    expect(q('[data-github-no-active-account]')?.textContent).toBe(
      'No active account — select one',
    );
    expect(q('[data-github-account-line]')).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain('not logged in');
    expect(q('[data-github-disconnect]')).not.toBeNull();
    expect(q('[data-github-connect]')).toBeNull();
  });

  it('GitLab: logged-in with an empty account list', async () => {
    await renderGitlab({ kind: 'logged-in', accounts: [] });
    const pill = q('[data-gitlab-status-pill]');
    expect(pill?.getAttribute('data-gitlab-status-pill')).toBe('no-active-account');
    expect(pill?.textContent).toBe('No active account');
    expect(pill?.className).toContain('text-waiting');
    expect(pill?.className).toContain('border-waiting-tint');
    expect(q('[data-gitlab-no-active-account]')?.textContent).toBe(
      'No active account — select one',
    );
    expect(q('[data-gitlab-account-line]')).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain('not logged in');
    expect(q('[data-gitlab-connect]')).not.toBeNull();
    expect(q('[data-gitlab-disconnect]')).toBeNull();
  });
});

describe('EC-71b pins, nothing else moves', () => {
  it('GitHub: an active account draws connected and the account line', async () => {
    await renderGithub({ kind: 'logged-in', accounts: [ghAccount('octocat', true)] });
    expect(q('[data-github-status-pill]')?.getAttribute('data-github-status-pill')).toBe(
      'connected',
    );
    expect(q('[data-github-account-line]')?.textContent).toContain('octocat');
    expect(q('[data-github-no-active-account]')).toBeNull();
  });

  it('GitLab: one account draws connected and the account line', async () => {
    await renderGitlab({ kind: 'logged-in', accounts: [{ host: 'gitlab.com', login: 'tanuki' }] });
    expect(q('[data-gitlab-status-pill]')?.getAttribute('data-gitlab-status-pill')).toBe(
      'connected',
    );
    expect(q('[data-gitlab-account-line]')?.textContent).toContain('tanuki');
    expect(q('[data-gitlab-no-active-account]')).toBeNull();
  });

  it('GitHub: logged-out and cli-missing are unchanged', async () => {
    await renderGithub({ kind: 'logged-out' });
    expect(q('[data-github-status-pill]')?.getAttribute('data-github-status-pill')).toBe(
      'not-connected',
    );
    expect(q('[data-github-status]')?.textContent?.toLowerCase()).toContain('not logged in');
    expect(q('[data-github-no-active-account]')).toBeNull();
    cleanup();
    await renderGithub({ kind: 'cli-missing', message: 'x' });
    expect(q('[data-github-status-pill]')?.getAttribute('data-github-status-pill')).toBe(
      'cli-missing',
    );
    expect(q('[data-github-no-active-account]')).toBeNull();
  });

  it('GitLab: logged-out and cli-missing are unchanged', async () => {
    await renderGitlab({ kind: 'logged-out' });
    expect(q('[data-gitlab-status-pill]')?.getAttribute('data-gitlab-status-pill')).toBe(
      'not-connected',
    );
    expect(q('[data-gitlab-status]')?.textContent?.toLowerCase()).toContain('not logged in');
    expect(q('[data-gitlab-no-active-account]')).toBeNull();
    cleanup();
    await renderGitlab({ kind: 'cli-missing', message: 'x' });
    expect(q('[data-gitlab-status-pill]')?.getAttribute('data-gitlab-status-pill')).toBe(
      'cli-missing',
    );
    expect(q('[data-gitlab-no-active-account]')).toBeNull();
  });
});

describe('branch coverage: pill kind edges and copy command', () => {
  it('GitHub: a mix of active and inactive accounts stays connected', async () => {
    await renderGithub({
      kind: 'logged-in',
      accounts: [ghAccount('a', false), ghAccount('b', true)],
    });
    expect(q('[data-github-status-pill]')?.getAttribute('data-github-status-pill')).toBe(
      'connected',
    );
    expect(q('[data-github-account-line]')?.textContent).toContain('b');
    expect(q('[data-github-no-active-account]')).toBeNull();
  });

  it('GitHub: logged-in with an empty list never draws the prompt line', async () => {
    await renderGithub({ kind: 'logged-in', accounts: [] });
    expect(q('[data-github-status-pill]')?.getAttribute('data-github-status-pill')).not.toBe(
      'no-active-account',
    );
    expect(q('[data-github-no-active-account]')).toBeNull();
  });

  it('GitHub and GitLab: unknown keeps the not-connected pill, no prompt line', async () => {
    await renderGithub({ kind: 'unknown', message: 'boom' });
    expect(q('[data-github-status-pill]')?.getAttribute('data-github-status-pill')).toBe(
      'not-connected',
    );
    expect(q('[data-github-no-active-account]')).toBeNull();
    cleanup();
    await renderGitlab({ kind: 'unknown', message: 'boom' });
    expect(q('[data-gitlab-status-pill]')?.getAttribute('data-gitlab-status-pill')).toBe(
      'not-connected',
    );
    expect(q('[data-gitlab-no-active-account]')).toBeNull();
  });

  it('GitHub no-active-account copies the logout command', async () => {
    const copyText = vi.fn(async () => true);
    const api: GithubApi = {
      authStatus: vi.fn(
        async () =>
          ({
            kind: 'logged-in',
            accounts: [ghAccount('a', false)],
          }) as GithubAuthStatus,
      ),
      connectStart: vi.fn(async () => null),
      connectRead: vi.fn(async () => ({ kind: 'none' }) as const),
      reposList: vi.fn(async () => ({ kind: 'ok', repos: [] }) as const),
      orgsList: vi.fn(async () => ({ kind: 'ok', orgs: [] }) as const),
      projectRemotes: vi.fn(async () => []),
    };
    render(<GithubPanel api={api} active={true} copyText={copyText} />);
    const btn = await waitFor(() => {
      const el = q('[data-github-copy-command]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    btn.click();
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('gh auth logout -h github.com'));
  });

  it('GitLab empty-accounts copies the login command', async () => {
    const copyText = vi.fn(async () => true);
    const api: GitlabApi = {
      authStatus: vi.fn(async () => ({ kind: 'logged-in', accounts: [] }) as GitlabAuthStatus),
      connectStart: vi.fn(async () => null),
      connectRead: vi.fn(async () => ({ kind: 'none' }) as const),
    };
    render(<GitlabPanel api={api} active={true} copyText={copyText} />);
    const btn = await waitFor(() => {
      const el = q('[data-gitlab-copy-command]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    btn.click();
    await waitFor(() =>
      expect(copyText).toHaveBeenCalledWith(expect.stringContaining('glab auth login')),
    );
  });
});
