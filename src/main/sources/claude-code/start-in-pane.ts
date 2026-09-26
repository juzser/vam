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
 * a pane whose foreground is anything but a shell OR A KNOWN PROVIDER is
 * `pane-occupied` to both, and the agent's own row -- which the next poll
 * draws -- is where those acts belong, with the confirmation `stop.ts` owes a
 * running one. Silence (a listing with no fourth field) refuses nothing, as
 * everywhere else.
 *
 * ISSUES 502/507: A PANE CONFIRMED RUNNING A KNOWN PROVIDER IS NOT `pane-occupied`
 * TO `typeIntoOwnPane` ANY MORE. `recordPrompt` (`source.ts`) routes every
 * `pane:` row id here -- Start session's own command AND the operator's very
 * first real message alike, because the Response view's `PaneReady` state
 * (drawn the instant `identifyRunningProvider` confirms a provider, ahead of
 * the slower agents-list poll that would otherwise repaint the row) enables
 * the SAME composer and sends through the SAME write. Refusing that message
 * left a "ready" pane permanently unable to receive one -- the row this whole
 * feature exists to enable. So the proof below now answers with which of two
 * shapes a pane is in, not merely whether it is empty: a SHELL still gets the
 * ordinary Start-session write (`typeThenEnter`, a single line, no escaping,
 * because the text is a command a shell runs); a pane a KNOWN provider
 * (`identifyRunningProvider`, `tmux/shell.ts`) is confirmed running gets the
 * SAME delivery a reply to a live agent already uses (`typeIntoPane`,
 * `reply.ts`) -- multi-line-safe and review-gate-aware, because the text is
 * now a PROMPT into a provider TUI, never typed the shell-command way. `null`
 * (running, unidentified -- an editor, a build, anything neither table entry
 * names) still refuses exactly as before: there is no proof that program is
 * safe to hand keystrokes framed as a provider's prompt, or as anything else.
 */

import type { ProviderId } from '../../../shared/providers.js';
import type { SourceError } from '../../ipc/channels.js';
import { isVamSession, killSessionArgv, sendEnterArgv, sendTextArgv } from '../tmux/argv.js';
import { identifyRunningProvider, isShellCommand } from '../tmux/shell.js';
import {
  classifyTmuxFailure,
  listVamSessions,
  type TmuxRun,
  type TmuxSession,
} from '../tmux/spawn.js';
import { typeIntoPane } from './reply.js';

/**
 * The pane, proven to be vam's own -- and, when it is no longer a shell,
 * WHICH known provider (`identifyRunningProvider`) is confirmed running in it,
 * so the caller can pick the right delivery. `runningProvider` is `undefined`
 * for a shell (the ordinary, empty-pane case `typeThenEnter` already handled)
 * and a `ProviderId` for a pane a known provider is confirmed running in --
 * never `null`, because `null` (running, unidentified) is refused right here,
 * exactly as an occupied pane always was.
 */
async function ownPane(
  run: TmuxRun,
  name: string,
  act: string,
): Promise<
  | { readonly pane: TmuxSession; readonly runningProvider: ProviderId | undefined }
  | { readonly error: SourceError }
> {
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
    // `identifyRunningProvider` only ever answers `undefined` for a shell or
    // an empty/absent command, both excluded by the branch above, so what is
    // left here is `ProviderId | null` -- a known provider, confirmed running,
    // or confirmed running something neither table entry names.
    const provider = identifyRunningProvider(pane.command);
    if (provider === null || provider === undefined) {
      return {
        error: {
          kind: 'refused',
          code: 'pane-occupied',
          message: `"${name}" has ${pane.command} running in it now, so it is no longer an empty pane; vam will not ${act} through this control -- the session's own row is where that belongs`,
        },
      };
    }
    return { pane, runningProvider: provider };
  }
  return { pane, runningProvider: undefined };
}

/**
 * Type `text` into the pane `name` literally, then press Return once. `null`
 * when both landed; a `SourceError` otherwise, never a thrown one
 * (`MainSource`'s contract). Return is NOT pressed when the text did not
 * land: submitting half a command is worse than a command sitting there
 * untyped.
 *
 * SPLIT OUT OF `typeIntoOwnPane`, which is `ownPane`'s proof plus
 * exactly this. The proof exists for the Start session BUTTON, where a poll
 * may have gone stale and the operator may since have typed something by
 * hand into the pane the row was drawn for (see `ownPane`'s own header).
 * A caller that just created the pane in this SAME run of calls -- a resume
 * (`claude-code/resume.ts`, `codex/resume.ts`), or the "new project" path
 * (`create-session.ts`) -- has no such gap to close: nothing else knows the
 * freshly-minted, random-suffixed session name yet, so re-asking
 * `listVamSessions` whether the pane is still vam's own and still a shell
 * answers a question that cannot have changed since `new-session` returned
 * two lines above. Those callers use this directly; `typeIntoOwnPane` below
 * is unchanged for the caller that still needs the proof.
 */
