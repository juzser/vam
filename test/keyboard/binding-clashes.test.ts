/**
 * Two actions, one key — who fires, who is dead, and which write minted it.
 *
 * Audit finding F3, reproduced first and then held. The sequence is entirely
 * through the normal editor, with no hand-edited payload: move `rename` off
 * `r` onto a free key, bind `icon` to the freed `r`, then RESET `rename`.
 * The capture box judged the one key it was handed; reset judged nothing, so
 * the third step put `rename` back on a key `icon` now owned. `buildTables`
 * gives the override precedence, so `r` fired `icon` while both the sheet and
 * the editor went on advertising `r` for `rename`.
 *
 * Everything here is asserted through `resolveChord` — what the keystroke
 * really does — rather than against a hand-written expectation of the map. A
 * test that only read the override map back would pass on the very state the
 * defect produces.
 */

import { describe, expect, it } from 'vitest';
import {
  bindingClashes,
  bindKey,
  chordText,
  clearBindings,
  defaultBindings,
  EMPTY_CHORD,
  type KeyBindings,
  NO_BINDINGS,
  newClashes,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';
import { buildBindingSheet, buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';

/** The three steps of F3, as the editor performs them. */
const RENAME_MOVED = bindKey(NO_BINDINGS, 'rename', 0, 'b');
const ICON_ON_R = bindKey(RENAME_MOVED, 'icon', 0, 'r');
const RENAME_RESET = clearBindings(ICON_ON_R, 'rename');

/** What a chord really invokes, chord or top-level key alike. */
function fires(bindings: KeyBindings, text: string) {
  const head = text[0] ?? '';
  const isChord = text.length === 2 && 'gyz'.includes(head);
  const state = isChord ? { pending: head as 'g' | 'y' | 'z' } : EMPTY_CHORD;
  return resolveChord(state, isChord ? text.slice(1) : text, bindings).action;
}

describe('the shipped grammar contests nothing', () => {
  it('walks the whole catalogue and finds no key claimed twice', () => {
    // The corpus is asserted, not assumed: an empty walk would make this
    // green while measuring nothing — and this property is what makes "reset
    // shortcuts" a way OUT of a contested map rather than another way in.
    const chords = defaultBindings().flatMap((binding) => binding.chords.map(chordText));
    expect(chords.length).toBeGreaterThan(30);
    expect(bindingClashes(NO_BINDINGS)).toEqual([]);
  });
});

describe('F3 — the state the editor could reach', () => {
  it('names the key two actions claim, the winner, and who is dead', () => {
    const clashes = bindingClashes(RENAME_RESET);
    expect(clashes.length).toBe(1);
    expect(clashes[0]?.chord).toBe('r');
    expect(clashes[0]?.winner).toBe('icon');
    expect(clashes[0]?.shadowed).toEqual(['rename']);
  });

  it('names the winner the keystroke really invokes, not a second guess at it', () => {
    // The anti-drift assertion: `bindingClashes` and `buildTables` must settle
    // a contested key the same way, or the UI would name one action while
    // another fired — which is the defect wearing a label.
    for (const clash of bindingClashes(RENAME_RESET)) {
      const action = fires(RENAME_RESET, clash.chord);
      expect(action).not.toBeNull();
      const winner = defaultBindings().find((binding) => binding.id === clash.winner);
      expect(action, `"${clash.chord}" is advertised for ${clash.winner}`).toEqual(winner?.action);
    }
  });

  it('sees a contested CHORD, not only a contested top-level key', () => {
    // `gg` is `first`. A payload — or a default that moves in a later vam —
    // can put a second claim behind a prefix just as easily.
    const bindings: KeyBindings = { 'move:left': ['gg'] };
    const clashes = bindingClashes(bindings);
    expect(clashes.map((clash) => clash.chord)).toEqual(['gg']);
    expect(clashes[0]?.winner).toBe('move:left');
    expect(fires(bindings, 'gg')).toEqual({ kind: 'move', direction: 'left' });
  });

  it('does not call an action holding one key twice a clash', () => {
    // A payload that lists the same key in both slots wastes a slot; it steals
    // nothing, and refusing the write would strand the operator.
    expect(bindingClashes({ rename: ['b', 'b'] })).toEqual([]);
  });
});

describe('which write minted it', () => {
  it('reports the clash a reset would create, before it is written', () => {
    const created = newClashes(ICON_ON_R, RENAME_RESET);
    expect(created.length).toBe(1);
    expect(created[0]?.chord).toBe('r');
    expect(created[0]?.winner).toBe('icon');
  });

  it('reports the clash a capture would create', () => {
    const taken = bindKey(NO_BINDINGS, 'icon', 0, 'r');
    expect(newClashes(NO_BINDINGS, taken).map((clash) => clash.chord)).toEqual(['r']);
  });

  it('is silent about the two steps that were always legal', () => {
    expect(newClashes(NO_BINDINGS, RENAME_MOVED)).toEqual([]);
    expect(newClashes(RENAME_MOVED, ICON_ON_R)).toEqual([]);
  });

  it('lets an operator out of a contested map instead of freezing them in it', () => {
    // A map that arrived contested — hand-edited, or an override colliding
    // with a shipped key a later vam moved — must not refuse every write on
    // its own key. Only a NEW claim is refused.
    const wayOut = bindKey(RENAME_RESET, 'icon', 0, 'q');
    expect(newClashes(RENAME_RESET, wayOut)).toEqual([]);
    expect(fires(wayOut, 'r')).toEqual({ kind: 'rename' });
    expect(newClashes(RENAME_RESET, NO_BINDINGS)).toEqual([]);
  });
});

/**
 * The other half of F3: a map that IS contested — by a payload, or by an
 * upgrade that moved a shipped key onto a stored override — is a state both
 * surfaces have to show rather than hide. The sheet used to print `r` twice,
 * for two actions, with nothing saying which one the key reaches.
 */
describe('the sheet shows the winner and marks what is dead', () => {
  it('marks the shadowed row and leaves the winner’s row alone', () => {
    const rows = buildBindingSheet(RENAME_RESET).flatMap((group) => group.rows);
    const rename = rows.find((row) => row.id === 'rename');
    const icon = rows.find((row) => row.id === 'icon');
    expect(rename?.keys).toEqual(['r']);
    // Named by what took it, not merely flagged: "dead" without a culprit
    // leaves the operator hunting.
    expect(rename?.dead['r']).toBe(icon?.label);
    expect(icon?.dead).toEqual({});
  });

  it('carries the same fact into the reference sheet, per row', () => {
    const rows = buildKeySheet(RENAME_RESET).flatMap((group) => group.rows);
    const onR = rows.filter((row) => row.keys === 'r');
    expect(onR.length).toBe(2);
    const dead = onR.filter((row) => row.dead !== null);
    expect(dead.length).toBe(1);
    expect(dead[0]?.label).toContain('rename');
    expect(dead[0]?.dead).toContain('icon');
  });

  it('marks a row dead EXACTLY when its key reaches something else', () => {
    // The whole corpus, over a contested map: the mark is derived from what
    // the keystroke does, so it cannot say one thing while the key does
    // another. A row asserting only its own map entry would pass on the defect.
    const map: KeyBindings = { ...RENAME_RESET, 'move:left': ['gg'] };
    const actionOf = new Map(defaultBindings().map((binding) => [binding.id, binding.action]));
    let marked = 0;
    let walked = 0;
    for (const group of buildBindingSheet(map)) {
      for (const row of group.rows) {
        for (const key of row.keys) {
          walked += 1;
          const reached = fires(map, key);
          const own = JSON.stringify(reached) === JSON.stringify(actionOf.get(row.id));
          expect(row.dead[key] !== undefined, `"${key}" on ${row.id}`).toBe(!own);
          if (!own) marked += 1;
        }
      }
    }
    expect(walked).toBeGreaterThan(30);
    expect(marked).toBe(2);
  });
});
