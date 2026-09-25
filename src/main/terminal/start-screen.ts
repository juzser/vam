/**
 * The pane's own screen, for a row a Start-session/Resume wait is up on --
 * and the one screen vam is allowed to answer on its own, the trust dialog.
 *
 * Aimed by `targetSession`, the SAME rule `readSessionPrompt`/`answerQuestion`
 * (`answer.ts`) already use, and for the identical reason: a card drawn from
 * a screen vam read in the wrong pane would be answered in the wrong pane.
 */

import { PROVIDERS, type ProviderId } from '../../shared/providers.js';
import type { AnswerTrustResult, StartScreenView } from '../../shared/start-screen.js';
import { answerTrustDialog, detectStartScreen } from '../sources/claude-code/start-screen.js';
import { listVamSessions, readPane, type TmuxRun } from '../sources/tmux/spawn.js';
import { targetSession } from './pane.js';

export type { AnswerTrustResult };

/**
 * WHICH PROVIDER IS ACTUALLY RUNNING IN THIS PANE, from its foreground
 * command (`pane_current_command`) -- a SEPARATE question from `screen`
 * above, and answered from a different signal: `start-screen.ts`'s own
 * classifier reads the pane's TEXT and is deliberately blind to the command
 * (its own header explains why); this is the command, and nothing else.
 *
 * A DIRECT MATCH for a provider whose own quirk-free command is running
 * (`codex`), and the ONE MEASURED EXCEPTION for `claude`: its ready screen
 * and its blocking dialogs alike report the bare version string
 * (`2.1.282`) as the foreground command, never the word `claude`
 * (`sources/claude-code/start-screen.ts`'s own header, measured against the
 * real CLI). `null` for a shell, an unrecognised command, or no command at
 * all -- never a guess at which provider that might be.
 */
const CLAUDE_VERSION_COMMAND = /^\d+\.\d+\.\d+$/;

export function identifyRunningProvider(command: string | undefined): ProviderId | null {
  if (command === undefined || command === '') return null;
  const bare = command.startsWith('-') ? command.slice(1) : command;
  const direct = PROVIDERS.find((provider) => provider.command[0] === bare);
  if (direct !== undefined) return direct.id;
  return CLAUDE_VERSION_COMMAND.test(bare) ? 'claude-code' : null;
}

/**
 * The screen the pane behind `rowId` is showing right now, AND which
 * provider its foreground command names -- a READ, safe to poll, nothing
 * here presses a key.
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
  return {
    kind: 'ok',
    screen: detectStartScreen(pane.text),
    provider: identifyRunningProvider(session?.command),
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
