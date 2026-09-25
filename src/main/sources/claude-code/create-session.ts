/**
 * Starting a NEW session, in a tmux session vam owns.
 *
 * Until now `o` answered "sessions are created from the CLI". It can stop
 * saying that: `tmux new-session -d -c <cwd> <shell>` really starts one, in a
 * detachable pty, with no native module involved.
 *
 * WHAT THE PANE RUNS IS A SHELL, NOT `claude`, since Stage 2 of
 * `docs/design/vam-owns-the-session.md` -- ON BOTH PATHS BELOW, NOW. The pane
 * exists from the first frame with nothing started in it, its Terminal view
 * works at once, and the provider is chosen AFTER: typed into the pane
 * (`typeThenEnter`, `start-in-pane.ts`) rather than handed to tmux at spawn.
 * `tmux/shell.ts` says which shell and why.
 *
 * THE "NEW PROJECT" PATH USED TO BE THE EXCEPTION, spending the provider at
 * spawn, and the reason was where the row lives: a pane row is filed under
 * the project section its digest names, and until Stage 1 of the design
 * (`listVamSessions` inverting into a project for an untagged, real-cwd
 * session -- `pane-row.ts`, `source.ts`) a shell pane in a brand-new
 * directory would have been a pane no row, no tab and no Terminal view could
 * reach. Stage 1 has since shipped, which is what let this path close the
 * exception rather than merely narrate it.
 *
 * WHY IT COULD NOT STAY OPEN. The operator's report against this build:
 * pressing Ctrl+C in the terminal shut the session down entirely, on every
 * path except the (already shell-first) existing-project one. The reason is
 * `VAM_PID_OPTION`'s own measured fact -- `tmux/argv.ts` -- restated here
 * because this file is where it bites: `new-session`'s command is SPREAD
 * across tmux's own argv, so tmux execs it directly with no shell in front,
 * and when that one process exits, `remain-on-exit` being off (tmux's
 * default) tears the pane down and, with nothing else in the session, the
 * session with it. MEASURED, on a private `-L` socket, real `claude` and
 * `codex`: spawned straight into the pane, two Ctrl-C (`claude`) or one
 * (`codex`) ended the process and `list-sessions` answered "no server
 * running" a moment later -- the whole tmux session was gone, along with the
 * conversation vam had a pane and a row for. Spawned into a shell instead,
 * typed afterward, the identical keystrokes ended the agent and left the pane
 * alive with the shell in its foreground (`pane_current_command` read back
 * `zsh`), which is what the operator's report says a terminal ought to do.
 * `createSessionInDirectory` closing this file's own gap is what stops that
 * for the "new project" path; `claude-code/resume.ts` and `codex/resume.ts`
 * close the same gap for the two paths that reopen a session, which spawned
 * their own command directly for the identical reason and needed the
 * identical fix -- their own headers carry it rather than repeating it here.
 *
 * THIS PATH NO LONGER TYPES THE PROVIDER IN EITHER, as of the operator's
 * second report against the shell-first build: "there seems to be a
 * start-session flow running in the background, in parallel with the
 * getting-started screen -- about 5 seconds later the session is created
 * automatically." That five seconds was real: this function used to spawn
 * the shell and then `typeThenEnter` the provider's command the same tick,
 * while the row it had just created was drawn `unstarted` (`pane-row.ts`
 * marks every unclaimed vam pane that way regardless of what is actually
 * running in its foreground) and the Response view showed the SAME start
 * screen `StartSession` draws for a pane that truly has nothing running --
 * so the operator saw a provider picker and a Start button over a pane
 * `claude` was already loading into, and a press of that button raced
 * `typeIntoOwnPane`'s own re-proof of ownership into a `pane-occupied`
 * refusal the operator never asked for. Removed: this function spawns a
 * shell now and returns, exactly like `createSessionInProject` beside it --
 * `provider` is still accepted, for the IPC contract's sake, and still not
 * spent, exactly as that function has never spent it. The one door left
 * that types a provider into a pane THIS FUNCTION just opened is the
 * operator's own choice, on the same start screen a new session in an
 * existing project already shows, or their own hands in the Terminal view.
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
import { whyNotARepository } from '../repo.js';
import { vamSessionName } from '../tmux/argv.js';
import { loginShellCommand } from '../tmux/shell.js';
import { createVamSession, type TmuxRun, type TmuxSession } from '../tmux/spawn.js';
import type { LiveAgent } from './agents.js';
import { projectIdOf } from './project-id.js';

/**
 * `provider` IS ACCEPTED BUT NOT SPENT BY EITHER FUNCTION BELOW. Both spawn a
 * shell (see the header) and stop there; the choice the id names is made
 * later, by the Start session button on the row the spawn just created --
 * `start-in-pane.ts` is handed the command the RENDERER resolved from
 * `shared/providers.ts`, main never resolves one itself. The parameter stays
 * on both signatures only so the IPC contract keeps its shape under the
 * callers that already send it (`combine.ts`, `source.ts`).
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
  /**
   * The tmux sessions vam knows about, panes included -- consulted ONLY when
   * no live agent answers `projectId` below. A project right after Start is
   * all pane rows and no live agent yet (`create-session.ts`'s own header,
   * Stage 2 of `docs/design/vam-owns-the-session.md`: the pane exists before
   * anything has been typed into it), so the live-agent lookup alone answered
   * `unknown-project` for a project vam's own Terminal tab was drawing that
   * moment. OPTIONAL, and defaults to none consulted: every caller and every
   * fixture in this suite that predates this parameter keeps the exact
   * behaviour it always had -- a `projectId` no live agent answers for is
   * refused, never guessed at from nothing.
   */
  panes?: readonly TmuxSession[];
}): Promise<SourceError | null> {
  const { agents, projectId, title, run } = input;
  const match = agents.find((candidate) => projectIdOf(candidate.cwd) === projectId);
  const cwd = match?.cwd ?? paneProjectDirectory(input.panes ?? [], projectId);
  if (cwd === null) {
    return {
      kind: 'refused',
      code: 'unknown-project',
      message: `vam cannot tell which directory project ${projectId} is, so it will not start a session in a guessed one`,
    };
  }
  // NOT through `createSessionInDirectory`, and the difference is the
  // repository check that one applies. This path's cwd was not chosen in a
  // dialog: it is the directory a session is ALREADY running in, resolved by
  // digest from the live agent list or a pane already tagged for it.
  // Narrowing it to repositories would refuse a second session beside a first
  // one vam is drawing at that very moment -- a refusal about a directory the
  // operator never picked.
  return spawnSessionIn({
    cwd,
    title,
    run,
    name: input.name,
    // THE SHELL: this project has a section, so the pane has a row to live in
    // and a Terminal view to be typed into from its first frame.
    command: input.shell ?? loginShellCommand(),
  });
}

