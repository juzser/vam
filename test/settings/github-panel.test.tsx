// @vitest-environment happy-dom

/**
 * Settings -> Integrations -> GitHub: status, Connect/Disconnect through a
 * pane, and the absence of a repo picker.
 *
 * Operator: "add an Integrations section in Settings, to connect a GitHub
 * account and select a repo." vam stores no token of its own -- `gh` keeps it
 * in the Keychain -- so every act here is a read of `gh`'s own answer or a
 * write main types into a pane the operator watches.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubApi } from '../../src/preload/api.js';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';
import { GithubPanel, type GithubPanelProps } from '../../src/renderer/settings/GithubPanel.js';
import type { GithubAuthStatus } from '../../src/shared/github.js';

afterEach(cleanup);

const status = () => document.querySelector('[data-github-status]')?.textContent ?? '';
const pill = () => document.querySelector('[data-github-status-pill]');
const account = () => document.querySelector('[data-github-account]');
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

function setup(over: Partial<GithubPanelProps> = {}) {
  const props: GithubPanelProps = { api: fakeApi(), active: true, ...over };
  render(<GithubPanel {...props} />);
  return { props };
}

describe('props', () => {
  it('declares only the props it reads (type-level pin)', () => {
    const api = fakeApi();
    render(
      <GithubPanel
        api={api}
        active={false}
        // @ts-expect-error prefs is not a GithubPanel prop
        prefs={EMPTY_PREFS}
      />,
    );
    render(
      <GithubPanel
        api={api}
        active={false}
        // @ts-expect-error onChange is not a GithubPanel prop
        onChange={() => undefined}
      />,
    );
    render(
      <GithubPanel
        api={api}
        active={false}
        // @ts-expect-error projects is not a GithubPanel prop
        projects={[]}
      />,
    );
  });
});

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
    await waitFor(() => expect(account()?.textContent).toMatch(/octocat/));
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
    await waitFor(() => expect(account()?.textContent).toMatch(/octocat/));
    expect(document.querySelector('[data-github-scopes-warning]')).toBeNull();
  });
});

/**
 * THE SKILLS-CARD SHAPE (settings-views restructure, item F). Operator:
 * "restyle GitHub connect UI to match the Skills card shape ... status pill:
 * Connected/Not connected/gh not installed; 'Logged in as: **account**' when
 * connected." `data-github-status` (the longer sentence) is untouched by
 * this -- these are ADDITIONAL hooks, not replacements, the same way
 * `AdhdSkillCard.tsx`'s pill sits beside its own title rather than instead
 * of any existing text.
 */
