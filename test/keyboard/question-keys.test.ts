/**
 * The question card's keys, resolved from the SAME table the key sheet reads.
 *
 * THE DEFECT THIS CLOSES. `keysheet.ts` generates the caption "move
 * ⟨direction⟩ — the options of an open question, when one is asked" from the
 * live binding table, while the card tested `event.key` against the literals
 * `h`, `j`, `k`, `l`. Rebind move to `w`/`s` and the sheet said `s` walks the
 * options while `s` did nothing and `j` still worked -- the same class as the
 * three key-literal lies already fixed in this repo.
 */

import { describe, expect, it } from 'vitest';
import { questionKeys } from '../../src/renderer/keyboard/question-keys.js';

describe('questionKeys', () => {
  it('is hjkl plus the arrows on the shipped grammar', () => {
    const keys = questionKeys({});
    expect(keys.down).toEqual(['j', 'ArrowDown']);
    expect(keys.up).toEqual(['k', 'ArrowUp']);
    expect(keys.prev).toEqual(['h', 'ArrowLeft']);
    expect(keys.next).toEqual(['l', 'ArrowRight']);
    expect(keys.chat).toEqual(['c']);
  });

  it('follows the operator when they move the binding', () => {
    const keys = questionKeys({ 'move:down': ['s'], 'move:up': ['w'] });
    expect(keys.down).toEqual(['s', 'ArrowDown']);
    expect(keys.up).toEqual(['w', 'ArrowUp']);
    // The pair they did NOT touch is unchanged, not blanked.
    expect(keys.prev).toEqual(['h', 'ArrowLeft']);
  });

  it('keeps the arrows when the operator unbinds a direction entirely', () => {
    // An empty array is the honest spelling of "I unbound this" -- and the
    // arrows are not the operator's to unbind here: they are what a listbox
    // answers to, and a card with no way out of row one is not a card.
    expect(questionKeys({ 'move:down': [] }).down).toEqual(['ArrowDown']);
  });

  it('ignores a CHORD, which no bare keystroke in the list can be', () => {
    // `gj` is two keystrokes behind a prefix; the card hears one key at a
    // time, so a chord bound to a move contributes nothing here rather than
    // making the card answer to a bare `j` the operator moved away.
    expect(questionKeys({ 'move:down': ['gj'] }).down).toEqual(['ArrowDown']);
  });

  it('gives up `c` when the operator has moved a motion onto it', () => {
    // Both meanings on one key is the ambiguity the card cannot resolve, and
    // walking the list is the one the operator just asked for. The caller
    // prints no `c` hint when this is empty, so the sheet and the card still
    // agree.
    expect(questionKeys({ 'move:down': ['c'] }).chat).toEqual([]);
    expect(questionKeys({ 'move:down': ['c'] }).down).toEqual(['c', 'ArrowDown']);
  });
});