/**
 * The one directory every pane tagged for `projectId` agrees on, or `null` --
 * for "no pane answers it" AND for "more than one answer disagrees", which is
 * refused rather than guessed, the same rule the caller above already applies
 * to a `projectId` no live agent names either.
 *
 * THE SAME PROJECT IDENTITY THE SIDEBAR GROUPS BY (`source.ts`'s own grouping
 * of pane rows into projects): a pane's `@vam-project` tag first -- stamped
 * once at creation and stable for its whole life -- and its live `cwd`
 * re-hashed only when the tag itself is unset, which is what a bare `tmux
 * new-session`, never handed to `createVamSession` at all, looks like.
 *
 * A tag that matches but carries no live `cwd` at all (an older tmux, or any
 * fixture that predates the field) answers nothing here -- absence is not a
 * directory to guess from, the same rule every other reader of an optional
 * `TmuxSession` field in this tree follows.
 */
function paneProjectDirectory(panes: readonly TmuxSession[], projectId: string): string | null {
  const cwds = new Set<string>();
  for (const pane of panes) {
    if (pane.cwd === undefined || pane.cwd === '') continue;
    const id = pane.project !== '' ? pane.project : projectIdOf(pane.cwd);
    if (id === projectId) cwds.add(pane.cwd);
  }
  return cwds.size === 1 ? (cwds.values().next().value as string) : null;
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
 *
 * THE SHELL, AND NOTHING ELSE -- see the header for why this path used to
 * type the provider in the instant the shell existed, and no longer does:
 * that raced the SAME start screen a new session in an existing project
 * shows, on a pane where the provider had already started underneath it.
 * `name` is resolved ONCE, here, rather than left to `spawnSessionIn`'s own
 * fallback, so a caller that inspects the failure (or, before this fix, a
 * caller that typed into the pane after spawning it) addresses the exact
 * pane the spawn just created rather than a second, re-derived random tail.
 */
export async function createSessionInDirectory(input: {
  cwd: string;
  title: string;
  run: TmuxRun;
  name?: string;
  provider?: string;
}): Promise<SourceError | null> {
  const refusal = whyNotARepository(input.cwd);
  if (refusal !== null) return refusal;
  const name = input.name ?? vamSessionName(input.title);
  // THE SPAWN IS THE WHOLE OF THIS FUNCTION NOW -- see the header. The row
  // the next `load()` reports is `unstarted` (`pane-row.ts`), exactly as
  // `createSessionInProject`'s row is, and the SAME start screen
  // (`StartSession`, `DetailPanel.tsx`) is what types a provider into it,
  // through `recordPrompt` -> `typeIntoOwnPane` -- never this function again.
  return spawnSessionIn({
    cwd: input.cwd,
    title: input.title,
    run: input.run,
    name,
    command: loginShellCommand(),
  });
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
    // BOTH PATHS RUN A SHELL NOW, so the pane's own `@vam-pid` always names
    // the shell, never an agent; `pane-row.ts` says what that costs the
    // pairing and what stands in for it.
    command: input.command,
    // WHAT THE TERMINAL TAB WILL LOOK THIS UP BY. The name is for a person
    // reading `tmux ls`; the pairing is this id, recorded on the session
    // itself. Nothing re-derives a name from `title` -- that is the bug this
    // argument exists to end (`terminal/pane.ts`).
    projectId: projectIdOf(cwd),
  });
}
