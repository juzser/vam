/**
 * Connect and Disconnect, run in a NEW vam pane -- `github-pane.test.ts`'s
 * own corpus, mirrored for `glab`: the SAME mechanism vam uses to start a
 * session in one, so the operator sees `glab auth login --web` prints
 * exactly as they would watching any other pane.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetGitlabAuthPaneForTest,
  GITLAB_LOGIN_COMMAND,
  GITLAB_LOGOUT_COMMAND,
  readGitlabAuthPane,
  startGitlabAuthPane,
} from '../../src/main/integrations/gitlab-pane.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';

afterEach(() => __resetGitlabAuthPaneForTest());

/** `github-pane.test.ts`'s own fake, unchanged. */
function fakeTmux(initialListing = '') {
  const calls: (readonly string[])[] = [];
  let listing = initialListing;
  const run: TmuxRun = async (argv) => {
    calls.push(argv);
    const verb = argv[0] ?? '';
    if (verb === 'list-sessions') return { failure: null, stdout: listing, stderr: '' };
    if (verb === 'new-session') {
      const name = argv[argv.indexOf('-s') + 1] ?? '';
      listing = `${listing}vam-integrations-gitlab-auth\t\t${name}\tzsh\n`;
      return { failure: null, stdout: '4242', stderr: '' };
    }
    return { failure: null, stdout: '', stderr: '' };
  };
  return { run, calls: () => calls, setListing: (next: string) => (listing = next) };
}

describe('startGitlabAuthPane', () => {
  it('creates a new vam pane and types the login command literally, then Return', async () => {
    const { run, calls } = fakeTmux();
    const result = await startGitlabAuthPane(run, 'login');
    expect(result).toBeNull();
    const sendKeys = calls().filter((c) => c[0] === 'send-keys');
    expect(sendKeys[0]).toEqual(expect.arrayContaining(['-l', '--', GITLAB_LOGIN_COMMAND]));
    expect(sendKeys[1]?.[0]).toBe('send-keys');
    expect(sendKeys[1]).toEqual(expect.arrayContaining(['Enter']));
  });

  it('types the logout command for `logout`, never the login one', async () => {
    const { run, calls } = fakeTmux();
    await startGitlabAuthPane(run, 'logout');
    const sendKeys = calls().filter((c) => c[0] === 'send-keys');
    expect(sendKeys[0]).toEqual(expect.arrayContaining(['-l', '--', GITLAB_LOGOUT_COMMAND]));
  });

  it('never types a shell metacharacter unescaped -- the command is one fixed, constant string', () => {
    expect(GITLAB_LOGIN_COMMAND).toBe('glab auth login --hostname gitlab.com --web');
    expect(GITLAB_LOGOUT_COMMAND).toBe('glab auth logout --hostname gitlab.com');
  });

  it('refuses a second Connect while the first pane is still running glab', async () => {
    const { run, calls, setListing } = fakeTmux();
    await startGitlabAuthPane(run, 'login');
    const newSession = calls().find((c) => c[0] === 'new-session');
    const name = newSession?.[(newSession.indexOf('-s') ?? -1) + 1];
    setListing(`vam-integrations-gitlab-auth\t\t${name}\tglab\n`);
    const second = await startGitlabAuthPane(run, 'login');
    expect(second).toMatchObject({ kind: 'refused', code: 'already-running' });
  });

  it('allows a fresh Connect once the previous pane is back to a shell', async () => {
    const { run, calls, setListing } = fakeTmux();
    await startGitlabAuthPane(run, 'login');
    const newSession = calls().find((c) => c[0] === 'new-session');
    const name = newSession?.[(newSession.indexOf('-s') ?? -1) + 1];
    setListing(`vam-integrations-gitlab-auth\t\t${name}\tzsh\n`);
    const second = await startGitlabAuthPane(run, 'login');
    expect(second).toBeNull();
  });
});

describe('readGitlabAuthPane', () => {
  it('answers none before anything has been started', async () => {
    const { run } = fakeTmux();
    expect(await readGitlabAuthPane(run)).toEqual({ kind: 'none' });
  });

  it('answers the pane’s own screen once Connect has run', async () => {
    const { run } = fakeTmux();
    await startGitlabAuthPane(run, 'login');
    const view = await readGitlabAuthPane(run);
    expect(view.kind).toBe('ok');
  });

  it('answers ended once the pane is no longer in vam’s own listing', async () => {
    const { run, setListing } = fakeTmux();
    await startGitlabAuthPane(run, 'login');
    setListing('');
    const view = await readGitlabAuthPane(run);
    expect(view).toEqual({ kind: 'ended' });
  });
});
