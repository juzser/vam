/**
 * Which glyph stands for a session, answered in one place.
 *
 * The operator's rule is "default to the project's icon", which makes this a
 * chain rather than a field: the session's own choice if it has one, the
 * project's if it does not, and a neutral mark when nobody has chosen. Two
 * surfaces draw a session icon — the canvas root node and the sidebar row —
 * and inlining the chain at each of them is how they come to disagree the
 * first time one is edited, so the chain lives here and neither surface owns
 * a second opinion.
 *
 * Both ends of the chain can vanish on their own: an empty pick clears a
 * choice rather than storing "" (`setIcon`), and the stored buckets are
 * pruned by a TTL. Either way the value read here is simply absent, so the
 * next link answers and the node never goes blank.
 */

import type { SessionEntry } from '../domain/selectors.js';

/**
 * What a session with no glyph anywhere shows. The sidebar's row already drew
 * this exact mark for the same case, so adopting it keeps the two surfaces
 * saying one thing rather than two.
 */
export const NEUTRAL_SESSION_ICON = '·';

/** Session glyph, else project glyph, else the neutral mark. Never empty. */
export function resolveSessionIcon(entry: SessionEntry): string {
  return entry.session.icon ?? entry.project.icon ?? NEUTRAL_SESSION_ICON;
}
