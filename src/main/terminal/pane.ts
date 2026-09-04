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

import type { PaneKey, PaneSendResult, PaneSize, PaneView } from '../../shared/terminal.js';
import { sessionIdOf } from '../sources/claude-code/deliver.js';
import {
  sendBackspaceArgv,
  sendBackTabArgv,
  sendEnterArgv,
  sendTextArgv,
} from '../sources/tmux/argv.js';
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
  | { readonly kind: 'ambiguous'; readonly names: readonly string[] }
  /**
   * The row named its own pane and vam cannot use it. A FOURTH ANSWER rather
   * than `none`, because the two are different facts: `none` is nobody having
   * said anything and vam having nothing of its own here, while this is a row
   * that said exactly where it is and pointed somewhere vam must not act on.
   * Everything that WRITES treats them the same -- refuse -- but the tab has
   * to say different words, and it was saying "vam did not start a session
   * for this one" while holding a published name it had just rejected.
   */
  | { readonly kind: 'mispaired'; readonly published: string };

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
  if (published !== undefined) {
    // THE PROJECT IS CHECKED, AND A DISAGREEMENT ENDS THE SEARCH. Matching
    // the name alone made this fast path strictly WEAKER than the fallback it
    // exists to bypass, which has always filtered on the project: a stale or
    // crossed published value naming a vam session of ANOTHER project
    // resolved here as a confident single match, and a keystroke went into
    // that project's running agent.
    //
    // But refusing the value and then FALLING THROUGH is worse still, and it
    // is why this is one branch rather than a condition. The tag path answers
    // a different question and can resolve a perfectly healthy session that
    // this row was never in -- so a row with a wrong pairing would have its
    // keys typed into a session chosen by a rule that never looked at the
    // row. No published value is "nobody said, so try the tag"; a published
    // value that disagrees is "this row is wrong", and vam stops.
    //
    // An empty id is what an unset option reads back as, so it may not match
    // anything; `matchVamSession` refuses it for the same reason.
    return projectId !== '' &&
      sessions.some((session) => session.name === published && session.project === projectId)
      ? { kind: 'one', name: published }
      : { kind: 'mispaired', published };
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
  // Carried through rather than flattened into `not-vam`: the row said where
  // it is, and what the tab owes the operator is that fact, not a denial.
  if (match.kind === 'mispaired') {
    return { kind: 'mispaired', published: match.published };
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

/**
 * Type ONE keystroke into the pane the tab is showing. `true` means tmux took
 * it; every `false` means nothing was sent at all.
 *
 * THIS IS THE FIRST THING IN VAM THAT WRITES INTO A RUNNING AGENT. The resize
 * above changes how someone's screen is drawn; this changes what they typed.
 * So it is aimed by `targetSession` -- the SAME rule the read and the resize
 * use, and deliberately not a second opinion about whose terminal this is --
 * and it refuses outright on every answer but `one`. `none` is a session vam
 * did not start (including the operator's own, which is listed with an empty
 * project and is not vam's to type into), and `ambiguous` is two candidates,
 * where guessing would land a keystroke in the wrong agent's prompt.
 *
 * The refusal is REPORTED rather than swallowed, and it says which refusal it
 * was: `unaimed` when the pairing named no single session, `refused` when
 * tmux would not deliver to the session vam did name. The tab draws a
 * different sentence for each, because they send the operator to different
 * places.
 *
 * THE RACE THIS DOES NOT CLOSE, stated plainly because it is real and because
 * a comment that implied otherwise would be worse than none. Ownership is
 * decided by `list-sessions` and the key is delivered by a SECOND tmux
 * command. A session that exits between the two normally fails safe -- tmux
 * answers `can't find pane` and this returns false -- but if its exact name
 * is taken by a new session in that window, the keystroke lands there.
 *
 * WHY THAT IS IMPROBABLE AND NOT IMPOSSIBLE. A vam session name carries six
 * base-36 characters of randomness (`vamSessionName`), about 2.2e9 values, so
 * the collision is not something a fresh vam session stumbles into: it takes
 * a process that creates a tmux session with that exact name inside a window
 * a few milliseconds wide. Improbable is the honest word. Not impossible.
 *
 * HOW IT WOULD BE CLOSED, so the next reader does not have to rediscover it.
 * tmux has no compare-and-send: no verb sends a key conditional on a session
 * still being the one you looked at. But it has something that works better,
 * and it is MEASURED on tmux 3.7b over a private `-L` socket rather than
 * assumed: session IDS are not reused. Killing `$1` and immediately creating
 * a session with the same NAME produced `$2`, `send-keys -t '$3'` delivers,
 * and a dead id answers `can't find session: $3` and exits 1 instead of
 * landing somewhere else. Carrying `#{session_id}` out of the SAME
 * `list-sessions` that proved the project and sending to the id would make
 * the reuse case impossible for the lifetime of the server -- leaving only a
 * server restart between the two calls, which kills every vam session anyway.
 *
 * It is not done here because the id has to come from that one listing to be
 * worth anything, which means changing the listing's wire format
 * (`listSessionsArgv`), its parser and `TmuxSession` -- read by five call
 * sites and stubbed by six test files, one directory of which is being
 * edited by another task. That is its own change, with its own tests, and
 * doing it inside this one would be the kind of drive-by that breaks a peer.
 * Every write path here shares this window, not just the keystroke.
 */
export async function sendSessionKey(
  run: TmuxRun,
  projectId: string,
  key: PaneKey,
  rowId?: string,
  panes?: ReadonlyMap<string, string>,
): Promise<PaneSendResult> {
  const listed = await listVamSessions(run);
  // vam could not look, so it cannot claim a pairing problem either -- but it
  // certainly did not deliver. `unaimed` is the honest half of that: nothing
  // was aimed at anything.
  if (listed.kind === 'unavailable') return 'unaimed';
  const match = targetSession(listed.sessions, projectId, rowId, panes);
  if (match.kind !== 'one') return 'unaimed';
  // The builders are kept apart in `tmux/argv.ts` for the one reason that
  // matters here: `-l` types, and Return, Backspace and Shift-Tab have to be
  // PRESSED. There is deliberately no builder that takes a key name, so
  // nothing here can turn the operator's text into a keypress by accident --
  // and this switch is where that holds: a `kind` off the bridge selects one
  // of three fixed argvs, and only `text` carries anything the operator wrote.
  const argv =
    key.kind === 'enter'
      ? sendEnterArgv(match.name)
      : key.kind === 'backspace'
        ? sendBackspaceArgv(match.name)
        : key.kind === 'back-tab'
          ? // Aimed by the SAME guard as a character: a mode changed in the
            // wrong agent changes how somebody else's running work behaves.
            sendBackTabArgv(match.name)
          : sendTextArgv(match.name, key.text);
  return (await run(argv)).failure === null ? 'sent' : 'refused';
}
