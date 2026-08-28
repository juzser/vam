/**
 * `/` `n` `N` (docs/design/canvas-layout.md §4).
 *
 * Substring, case-insensitive, over the text already on screen: the session
 * title, its epic, its id, and the name of the project holding it. Nothing
 * clever — a fuzzy ranker would answer a different question from the one `/`
 * asks, which is "where is the thing I can see".
 */

import type { SessionEntry } from './selectors.js';

/**
 * The ids that match, **in canvas order**.
 *
 * Order is the feature. `n` is a walk across the screen, so the sequence has to
 * be the one the eye follows; sorting by relevance would make the next match
 * unpredictable, which is the one thing a repeat key must never be.
 *
 * An empty or blank query matches nothing rather than everything: `/` with
 * nothing typed has selected nothing yet, and matching all of them would send
 * the first `n` somewhere for no reason.
 */
export function searchMatches(entries: readonly SessionEntry[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  return entries
    .filter(({ project, session }) =>
      [session.title, session.id, session.epic ?? '', project.name]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
    .map(({ session }) => session.id);
}

/**
 * The next match after `currentId`, wrapping in both directions.
 *
 * When the cursor is not one of the matches — the usual case right after
 * typing a query — this lands on the first match rather than doing nothing, so
 * `/foo` then `n` goes somewhere useful instead of requiring a second `n`.
 */
export function cycleMatch(
  matches: readonly string[],
  currentId: string | null,
  delta: 1 | -1,
): string | null {
  if (matches.length === 0) {
    return null;
  }
  const index = currentId === null ? -1 : matches.indexOf(currentId);
  if (index === -1) {
    return matches[0] ?? null;
  }
  return matches[(index + delta + matches.length) % matches.length] ?? null;
}
