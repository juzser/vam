/**
 * `rowConflicts` — ONE ROW'S OWN SLICE of `bindingClashes`, symmetric.
 *
 * `bindingClashes` already names, for a contested chord, which action WINS
 * and which are SHADOWED — the settings editor's `row.dead` reads exactly
 * that, struck through on the loser's own slot. What it does not answer by
 * itself is "does THIS row have a problem at all, and who is the other side
 * of it" for a row that WINS a contest too — an operator editing the winner
 * has just as much reason to be told its key is shared as the operator
 * editing the loser does, and `row.dead` never marks a winning row.
 *
 * `rowConflicts` is the pure, symmetric answer both sides read: for a given
 * action id, every chord it is party to a clash on, and who the other party
 * is. `SettingsOverlay.tsx`'s conflict dot is the one caller; this file holds
 * the derivation on its own, with no DOM in it, the same split every other
 * pure predicate in this module keeps from its React reader.
 */

import { describe, expect, it } from 'vitest';
import {
  bindingClashes,
  bindKey,
  clearBindings,
  type KeyBindings,
  NO_BINDINGS,
  rowConflicts,
} from '../../src/renderer/keyboard/chords.js';

/**
 * F3's own three-step sequence (`binding-clashes.test.ts` holds the full
 * finding): move `rename` off `r`, aim `close` at the freed key, then RESET
 * `rename` — which puts it back on its shipped `r`, now `close`'s too.
 */
function f3Contested(): KeyBindings {
  const moved = bindKey(NO_BINDINGS, 'rename', 0, 'b');
  const closeOnR = bindKey(moved, 'close', 0, 'r');
  return clearBindings(closeOnR, 'rename');
}

describe('rowConflicts', () => {
  it('is empty for the shipped grammar — nothing contests by default', () => {
    const clashes = bindingClashes(NO_BINDINGS);
    expect(rowConflicts(clashes, 'rename')).toEqual([]);
  });

  it('names the conflict on the LOSING row — the one `row.dead` already marks', () => {
    const clashes = bindingClashes(f3Contested());
    expect(rowConflicts(clashes, 'rename')).toEqual([{ chord: 'r', with: 'close' }]);
  });

  it('ALSO names it on the WINNING row — symmetric, which `row.dead` never is', () => {
    const clashes = bindingClashes(f3Contested());
    expect(rowConflicts(clashes, 'close')).toEqual([{ chord: 'r', with: 'rename' }]);
  });

  it('is empty for a row that holds no contested chord at all', () => {
    const clashes = bindingClashes(f3Contested());
    expect(rowConflicts(clashes, 'newSession')).toEqual([]);
  });

  it('lists more than one conflict when a row holds two contested slots', () => {
    // `close` already answers `x` and `Mod-w`; take both.
    const takeX = bindKey(NO_BINDINGS, 'newSession', 0, 'x');
    const takeModW = bindKey(takeX, 'newTab', 1, 'Mod-w');
    const clashes = bindingClashes(takeModW);
    expect(rowConflicts(clashes, 'close')).toEqual(
      expect.arrayContaining([
        { chord: 'x', with: 'newSession' },
        { chord: 'Mod-w', with: 'newTab' },
      ]),
    );
    expect(rowConflicts(clashes, 'close')).toHaveLength(2);
  });

  it('names BOTH other parties on a chord three actions claim, from a losing row', () => {
    // `close` ships `x`; override `rename` onto it, then `revealProject`
    // onto it too. Three claims on one chord: the LAST override laid down
    // wins (`inPrecedenceOrder`'s own rule), and the other two — the shipped
    // default and the first override — are both shadowed.
    const renameOnX = bindKey(NO_BINDINGS, 'rename', 0, 'x');
    const bothOnX = bindKey(renameOnX, 'revealProject', 0, 'x');
    const clashes = bindingClashes(bothOnX);
    expect(rowConflicts(clashes, 'close')).toEqual([{ chord: 'x', with: 'revealProject' }]);
    expect(rowConflicts(clashes, 'rename')).toEqual([{ chord: 'x', with: 'revealProject' }]);
  });
});
