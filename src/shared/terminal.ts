/**
 * What the Terminal tab is given when it asks for a session's screen, and how
 * big a screen it may ask for.
 *
 * In `src/shared/` for the reason `usage.ts` is here: main
 * produces this, the preload forwards it and the renderer draws it, so it
 * cannot live in any one of the three.
 *
 * FIVE ANSWERS, AND THE SPLIT IS THE POINT (`sources/tmux/spawn.ts`). `ok` is
 * a screen. `not-vam` is vam having looked and found no session of its own for
 * this one -- which includes tmux reporting no server running, since no server
 * means no sessions. `gone` is a session vam did start that has since ended.
 * `ambiguous` is more than one session vam started for this project, where
 * showing either would be a coin toss the operator could not see; it carries
 * the names so the answer can say what it found. `unavailable` is vam not
 * having found out, and it carries the reason tmux gave. Collapsing the last
 * one into an empty pane would tell the operator there is nothing to look at
 * on the strength of never having looked.
 */

import type { SourceError } from '../renderer/sources/port.js';

export type PaneView =
  | { readonly kind: 'ok'; readonly name: string; readonly text: string }
  | { readonly kind: 'not-vam' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'ambiguous'; readonly names: readonly string[] }
  | { readonly kind: 'unavailable'; readonly error: SourceError };

/**
 * A terminal size, in tmux's own units.
 *
 * Here rather than beside the arithmetic that produces it (`renderer/panels/
 * terminal-size.ts`) because BOTH SIDES have to agree about it: the renderer
 * measures a size, and main has to bound the one it is handed. The renderer is
 * the least trusted process in the app, so the bounds are enforced again in
 * main -- and a bound enforced against a second copy of the numbers is a bound
 * that drifts.
 */
export type PaneSize = { readonly columns: number; readonly rows: number };

/**
 * The clamps. tmux accepts a resize to one column and then has nowhere to
 * draw, so a pane dragged almost shut would otherwise reflow a working agent's
 * screen into a ribbon; the floors are the smallest sizes at which a terminal
 * is still a terminal. The ceilings bound what a compromised renderer can ask
 * tmux to allocate.
 */
export const MIN_COLUMNS = 20;
export const MAX_COLUMNS = 500;
export const MIN_ROWS = 5;
export const MAX_ROWS = 300;

/** Whether a size is one vam will actually send to tmux. */
export function isPaneSize(size: PaneSize): boolean {
  return (
    Number.isInteger(size.columns) &&
    Number.isInteger(size.rows) &&
    size.columns >= MIN_COLUMNS &&
    size.columns <= MAX_COLUMNS &&
    size.rows >= MIN_ROWS &&
    size.rows <= MAX_ROWS
  );
}
