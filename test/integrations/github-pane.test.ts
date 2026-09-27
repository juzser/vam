/**
 * Connect and Disconnect, run in a NEW vam pane -- the SAME mechanism vam uses
 * to start a session in one (`createVamSession`, `typeThenEnter`), so the
 * operator sees the device code and the browser prompt `gh auth login --web`
 * prints, exactly as they would watching any other pane in the Terminal tab.
 *
 * NEVER THE PROJECT/SESSION MACHINERY: this pane is not a session row, has no
 * agent and answers to nobody's `projectId` but its own constant tag -- there
 * is exactly one of these panes at a time, tracked by name in this module, so
 * every read and every new Connect press is aimed at a name this module
 * itself minted rather than resolved by a guess.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetGithubAuthPaneForTest,
  GITHUB_LOGIN_COMMAND,
  GITHUB_LOGOUT_COMMAND,
  readGithubAuthPane,
  startGithubAuthPane,
} from '../../src/main/integrations/github-pane.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';

afterEach(() => __resetGithubAuthPaneForTest());

/** A tmux fake that answers `list-sessions` from a mutable listing, so a test
 *  can simulate the pane appearing after `new-session` runs. */
function fakeTmux(initialListing = '') {
  const calls: (readonly string[])[] = [];
  let listing = initialListing;
  const run: TmuxRun = async (argv) => {
    calls.push(argv);
    const verb = argv[0] ?? '';
    if (verb === 'list-sessions') return { failure: null, stdout: listing, stderr: '' };
    if (verb === 'new-session') {
      const name = argv[argv.indexOf('-s') + 1] ?? '';
      listing = `${listing}vam-integrations-github-auth\t\t${name}\tzsh\n`;
      return { failure: null, stdout: '4242', stderr: '' };
    }
    return { failure: null, stdout: '', stderr: '' };
  };
  return { run, calls: () => calls, setListing: (next: string) => (listing = next) };
}

describe('startGithubAuthPane', () => {
  it('creates a new vam pane and types the login command literally, then Return', async () => {
    const { run, calls } = fakeTmux();
    const result = await startGithubAuthPane(run, 'login');
    expect(result).toBeNull();
    const sendKeys = calls().filter((c) => c[0] === 'send-keys');
    expect(sendKeys[0]).toEqual(expect.arrayContaining(['-l', '--', GITHUB_LOGIN_COMMAND]));
    expect(sendKeys[1]?.[0]).toBe('send-keys');
    expect(sendKeys[1]).toEqual(expect.arrayContaining(['Enter']));
  });

  it('types the logout command for `logout`, never the login one', async () => {
    const { run, calls } = fakeTmux();
    await startGithubAuthPane(run, 'logout');
    const sendKeys = calls().filter((c) => c[0] === 'send-keys');
    expect(sendKeys[0]).toEqual(expect.arrayContaining(['-l', '--', GITHUB_LOGOUT_COMMAND]));
  });

  it('never types a shell metacharacter unescaped -- the command is one fixed, constant string', () => {
    expect(GITHUB_LOGIN_COMMAND).toBe('gh auth login --web -h github.com');
    expect(GITHUB_LOGOUT_COMMAND).toBe('gh auth logout -h github.com');
  });

  it('refuses a second Connect while the first pane is still running gh', async () => {
    const { run, calls, setListing } = fakeTmux();
    await startGithubAuthPane(run, 'login');
    const newSession = calls().find((c) => c[0] === 'new-session');
    const name = newSession?.[(newSession.indexOf('-s') ?? -1) + 1];
    // gh is still the foreground command -- the pane has not returned to a
    // shell, so the login/logout is still in flight.
    setListing(`vam-integrations-github-auth\t\t${name}\tgh\n`);
    const second = await startGithubAuthPane(run, 'login');
    expect(second).toMatchObject({ kind: 'refused', code: 'already-running' });
  });

  it('allows a fresh Connect once the previous pane is back to a shell', async () => {
    const { run, calls, setListing } = fakeTmux();
    await startGithubAuthPane(run, 'login');
    const newSession = calls().find((c) => c[0] === 'new-session');
    const name = newSession?.[(newSession.indexOf('-s') ?? -1) + 1];
    setListing(`vam-integrations-github-auth\t\t${name}\tzsh\n`);
    const second = await startGithubAuthPane(run, 'login');
    expect(second).toBeNull();
  });
});

describe('readGithubAuthPane', () => {
  it('answers none before anything has been started', async () => {
    const { run } = fakeTmux();
    expect(await readGithubAuthPane(run)).toEqual({ kind: 'none' });
  });

  it('answers the pane’s own screen once Connect has run', async () => {
    const { run } = fakeTmux();
    await startGithubAuthPane(run, 'login');
    const view = await readGithubAuthPane(run);
    expect(view.kind).toBe('ok');
  });

  it('answers ended once the pane is no longer in vam’s own listing', async () => {
    const { run, setListing } = fakeTmux();
    await startGithubAuthPane(run, 'login');
    setListing('');
    const view = await readGithubAuthPane(run);
    expect(view).toEqual({ kind: 'ended' });
  });
});
