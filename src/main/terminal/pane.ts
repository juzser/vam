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

import type { PaneSize, PaneView } from '../../shared/terminal.js';
import { sessionIdOf } from '../sources/claude-code/deliver.js';
import {
  listVamSessions,
  readPane,
  resizeWindow,
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

export function matchVamSession(sessions: readonly TmuxSession[], projectId: string): SessionMatch {
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
 * WHICH tmux session a row is about -- the one rule, used by everything that
 * reads or touches a session.
 *
 * THE PUBLISHED PANE FIRST, and it is what makes `ambiguous` rare instead of
 * usual: a project with two sessions vam started has two panes, and only the
 * session itself knows which one it is in (`sources/claude-code/
 * session-pane.ts`). It is checked against vam's own listing, so a pane the
 * operator started -- published in the same directory -- is never acted on.
 * The project tag is the fallback for a session that published nothing.
 *
 * One function rather than one per caller: a second pairing rule would be a
 * second answer to "whose terminal is this", and the callers that CHANGE a
 * session are exactly the ones that must not have their own opinion.
 */
export function targetSession(
  sessions: readonly TmuxSession[],
  projectId: string,
  rowId: string | undefined,
  panes: ReadonlyMap<string, string> | undefined,
): SessionMatch {
  const published = rowId === undefined ? undefined : panes?.get(sessionIdOf(rowId));
  if (published !== undefined && sessions.some((session) => session.name === published)) {
    return { kind: 'one', name: published };
  }
  return matchVamSession(sessions, projectId);
}

/**
 * The screen for `projectId`, or the honest reason there is none.
 *
 * A `no-such-session` on the capture is reported as `gone` rather than as a
 * failure: the session was listed a moment ago and has ended since, which is
 * an answer about the session, not a loss of vam's ability to look.
 */
export async function readSessionPane(
  run: TmuxRun,
  projectId: string,
  // The ROW the tab is showing, and what the sessions published about
  // themselves. Both optional: a caller with neither gets the project-wide
  // answer this module gave before, `ambiguous` and all.
  rowId?: string,
  panes?: ReadonlyMap<string, string>,
): Promise<PaneView> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'unavailable') {
    return { kind: 'unavailable', error: listed.error };
  }
  const match = targetSession(listed.sessions, projectId, rowId, panes);
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

/**
 * Make the session's screen the size the pane can show -- and only ever a
 * session vam can PROVE it started for this project.
 *
 * THIS IS THE FIRST THING IN VAM THAT CHANGES A TMUX SESSION rather than
 * reading one, so the pairing above stops being a display decision and starts
 * being a safety one. vam shares one server with whatever the operator is
 * running; a resize aimed by anything looser than the recorded `@vam-project`
 * would reflow a terminal vam has no business touching, and the operator would
 * see their own work reformat itself for no reason they could trace.
 *
 * `none` and `ambiguous` therefore both do NOTHING, and the second is the one
 * worth naming: the tab draws no screen when two sessions answer to one
 * project, so there is nothing on it to fit, and picking one of the two would
 * be a coin toss landing in a real terminal.
 *
 * The answer is a plain boolean because the only caller is the pane fitting
 * itself: there is nothing on screen that a reason could be drawn into, and
 * every refusal here is either normal (no session) or already visible in the
 * pane's own `PaneView`.
 */
export async function resizeSessionPane(
  run: TmuxRun,
  projectId: string,
  size: PaneSize,
  rowId?: string,
  panes?: ReadonlyMap<string, string>,
): Promise<boolean> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'unavailable') return false;
  // THE SAME `targetSession` THE READ USES, and that is the whole safety
  // argument: the session being resized is the session whose screen is on
  // screen. A second rule here could aim the resize at a terminal the tab is
  // not showing, and nothing in the app would look wrong while it happened.
  const match = targetSession(listed.sessions, projectId, rowId, panes);
  if (match.kind !== 'one') return false;
  return (await resizeWindow(run, match.name, size)) === null;
}
