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

import type { LayoutName } from '../prefs/panes.js';
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
export const PREFIXES = ['g', 'y', 'z'] as const;
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
  /** `o` — start a new session, the way `o` opens a new line. Bound plain
      because vam is browser-tested for now; once it runs in an Electron
      shell (like orca) the intended chord is `Mod-t`, which a desktop
      window can capture and a browser tab cannot. */
  | { readonly kind: 'newSession' }
  /** `F` — open or close the sidebar's filter popover. Shift-f, because
      plain `f` is already the jump-label move and this is its stronger,
      "narrow the whole list" cousin. */
  | { readonly kind: 'filterMenu' }
  /** `,` — settings, the convention most editors already use. */
  | { readonly kind: 'settings' }
  /** `?` — the shortcut sheet, generated from the tables below. Free on this
      layout, and a real Shift+`/` keydown normalizes to `?` itself (proven in
      test/keyboard/chords.test.ts, not assumed). */
  | { readonly kind: 'help' }
  /** `<` / `>` — narrow or widen the focused side pane by one step. */
  | { readonly kind: 'resizePane'; readonly delta: -1 | 1 }
  /** `z0` — the shipped layout back: both side panes at their default width
      AND all three columns drawn again. */
  | { readonly kind: 'resetPanes' }
  /** `zc` / `zC` hide columns, `zf` reorders them. See `AFTER_Z`. */
  | { readonly kind: 'layout'; readonly name: LayoutName }
  /** `Mod-1` … `Mod-8` — jump straight to a session by its position in the
      sidebar, zero-based here because that is what an index into the list is.
      `Mod-9` is deliberately NOT in this family: it is `last` (below). */
  | { readonly kind: 'sessionAt'; readonly index: number }
  | { readonly kind: 'cancel' };

export type ChordStep = {
  readonly state: ChordState;
  readonly action: KeyAction | null;
};

/**
 * The four motions, written as actions rather than as bare directions so they
 * sit in a table shaped like every other one — which is what lets the shortcut
 * sheet be generated by walking `BINDING_TABLES` instead of special-casing
 * hjkl, the one binding family a hand-written sheet would be most likely to
 * describe wrongly.
 */
const MOVES: Readonly<Record<string, KeyAction>> = {
  h: { kind: 'move', direction: 'left' },
  j: { kind: 'move', direction: 'down' },
  k: { kind: 'move', direction: 'up' },
  l: { kind: 'move', direction: 'right' },
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
  '?': { kind: 'help' },
  f: { kind: 'jump' },
  F: { kind: 'filterMenu' },
  G: { kind: 'last' },
  '/': { kind: 'search' },
  n: { kind: 'searchNext' },
  N: { kind: 'searchPrev' },
  Enter: { kind: 'open' },
  'Mod-k': { kind: 'palette' },
  // Cmd/Ctrl + a digit, the one shortcut every browser and terminal already
  // taught: 1..8 are positions, and 9 is the LAST one whatever the count —
  // far more use than a ninth position once the list outgrows nine. Written
  // out rather than generated so the table stays the one place every binding
  // can be read off. `Mod-0` is left unbound: `z0` already owns the zero.
  'Mod-1': { kind: 'sessionAt', index: 0 },
  'Mod-2': { kind: 'sessionAt', index: 1 },
  'Mod-3': { kind: 'sessionAt', index: 2 },
  'Mod-4': { kind: 'sessionAt', index: 3 },
  'Mod-5': { kind: 'sessionAt', index: 4 },
  'Mod-6': { kind: 'sessionAt', index: 5 },
  'Mod-7': { kind: 'sessionAt', index: 6 },
  'Mod-8': { kind: 'sessionAt', index: 7 },
  'Mod-9': { kind: 'last' },
  // The same action as `x`, under the chord a person coming from a browser or
  // a terminal already has in their fingers. It is `Mod-w` rather than a
  // second letter because "close this thing" IS Cmd-W everywhere else.
  //
  // IT COLLIDES WITH THE WINDOW, and the collision is resolved in main:
  // Electron's default macOS menu binds Cmd-W to Close Window, and a native
  // menu key equivalent is matched before the page ever sees the keydown. So
  // `src/main/menu.ts` releases that one item at startup; without it this
  // binding would be dead in the packaged app while passing every test here.
  'Mod-w': { kind: 'close' },
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

/**
 * `z` is vim's "adjust the view" namespace — which is exactly what hiding a
 * column is — so the layouts live here rather than taking three more of the
 * dwindling single keys.
 *
 * `zc` is vim's "close a fold", and closing the canvas is the same gesture on
 * the same key: the thing in front of you folds away and its neighbours take
 * the room. `zC` is vim's "close them recursively", i.e. the same idea taken
 * further — here, everything but the response. The pair reads as one binding
 * with a stronger form, the way `gt`/`gT` and `n`/`N` already do in this table.
 *
 * `z0` is the undo for both, and restores visibility as well as width — see
 * the `resetPanes` handler in Canvas.tsx for why that is one idea, not two.
 */
const AFTER_Z: Readonly<Record<string, KeyAction>> = {
  '0': { kind: 'resetPanes' },
  c: { kind: 'layout', name: 'noCanvas' },
  C: { kind: 'layout', name: 'responseOnly' },
  // `f` for focus, and the odd one out of this table: it hides nothing. It
  // moves the response into the middle and the canvas out to a strip, which is
  // still "adjust the view" and so still belongs under `z`.
  f: { kind: 'layout', name: 'focusResponse' },
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

  return { state: EMPTY_CHORD, action: MOVES[key] ?? SINGLE[key] ?? null };
}

/**
 * Every binding table, each with the key that must be typed before it.
 *
 * The one enumeration of the grammar's surface. The shortcut sheet is built by
 * walking this and looking each action up, so it is structurally incapable of
 * naming a key nothing is bound to — and a chord is spelled `prefix + key`
 * (`gt`, `yy`, `z0`) because that is the keystroke, whereas its bare second
 * key is unbound and printing it would be the very defect this guards against.
 */
export const BINDING_TABLES: readonly {
  readonly prefix: string;
  readonly table: Readonly<Record<string, KeyAction>>;
}[] = [
  { prefix: '', table: MOVES },
  { prefix: '', table: SINGLE },
  { prefix: 'g', table: AFTER_G },
  { prefix: 'y', table: AFTER_Y },
  { prefix: 'z', table: AFTER_Z },
];
