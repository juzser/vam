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
 * `main/terminal/start-screen.ts`) -- THREE STATES, not two, and collapsing
 * them was an S2 (a starship/pure prompt echoes its OWN `❯` in front of a
 * `claude` an operator has typed but not yet run, which `screen` alone reads
 * as `ready`, READY_CARET being deliberately blind to the foreground command
 * -- `sources/claude-code/start-screen.ts`'s own header):
 *
 *  - `undefined` -- the pane's foreground is still a plain SHELL (or
 *    `readStartScreen` has no command to read at all). NOT a guess, and NOT
 *    confirmed running: a caller polling for readiness must keep polling,
 *    never treat this as "something is running, unidentified".
 *  - `null` -- CONFIRMED running (the foreground is neither a shell nor
 *    listed provider table entry): an `htop`, an editor, anything the
 *    operator typed by hand that names neither table entry.
 *  - a `ProviderId` -- the command matched the table directly, or `claude`'s
 *    own bare-version-string quirk.
 */
export type StartScreenView =
  | {
      readonly kind: 'ok';
      readonly screen: StartScreenKind;
      readonly provider: ProviderId | null | undefined;
    }
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
