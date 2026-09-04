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

import type { Tab as DetailTab } from '../panels/DetailPanel.js';
import type { LayoutName } from '../prefs/panes.js';
import type { Direction } from './spatial-nav.js';

/** A `KeyboardEvent`, narrowed to what the grammar reads. */
export type KeyEventLike = {
  readonly key: string;
  /**
   * The PHYSICAL key, when the event reports one. Read for the digit row only
   * (see `normalizeKey`), and optional because every other caller in this
   * codebase builds these by hand from a `key` alone.
   */
  readonly code?: string | undefined;
  readonly ctrlKey?: boolean | undefined;
  readonly metaKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
};

/** Pressing one of these alone is not a keystroke, it is a hand moving. */
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);

/**
 * The number row's position, `'0'`..`'9'`, or null when this is not one of
 * those keys.
 *
 * `code` first, because that is the position; `key` only as the fallback for
 * an event that reports no code — every hand-built `KeyEventLike` in the tests
 * and, historically, every browser before `code` existed. `Numpad1` is
 * deliberately not matched: it is a different key, and under Shift it does not
 * even produce a digit.
 */
function digitPosition(event: KeyEventLike): string | null {
  const fromCode = /^Digit([0-9])$/.exec(event.code ?? '');
  if (fromCode?.[1] !== undefined) {
    return fromCode[1];
  }
  return /^[0-9]$/.test(event.key) ? event.key : null;
}