export async function typeThenEnter(
  run: TmuxRun,
  name: string,
  text: string,
): Promise<SourceError | null> {
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
 * D12: PANES WITH A START/RESUME WRITE ALREADY IN FLIGHT.
 *
 * Two presses within a few milliseconds -- two rapid Start clicks, or Enter's
 * own native activation landing beside a mouse click -- both reach here
 * before either has run a single `send-keys`, so `ownPane`'s proof (the
 * pane is still a shell) was true for BOTH: the race is not in the renderer's
 * `disabled` state, which only ever describes the LAST commit, it is that two
 * calls can be in flight for the same pane at once with nothing between them
 * that has said so. A `Set`, mutated synchronously the moment a call is
 * accepted and before its first `await`, is what closes it -- JS runs a
 * function synchronously up to that point, so a second call for the same
 * name arriving anywhere after the first has been accepted, even
 * microseconds later, sees it in the set.
 *
 * MODULE-LEVEL AND PROCESS-WIDE ON PURPOSE: this is the one write path with
 * the poll-gap race `ownPane`'s own header describes, and main is the
 * one process every Start/Resume press reaches through, however many
 * `createTmuxRunner()`s the caller minted for the occasion.
 */
const paneWritesInFlight = new Set<string>();

/**
 * Type `text` into the pane `name`, then press Return once -- `typeThenEnter`
 * plus `ownPane`'s proof, for Start session AND for `recordPrompt`'s own
 * `pane:` row branch (`source.ts`), the two callers with a real gap between
 * the row being drawn and this running.
 *
 * WHICH DELIVERY RUNS IS `ownPane`'s OWN ANSWER, NOT A GUESS FROM `text`:
 * `runningProvider === undefined` is the ordinary empty shell, and gets the
 * single-line, no-escaping write a shell command wants (`typeThenEnter`) --
 * this is Start session's own path, unchanged. A `ProviderId` means the pane
 * is CONFIRMED running a known provider already, so `text` here is a PROMPT
 * into that provider's TUI -- delivered through `typeIntoPane` (`reply.ts`),
 * the identical multi-line-safe, review-gate-aware channel a reply to a live
 * agent already uses. See the file header for why both shapes reach this one
 * function and why that is correct rather than incidental.
 */
export async function typeIntoOwnPane(input: {
  run: TmuxRun;
  name: string;
  text: string;
}): Promise<SourceError | null> {
  const { run, name, text } = input;
  if (paneWritesInFlight.has(name)) {
    return {
      kind: 'refused',
      code: 'start-in-flight',
      message: `vam is already typing into "${name}" from a press a moment ago -- this one is refused rather than sent again`,
    };
  }
  paneWritesInFlight.add(name);
  try {
    const found = await ownPane(run, name, 'type');
    if ('error' in found) return found.error;
    if (found.runningProvider !== undefined) return await typeIntoPane(run, name, text);
    return await typeThenEnter(run, name, text);
  } finally {
    paneWritesInFlight.delete(name);
  }
}

/**
 * Kill the pane `name` -- §5's "Close the session", for a pane with nothing in
 * it. No confirmation is owed: there is no work in flight to lose, and no
 * conversation, because none was started. `null` when tmux killed it, or when
 * there was nothing left to kill in the first place -- see below.
 *
 * IDEMPOTENT ON A PANE THAT IS ALREADY GONE, and this is deliberately NOT
 * `ownPane`'s missing-pane branch, which `typeIntoOwnPane` still uses
 * unchanged: typing has to refuse when there is no pane to type into, but
 * closing one that no longer exists has already reached Close's own goal --
 * "this pane is not running any more" -- so answering that with a refusal was
 * the bug the operator reported: a row Close could never make go away, on a
 * poll cycle where the operator's own `tmux kill-session` (or the shell
 * exiting on its own) won the race against the next `load()`.
 *
 * THE PROOF THIS IS SAFE TO DO is `name` itself: a pane-row id is only ever
 * minted from a name `listVamSessions` already returned (`pane-row.ts`), which
 * is filtered to vam's own prefix -- so a name that PASSES `isVamSession` but
 * is no longer in today's listing was vam's pane a moment ago. A name that
 * fails the prefix (an id nobody could have gotten from a real row, or a
 * caller's own mistake) is refused exactly as before: there is no evidence at
 * all that this was ever vam's to close.
 */
export async function killOwnPane(input: {
  run: TmuxRun;
  name: string;
}): Promise<SourceError | null> {
  const { run, name } = input;
  const listed = await listVamSessions(run);
  if (listed.kind !== 'ok') return listed.error;
  const pane = listed.sessions.find((session) => session.name === name);
  if (pane === undefined) {
    if (isVamSession(name)) {
      // See the header: idempotent success, not `not-vam-started`.
      return null;
    }
    return {
      kind: 'refused',
      code: 'not-vam-started',
      message: `vam has no tmux session "${name}" of its own -- it has ended, or vam never started it -- so it will not close there`,
    };
  }
  if (pane.command !== undefined && !isShellCommand(pane.command)) {
    return {
      kind: 'refused',
      code: 'pane-occupied',
      message: `"${name}" has ${pane.command} running in it now, so it is no longer an empty pane; vam will not close through this control -- the session's own row is where that belongs`,
    };
  }
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
