// @vitest-environment happy-dom

/**
 * Settings -> Integrations -> GitLab: status and Connect/Disconnect through
 * a pane -- `github-panel.test.tsx`'s own corpus, mirrored and narrowed: no
 * repo picker (out of scope, operator's own decision: "GitLab now via glab,
 * Bitbucket later" -- merge requests, PR status and a repo picker were never
 * asked for), no scopes warning (`glab auth status` reports no scopes at
 * all, see `shared/gitlab.ts`'s own header).
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitlabApi } from '../../src/preload/api.js';
import { GitlabPanel, type GitlabPanelProps } from '../../src/renderer/settings/GitlabPanel.js';
import type { GitlabAuthStatus } from '../../src/shared/gitlab.js';

afterEach(cleanup);

const status = () => document.querySelector('[data-gitlab-status]')?.textContent ?? '';
const pill = () => document.querySelector('[data-gitlab-status-pill]');
const account = () => document.querySelector('[data-gitlab-account]');
const recheck = () => document.querySelector<HTMLButtonElement>('[data-gitlab-recheck]');
const connect = () => document.querySelector<HTMLButtonElement>('[data-gitlab-connect]');
const disconnect = () => document.querySelector<HTMLButtonElement>('[data-gitlab-disconnect]');
const disconnectConfirm = () =>
  document.querySelector<HTMLButtonElement>('[data-gitlab-disconnect-confirm]');
const disconnectCancel = () =>
  document.querySelector<HTMLButtonElement>('[data-gitlab-disconnect-cancel]');
const copyCommand = () => document.querySelector<HTMLButtonElement>('[data-gitlab-copy-command]');
const paneText = () => document.querySelector('[data-gitlab-pane]')?.textContent ?? '';

const LOGGED_OUT: GitlabAuthStatus = { kind: 'logged-out' };

function fakeApi(over: Partial<GitlabApi> = {}): GitlabApi {
  return {
    authStatus: vi.fn(async () => LOGGED_OUT),
    connectStart: vi.fn(async () => null),
    connectRead: vi.fn(async () => ({ kind: 'none' }) as const),
    ...over,
  };
}

function setup(over: Partial<GitlabPanelProps> = {}) {
  const props: GitlabPanelProps = {
    api: fakeApi(),
    active: true,
    ...over,
  };
  render(<GitlabPanel {...props} />);
}

describe('status', () => {
  it('asks once on mount, and draws the answer', async () => {
    const api = fakeApi({
      authStatus: vi.fn(
        async () =>
          ({
            kind: 'logged-in',
            accounts: [{ host: 'gitlab.com', login: 'octocat' }],
          }) satisfies GitlabAuthStatus,
      ),
    });
    setup({ api });
    await waitFor(() => expect(account()?.textContent).toMatch(/octocat/));
    expect(api.authStatus).toHaveBeenCalledTimes(1);
  });

  it('says glab is missing, with nothing further to press', async () => {
    const api = fakeApi({
      authStatus: vi.fn(
        async () => ({ kind: 'cli-missing', message: 'not found' }) satisfies GitlabAuthStatus,
      ),
    });
    setup({ api });
    await waitFor(() => expect(status().toLowerCase()).toMatch(/not installed|glab/));
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
});

describe('the status pill and "logged in as" line', () => {
  it('reads "glab not installed" when the CLI itself is missing, and draws no account line', async () => {
    const api = fakeApi({
      authStatus: vi.fn(
        async () => ({ kind: 'cli-missing', message: 'not found' }) satisfies GitlabAuthStatus,
      ),
    });
    setup({ api });
    await waitFor(() =>
      expect(pill()?.getAttribute('data-gitlab-status-pill')).toBe('cli-missing'),
    );
    expect(pill()?.textContent).toMatch(/glab not installed/);
    expect(account()).toBeNull();
  });

  it('reads "Not connected" when logged out, and draws no account line', async () => {
    setup();
    await waitFor(() =>
      expect(pill()?.getAttribute('data-gitlab-status-pill')).toBe('not-connected'),
    );
    expect(pill()?.textContent?.toLowerCase()).toMatch(/not connected/);
    expect(account()).toBeNull();
  });

  it('reads "Connected" and names the account when logged in', async () => {
    const api = fakeApi({
      authStatus: vi.fn(
        async () =>
          ({
            kind: 'logged-in',
            accounts: [{ host: 'gitlab.com', login: 'octocat' }],
          }) satisfies GitlabAuthStatus,
      ),
    });
    setup({ api });
    await waitFor(() => expect(pill()?.getAttribute('data-gitlab-status-pill')).toBe('connected'));
    expect(pill()?.textContent?.toLowerCase()).toMatch(/^connected$/);
    expect(account()?.textContent).toMatch(/octocat/);
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

  it('offers Copy command with the exact fixed string, and never a token', async () => {
    const copyText = vi.fn(async () => true);
    setup({ copyText });
    await waitFor(() => expect(copyCommand()).not.toBeNull());
    fireEvent.click(copyCommand() as HTMLElement);
    await waitFor(() =>
      expect(copyText).toHaveBeenCalledWith('glab auth login --hostname gitlab.com --web'),
    );
    expect(copyText.mock.calls.flat().join(' ')).not.toMatch(/glpat-/);
  });
});

describe('Disconnect', () => {
  const LOGGED_IN: GitlabAuthStatus = {
    kind: 'logged-in',
    accounts: [{ host: 'gitlab.com', login: 'octocat' }],
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

  it('confirm runs `glab auth logout` in a pane', async () => {
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

/**
 * THE GITLAB MARK -- `GithubPanel.tsx`'s own "the GitHub mark" corpus,
 * mirrored: Simple Icons, CC0, inlined verbatim, never a baked hex.
 */