describe('the status pill and "logged in as" line (item F)', () => {
  it('reads "gh not installed" when the CLI itself is missing, and draws no account line', async () => {
    const api = fakeApi({
      authStatus: vi.fn(
        async () => ({ kind: 'cli-missing', message: 'not found' }) satisfies GithubAuthStatus,
      ),
    });
    setup({ api });
    await waitFor(() =>
      expect(pill()?.getAttribute('data-github-status-pill')).toBe('cli-missing'),
    );
    expect(pill()?.textContent).toMatch(/gh not installed/);
    expect(account()).toBeNull();
  });

  it('reads "Not connected" when logged out, and draws no account line', async () => {
    setup();
    await waitFor(() =>
      expect(pill()?.getAttribute('data-github-status-pill')).toBe('not-connected'),
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
    await waitFor(() => expect(pill()?.getAttribute('data-github-status-pill')).toBe('connected'));
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

describe('the GitHub panel carries no repository picker', () => {
  it('draws no picker hook, with a project or without', async () => {
    const api = fakeApi({
      projectRemotes: vi.fn(async () => [{ name: 'origin', repo: 'juzser/vam' }]),
    });
    setup({ api });
    await waitFor(() => expect(status()).not.toBe(''));
    for (const hook of [
      'current',
      'clear',
      'change',
      'search',
      'search-button',
      'candidate',
      'noproject',
    ]) {
      expect(document.querySelector(`[data-github-repo-${hook}]`), hook).toBeNull();
    }
    expect(api.projectRemotes).not.toHaveBeenCalled();
  });
});

/**
 * THE GITHUB MARK, drawn on the card the way `AdhdSkillCard.tsx`'s own icon
 * tile draws its lucide glyph -- except this one is the brand's own outline,
 * not a borrowed generic icon. `GithubPanel.tsx`'s own header records where
 * it came from (Simple Icons, CC0) and why it is safe to inline verbatim.
 */
describe('the GitHub mark', () => {
  const mark = () => document.querySelector('[data-github-mark]');

  it('draws the official GitHub logo in currentColor, never a baked hex', () => {
    setup();
    expect(mark(), 'no GitHub mark drawn on the card').not.toBeNull();
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
 * THE GH-MISSING GUIDE. Operator: when `gh` itself is not on PATH, the card
 * should walk the operator through installing it rather than only naming the
 * fact and linking out -- `brew install gh`, `gh auth login`, a "Check
 * again" that re-runs the same status read the pill already does on mount,
 * and both `https://cli.github.com` and `https://brew.sh` for whichever half
 * the operator is missing.
 */
describe('the "gh not installed" guide', () => {
  const CLI_MISSING: GithubAuthStatus = { kind: 'cli-missing', message: 'not found' };

  function setupMissing(over: Partial<GithubPanelProps> = {}) {
    const api = fakeApi({ authStatus: vi.fn(async () => CLI_MISSING) });
    return setup({ api, ...over });
  }

  const guide = () => document.querySelector('[data-github-cli-guide]');
  const brewCode = () => document.querySelector('[data-github-guide-brew]');
  const loginCode = () => document.querySelector('[data-github-guide-login]');
  const copyBrew = () => document.querySelector<HTMLButtonElement>('[data-github-guide-copy-brew]');
  const checkAgain = () => document.querySelector<HTMLButtonElement>('[data-github-guide-check]');

  it('draws a short guide, the brew command, gh auth login, and a link to cli.github.com', async () => {
    setupMissing();
    await waitFor(() => expect(guide()).not.toBeNull());
    expect(guide()?.textContent?.toLowerCase()).toMatch(/not installed/);
    expect(brewCode()?.textContent).toBe('brew install gh');
    expect(loginCode()?.textContent).toBe('gh auth login');
    expect(guide()?.querySelector('a[href="https://cli.github.com"]')).not.toBeNull();
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
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('brew install gh'));
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

  it('never renders Connect while gh itself is missing -- nothing to press yet', async () => {
    setupMissing();
    await waitFor(() => expect(guide()).not.toBeNull());
    expect(connect()).toBeNull();
  });

  /**
   * THE GUIDE'S TWO LINKS, under the same policy `PairingPanel.tsx`'s own
   * `ExternalLink` was built for: `src/main/index.ts`'s
   * `setWindowOpenHandler(() => ({ action: 'deny' }))` denies every
   * `target="_blank"` in this window, so an ordinary anchor here does
   * nothing at all. `ExternalLink` (`primitives.tsx`, shared with
   * `PairingPanel.tsx`) is a real `<a href>` -- for accessibility and the
   * browser-build fallback -- whose click hands off to a bridge instead of
   * the window, exactly mirroring `test/settings/pairing-panel.test.tsx`'s
   * own corpus for the identical defect.
   */
  describe('the guide’s two external links, under a policy that denies window.open', () => {
    const brewLink = () =>
      document.querySelector<HTMLAnchorElement>(
        '[data-github-cli-guide] a[href="https://brew.sh"]',
      );
    const cliLink = () =>
      document.querySelector<HTMLAnchorElement>(
        '[data-github-cli-guide] a[href="https://cli.github.com"]',
      );

    function setupMissingWithOpen(over: Partial<GithubPanelProps> = {}) {
      const openExternal = vi.fn(async () => undefined);
      setupMissing({ openExternal, ...over });
      return { openExternal };
    }

    it('keeps a real href, for accessibility and the browser-build fallback', async () => {
      setupMissingWithOpen();
      await waitFor(() => expect(brewLink()).not.toBeNull());
      expect(brewLink()?.getAttribute('href')).toBe('https://brew.sh');
      expect(cliLink()?.getAttribute('href')).toBe('https://cli.github.com');
    });

    it('asks main to open brew.sh through the bridge, not window.open', async () => {
      const { openExternal } = setupMissingWithOpen();
      await waitFor(() => expect(brewLink()).not.toBeNull());
      fireEvent.click(brewLink() as HTMLElement);
      expect(openExternal).toHaveBeenCalledWith('https://brew.sh');
    });

    it('asks main to open cli.github.com through the bridge the same way', async () => {
      const { openExternal } = setupMissingWithOpen();
      await waitFor(() => expect(cliLink()).not.toBeNull());
      fireEvent.click(cliLink() as HTMLElement);
      expect(openExternal).toHaveBeenCalledWith('https://cli.github.com');
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