/**
 * A `KeyboardEvent` reduced to the one string a binding is written in, or
 * `null` when the event is not a keystroke at all.
 *
 * `Mod` folds Ctrl and Cmd together, borrowing orca's token (§4.1): vam runs on
 * one machine at a time, both spellings mean the same intent, and keeping them
 * apart would mean declaring every binding twice.
 *
 * Shift deliberately gets no token *for characters*. The browser already
 * applied it — `G` and `?` arrive as themselves — so adding one would give the
 * same keystroke two spellings, and only one of them would ever match.
 *
 * THE DIGIT ROW UNDER A MODIFIER IS THE EXCEPTION, and it is an exception
 * because those bindings are about a POSITION rather than a character: the
 * table's own comment says "1..8 are positions". A character-based spelling
 * cannot keep that promise, and failed it twice. Shift alters a digit, so
 * `Cmd+Shift+1` arrives as `!` and would have to be written `Mod-!` — a
 * spelling no key sheet can render as a position. And on any layout whose
 * digit row is shifted (AZERTY), plain `Cmd+1` arrives as `&`, so the shipped
 * `sessionAt` bindings were simply DEAD there.
 *
 * `event.code` answers both: `Digit1` is the position, whatever the layout put
 * on it, so the digit row keeps one spelling everywhere and Shift can carry a
 * token there without giving any keystroke a second one. Letters stay folded.
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
  const digit = digitPosition(event);
  if (digit !== null) {
    return `${mod ? 'Mod-' : ''}${alt ? 'Alt-' : ''}${event.shiftKey === true ? 'Shift-' : ''}${digit}`;
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
  /** `o` / `Mod-n` — start a new session. `o` the way `o` opens a new line,
      and `Mod-n` because that is what "new" is bound to everywhere else. */
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
  /** `Mod-Shift-1` … `Mod-Shift-4` — show one of the detail pane's tabs. Named
      rather than numbered because a position is what the KEY means, not what
      the action does: reorder the bar and the binding follows the name, and
      the sheet keeps saying which tab it opens. Type-only import, so the
      grammar still pulls no component in at runtime. */
  | { readonly kind: 'detailTab'; readonly tab: DetailTab }
  /** `p` — reveal the focused session's project in the sidebar and put the
      keyboard on its fold. */
  | { readonly kind: 'revealProject' }
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
  // The same digit row, one row up: Shift makes it a POSITION IN THE TAB BAR
  // rather than in the sidebar. A letter would have fought the prompt box,
  // which is where an operator's hands are when they want another tab, and
  // `Mod-1`..`Mod-9` were already taken. Spelled by position (`normalizeKey`
  // reads `event.code` for the digit row), so `Cmd+Shift+1` is this binding
  // and not the `!` the browser would otherwise have handed us.
  'Mod-Shift-1': { kind: 'detailTab', tab: 'Response' },
  'Mod-Shift-2': { kind: 'detailTab', tab: 'PRs' },
  'Mod-Shift-3': { kind: 'detailTab', tab: 'Terminal' },
  'Mod-Shift-4': { kind: 'detailTab', tab: 'Agents' },
  // `p` for project. It shipped hand-wired to its own window listener in
  // SessionList.tsx, which cost it both properties this table exists to give:
  // it appeared in no key sheet, and it fired straight through an open
  // overlay. Being here is the fix for both at once.
  p: { kind: 'revealProject' },
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
  // And the same shape for creating one: `o` is the vim gesture, `Mod-n` is
  // the chord every application on the machine already spells "new". Both, not
  // one — an operator whose hands are on the prompt box reaches for Cmd-N, and
  // an operator navigating the canvas reaches for `o`.
  //
  // Free: plain `n` is `searchNext` and stays that way, since `normalizeKey`
  // gives a modified letter its own `Mod-` spelling. Deliberately reachable
  // from inside the prompt box — the tab chords let modifier keystrokes past
  // the INPUT|TEXTAREA guard, and a Cmd chord produces no character on any layout,
  // so it cannot be a keystroke the operator meant for the text.
  'Mod-n': { kind: 'newSession' },
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
export function resolveChord(
  state: ChordState,
  key: string,
  overrides: KeyBindings = activeBindings(),
): ChordStep {
  if (key === 'Escape') {
    return { state: EMPTY_CHORD, action: { kind: 'cancel' } };
  }
  const tables = tablesFor(overrides);

  if (state.pending !== null) {
    const action = tables.chords[state.pending]?.[key];
    // A completed chord clears the memory, so `ggg` is `gg` then a fresh `g`
    // rather than two jumps to the top.
    return { state: EMPTY_CHORD, action: action ?? null };
  }

  if (isPrefix(key)) {
    return { state: { pending: key }, action: null };
  }

  return { state: EMPTY_CHORD, action: tables.top[key] ?? null };
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

/* ---------------------------------------------------------------------------
 * Operator overrides.
 *
 * The tables above are the SHIPPED grammar; what is actually in force is the
 * shipped grammar with the operator's overrides laid over it. Everything below
 * derives that, and both readers of the grammar — `resolveChord` and the
 * shortcut sheet — go through it, so the sheet keeps the one property it was
 * written for: it can only name a key that is really bound.
 * ------------------------------------------------------------------------ */

/** How many keys one action may hold. Two: the shipped table already binds
 *  `close` twice (`x`, `Mod-w`), and a third is a keymap, not a preference. */
export const MAX_BINDINGS = 2;

/**
 * The keys nothing may be bound to, named HERE and nowhere else.
 *
 * `Escape` because it is how a capture box is cancelled and how every overlay
 * closes (an open overlay owns the keyboard entirely), so a binding on it
 * would be unreachable at best and a trap at worst. `g`, `y` and `z` because
 * they are not keys, they are the doors to the chord tables: bound alone, they
 * would shadow every chord behind them.
 */
export const RESERVED_KEYS: readonly string[] = ['Escape', ...PREFIXES];

export function isReserved(key: string): boolean {
  return RESERVED_KEYS.includes(key);
}

/**
 * A stable, storable name for one action.
 *
 * Parameterised actions carry their parameter, or every `move` would share one
 * id and rebinding `h` would rebind all four.
 */
export function actionId(action: KeyAction): string {
  switch (action.kind) {
    case 'move':
      return `move:${action.direction}`;
    case 'layout':
      return `layout:${action.name}`;
    case 'sessionAt':
      return `sessionAt:${action.index}`;
    case 'detailTab':
      return `detailTab:${action.tab}`;
    case 'project':
      return `project:${action.delta}`;
    case 'resizePane':
      return `resizePane:${action.delta}`;
    default:
      return action.kind;
  }
}

/** One keystroke: a top-level key, or a chord's second key behind its prefix. */
export type Chord = { readonly prefix: string; readonly key: string };

/** What the operator stored: action id → the keys it holds. An ABSENT id means
 *  "the shipped bindings"; a present one replaces them, including an empty
 *  array, which is the honest spelling of "I unbound this". */
export type KeyBindings = Readonly<Record<string, readonly string[]>>;

export const NO_BINDINGS: KeyBindings = {};

export type Binding = {
  readonly id: string;
  readonly action: KeyAction;
  readonly chords: readonly Chord[];
};

/** How a chord is written down — in the sheet, in a slot, and in storage. */
export function chordText(chord: Chord): string {
  return `${chord.prefix}${chord.key}`;
}

/** The inverse. Only a two-character string opening with a prefix is a chord:
 *  a captured keystroke is a single character or a named key (`Enter`,
 *  `Mod-k`), never `gt`, so nothing an operator can press parses as one. */
export function parseChord(text: string): Chord {
  const head = text[0] ?? '';
  return text.length === 2 && isPrefix(head)
    ? { prefix: head, key: text.slice(1) }
    : { prefix: '', key: text };
}

/** The shipped grammar as one entry per action, in table order. */
export function defaultBindings(): readonly Binding[] {
  const out: Binding[] = [];
  const at = new Map<string, number>();
  for (const { prefix, table } of BINDING_TABLES) {
    for (const [key, action] of Object.entries(table)) {
      const id = actionId(action);
      const seen = at.get(id);
      const previous = seen === undefined ? undefined : out[seen];
      if (seen === undefined || previous === undefined) {
        at.set(id, out.length);
        out.push({ id, action, chords: [{ prefix, key }] });
      } else {
        out[seen] = { ...previous, chords: [...previous.chords, { prefix, key }] };
      }
    }
  }
  return out;
}

const DEFAULTS = defaultBindings();

/** The shipped grammar with the overrides laid over it: what is in force. */
export function effectiveBindings(overrides: KeyBindings = activeBindings()): readonly Binding[] {
  return DEFAULTS.map((binding) => {
    const chosen = overrides[binding.id];
    return chosen === undefined ? binding : { ...binding, chords: chosen.map(parseChord) };
  });
}

/** The chords one action holds right now, as the operator's slots show them. */
export function bindingChords(overrides: KeyBindings, id: string): readonly string[] {
  return (
    effectiveBindings(overrides)
      .find((binding) => binding.id === id)
      ?.chords.map(chordText) ?? []
  );
}

/**
 * The action `key` already belongs to, or null when it is free.
 *
 * Read off what is IN FORCE, not off the shipped tables: a key the operator
 * freed a moment ago by moving its action elsewhere is free, and a key they
 * just took is taken.
 */
export function bindingConflict(overrides: KeyBindings, id: string, key: string): string | null {
  for (const binding of effectiveBindings(overrides)) {
    if (binding.id === id) continue;
    if (binding.chords.some((chord) => chord.prefix === '' && chord.key === key)) {
      return binding.id;
    }
  }
  return null;
}

/**
 * Put `key` in one of an action's slots.
 *
 * Seeded from what the action holds now, so editing the second slot of an
 * action whose first is a chord (`gg`, `yy`) does not silently unbind the
 * chord — it cannot be retyped into a capture box, so dropping it would be a
 * one-way door.
 */
export function bindKey(
  overrides: KeyBindings,
  id: string,
  slot: number,
  key: string,
): KeyBindings {
  const next = [...bindingChords(overrides, id)];
  const index = Math.min(Math.max(slot, 0), Math.min(next.length, MAX_BINDINGS - 1));
  next[index] = key;
  return { ...overrides, [id]: next.slice(0, MAX_BINDINGS) };
}

/** Back to the shipped bindings for one action — by REMOVING the override,
 *  never by storing today's keys, which would freeze them forever. */
export function clearBindings(overrides: KeyBindings, id: string): KeyBindings {
  const next: Record<string, readonly string[]> = {};
  for (const key of Object.keys(overrides)) {
    if (key !== id) {
      next[key] = overrides[key] as readonly string[];
    }
  }
  return next;
}

type Tables = {
  readonly top: Record<string, KeyAction>;
  readonly chords: Record<string, Record<string, KeyAction>>;
};

function buildTables(overrides: KeyBindings): Tables {
  const top: Record<string, KeyAction> = {};
  const chords: Record<string, Record<string, KeyAction>> = {};
  for (const prefix of PREFIXES) {
    chords[prefix] = {};
  }
  const bindings = effectiveBindings(overrides);
  const put = (binding: Binding) => {
    for (const chord of binding.chords) {
      const table = chord.prefix === '' ? top : chords[chord.prefix];
      if (table !== undefined) {
        table[chord.key] = binding.action;
      }
    }
  };
  // Shipped bindings first, overrides second: if the operator took a key that
  // something else still holds by default, the operator wins — deterministically
  // rather than by table order. The UI refuses that bind before it gets here;
  // this is what happens when a hand-edited payload does it anyway.
  for (const binding of bindings) {
    if (overrides[binding.id] === undefined) put(binding);
  }
  for (const binding of bindings) {
    if (overrides[binding.id] !== undefined) put(binding);
  }
  return { top, chords };
}

let active: KeyBindings = NO_BINDINGS;
let cachedFor: KeyBindings | null = null;
let cached: Tables = buildTables(NO_BINDINGS);

function tablesFor(overrides: KeyBindings): Tables {
  if (cachedFor !== overrides) {
    cached = buildTables(overrides);
    cachedFor = overrides;
  }
  return cached;
}

/**
 * Hand the grammar the operator's overrides.
 *
 * A module-level singleton on purpose: `resolveChord` is called from a window
 * listener and `buildKeySheet` from two overlays, none of which is the owner of
 * the preferences, and threading a binding map through all three would be a
 * change to files this feature has no business editing. `prefs.ts` calls this
 * on every read and every write, so "what is stored" and "what is in force"
 * cannot drift.
 */
export function setActiveBindings(overrides: KeyBindings): void {
  active = overrides;
}

export function activeBindings(): KeyBindings {
  return active;
}
