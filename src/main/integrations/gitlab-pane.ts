/**
 * Connect and Disconnect, run in a NEW vam pane -- `github-pane.ts`'s own
 * mechanism, mirrored for `glab`: `createVamSession` spawns a shell and
 * `typeThenEnter` types the ONE fixed command literally, then presses
 * Return, exactly as the GitHub card and "Start session" both already do.
 *
 * NEITHER COMMAND IS EVER BUILT FROM ANYTHING THE RENDERER SENDS -- both are
 * constant strings, fixed at `--hostname gitlab.com`.
 *
 * NEVER THE PROJECT/SESSION MACHINERY, tagged with its OWN constant
 * (`GITLAB_AUTH_PROJECT_ID`) rather than `GITHUB_AUTH_PROJECT_ID` -- a
 * separate module, a separate module-level `activePane`, so a GitHub sign-in
 * and a GitLab sign-in can run in two panes at once without either module's
 * "one pane at a time" rule seeing the other's.
 */

import {
  GITLAB_LOGIN_COMMAND,
  GITLAB_LOGOUT_COMMAND,
  type GitlabAuthPaneKind,
  type GitlabAuthPaneRefusal,
  type GitlabAuthPaneView,
} from '../../shared/gitlab.js';
import { typeThenEnter } from '../sources/claude-code/start-in-pane.js';
import { vamSessionName } from '../sources/tmux/argv.js';
import { isShellCommand, loginShellCommand } from '../sources/tmux/shell.js';
import {
  createVamSession,
  listVamSessions,
  readPane,
  type TmuxRun,
} from '../sources/tmux/spawn.js';

export type { GitlabAuthPaneKind, GitlabAuthPaneRefusal };
export { GITLAB_LOGIN_COMMAND, GITLAB_LOGOUT_COMMAND };

/** NOT a real project's digest -- `GITHUB_AUTH_PROJECT_ID`'s own reasoning,
 *  restated: deliberately not that shape, so it can never collide with a
 *  project the operator actually has open. */
export const GITLAB_AUTH_PROJECT_ID = 'vam-integrations-gitlab-auth';

let activePane: { readonly name: string; readonly kind: GitlabAuthPaneKind } | null = null;

/** For tests only -- this module is process-wide, like `github-pane.ts`'s. */
export function __resetGitlabAuthPaneForTest(): void {
  activePane = null;
}

/** The pane Connect/Disconnect most recently started, or `null`. */
export function currentGitlabAuthPane(): {
  readonly name: string;
  readonly kind: GitlabAuthPaneKind;
} | null {
  return activePane;
}

/**
 * Start (or replace) the auth pane. Resolves to `null` once the pane exists
 * and the command has been typed into it, or to a refusal --
 * `startGithubAuthPane`'s own contract.
 */
export async function startGitlabAuthPane(
  run: TmuxRun,
  kind: GitlabAuthPaneKind,
): Promise<GitlabAuthPaneRefusal | null> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'ok' && activePane !== null) {
    const pane = listed.sessions.find((session) => session.name === activePane?.name);
    if (pane !== undefined && !isShellCommand(pane.command)) {
      return {
        kind: 'refused',
        code: 'already-running',
        message:
          'vam is already running a GitLab sign-in/out in a pane -- watch it, or wait for it to finish.',
      };
    }
  }
  const name = vamSessionName('glab-auth');
  const created = await createVamSession(run, {
    name,
    cwd: process.cwd(),
    command: loginShellCommand(),
    projectId: GITLAB_AUTH_PROJECT_ID,
  });
  if (created !== null) {
    return { kind: 'refused', code: created.code, message: created.message };
  }
  activePane = { name, kind };
  const command = kind === 'login' ? GITLAB_LOGIN_COMMAND : GITLAB_LOGOUT_COMMAND;
  const typed = await typeThenEnter(run, name, command);
  if (typed !== null) {
    return { kind: 'refused', code: typed.code, message: typed.message };
  }
  return null;
}

export type { GitlabAuthPaneView };

/** The pane's own screen -- read-only, `readGithubAuthPane`'s own contract. */
export async function readGitlabAuthPane(run: TmuxRun): Promise<GitlabAuthPaneView> {
  if (activePane === null) return { kind: 'none' };
  const listed = await listVamSessions(run);
  if (listed.kind !== 'ok') {
    return { kind: 'unavailable', message: listed.error.message };
  }
  const stillThere = listed.sessions.some((session) => session.name === activePane?.name);
  if (!stillThere) {
    activePane = null;
    return { kind: 'ended' };
  }
  const pane = await readPane(run, activePane.name);
  if (pane.kind !== 'ok') {
    if (pane.error.code === 'no-such-session') {
      activePane = null;
      return { kind: 'ended' };
    }
    return { kind: 'unavailable', message: pane.error.message };
  }
  return { kind: 'ok', text: pane.text, authKind: activePane.kind };
}
