/**
 * `Mod-.` INTERRUPTS THE AGENT — the operator's reversal.
 *
 * Escape used to be the pane's own interrupt (`TerminalTab`: "inside tmux,
 * Escape should do what Escape does") and the composer's too
 * (`DetailPanel`'s old `interruptRun`-on-Escape). The operator asked for the
 * opposite split: Escape leaves Insert — everywhere, including the terminal
 * pane and the composer — and the interrupt moves to a chord of its own,
 * `Cmd+.` on macOS. `Mod-` already means "the platform's command modifier"
 * (`chords.ts`'s own header), so the identical binding is `Ctrl+.` on Linux
 * and Windows with no second table entry required — the same free ride every
 * other `Mod-<character>` chord in this grammar already gets.
 *
 * This file holds the GRAMMAR's half: that a real keydown reaches the
 * action, that nothing shipped loses a key to it, and that the generated
 * sheet can name it. `Canvas.tsx`'s `case 'interrupt'` is what actually
 * presses the key into a session's pane; that is covered where the other
 * session-scoped actions are (`test/canvas/Canvas.interrupt.test.tsx`).
 */

import { describe, expect, it } from 'vitest';
import {
  bindingClashes,
  bindKey,
  defaultBindings,
  EMPTY_CHORD,
  type KeyAction,
  type KeyEventLike,
  NO_BINDINGS,
  newClashes,
  normalizeKey,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';

const CMD_PERIOD: KeyEventLike = { key: '.', metaKey: true };
const CTRL_PERIOD: KeyEventLike = { key: '.', ctrlKey: true };
/** A bare period is a character — every prompt that ends a sentence has one. */
const BARE_PERIOD: KeyEventLike = { key: '.' };

function actionFor(event: KeyEventLike, mac = true): KeyAction | null {
  const key = normalizeKey(event, mac);
  return key === null ? null : resolveChord(EMPTY_CHORD, key).action;
}

const sheetRows = () => buildKeySheet().flatMap((group) => group.rows);

describe('Cmd+. interrupts the running agent', () => {
  it('reaches the interrupt action on each platform’s own command modifier', () => {
    expect(actionFor(CMD_PERIOD, true)).toEqual({ kind: 'interrupt' });
    expect(actionFor(CTRL_PERIOD, false)).toEqual({ kind: 'interrupt' });
  });

  it('is spelled `Mod-.`, and a bare `.` is left alone for prose', () => {
    expect(normalizeKey(CMD_PERIOD, true)).toBe('Mod-.');
    expect(normalizeKey(CTRL_PERIOD, false)).toBe('Mod-.');
    expect(normalizeKey(BARE_PERIOD)).toBe('.');
    expect(actionFor(BARE_PERIOD)).toEqual({ kind: 'remote' });
  });

  it('is a different chord from Ctrl+. on macOS, where Ctrl belongs to the terminal', () => {
    // `.` is not one of `CTRL_GESTURES` ('d', 'u'), so on macOS Control does
    // not fold into the command modifier here — a real Ctrl+. stays the
    // terminal's own, exactly like Ctrl+K or Ctrl+W.
    expect(normalizeKey(CTRL_PERIOD, true)).toBe('Ctrl-.');
    expect(actionFor(CTRL_PERIOD, true)).toBeNull();
  });
});

describe('the generated key sheet names it', () => {
  it('gives `Mod-.` a row with a caption of its own', () => {
    const rows = sheetRows();
    expect(rows.length).toBeGreaterThan(30);
    const row = rows.find((each) => each.keys === 'Mod-.');
    expect(row, 'no sheet row for Mod-.').toBeDefined();
    expect(row?.label).toMatch(/interrupt/i);
    expect(row?.dead).toBeNull();
  });
});

describe('nothing shipped loses a key to it', () => {
  it('leaves the shipped map with no contested chord at all', () => {
    expect(defaultBindings().length).toBeGreaterThan(30);
    expect(bindingClashes(NO_BINDINGS)).toEqual([]);
  });

  it('and the clash machinery sees the new binding when something takes it', () => {
    const contested = bindKey(NO_BINDINGS, 'revealProject', 0, 'Mod-.');
    expect(newClashes(NO_BINDINGS, contested)).toEqual([
      { chord: 'Mod-.', winner: 'revealProject', shadowed: ['interrupt'] },
    ]);
  });
});
