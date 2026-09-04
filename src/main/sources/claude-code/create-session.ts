/**
 * Starting a NEW Claude Code session, in a tmux session vam owns.
 *
 * Until now `o` answered "sessions are created from the CLI". It can stop
 * saying that: `tmux new-session -d -c <cwd> claude` really starts one, in a
 * detachable pty, with no native module involved.
 *
 * WHAT IT STILL CANNOT DO. The session vam creates is vam's. The operator's
 * existing sessions are children of their own login shell and cannot be
 * adopted -- no process may take over another's controlling TTY -- so this is
 * a creation path only, never an attach path for what is already running.
 *
 * THE DIRECTORY IS NEVER GUESSED. A project id is a digest (`project-id.ts`),
 * so the only way back to a path is to re-derive the id for each directory
 * vam can actually see. If none matches, this refuses by name rather than
 * starting a session somewhere plausible: a session in the wrong repository
 * is worse than no session.
 */

import type { SourceError } from '../../ipc/channels.js';
import { vamSessionName } from '../tmux/argv.js';
import { createVamSession, type TmuxRun } from '../tmux/spawn.js';
import type { LiveAgent } from './agents.js';
import { projectIdOf } from './project-id.js';

/**
 * What a new session runs. Bare `claude` -- an interactive session, not a
 * query. An ARRAY of words, not a string: tmux runs a one-argument
 * `shell-command` through `sh -c` and only a multi-argument one directly, so
 * the split is what keeps a shell out of the path (`tmux/argv.ts`).
 */
const NEW_SESSION_COMMAND = ['claude'] as const;

/**
 * Resolves to `null` when the session started, and to the `SourceError`
 * otherwise -- never throws, for `MainSource`'s documented reason.
 *
 * `name` is a parameter only so a test can fix it to a known value; in production the random
 * tail in `vamSessionName` is what stops a second session for one project
 * from colliding with the first.
 */
export async function createSessionInProject(input: {
  agents: readonly LiveAgent[];
  projectId: string;
  title: string;
  run: TmuxRun;
  name?: string;
}): Promise<SourceError | null> {
  const { agents, projectId, title, run } = input;
  const match = agents.find((candidate) => projectIdOf(candidate.cwd) === projectId);
  if (match === undefined) {
    return {
      kind: 'refused',
      code: 'unknown-project',
      message: `vam cannot tell which directory project ${projectId} is, so it will not start a session in a guessed one`,
    };
  }
  return createVamSession(run, {
    name: input.name ?? vamSessionName(title),
    cwd: match.cwd,
    command: NEW_SESSION_COMMAND,
    // WHAT THE TERMINAL TAB WILL LOOK THIS UP BY. The name is for a person
    // reading `tmux ls`; the pairing is this id, recorded on the session
    // itself. Nothing re-derives a name from `title` -- that is the bug this
    // argument exists to end (`terminal/pane.ts`).
    projectId,
  });
}
