/**
 * What the Terminal tab is given when it asks for a session's screen, and how
 * big a screen it may ask for.
 *
 * In `src/shared/` for the reason `usage.ts` is here: main
 * produces this, the preload forwards it and the renderer draws it, so it
 * cannot live in any one of the three.
 *
 * SIX ANSWERS, AND THE SPLIT IS THE POINT (`sources/tmux/spawn.ts`). `ok` is
 * a screen. `not-vam` is vam having looked and found no session of its own for
 * this one -- which includes tmux reporting no server running, since no server
 * means no sessions. `gone` is a session vam did start that has since ended.
 * `ambiguous` is more than one session vam started for this project, where
 * showing either would be a coin toss the operator could not see; it carries
 * the names so the answer can say what it found. `unavailable` is vam not
 * having found out, and it carries the reason tmux gave. Collapsing the last
 * one into an empty pane would tell the operator there is nothing to look at
 * on the strength of never having looked.
 *
 * `mispaired` is the sixth and the newest, and it exists because `not-vam` was
 * being told for it. The row PUBLISHED the pane it is running in
 * (`sources/claude-code/session-pane.ts`) and that pane is not one vam can use
 * for this project -- another project's, ended, or never vam's at all. "vam
 * did not start a session for this one" is then false in the way that costs an
 * operator time: vam did start one, it simply cannot prove that one is this
 * row's, and the two facts send a person to different places. It carries the
 * name the row published so the answer can say what it was asked to trust.
 */

import type { SourceError } from '../renderer/sources/port.js';

export type PaneView =
  | { readonly kind: 'ok'; readonly name: string; readonly text: string }
  | { readonly kind: 'not-vam' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'ambiguous'; readonly names: readonly string[] }
  | { readonly kind: 'mispaired'; readonly published: string }
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

/**
 * ONE KEYSTROKE, on its way to the pane -- and every kind is one of the two
 * ways tmux can deliver one (`sources/tmux/argv.ts`).
 *
 * `text` is typed LITERALLY (`send-keys -l --`), which is what stops a pane
 * being sent `^[` because the operator typed the letters of `Escape`. `enter`,
 * `backspace` and `back-tab` have to be INTERPRETED, which `-l` forbids, so
 * each is its own kind rather than a character inside the text -- measured,
 * `send-keys -l -- 'BSpace'` types the word into the line.
 *
 * THE LIST IS DELIBERATELY THIS SHORT. It is not a key-forwarding mechanism:
 * three of these are what typing is made of -- characters, submit, correct --
 * and anything else that ever belongs here is a decision, not an addition.
 * `back-tab` is that decision made once: the chord a Claude Code session
 * binds to cycling its own mode, a KIND rather than a key name in a field --
 * a field would let the least trusted process in the app ask for `C-c`.
 *
 * A discriminated pair rather than a string with a flag: the renderer is the
 * least trusted process in the app, and "was this literal?" must not be a
 * boolean that a missing field can make false.
 */
export type PaneKey =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'enter' }
  | { readonly kind: 'backspace' }
  /** Shift-Tab, `BTab` to tmux -- the session's own cycle-the-mode chord. */
  | { readonly kind: 'back-tab' };

/**
 * The longest text one keystroke may carry. A `KeyboardEvent.key` for a
 * printable key is one character, and a composed one (an IME, a dead key) is
 * a very few. The bound is what keeps this channel from becoming an unbounded
 * paste into a running agent by a renderer that is no longer vam's.
 */
export const MAX_KEY_TEXT = 16;

/**
 * What became of one keystroke. THREE ANSWERS, and the split exists because a
 * boolean made the tab lie.
 *
 * `unaimed` is vam declining to guess: no session of its own answers for this
 * project, or two do. `refused` is tmux having rejected the delivery to a
 * session vam DID name -- overwhelmingly the session ending between the
 * listing and the send, which the tab's own next read will show as `gone`.
 * They are different sentences to a person: one sends them looking for a
 * pairing problem, the other tells them their agent exited. A single `false`
 * said the first for both.
 */
export type PaneSendResult = 'sent' | 'unaimed' | 'refused';

/** Whether a value off the bridge is a keystroke vam will send. */
export function isPaneKey(value: unknown): value is PaneKey {
  if (typeof value !== 'object' || value === null) return false;
  const key = value as { kind?: unknown; text?: unknown };
  if (key.kind === 'enter' || key.kind === 'backspace' || key.kind === 'back-tab') return true;
  return (
    key.kind === 'text' &&
    typeof key.text === 'string' &&
    key.text.length > 0 &&
    key.text.length <= MAX_KEY_TEXT
  );
}
