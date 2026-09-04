/**
 * How many columns and rows fit in the Terminal tab's pane.
 *
 * This is the arithmetic behind the one thing CSS cannot do for this tab.
 * `capture-pane` returns the screen tmux ALREADY laid out, at the size the
 * session was created with, so a line tmux wrapped at 80 columns stays wrapped
 * at 80 whatever the wrapper is styled to. The pane fits only if tmux is told
 * the size, and the size can only be told in cells.
 *
 * It is a pure function for a reason that is a test-environment fact rather
 * than a preference: happy-dom does no layout, so every rectangle in a
 * component test is zeros unless the test writes one. Exhaustive coverage of
 * the arithmetic lives here, where nothing needs a layout engine, and the
 * component is left to prove only that it MEASURES and does not thrash.
 */

import { describe, expect, it } from 'vitest';
import {
  fitPane,
  MAX_COLUMNS,
  MAX_ROWS,
  MIN_COLUMNS,
  MIN_ROWS,
  sameSize,
} from '../../src/renderer/panels/terminal-size.js';

const cell = { width: 8, height: 16 };

describe('fitPane turns a box and a cell into a column and row count', () => {
  it('divides the box by the cell, both ways', () => {
    expect(fitPane({ width: 800, height: 480 }, cell)).toEqual({ columns: 100, rows: 30 });
  });

  it('floors a partial cell rather than rounding it up', () => {
    // A column tmux draws that the wrapper can only half show is a column that
    // wraps on screen -- the exact defect this exists to remove. Rounding down
    // leaves a sliver of background; rounding up puts the text back where it
    // started.
    expect(fitPane({ width: 807, height: 495 }, cell)).toEqual({ columns: 100, rows: 30 });
  });

  it('measures a fractional cell, which is what a real font gives', () => {
    // A rendered monospace advance is not an integer. 6.6015625px is Geist
    // Mono at 10.5px on this machine; a guessed 0.6 ratio would have said 105.
    expect(fitPane({ width: 700, height: 300 }, { width: 6.6015625, height: 15.225 })).toEqual({
      columns: 106,
      rows: 19,
    });
  });

  it('clamps a tiny box up, because tmux does nothing useful at one column', () => {
    expect(fitPane({ width: 8, height: 16 }, cell)).toEqual({
      columns: MIN_COLUMNS,
      rows: MIN_ROWS,
    });
  });

  it('clamps an enormous box down', () => {
    expect(fitPane({ width: 100_000, height: 100_000 }, cell)).toEqual({
      columns: MAX_COLUMNS,
      rows: MAX_ROWS,
    });
  });

  it.each([
    ['a box with no width yet', { width: 0, height: 480 }, cell],
    ['a box with no height yet', { width: 800, height: 0 }, cell],
    ['a negative box, which a hidden pane can report', { width: -10, height: 480 }, cell],
    ['an unmeasured cell', { width: 800, height: 480 }, { width: 0, height: 16 }],
    ['a cell with no height', { width: 800, height: 480 }, { width: 8, height: 0 }],
    ['a NaN box', { width: Number.NaN, height: 480 }, cell],
    [
      'an infinite cell',
      { width: 800, height: 480 },
      { width: Number.POSITIVE_INFINITY, height: 16 },
    ],
  ])('answers null for %s rather than guessing', (_why, box, size) => {
    // BEFORE LAYOUT EXISTS this is the answer. `null` is not a small size: a
    // size sent from a zero box would resize the operator's session to the
    // clamp floor every time the tab mounted.
    expect(fitPane(box, size)).toBeNull();
  });
});

describe('sameSize is what stops a resize per frame', () => {
  it('is true only when both numbers match', () => {
    expect(sameSize({ columns: 100, rows: 30 }, { columns: 100, rows: 30 })).toBe(true);
    expect(sameSize({ columns: 100, rows: 30 }, { columns: 101, rows: 30 })).toBe(false);
    expect(sameSize({ columns: 100, rows: 30 }, { columns: 100, rows: 31 })).toBe(false);
  });

  it('treats "never measured" as different, so the first measure always lands', () => {
    expect(sameSize(null, { columns: 100, rows: 30 })).toBe(false);
  });
});
