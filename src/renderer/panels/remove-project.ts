/**
 * What removing a project does, split into the half vam can perform and the
 * half it can only record.
 *
 * A project in vam is DERIVED from the cwd of live sessions -- there is no
 * stored project to delete. So "remove" is two things at once: end the
 * sessions vam itself started, and remember the project so the ones it cannot
 * end stop putting it back on the next refresh. Neither half touches the
 * machine: no directory, no repository and no conversation is deleted, and the
 * terminals somebody else opened keep running.
 *
 * Pure, and separate from the dialog that renders it, because the dialog's two
 * numbers ARE this plan. A confirm that says "this will end your sessions"
 * without counting them is a sentence, not a disclosure.
 */

import type { Session } from '../domain/model.js';

export type RemovalPlan = {
  /** Session ids vam will end, in the order they were listed. */
  readonly end: readonly string[];
  /** Session ids that keep running and merely stop being shown. */
  readonly hide: readonly string[];
};

/**
 * `vamControlled === true` AND NOTHING WIDER. The flag is three-state: `true`
 * is a proven tmux pairing, `false` is vam having asked and found none, and
 * ABSENT is vam not being able to ask at all. The last two are different
 * facts but the same instruction -- do not kill this -- because a kill aimed
 * at a session vam does not own ends a terminal the operator is working in,
 * and there is no undo for that.
 */
export function removalPlan(sessions: readonly Session[]): RemovalPlan {
  const end: string[] = [];
  const hide: string[] = [];
  for (const session of sessions) {
    (session.vamControlled === true ? end : hide).push(session.id);
  }
  return { end, hide };
}
