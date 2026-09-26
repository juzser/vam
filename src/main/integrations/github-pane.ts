/**
 * Connect and Disconnect, run in a NEW vam pane -- exactly the mechanism vam
 * already uses to start a session in one, so the operator watches `gh auth
 * login --web` the same way they would watch any other pane: `createVamSession`
 * spawns a shell (`sources/tmux/spawn.ts`, `tmux/shell.ts`'s login shell,
 * unchanged from every other vam pane), and `typeThenEnter`
 * (`claude-code/start-in-pane.ts`) types the ONE fixed command literally, then
 * presses Return -- the identical two-step "Start session" already does.
 *
 * NEITHER COMMAND IS EVER BUILT FROM ANYTHING THE RENDERER SENDS. Both are
 * constant strings, fixed at `-h github.com`: there is no interpolation for an
 * injection to ride, which is a stronger guarantee than validating an argument
 * would be -- there is no argument.
 *
 * NEVER THE PROJECT/SESSION MACHINERY. This pane answers to no `projectId` a
 * session groups by; it is tagged with ITS OWN constant so `list-sessions`
 * still reports it (and so a stray tag can never collide with a real
 * project's digest, which `project-id.ts` always renders in hex), and there
 * is at most ONE of these panes tracked at a time, by name, in this module --
 * the same "module state is a projection of one fact" shape `pr-repos.ts`
 * documents for its own map.
 *
 * ONE PANE AT A TIME. A second Connect press while `gh` is still the pane's
 * foreground command is refused rather than starting a SECOND `gh auth
 * login` that could race the first for the operator's one device code. Once
 * the pane is back to a shell -- `gh` finished, one way or another -- a fresh
 * Connect is free to start a new pane; the old one is left exactly where
 * every other vam pane is left once its command exits: an idle shell an
 * operator can still find in the Terminal view.
 */

import {
  GITHUB_LOGIN_COMMAND,
  GITHUB_LOGOUT_COMMAND,
  type GithubAuthPaneKind,
  type GithubAuthPaneRefusal,
  type GithubAuthPaneView,
} from '../../shared/github.js';
import { typeThenEnter } from '../sources/claude-code/start-in-pane.js';
import { vamSessionName } from '../sources/tmux/argv.js';
import { isShellCommand, loginShellCommand } from '../sources/tmux/shell.js';
import {
  createVamSession,
  listVamSessions,
  readPane,
  type TmuxRun,
} from '../sources/tmux/spawn.js';

export type { GithubAuthPaneKind, GithubAuthPaneRefusal };
export { GITHUB_LOGIN_COMMAND, GITHUB_LOGOUT_COMMAND };

/**
 * NOT a real project's digest. `project-id.ts` always renders one in hex from
 * a real directory; this constant is deliberately not that shape, so it can
 * never collide with a project the operator actually has open, and the tag is
 * here only so `list-sessions` has SOMETHING to report -- nothing reads it
 * back to group this pane under a project.
 */
export const GITHUB_AUTH_PROJECT_ID = 'vam-integrations-github-auth';

let activePane: { readonly name: string; readonly kind: GithubAuthPaneKind } | null = null;

/** For tests only -- this module is process-wide, like `pr-repos.ts`'s map. */
export function __resetGithubAuthPaneForTest(): void {
  activePane = null;
}

/** The pane Connect/Disconnect most recently started, or `null`. Read by the
 *  IPC layer so "Copy command" can offer the SAME command a running pane is
 *  already typing, never a second guess at what it might be. */
export function currentGithubAuthPane(): {
  readonly name: string;
  readonly kind: GithubAuthPaneKind;
} | null {
  return activePane;
}

/**
 * Start (or replace) the auth pane. Resolves to `null` once the pane exists
 * and the command has been typed into it, or to a refusal.
 *
 * A REFUSAL HERE CAN STILL MEAN A PANE EXISTS: if `createVamSession` succeeds
 * and the follow-up `typeThenEnter` fails, the pane is real and trackable (so
 * `readGithubAuthPane` can still show it and the operator can type into it by
 * hand from the Terminal view) but the command never landed -- reported
 * rather than silently left half-done.
 */
export async function startGithubAuthPane(
  run: TmuxRun,
  kind: GithubAuthPaneKind,
): Promise<GithubAuthPaneRefusal | null> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'ok' && activePane !== null) {
    const pane = listed.sessions.find((session) => session.name === activePane?.name);
    if (pane !== undefined && !isShellCommand(pane.command)) {
      return {
        kind: 'refused',
        code: 'already-running',
        message:
          'vam is already running a GitHub sign-in/out in a pane -- watch it, or wait for it to finish.',
      };
    }
  }
  const name = vamSessionName('gh-auth');
  const created = await createVamSession(run, {
    name,
    cwd: process.cwd(),
    command: loginShellCommand(),
    projectId: GITHUB_AUTH_PROJECT_ID,
  });
  if (created !== null) {
    return { kind: 'refused', code: created.code, message: created.message };
  }
  activePane = { name, kind };
  const command = kind === 'login' ? GITHUB_LOGIN_COMMAND : GITHUB_LOGOUT_COMMAND;
  const typed = await typeThenEnter(run, name, command);
  if (typed !== null) {
    return { kind: 'refused', code: typed.code, message: typed.message };
  }
  return null;
}

export type { GithubAuthPaneView };

/**
 * The pane's own screen -- read-only, exactly what Connect/Disconnect have
 * typed and whatever `gh` has printed back, never anything vam sends into it
 * afterwards. "Never read the code or the token": this returns the raw screen
 * for a HUMAN to read, and parses none of it back out for vam's own use.
 */
export async function readGithubAuthPane(run: TmuxRun): Promise<GithubAuthPaneView> {
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
