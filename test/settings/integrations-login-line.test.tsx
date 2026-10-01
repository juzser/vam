// @vitest-environment happy-dom

/**
 * Operator event #41: a logged-in Integrations block said "logged in as"
 * twice -- the status sentence and the account line. The account line is the
 * one that stays (EC-49); the sentence has no logged-in branch, and neither
 * provider's host is shown while logged in (OQ29).
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubApi, GitlabApi } from '../../src/preload/api.js';
import { GithubPanel } from '../../src/renderer/settings/GithubPanel.js';
import { GitlabPanel } from '../../src/renderer/settings/GitlabPanel.js';
import type { GithubAuthStatus } from '../../src/shared/github.js';
import type { GitlabAuthStatus } from '../../src/shared/gitlab.js';

afterEach(cleanup);

const githubApi = (status: GithubAuthStatus): GithubApi => ({
  authStatus: vi.fn(async () => status),
  connectStart: vi.fn(async () => null),
  connectRead: vi.fn(async () => ({ kind: 'none' }) as const),
  reposList: vi.fn(async () => ({ kind: 'ok', repos: [] }) as const),
  orgsList: vi.fn(async () => ({ kind: 'ok', orgs: [] }) as const),
  projectRemotes: vi.fn(async () => []),
});

const gitlabApi = (status: GitlabAuthStatus): GitlabApi => ({
  authStatus: vi.fn(async () => status),
  connectStart: vi.fn(async () => null),
  connectRead: vi.fn(async () => ({ kind: 'none' }) as const),
});

const GITHUB_IN: GithubAuthStatus = {
  kind: 'logged-in',
  accounts: [
    {
      host: 'ghe.example.com',
      login: 'octocat',
      active: true,
      tokenSource: 'keyring',
      scopes: ['repo'],
      missingScopes: [],
    },
  ],
};
const GITLAB_IN: GitlabAuthStatus = {
  kind: 'logged-in',
  accounts: [{ host: 'gitlab.example.com', login: 'octocat' }],
};

const count = (text: string) => (text.toLowerCase().match(/logged in as/g) ?? []).length;

describe.each([
  {
    name: 'github',
    mount: () => render(<GithubPanel api={githubApi(GITHUB_IN)} active={true} />),
    host: 'ghe.example.com',
  },
  {
    name: 'gitlab',
    mount: () => render(<GitlabPanel api={gitlabApi(GITLAB_IN)} active={true} />),
    host: 'gitlab.example.com',
  },
])('$name logged-in block', ({ name, mount, host }) => {
  it('says "logged in as" exactly once, in the account line naming the account', async () => {
    const { container } = mount();
    await waitFor(() =>
      expect(
        container
          .querySelector(`[data-${name}-status-pill]`)
          ?.getAttribute(`data-${name}-status-pill`),
      ).toBe('connected'),
    );
    expect(count(container.textContent ?? '')).toBe(1);
    const line = container.querySelector(`[data-${name}-account-line]`);
    expect(line).not.toBeNull();
    expect(count(line?.textContent ?? '')).toBe(1);
    expect(line?.textContent).toContain('octocat');
    expect(line?.textContent?.toLowerCase()).not.toContain(' on ');
  });

  it('draws no status sentence row and no host while logged in', async () => {
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelector(`[data-${name}-account-line]`)).not.toBeNull(),
    );
    expect(container.querySelector(`[data-${name}-status]`)).toBeNull();
    expect(container.textContent).not.toContain(host);
  });
});

describe('pins: other states are unchanged', () => {
  it('github logged-out keeps its sentence and the pill', async () => {
    const { container } = render(
      <GithubPanel api={githubApi({ kind: 'logged-out' })} active={true} />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-github-status]')?.textContent?.toLowerCase()).toMatch(
        /not logged in/,
      ),
    );
    expect(container.querySelector('[data-github-status-pill]')).not.toBeNull();
  });

  it('gitlab logged-out keeps its sentence and the pill', async () => {
    const { container } = render(
      <GitlabPanel api={gitlabApi({ kind: 'logged-out' })} active={true} />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-gitlab-status]')?.textContent?.toLowerCase()).toMatch(
        /not logged in/,
      ),
    );
    expect(container.querySelector('[data-gitlab-status-pill]')).not.toBeNull();
  });
});
