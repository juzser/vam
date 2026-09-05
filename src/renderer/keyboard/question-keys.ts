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
