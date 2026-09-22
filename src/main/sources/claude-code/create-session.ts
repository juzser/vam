/**
 * Starting a NEW session, in a tmux session vam owns.
 *
 * Until now `o` answered "sessions are created from the CLI". It can stop
 * saying that: `tmux new-session -d -c <cwd> <shell>` really starts one, in a
 * detachable pty, with no native module involved.
 *
 * WHAT THE PANE RUNS IS A SHELL, NOT `claude`, since Stage 2 of
 * `docs/design/vam-owns-the-session.md` -- IN A PROJECT VAM ALREADY DRAWS.
 * The pane exists from the first frame with nothing started in it; it is a
 * row of its own (`pane-row.ts`), its Terminal view works at once, and the
 * provider is chosen AFTER -- typed into the pane by the Start session button
 * (`start-in-pane.ts`) or by the operator's own hand. `tmux/shell.ts` says
 * which shell and why.
 *
 * THE "NEW PROJECT" PATH STILL RUNS THE PROVIDER, and the reason is where the
 * row lives. A pane row is filed under the project section its digest names,
 * and a digest cannot be turned back into a directory: until something RUNS
 * in a brand-new directory no source reports a project for it, so a shell
 * pane there would be a pane no row, no tab and no Terminal view could
 * reach -- a session the operator started that only `tmux attach` could find.
 * The design's Stage 1 (the list inverting onto `listVamSessions`) is what
 * gives such a pane a section; until then, `createSessionInDirectory` spends
 * the provider at spawn exactly as it always has, and the shell-first start
 * is the project path's alone. The design document does not draw this line;
 * building against it did.
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

import { resolveProvider } from '../../../shared/providers.js';
import type { SourceError } from '../../ipc/channels.js';
import { whyNotARepository } from '../repo.js';
import { vamSessionName } from '../tmux/argv.js';
import { loginShellCommand } from '../tmux/shell.js';
import { createVamSession, type TmuxRun } from '../tmux/spawn.js';
import type { LiveAgent } from './agents.js';
import { projectIdOf } from './project-id.js';

/**
 * WHAT THE NEW-PROJECT SESSION RUNS COMES FROM THE PROVIDER TABLE, not from a
 * literal here. `shared/providers.ts` carries the words for each provider vam
 * can start, and `resolveProvider` is total, so an id from a store main never
 * wrote and does not recognise starts the default provider instead of
 * nothing. Main normalises for itself: the renderer already did, and a
 * renderer's normalisation is not something main may take on trust.
 *
 * ON THE PROJECT PATH `provider` IS ACCEPTED AND NOT READ: the spawn there is
 * a shell (see the header), and the choice the id names is made later, in
 * the pane, where `start-in-pane.ts` is handed the command the renderer
 * resolved from the same table. It stays on that signature so the IPC
 * contract keeps its shape under the callers that send it.
 */

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
  provider?: string;
  /** The shell the pane runs; a parameter only so a test can fix it. */
  shell?: readonly string[];
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
  // NOT through `createSessionInDirectory`, and the difference is the
  // repository check that one applies. This path's cwd was not chosen in a
  // dialog: it is the directory a session is ALREADY running in, resolved by
  // digest from the live agent list. Narrowing it to repositories would refuse
  // a second session beside a first one vam is drawing at that very moment --
  // a refusal about a directory the operator never picked.
  return spawnSessionIn({
    cwd: match.cwd,
    title,
    run,
    name: input.name,
    // THE SHELL: this project has a section, so the pane has a row to live in
    // and a Terminal view to be typed into from its first frame.
    command: input.shell ?? loginShellCommand(),
  });
}

/**
 * The same creation, for a directory named directly rather than resolved from
 * a project id -- the "new project" path, where the operator has just chosen
 * the directory in Electron's own dialog and no project id exists for it yet.
 *
 * `projectId` is still recorded on the tmux session, re-derived from the cwd
 * by the SAME digest every other project id comes from: the project this
 * creates is the one the next `load()` will report, so the two must agree or
 * the Terminal tab would find nothing for a session vam itself started.
 *
 * Whether the directory exists is tmux's question, not this module's -- `-c`
 * on a missing directory fails the spawn and `createVamSession` classifies
 * it, which keeps one answer for "that path is gone" instead of two.
 *
 * WHETHER IT IS A REPOSITORY IS THIS MODULE'S QUESTION, and it is asked here
 * rather than in the renderer for the reason main re-normalises the provider
 * id: this channel is reachable without the dialog, so a check the renderer
 * made is not a check main may rely on. `repo.ts` says why the narrowing is a
 * validation and not a list of known repositories. The refusal returns BEFORE
 * anything spawns, and carries the path, so the operator who picked their
 * downloads folder reads what was wrong with it rather than nothing at all.
 */
export async function createSessionInDirectory(input: {
  cwd: string;
  title: string;
  run: TmuxRun;
  name?: string;
  provider?: string;
}): Promise<SourceError | null> {
  return (
    whyNotARepository(input.cwd) ??
    spawnSessionIn({
      ...input,
      // THE PROVIDER, not the shell -- see the header for why this path is
      // the exception: there is no section for a row to appear in until
      // something runs here.
      command: resolveProvider(input.provider).command,
    })
  );
}

/** The spawn both paths share, once the directory and the command are settled. */
async function spawnSessionIn(input: {
  cwd: string;
  title: string;
  run: TmuxRun;
  name?: string;
  command: readonly string[];
}): Promise<SourceError | null> {
  const { cwd, title, run } = input;
  return createVamSession(run, {
    name: input.name ?? vamSessionName(title),
    cwd,
    // On the project path this is a shell, and the pane's own `@vam-pid`
    // therefore names the shell, not an agent; `pane-row.ts` says what that
    // costs the pairing and what stands in for it.
    command: input.command,
    // WHAT THE TERMINAL TAB WILL LOOK THIS UP BY. The name is for a person
    // reading `tmux ls`; the pairing is this id, recorded on the session
    // itself. Nothing re-derives a name from `title` -- that is the bug this
    // argument exists to end (`terminal/pane.ts`).
    projectId: projectIdOf(cwd),
  });
}
