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
import { listVamSessions, readPane, type TmuxRun } from '../sources/tmux/spawn.js';
import { targetSession } from './pane.js';

export type { AnswerTrustResult };

/**
 * The screen the pane behind `rowId` is showing right now. A READ, safe to
 * poll -- nothing here presses a key.
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
  return { kind: 'ok', screen: detectStartScreen(pane.text) };
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
