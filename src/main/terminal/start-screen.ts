/**
 * The pane's own screen, for a row a Start-session/Resume wait is up on --
 * and the one screen vam is allowed to answer on its own, the trust dialog.
 *
 * Aimed by `targetSession`, the SAME rule `readSessionPrompt`/`answerQuestion`
 * (`answer.ts`) already use, and for the identical reason: a card drawn from
 * a screen vam read in the wrong pane would be answered in the wrong pane.
 */

import type { AnswerTrustResult, StartScreenView } from '../../shared/start-screen.js';
import { answerTrustDialog, detectStartScreen } from '../sources/claude-code/start-screen.js';
import { identifyRunningProvider, isShellCommand } from '../sources/tmux/shell.js';
import { listVamSessions, readPane, type TmuxRun } from '../sources/tmux/spawn.js';
import { targetSession } from './pane.js';

export type { AnswerTrustResult };
export { identifyRunningProvider };

/**
 * The screen the pane behind `rowId` is showing right now, AND which
 * provider its foreground command names -- a READ, safe to poll, nothing
 * here presses a key.
 *
 * THREE STATES, TOLD APART BY HAND rather than taken straight off
 * `identifyRunningProvider` -- an S2: that classifier ALSO answers
 * `undefined` for "no command in the listing at all" (`sources/tmux/
 * shell.ts`'s own three-state header), and folding THAT case in with a
 * genuine shell would have this function refuse to say anything is running
 * merely because a stubbed runner or an old tmux carried no command field --
 * a strictly WORSE answer than the honest "confirmed running, unidentified"
 * every caller before this fix already relied on. So the two are read apart
 * here, off the exact same `session?.command` this function already has in
 * hand: absence of a command is `null` (unchanged, `StartScreenView`'s own
 * "never a guess" rule -- and `readStartScreen`'s own existing fixture
 * proves it, `test/main/terminal/start-screen.test.ts`); a command that
 * NAMES a shell is `undefined`, on purpose distinct from `null` -- the pane
 * has genuinely proven nothing is running yet, and a caller polling for
 * readiness (`Canvas.tsx`) must keep polling rather than confirm on the
 * strength of `screen` alone, which a starship/pure prompt can echo `ready`
 * for (a typed-but-not-yet-run `claude`, READY_CARET's own header,
 * `sources/claude-code/start-screen.ts`) while the foreground is still
 * genuinely a shell.
 */
export async function readStartScreen(
  run: TmuxRun,
  projectId: string,
  rowId: string | undefined,
  panes: ReadonlyMap<string, string> | undefined,
): Promise<StartScreenView> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'unavailable') return { kind: 'unavailable' };
  const match = targetSession(listed.sessions, projectId, rowId, panes);
  if (match.kind === 'mispaired') return { kind: 'mispaired' };
  if (match.kind !== 'one') return { kind: 'unaimed' };
  const pane = await readPane(run, match.name);
  if (pane.kind !== 'ok') return { kind: 'unreadable' };
  const session = listed.sessions.find((candidate) => candidate.name === match.name);
  const command = session?.command;
  const provider =
    command === undefined
      ? null
      : isShellCommand(command)
        ? undefined
        : identifyRunningProvider(command);
  return {
    kind: 'ok',
    screen: detectStartScreen(pane.text),
    provider,
  };
}

/**
 * Answer the trust dialog on the pane behind `rowId` -- aimed by the same
 * rule as the read above, never a second opinion about whose pane this is.
 */
export async function answerTrustOnPane(
  run: TmuxRun,
  projectId: string,
  rowId: string | undefined,
  trust: boolean,
  panes: ReadonlyMap<string, string> | undefined,
): Promise<AnswerTrustResult> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'unavailable') return { kind: 'unaimed' };
  const match = targetSession(listed.sessions, projectId, rowId, panes);
  if (match.kind !== 'one') return { kind: 'unaimed' };
  return answerTrustDialog(run, match.name, trust);
}
