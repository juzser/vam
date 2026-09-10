/**
 * The keys the QUESTION CARD answers to, resolved from the operator's own
 * binding table.
 *
 * WHY THIS MODULE EXISTS. The card used to test `event.key` against the
 * literals `h`, `j`, `k`, `l` and `c`, while `keysheet.ts` generated the
 * caption "move ⟨direction⟩ — the options of an open question, when one is
 * asked" from the live table. Rebind move to `w`/`s` and the sheet promised
 * `s` walks the options, `s` did nothing, and `j` still worked. One table, two
 * readers -- the sheet and the card -- is the only shape in which that cannot
 * happen again, and it is the same rule the canvas grammar already follows.
 *
 * ONE GRAMMAR FOR EVERY ASKING SHAPE. Whatever card is drawn -- a
 * single-select, a multi-select, a step of a multi-question call -- it walks
 * with these. A picker driven by one grammar beside a prompt driven by another
 * is the inconsistency the operator named.
 */

import { activeBindings, bindingChords, type KeyBindings, parseChord } from './chords.js';

export type QuestionKeys = {
  /** Down and up the OPTIONS of the step on screen. */
  readonly down: readonly string[];
  readonly up: readonly string[];
  /** Back and forward through the STEPS of a multi-question call. */
  readonly prev: readonly string[];
  readonly next: readonly string[];
  /**
   * Out of the picker and into prose. EMPTY when the operator has moved a
   * motion onto the same key: both meanings on one keystroke is an ambiguity
   * the card cannot resolve, and walking the list is what they just asked for.
   * A caller that prints a hint must print none when this is empty, or the
   * hint becomes the next lie.
   */
  readonly chat: readonly string[];
};

/** The key `chat` holds unless a motion has taken it. Not rebindable: it is
 *  not in `BINDING_TABLES`, and the sheet does not claim it is. */
const CHAT = 'c';

/**
 * The bare keys one motion holds. A CHORD contributes nothing: `gj` is two
 * keystrokes behind a prefix and the card hears one at a time, so counting it
 * would make the card answer to a bare `j` the operator had moved away.
 */
const bare = (overrides: KeyBindings, id: string): readonly string[] =>
  bindingChords(overrides, id)
    .map(parseChord)
    .filter((chord) => chord.prefix === '')
    .map((chord) => chord.key);

export function questionKeys(overrides: KeyBindings = activeBindings()): QuestionKeys {
  // THE ARROWS ARE NOT THE OPERATOR'S TO UNBIND HERE. This is a listbox, the
  // arrows are what a listbox answers to for every assistive technology that
  // will ever meet it, and a card whose only motion the operator has unbound
  // is a card with no way off row one.
  const of = (id: string, arrow: string) => [...bare(overrides, id), arrow];
  const down = of('move:down', 'ArrowDown');
  const up = of('move:up', 'ArrowUp');
  const prev = of('move:left', 'ArrowLeft');
  const next = of('move:right', 'ArrowRight');
  const taken = [...down, ...up, ...prev, ...next].includes(CHAT);
  return { down, up, prev, next, chat: taken ? [] : [CHAT] };
}

/**
 * What the card does about one keystroke, or `null` when it is not the card's.
 *
 * `walkOption` steps the options of the step on screen; `walkStep` steps
 * through the STEPS of a multi-question call; `mark` is a digit naming an
 * option by position; `toggle` is the pick under the cursor; `chat` leaves the
 * picker for prose.
 */
export type QuestionAction =
  | { readonly kind: 'walkOption'; readonly delta: 1 | -1 }
  | { readonly kind: 'walkStep'; readonly delta: 1 | -1 }
  /** ZERO-BASED — an index into the step's options, not the digit typed. The
   *  digit is 1-based because a POSITION is what the key means; converting it
   *  here is what stops two call sites doing the same arithmetic. */
  | { readonly kind: 'mark'; readonly at: number }
  | { readonly kind: 'toggle' }
  | { readonly kind: 'chat' };

/**
 * ONE RESOLUTION FOR THE CARD, IN THE GRAMMAR'S OWN VOCABULARY — audit F2.
 *
 * The listbox's listener sits BELOW the window listener in the bubble path, so
 * whatever the card claims, it claims first. That is deliberate, and it is
 * what keeps the two cursor modes out of each other's way without either side
 * enumerating the other's keys. What was NOT deliberate is that the card
 * decided by a different vocabulary, in a fixed order of its own:
 *
 *   - It matched raw `event.key`. `questionKeys()` has always been able to
 *     return `Mod-j` — `bindingChords` gives back whatever the capture box
 *     captured — and no raw `event.key` is ever equal to that. So a motion the
 *     operator had rebound onto a chord could not match here; it fell through
 *     to `Canvas`, which resolved it as `move` and walked the pane's ACTION
 *     index while the key sheet's caption promised the options.
 *
 *   - It resolved its own built-in digits BEFORE the operator's motions. The
 *     settings editor accepts a rebind of "down" onto `1` (nothing in
 *     `RESERVED_KEYS` forbids it, and nothing should), after which `1` marked
 *     option one and the rebind was simply lost — silently, with the sheet
 *     still promising the new key.
 *
 * PRECEDENCE, and the argument for it. The OPERATOR'S OWN BINDINGS COME FIRST,
 * then the card's built-ins. `chat` already worked this way — it hands `c`
 * over the moment a motion moves onto it, on the reasoning that two meanings
 * on one keystroke is an ambiguity the card cannot resolve, and walking the
 * list is what was just asked for. The digits and Enter/Space follow the same
 * rule now, because the rule was never about `c` in particular.
 *
 * The cost is stated rather than hidden: an operator who binds a motion to `1`
 * cannot mark option one by number any more. One digit, spent by them, in
 * exchange for a key that does what they and the sheet both say — against a
 * rebind that used to do nothing whatsoever.
 *
 * `key` is a NORMALIZED spelling (`normalizeKey`), and that is what let the
 * blanket "reject anything with a modifier on it" guard go: `Mod-c` is not
 * `c` and `Mod-2` is not `2` by construction, so `yy`'s cousin and the tab
 * chords reach the window listener without this file naming any of them.
 * `null` in — a bare modifier keydown — is `null` out.
 */
export function resolveQuestionKey(
  key: string | null,
  overrides: KeyBindings = activeBindings(),
): QuestionAction | null {
  if (key === null) {
    return null;
  }
  const keys = questionKeys(overrides);
  if (keys.down.includes(key)) return { kind: 'walkOption', delta: 1 };
  if (keys.up.includes(key)) return { kind: 'walkOption', delta: -1 };
  if (keys.next.includes(key)) return { kind: 'walkStep', delta: 1 };
  if (keys.prev.includes(key)) return { kind: 'walkStep', delta: -1 };
  if (keys.chat.includes(key)) return { kind: 'chat' };
  if (/^[1-9]$/.test(key)) return { kind: 'mark', at: Number(key) - 1 };
  if (key === 'Enter' || key === ' ') return { kind: 'toggle' };
  return null;
}