describe('the GitLab mark', () => {
  const mark = () => document.querySelector('[data-gitlab-mark]');

  it('draws the official GitLab logo in currentColor, never a baked hex', () => {
    setup();
    expect(mark(), 'no GitLab mark drawn on the card').not.toBeNull();
    const path = mark()?.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('currentColor');
    expect(/#[0-9a-fA-F]{3,8}\b/.test(mark()?.outerHTML ?? '')).toBe(false);
  });

  it('is not a lucide glyph standing in for the brand', () => {
    setup();
    expect(mark()?.classList.contains('lucide')).toBe(false);
  });
});

/**
 * THE GLAB-MISSING GUIDE -- `GithubPanel.tsx`'s own "gh not installed" guide,
 * mirrored: `brew install glab`, a `glab auth login` step, "Check again",
 * and links to brew.sh and the glab CLI's own GitLab project.
 */
describe('the "glab not installed" guide', () => {
  const CLI_MISSING: GitlabAuthStatus = { kind: 'cli-missing', message: 'not found' };

  function setupMissing(over: Partial<GitlabPanelProps> = {}) {
    const api = fakeApi({ authStatus: vi.fn(async () => CLI_MISSING) });
    return setup({ api, ...over });
  }

  const guide = () => document.querySelector('[data-gitlab-cli-guide]');
  const brewCode = () => document.querySelector('[data-gitlab-guide-brew]');
  const loginCode = () => document.querySelector('[data-gitlab-guide-login]');
  const copyBrew = () => document.querySelector<HTMLButtonElement>('[data-gitlab-guide-copy-brew]');
  const checkAgain = () => document.querySelector<HTMLButtonElement>('[data-gitlab-guide-check]');

  it('draws a short guide, the brew command, glab auth login, and a link to the glab CLI project', async () => {
    setupMissing();
    await waitFor(() => expect(guide()).not.toBeNull());
    expect(guide()?.textContent?.toLowerCase()).toMatch(/not installed/);
    expect(brewCode()?.textContent).toBe('brew install glab');
    expect(loginCode()?.textContent).toBe('glab auth login');
    expect(guide()?.querySelector('a[href="https://gitlab.com/gitlab-org/cli"]')).not.toBeNull();
  });

  it('mentions brew.sh for an operator missing Homebrew too', async () => {
    setupMissing();
    await waitFor(() => expect(guide()).not.toBeNull());
    expect(guide()?.querySelector('a[href="https://brew.sh"]')).not.toBeNull();
  });

  it('copies the brew command through the same clipboard path other copy buttons use', async () => {
    const copyText = vi.fn(async () => true);
    setupMissing({ copyText });
    await waitFor(() => expect(copyBrew()).not.toBeNull());
    fireEvent.click(copyBrew() as HTMLElement);
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('brew install glab'));
  });

  it('draws no copy button when no clipboard bridge is wired (the browser build)', async () => {
    setupMissing({ copyText: undefined });
    await waitFor(() => expect(guide()).not.toBeNull());
    expect(copyBrew()).toBeNull();
  });

  it('"Check again" re-runs the same status read the pill already does on mount', async () => {
    const api = fakeApi({ authStatus: vi.fn(async () => CLI_MISSING) });
    setup({ api });
    await waitFor(() => expect(api.authStatus).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(checkAgain()).not.toBeNull());
    fireEvent.click(checkAgain() as HTMLElement);
    await waitFor(() => expect(api.authStatus).toHaveBeenCalledTimes(2));
  });

  it('never renders Connect while glab itself is missing -- nothing to press yet', async () => {
    setupMissing();
    await waitFor(() => expect(guide()).not.toBeNull());
    expect(connect()).toBeNull();
  });

  describe('the guide’s two external links, under a policy that denies window.open', () => {
    const brewLink = () =>
      document.querySelector<HTMLAnchorElement>(
        '[data-gitlab-cli-guide] a[href="https://brew.sh"]',
      );
    const cliLink = () =>
      document.querySelector<HTMLAnchorElement>(
        '[data-gitlab-cli-guide] a[href="https://gitlab.com/gitlab-org/cli"]',
      );

    function setupMissingWithOpen(over: Partial<GitlabPanelProps> = {}) {
      const openExternal = vi.fn(async () => undefined);
      setupMissing({ openExternal, ...over });
      return { openExternal };
    }

    it('keeps a real href, for accessibility and the browser-build fallback', async () => {
      setupMissingWithOpen();
      await waitFor(() => expect(brewLink()).not.toBeNull());
      expect(brewLink()?.getAttribute('href')).toBe('https://brew.sh');
      expect(cliLink()?.getAttribute('href')).toBe('https://gitlab.com/gitlab-org/cli');
    });

    it('asks main to open brew.sh through the bridge, not window.open', async () => {
      const { openExternal } = setupMissingWithOpen();
      await waitFor(() => expect(brewLink()).not.toBeNull());
      fireEvent.click(brewLink() as HTMLElement);
      expect(openExternal).toHaveBeenCalledWith('https://brew.sh');
    });

    it('asks main to open the glab CLI project through the bridge the same way', async () => {
      const { openExternal } = setupMissingWithOpen();
      await waitFor(() => expect(cliLink()).not.toBeNull());
      fireEvent.click(cliLink() as HTMLElement);
      expect(openExternal).toHaveBeenCalledWith('https://gitlab.com/gitlab-org/cli');
    });

    it('stops the navigation the window would refuse anyway', async () => {
      setupMissingWithOpen();
      await waitFor(() => expect(brewLink()).not.toBeNull());
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      brewLink()?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves the link alone where there is no bridge to ask across', async () => {
      setupMissing({ openExternal: undefined });
      await waitFor(() => expect(brewLink()).not.toBeNull());
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      brewLink()?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});

/**
 * NEVER A TOKEN, ANYWHERE ON THE CARD. `shared/gitlab.ts`'s own rule: vam
 * stores no token of its own, and `GitlabAccount` carries no field a token
 * could hide in -- so there is no string on this card that could leak one by
 * being rendered, whatever `authStatus` answers.
 */
describe('tokens never rendered, never logged', () => {
  it('renders nothing token-shaped for a logged-in account', async () => {
    const api = fakeApi({
      authStatus: vi.fn(
        async () =>
          ({
            kind: 'logged-in',
            accounts: [{ host: 'gitlab.com', login: 'octocat' }],
          }) satisfies GitlabAuthStatus,
      ),
    });
    setup({ api });
    await waitFor(() => expect(account()?.textContent).toMatch(/octocat/));
    expect(document.body.textContent ?? '').not.toMatch(/glpat-/);
  });
});
