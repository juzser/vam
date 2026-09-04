/**
 * What the Terminal tab is given when it asks for a session's screen.
 *
 * Types only, in `src/shared/` for the reason `usage.ts` is here: main
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
