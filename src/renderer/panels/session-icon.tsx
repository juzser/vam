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
 * THAT REASON IS NOW LOAD-BEARING, because an icon carries a COLOUR. The rule
 * for a tone is the same rule ("the session's own, else the project's, else a
 * default"), and the obvious way to build it -- a second field resolved beside
 * this one -- is a second chain that can disagree with this one. It would let
 * a session drawing its PROJECT'S emoji wear its OWN stored tone: a
 * combination nobody picked, and one that cannot even be painted, since an
 * emoji ignores `color`. So the tone travels INSIDE the value this chain
 * resolves (`icon-value.tsx`), and whichever link answers, answers with both
 * halves at once. There is one chain here because there is one question.
 *
 * Both ends of the chain can vanish on their own: an empty pick clears a
 * choice rather than storing "" (`setIcon`), and the stored buckets are
 * pruned by a TTL. Either way the value read here is simply absent, so the
 * next link answers and the tab never goes blank. A stored value this build
 * cannot DRAW -- a glyph name a newer vam wrote -- behaves the same way by
 * design: `parseIcon` returns `null` for it, so it is skipped rather than
 * printed.
 *
 * The last link is a component rather than a string because a string cannot
 * be a placeholder anyone can see: the chain used to end in a middot, and at
 * 11px in a dim colour the operator read it as no icon at all. A lucide glyph
 * is not a string, so the shared unit is the *rendering* rather than the
 * resolved character. `resolveSessionIcon` stays exported for callers that
 * want the chain as data, and returns `null` for the case `SessionIcon` draws.
 */

import { Monitor } from 'lucide-react';
import type { ReactElement } from 'react';
import type { SessionEntry } from '../domain/selectors.js';
import { IconMark, type IconValue, parseIcon } from './icon-value.js';

/**
 * Session icon, else project icon, else `null` -- nobody has chosen one that
 * this build can draw.
 *
 * `??` between the two PARSED values rather than the two stored strings, which
 * is the difference that makes an unreadable value fall through instead of
 * stopping the chain with something nothing can render.
 */
export function resolveSessionIcon(entry: SessionEntry): IconValue | null {
  return parseIcon(entry.session.icon) ?? parseIcon(entry.project.icon) ?? null;
}

/**
 * The session's icon, drawn. Never empty: with no icon in the chain this is
 * the same `Monitor` the project heading already draws for the same case, so
 * "nobody has picked one" reads as one deliberate mark across the whole UI.
 *
 * `size` is the placeholder's, in px; an emoji takes its size from the
 * caller's text styling as it always has, and a lucide glyph takes this. It
 * stays a parameter rather than a constant because it is layout, which belongs
 * to the caller -- the identity question is the only thing this module decides.
 */
export function SessionIcon({ entry, size }: { entry: SessionEntry; size: number }): ReactElement {
  return (
    <IconMark
      value={resolveSessionIcon(entry)}
      size={size}
      fallback={<Monitor data-session-icon-placeholder size={size} strokeWidth={1.7} />}
    />
  );
}
