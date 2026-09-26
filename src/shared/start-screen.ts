/**
 * What the CLI's own screen is showing while a Start-session/Resume wait is
 * up, read straight off the pane -- `answer.ts`'s own reason this lives in
 * `src/shared/`: main performs the read, the preload forwards it, the
 * renderer draws the outcome, so it belongs to none of the three.
 *
 * `detectStartScreen` (main, `sources/claude-code/start-screen.ts`) is the
 * classifier; this file is only the shape crossing the IPC boundary.
 */

import type { ProviderId } from './providers.js';

/** `sources/claude-code/start-screen.ts`'s own type -- re-exported here so
 *  the renderer never imports a main-process module for it. */
export type StartScreenKind = 'trust' | 'update' | 'login' | 'onboarding' | 'ready' | 'unknown';

/**
 * What vam sees in a row's pane -- a screen, or the reason there is not one.
 * Same five non-`ok` answers `PromptView` (`answer.ts`) already carries, and
 * for the identical reasons: `unaimed` is no row named, `unavailable` is tmux
 * not answering, `mispaired` is a published pane vam refused, `unreadable` is
 * vam having looked and failed to read the pane.
 *
 * `provider` IS A SEPARATE READ FROM `screen`, on purpose -- the pane's own
 * TEXT (`detectStartScreen`) never says which CLI drew it, and `claude`'s own
 * measured quirk (its foreground command is a bare version string, e.g.
 * `2.1.282`, never the word `claude`) means the two providers cannot be told
 * apart by `screen` alone either. This is `pane_current_command`, classified
 * against the provider table (`identifyRunningProvider`,
 * `main/terminal/start-screen.ts`) -- `null` when the pane is a plain shell
 * or the command matches neither provider, never a guess.
 */
export type StartScreenView =
  | { readonly kind: 'ok'; readonly screen: StartScreenKind; readonly provider: ProviderId | null }
  | { readonly kind: 'unaimed' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'mispaired' }
  | { readonly kind: 'unreadable' };

/**
 * What answering the trust dialog came back with -- `null` when the keys
 * landed, `unaimed` when vam could not name a single session for the row
 * (mirroring `StartScreenView`'s own arm), or the `SourceError`
 * `sources/claude-code/start-screen.ts`'s `answerTrustDialog` refused with.
 * `SourceError` is structural (`kind`/`code`/`message`), so it is named here
 * rather than imported from main -- the preload and the renderer take the
 * shape, never the module.
 */
export type AnswerTrustResult =
  | null
  | { readonly kind: 'unaimed' }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string };
