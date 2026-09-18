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
import { normalizeKey } from '../../src/renderer/keyboard/chords.js';
import { questionKeys, resolveQuestionKey } from '../../src/renderer/keyboard/question-keys.js';

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

/**
 * AUDIT F2 — THE CARD USED TO RESOLVE KEYS BEFORE THE GRAMMAR DID, AND BY A
 * DIFFERENT VOCABULARY.
 *
 * The listbox sits below the window listener in the bubble path, so whatever
 * it claims, it claims first. Two things then leaked, and both are one
 * mistake: the card read RAW `event.key` and hard-ordered its own built-ins
 * ahead of the operator's table.
 *
 *  - The settings editor happily accepts a rebind of "down" to `1`. `1`
 *    already marked the first option and was checked FIRST, so the rebind
 *    silently lost: the sheet promised `1` walks the options, and it did not.
 *
 *  - Rebind a motion to a MODIFIED key and `questionKeys()` returns `Mod-j`,
 *    which no raw `event.key` can ever equal — and the card rejected every
 *    modified event before matching anyway. The keystroke fell through to
 *    `Canvas`, which resolved it as `move` and walked the pane's ACTION index
 *    instead of the options the sheet named.
 *
 * `resolveQuestionKey` is the fix: one resolution, over the same normalized
 * spelling `resolveChord` uses, with the operator's own bindings ahead of the
 * built-ins.
 */
describe('resolveQuestionKey — one resolution, in one vocabulary', () => {
  const at = (event: Parameters<typeof normalizeKey>[0], overrides = {}) =>
    resolveQuestionKey(normalizeKey(event), overrides);

  it('walks the options and the steps on the shipped grammar', () => {
    expect(at({ key: 'j' })).toEqual({ kind: 'walkOption', delta: 1 });
    expect(at({ key: 'k' })).toEqual({ kind: 'walkOption', delta: -1 });
    expect(at({ key: 'l' })).toEqual({ kind: 'walkStep', delta: 1 });
    expect(at({ key: 'h' })).toEqual({ kind: 'walkStep', delta: -1 });
  });

  it('answers the arrows, which are not the operator’s to unbind in a listbox', () => {
    expect(at({ key: 'ArrowDown' })).toEqual({ kind: 'walkOption', delta: 1 });
    expect(at({ key: 'ArrowRight' })).toEqual({ kind: 'walkStep', delta: 1 });
  });

  it('marks by number, and takes Enter and Space as the pick', () => {
    expect(at({ key: '3' })).toEqual({ kind: 'mark', at: 2 });
    expect(at({ key: 'Enter' })).toEqual({ kind: 'toggle' });
    expect(at({ key: ' ' })).toEqual({ kind: 'toggle' });
  });

  it('leaves the picker for prose on `c`', () => {
    expect(at({ key: 'c' })).toEqual({ kind: 'chat' });
  });

  it('gives the operator’s rebound motion the key, even when a digit held it', () => {
    // THE SILENT LOSS, made loud. `1` marked option one and was resolved
    // first, so a rebind the settings editor had accepted did nothing at all.
    const moved = { 'move:down': ['1'] };
    expect(at({ key: '1' }, moved)).toEqual({ kind: 'walkOption', delta: 1 });
    // And the digits that were not taken still mark, so the operator loses
    // exactly the one they spent and nothing else.
    expect(at({ key: '2' }, moved)).toEqual({ kind: 'mark', at: 1 });
  });

  it('answers a MODIFIED motion the operator bound, rather than dropping it', () => {
    // `questionKeys()` has always returned `Mod-j` here; the card rejected
    // every modified event before it could match, and `Canvas` then walked
    // the pane's action index under a caption promising the options.
    const moved = { 'move:down': ['Mod-j'] };
    expect(at({ key: 'j', metaKey: true }, moved)).toEqual({ kind: 'walkOption', delta: 1 });
  });

  it('leaves an UNBOUND chord to the grammar — the two cannot both answer', () => {
    // The reason the blanket "reject anything modified" guard could go: a
    // normalized spelling tells `Mod-c` from `c` and `Mod-2` from `2` by
    // construction, so the copy chord and the tab chords reach the window
    // listener without the card having to enumerate them.
    expect(at({ key: 'c', metaKey: true })).toBeNull();
    expect(at({ key: '2', metaKey: true, code: 'Digit2' })).toBeNull();
    expect(at({ key: 'j', metaKey: true })).toBeNull();
  });

  it('says nothing about a key it does not hold', () => {
    expect(at({ key: 'q' })).toBeNull();
    expect(at({ key: 'Escape' })).toBeNull();
    // A bare modifier is a hand moving; `normalizeKey` gives null and so does
    // this, rather than the card claiming a keystroke that never happened.
    expect(resolveQuestionKey(null)).toBeNull();
  });

  it('drops `c` when a motion has taken it, exactly as `questionKeys` reports', () => {
    expect(at({ key: 'c' }, { 'move:down': ['c'] })).toEqual({ kind: 'walkOption', delta: 1 });
  });
});
