/**
 * The vim chord layer: one key in, at most one action out.
 *
 * docs/design/canvas-layout.md §4 is the map this implements. §4.1 records why
 * it is written rather than borrowed: orca has a mature keybinding system —
 * an action registry, user overrides, conflict detection, even
 * `isDoubleTapBinding` — but **no vim mode**, so the chord grammar itself had
 * nowhere to come from.
 *
 * Deliberately a pure reducer over a one-key memory. Keeping it out of React
 * means the grammar can be tested exhaustively without a DOM, and means the
 * hook that owns the listener has no rules in it to drift from these.
 */

import type { Direction } from './spatial-nav.js';

/** A `KeyboardEvent`, narrowed to what the grammar reads. */
export type KeyEventLike = {
  readonly key: string;
  readonly ctrlKey?: boolean | undefined;
  readonly metaKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
};

/** Pressing one of these alone is not a keystroke, it is a hand moving. */
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);

/**
 * A `KeyboardEvent` reduced to the one string a binding is written in, or
 * `null` when the event is not a keystroke at all.
 *
 * `Mod` folds Ctrl and Cmd together, borrowing orca's token (§4.1): vam runs on
 * one machine at a time, both spellings mean the same intent, and keeping them
 * apart would mean declaring every binding twice.
 *
 * Shift deliberately gets no token. The browser already applied it — `G` and
 * `?` arrive as themselves — so adding one would give the same keystroke two
 * spellings, and only one of them would ever match.
 *
 * Returning `null` for a bare modifier is what stops reaching for a shortcut
 * and thinking better of it from silently eating a half-typed `g`.
 */
export function normalizeKey(event: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  const mod = event.ctrlKey === true || event.metaKey === true;
  const alt = event.altKey === true;
  if (!mod && !alt) {
    return event.key;
  }
  // Under a modifier the letter is lower-cased so Cmd-K and Cmd-Shift-K do not
  // become two different bindings for one gesture.
  const base = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return `${mod ? 'Mod-' : ''}${alt ? 'Alt-' : ''}${base}`;
}

/** Keys that open a chord instead of doing something on their own. */
const PREFIXES = ['g', 'y', 'z'] as const;
type Prefix = (typeof PREFIXES)[number];

export type ChordState = {
  /** The chord key already typed, or null when nothing is half-typed. */
  readonly pending: Prefix | null;
};

export const EMPTY_CHORD: ChordState = { pending: null };

export type KeyAction =
  | { readonly kind: 'move'; readonly direction: Direction }
  | { readonly kind: 'first' }
  | { readonly kind: 'last' }
  | { readonly kind: 'project'; readonly delta: 1 | -1 }
  | { readonly kind: 'jump' }
  | { readonly kind: 'copy' }
  | { readonly kind: 'open' }
  | { readonly kind: 'search' }
  | { readonly kind: 'searchNext' }
  | { readonly kind: 'searchPrev' }
  | { readonly kind: 'palette' }
  /** `i` — put the caret in the prompt box aimed at the focused session. */
  | { readonly kind: 'prompt' }
  /** `I` — move keyboard control into the action pane on the right. */
  | { readonly kind: 'focusAction' }
  /** `H` — back to the session list on the left. */
  | { readonly kind: 'focusList' }
  /** `r` — rename the focused session in place. */
  | { readonly kind: 'rename' }
  /** `s` — pick the focused session's icon. */
  | { readonly kind: 'icon' }
  /** `x` — close the focused session. */
  | { readonly kind: 'close' }
  /** `o` — start a new session, the way `o` opens a new line. */
  | { readonly kind: 'newSession' }
  /** `,` — settings, the convention most editors already use. */
  | { readonly kind: 'settings' }
  /** `<` / `>` — narrow or widen the focused side pane by one step. */
  | { readonly kind: 'resizePane'; readonly delta: -1 | 1 }
  /** `z0` — set both side panes back to their shipped defaults. */
  | { readonly kind: 'resetPanes' }
  | { readonly kind: 'cancel' };

