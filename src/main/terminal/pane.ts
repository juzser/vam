/**
 * Reading the screen of the tmux session vam started for a given project.
 *
 * This module is the production caller `sources/tmux/spawn.ts` says it does
 * not have: `listVamSessions` and `readPane` -- and with them the
 * no-server-to-empty-list mapping that stops "vam could not ask" being drawn
 * as "you have no sessions" -- run for the first time from here.
 *
 * HOW A SESSION IS MATCHED TO A TMUX SESSION, and it is the one decision here
 * worth reading twice. IT IS NOT DERIVED. `createVamSession` records the
 * project id on the tmux session as a user option at the moment it creates
 * one (`tmux/argv.ts`, `VAM_PROJECT_OPTION`), and this reads that back and
 * compares it exactly.
 *
 * What stood here re-derived a name from a label and matched by prefix, and it
 * was lossy in both directions. The creator was handed a project NAME while
 * this was asked with a session TITLE, so the two strings never met and every
 * session was drawn as one vam had not started. And the slug is truncated, so
 * two different labels could share a prefix and resolve to ONE pane -- stably,
 * which is not the same thing as correctly.
 *
 * It follows that vam only ever finds sessions IT STARTED. The operator's own
 * sessions are children of their login shell and cannot be adopted -- no
 * process may take over another's controlling TTY -- so "no match" is an
 * honest empty answer here, never a prompt to attach to something. An option
 * nobody set reads back as the empty string, which is exactly that answer.
 */

import type { PaneView } from '../../shared/terminal.js';
import {
  listVamSessions,
  readPane,
  type TmuxRun,
  type TmuxSession,
} from '../sources/tmux/spawn.js';

/**
 * What the recorded pairing says about one project.
 *
 * `ambiguous` is a third answer rather than a tie-break, and it is the point
 * of the rewrite. Two sessions vam started for one project are two screens,
 * and nothing here knows which the operator meant: the rule this replaced
 * sorted the names and took the last, which is stable and wrong half the time.
 * Saying so is the only answer that is not a guess.
 */
export type SessionMatch =
  | { readonly kind: 'none' }
  | { readonly kind: 'one'; readonly name: string }
  | { readonly kind: 'ambiguous'; readonly names: readonly string[] };

export function matchVamSession(
  sessions: readonly TmuxSession[],
  projectId: string,
): SessionMatch {
  // An empty id is what an UNSET option reads back as, so an empty id asking
  // would sweep up every session vam did not tag. It matches nothing.
  if (projectId === '') return { kind: 'none' };
  const mine = sessions
    .filter((session) => session.project === projectId)
    .map((session) => session.name)
    .sort();
  const [only] = mine;
  if (only === undefined) return { kind: 'none' };
  return mine.length === 1 ? { kind: 'one', name: only } : { kind: 'ambiguous', names: mine };
}

/**
 * The screen for `projectId`, or the honest reason there is none.
 *
 * A `no-such-session` on the capture is reported as `gone` rather than as a
 * failure: the session was listed a moment ago and has ended since, which is
 * an answer about the session, not a loss of vam's ability to look.
 */
export async function readSessionPane(run: TmuxRun, projectId: string): Promise<PaneView> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'unavailable') {
    return { kind: 'unavailable', error: listed.error };
  }
  const match = matchVamSession(listed.sessions, projectId);
  if (match.kind === 'none') {
    return { kind: 'not-vam' };
  }
  if (match.kind === 'ambiguous') {
    return { kind: 'ambiguous', names: match.names };
  }
  const pane = await readPane(run, match.name);
  if (pane.kind === 'ok') {
    return { kind: 'ok', name: match.name, text: pane.text };
  }
  return pane.error.code === 'no-such-session'
    ? { kind: 'gone' }
    : { kind: 'unavailable', error: pane.error };
}
