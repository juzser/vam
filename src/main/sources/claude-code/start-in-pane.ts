/**
 * The two writes a PANE ROW answers to: Start session, and Close.
 *
 * A pane row (`pane-row.ts`) is a vam tmux session with nothing running in
 * it. It has no agent, so nothing here goes through `paneForRow` -- there is
 * no row to pair -- and both writes are aimed at the tmux session BY NAME.
 * That is a power no other write in this source has, and it is bounded the
 * same way `session-pane.ts` bounds a published name: the name is used only
 * after it is found in `listVamSessions`, which is vam's own prefix-filtered
 * listing. The operator's sessions are never in it. A name that is not in it
 * is refused with the code `stop.ts` already uses for the same fact.
 *
 * START SESSION TYPES, IT DOES NOT SPAWN. `docs/design/vam-owns-the-session.md`
 * Stage 2: "Start types the provider's command into the pane it already
 * owns." The command is the provider table's (`shared/providers.ts`), typed
 * with `-l` so tmux reads it as characters, then one interpreted Return. From
 * here the path is identical to the operator having typed it in the Terminal
 * view -- the shell runs `claude`, Claude Code registers, publishes its pane,
 * and `load()` pairs the agent row to this pane and retires the empty one.
 * The button and the keyboard produce the same bound row because they ARE
 * the same keystrokes.
 *
 * WHAT BOTH REFUSE THAT NOTHING ELSE COULD SEE. The row that offered the
 * control was drawn a poll ago; the operator may since have typed `claude` by
 * hand in the Terminal view. The listing's foreground command
 * (`pane_current_command`) says whether the pane is still a shell. Typing
 * `claude` into a running agent sends it as a PROMPT; killing that pane cuts
 * the agent off through a control that promised to close an empty shell. So
 * a pane whose foreground is anything but a shell is `pane-occupied` to both,
 * and the agent's own row -- which the next poll draws -- is where those acts
 * belong, with the confirmation `stop.ts` owes a running one. Silence (a
 * listing with no fourth field) refuses nothing, as everywhere else.
 */

import type { SourceError } from '../../ipc/channels.js';
import { killSessionArgv, sendEnterArgv, sendTextArgv } from '../tmux/argv.js';
import { isShellCommand } from '../tmux/shell.js';
import {
  classifyTmuxFailure,
  listVamSessions,
  type TmuxRun,
  type TmuxSession,
} from '../tmux/spawn.js';

/** The pane, proven to be vam's own and holding only a shell -- or why not. */
async function ownEmptyPane(
  run: TmuxRun,
  name: string,
  act: string,
): Promise<{ readonly pane: TmuxSession } | { readonly error: SourceError }> {
  const listed = await listVamSessions(run);
  if (listed.kind !== 'ok') return { error: listed.error };
  const pane = listed.sessions.find((session) => session.name === name);
  if (pane === undefined) {
    return {
      error: {
        kind: 'refused',
        code: 'not-vam-started',
        message: `vam has no tmux session "${name}" of its own -- it has ended, or vam never started it -- so it will not ${act} there`,
      },
    };
  }
  if (pane.command !== undefined && !isShellCommand(pane.command)) {
    return {
      error: {
        kind: 'refused',
        code: 'pane-occupied',
        message: `"${name}" has ${pane.command} running in it now, so it is no longer an empty pane; vam will not ${act} through this control -- the session's own row is where that belongs`,
      },
    };
  }
  return { pane };
}

/**
 * Type `text` into the pane `name`, then press Return once. `null` when both
 * landed; a `SourceError` otherwise, never a thrown one (`MainSource`'s
 * contract). Return is NOT pressed when the text did not land: submitting
 * half a command is worse than a command sitting there untyped.
 */
export async function typeIntoOwnPane(input: {
  run: TmuxRun;
  name: string;
  text: string;
}): Promise<SourceError | null> {
  const { run, name, text } = input;
  const found = await ownEmptyPane(run, name, 'type');
  if ('error' in found) return found.error;
  const typed = await run(sendTextArgv(name, text));
  if (typed.failure !== null) {
    return classifyTmuxFailure({
      failure: typed.failure,
      stderr: typed.stderr,
      action: `typing into session ${name}`,
    });
  }
  const entered = await run(sendEnterArgv(name));
  if (entered.failure !== null) {
    const error = classifyTmuxFailure({
      failure: entered.failure,
      stderr: entered.stderr,
      action: `pressing Return in session ${name}`,
    });
    return {
      ...error,
      message: `"${text}" was typed into ${name} but vam could not press Return, so it is sitting there unrun: ${error.message}`,
    };
  }
  return null;
}

/**
 * Kill the pane `name` -- §5's "Close the session", for a pane with nothing in
 * it. No confirmation is owed: there is no work in flight to lose, and no
 * conversation, because none was started. `null` when tmux killed it.
 */
export async function killOwnPane(input: {
  run: TmuxRun;
  name: string;
}): Promise<SourceError | null> {
  const { run, name } = input;
  const found = await ownEmptyPane(run, name, 'close');
  if ('error' in found) return found.error;
  const killed = await run(killSessionArgv(name));
  if (killed.failure !== null) {
    return classifyTmuxFailure({
      failure: killed.failure,
      stderr: killed.stderr,
      action: `closing session ${name}`,
    });
  }
  return null;
}
