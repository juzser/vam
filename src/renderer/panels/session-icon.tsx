/**
 * Which glyph stands for a session, answered in one place.
 *
 * The operator's rule is "default to the project's icon", which makes this a
 * chain rather than a field: the session's own choice if it has one, the
 * project's if it does not, and a drawn placeholder when nobody has chosen.
 *
 * This module was written for TWO surfaces -- the canvas root node and the
 * sidebar row -- because inlining the chain at each of them is how they come
 * to disagree the first time one is edited. The sidebar's display has since
 * been removed at the operator's request, so today there is exactly one
 * caller, and that original argument no longer holds as written. The chain
 * still lives here, for the reason that outlives the caller count: it is the
 * answer to "what glyph stands for a session", which is a rule about the
 * session model rather than a detail of any one view -- statable and testable
 * on its own, and the place a second display would adopt rather than reinvent.
 *
 * Both ends of the chain can vanish on their own: an empty pick clears a
 * choice rather than storing "" (`setIcon`), and the stored buckets are
 * pruned by a TTL. Either way the value read here is simply absent, so the
 * next link answers and the node never goes blank.
 *
 * The last link is a component rather than a string because a string cannot
 * be a placeholder anyone can see: the chain used to end in a middot, and at
 * 11px in a dim colour the operator read it as no icon at all. A lucide glyph
 * is not a string, so the shared unit is the *rendering* rather than the
 * resolved character. `resolveSessionGlyph` stays exported for callers that
 * want the chain as data, and returns `null` for the case `SessionIcon` draws.
 */

import { Monitor } from 'lucide-react';
import type { ReactElement } from 'react';
import type { SessionEntry } from '../domain/selectors.js';

/** Session glyph, else project glyph, else `null` -- nobody has chosen one. */
export function resolveSessionGlyph(entry: SessionEntry): string | null {
  return entry.session.icon ?? entry.project.icon ?? null;
}

/**
 * The session's icon, drawn. Never empty: with no glyph in the chain this is
 * the same `Monitor` the project heading already draws for the same case, so
 * "nobody has picked one" reads as one deliberate mark across the whole UI.
 *
 * `size` is the placeholder's, in px; the glyph takes its size from the
 * caller's text styling as it always has. It stays a parameter rather than a
 * constant because it is layout, which belongs to the caller -- the identity
 * question is the only thing this module decides.
 */
export function SessionIcon({ entry, size }: { entry: SessionEntry; size: number }): ReactElement {
  const glyph = resolveSessionGlyph(entry);
  return <>{glyph ?? <Monitor data-session-icon-placeholder size={size} strokeWidth={1.7} />}</>;
}