export type ChordStep = {
  readonly state: ChordState;
  readonly action: KeyAction | null;
};

const DIRECTIONS: Readonly<Record<string, Direction>> = {
  h: 'left',
  j: 'down',
  k: 'up',
  l: 'right',
};

/**
 * The single-key bindings.
 *
 * Chosen so a vim user does not have to learn them so much as guess them:
 * `i` stops moving and starts saying something, `I` is its stronger form and
 * moves the whole caret into the pane where saying things happens, `H` and `L`
 * are already "far left" and "far right", `o` opens a new one, `r` replaces a
 * name, `x` deletes. Only `s` (icon) and `,` (settings) are conventions borrowed
 * from elsewhere, and both are conventions rather than inventions.
 *
 * Orca's sidebar has the same capabilities under Cmd-chords — `workspace.rename`,
 * `workspace.delete`, `sidebar.search.toggle`, `sidebar.focusWorktreeList` — so
 * what is borrowed here is the vocabulary, not the keys (§4.1).
 */
const SINGLE: Readonly<Record<string, KeyAction>> = {
  i: { kind: 'prompt' },
  I: { kind: 'focusAction' },
  H: { kind: 'focusList' },
  r: { kind: 'rename' },
  s: { kind: 'icon' },
  x: { kind: 'close' },
  o: { kind: 'newSession' },
  ',': { kind: 'settings' },
  f: { kind: 'jump' },
  G: { kind: 'last' },
  '/': { kind: 'search' },
  n: { kind: 'searchNext' },
  N: { kind: 'searchPrev' },
  Enter: { kind: 'open' },
  'Mod-k': { kind: 'palette' },
  // Vim's own "shift this leftwards / rightwards" — literally what moving a
  // side pane's boundary is. A real Shift+, / Shift+. keydown normalizes to
  // the browser-applied `<` / `>` here, distinct from the plain `,` above
  // (proven by test, not assumed — epic.md §4.5).
  '<': { kind: 'resizePane', delta: -1 },
  '>': { kind: 'resizePane', delta: 1 },
};

const AFTER_G: Readonly<Record<string, KeyAction>> = {
  g: { kind: 'first' },
  t: { kind: 'project', delta: 1 },
  T: { kind: 'project', delta: -1 },
};

const AFTER_Y: Readonly<Record<string, KeyAction>> = {
  y: { kind: 'copy' },
};

/** `z` is vim's "adjust the view" namespace; `z0` restores both side panes. */
const AFTER_Z: Readonly<Record<string, KeyAction>> = {
  '0': { kind: 'resetPanes' },
};

function isPrefix(key: string): key is Prefix {
  return (PREFIXES as readonly string[]).includes(key);
}

/**
 * Advance the chord machine by one key.
 *
 * Escape always wins: it cancels whatever is half-typed *and* reports the
 * cancel, because the top layer may also need closing.
 *
 * An unrecognised second key **abandons the chord silently** rather than
 * falling through to its standalone meaning. `gj` doing nothing is a key that
 * was wasted; `gj` moving down is the cursor going somewhere nobody asked for,
 * and on a canvas you navigate by muscle that is the more expensive mistake.
 */
export function resolveChord(state: ChordState, key: string): ChordStep {
  if (key === 'Escape') {
    return { state: EMPTY_CHORD, action: { kind: 'cancel' } };
  }

  if (state.pending !== null) {
    const table = state.pending === 'g' ? AFTER_G : state.pending === 'y' ? AFTER_Y : AFTER_Z;
    const action = table[key];
    // A completed chord clears the memory, so `ggg` is `gg` then a fresh `g`
    // rather than two jumps to the top.
    return { state: EMPTY_CHORD, action: action ?? null };
  }

  if (isPrefix(key)) {
    return { state: { pending: key }, action: null };
  }

  const direction = DIRECTIONS[key];
  if (direction !== undefined) {
    return { state: EMPTY_CHORD, action: { kind: 'move', direction } };
  }

  return { state: EMPTY_CHORD, action: SINGLE[key] ?? null };
}
