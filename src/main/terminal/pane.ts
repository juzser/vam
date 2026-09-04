/**
 * Reading the screen of the tmux session vam started for a given session.
 *
 * This module is the production caller `sources/tmux/spawn.ts` says it does
 * not have: `listVamSessions` and `readPane` -- and with them the
 * no-server-to-empty-list mapping that stops "vam could not ask" being drawn
 * as "you have no sessions" -- run for the first time from here.
 *
 * HOW A SESSION IS MATCHED TO A TMUX SESSION, and it is the one decision here
 * worth reading twice. Nothing records the pairing: `create-session.ts` builds
 * a name with `vamSessionName(title)` and keeps no note of it. So the name is
 * RE-DERIVED the same way -- `vamSessionName(title, '')` is exactly the
 * created name minus its random tail -- and that prefix is matched against the
 * names tmux reports. A stored mapping would be a side-file that goes stale
 * the moment tmux is used without vam, which is the reason the prefix scheme
 * exists at all (`tmux/argv.ts`).
 *
 * It follows that vam only ever finds sessions IT STARTED. The operator's own
 * sessions are children of their login shell and cannot be adopted -- no
 * process may take over another's controlling TTY -- so "no match" is an
 * honest empty answer here, never a prompt to attach to something.
 */

import type { PaneView } from '../../shared/terminal.js';
import { vamSessionName } from '../sources/tmux/argv.js';
import { listVamSessions, readPane, type TmuxRun } from '../sources/tmux/spawn.js';

/**
 * The vam session name for `title`, if one of `names` is it.
 *
 * With more than one match -- a second session started for the same title --
 * the LAST in sort order wins. Not because it is the newest (tmux's
 * `list-sessions` here reports names and nothing else, so age is not in hand)
 * but because a stable, stated rule beats whichever order tmux happened to
 * print: the tab must show the same pane on every refresh.
 */
export function matchVamSession(names: readonly string[], title: string): string | null {
  const prefix = vamSessionName(title, '');
  const mine = names
    .filter((name) => {
      // The tail must be the RANDOM SUFFIX and nothing else. A bare
      // `startsWith` would let the title `atlas` match `vam-atlas-two-a1b2c3`
      // -- a different session, with a different screen, whose title merely
      // begins with this one's. `randomSuffix` is base36 digits, so a `-` in
      // what is left over means the slug did not end where this title's does.
      const tail = name.slice(prefix.length);
      return name.startsWith(prefix) && !tail.includes('-');
    })
    .sort();
  return mine.at(-1) ?? null;
}

/**
 * The screen for `title`, or the honest reason there is none.
 *
 * A `no-such-session` on the capture is reported as `gone` rather than as a
 * failure: the session was listed a moment ago and has ended since, which is
 * an answer about the session, not a loss of vam's ability to look.
 */
export async function readSessionPane(run: TmuxRun, title: string): Promise<PaneView> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'unavailable') {
    return { kind: 'unavailable', error: listed.error };
  }
  const name = matchVamSession(listed.names, title);
  if (name === null) {
    return { kind: 'not-vam' };
  }
  const pane = await readPane(run, name);
  if (pane.kind === 'ok') {
    return { kind: 'ok', name, text: pane.text };
  }
  return pane.error.code === 'no-such-session'
    ? { kind: 'gone' }
    : { kind: 'unavailable', error: pane.error };
}
