/**
 * Putting tmux's cursor on the cell tmux means, and on no cell at all when
 * tmux did not say.
 *
 * WHY THIS IS A UNIT AND NOT A DETAIL OF THE COMPONENT. `cursor_x` counts
 * CELLS of the composed screen, while what the tab holds is a list of styled
 * runs -- and the raw capture those runs came from is full of escape bytes
 * that occupy no cell at all. The arithmetic between those two is the only
 * place this feature can be silently wrong, and it is wrong in the way nobody
 * notices from a screenshot of plain text: the moment the agent's output is
 * coloured, which is most of the time.
 *
 * The falsification is written into the first test rather than described: it
 * asserts what indexing the RAW line would have produced, so the naive
 * implementation cannot pass this file.
 */

import { describe, expect, it } from 'vitest';
import { parseAnsi } from '../../src/renderer/panels/terminal-ansi.js';
import { cellWidth, placeCursor } from '../../src/renderer/panels/terminal-cursor.js';
import type { PaneCursor } from '../../src/shared/terminal.js';

const ESC = '';

/** The one span the cursor is on, across the whole screen. */
function cursorCell(lines: ReturnType<typeof placeCursor>) {
  const found = lines.flatMap((spans, row) =>
    spans.filter((span) => span.cursor).map((span) => ({ row, span })),
  );
  // MORE THAN ONE IS A DEFECT, not a detail: a screen with two carets says
  // typing lands in two places.
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0] ?? null;
}

/** The visible text of a line, cursor markings ignored. */
const textOf = (spans: readonly { text: string }[]) => spans.map((span) => span.text).join('');

const at = (column: number, row: number): PaneCursor => ({ kind: 'at', column, row });

describe('the column is a cell of the SCREEN, not an index into the capture', () => {
  // `capture-pane -e` returns this: five red characters, a reset, then a
  // space and two plain ones. EIGHT CELLS of screen, seventeen characters of
  // capture -- and the gap between those two numbers is the whole subject of
  // this file.
  const RAW = `${ESC}[31mERROR${ESC}[0m ok`;

  it('lands on the character tmux is pointing at, inside a coloured run', () => {
    const found = cursorCell(placeCursor(parseAnsi(RAW), at(2, 0)));
    expect(found?.span.text).toBe('R');
    // AND IT KEEPS THE RUN'S COLOUR. The cell under a cursor is still the
    // agent's own character; a cursor that reset it to the pane's colour
    // would repaint one cell of somebody's error line.
    expect(found?.span.fg).toBe('red');
    // THE FALSIFICATION, spelled out. Column 2 of the RAW string is a byte of
    // the escape sequence -- so an implementation that indexed the capture
    // would draw the cursor on a character that is not on the screen at all,
    // and would pass any test written over plain text.
    expect(RAW[2]).toBe('3');
    expect(RAW[2]).not.toBe('R');
  });

  it('counts past the escape and lands correctly after the reset', () => {
    // E R R O R _ o k  ->  cell 6 is the `o`, which sits at raw index 15.
    const found = cursorCell(placeCursor(parseAnsi(RAW), at(6, 0)));
    expect(found?.span.text).toBe('o');
    expect(found?.span.fg).toBe(null);
    expect(RAW[15]).toBe('o');
    // The falsification again, and further from the escape this time: nine
    // characters of the capture have gone by that occupy no cell, so raw
    // index 6 is still inside the coloured run.
    expect(RAW[6]).toBe('R');
  });

  it('leaves the rest of the line whole around the cell it split out', () => {
    const [line] = placeCursor(parseAnsi(RAW), at(2, 0));
    expect(textOf(line ?? [])).toBe('ERROR ok');
    // The split is three runs where there was one, and the two halves keep
    // the colour they had.
    expect((line ?? []).map((span) => span.text)).toEqual(['ER', 'R', 'OR', ' ok']);
  });
});

describe('a cursor past the end of a line still has a cell', () => {
  it('pads to the column, because tmux TRIMS the trailing spaces it padded with', () => {
    // Measured on a real pane: `capture-pane` without `-N` strips trailing
    // spaces, and the cursor of a shell prompt sits exactly one cell past the
    // last visible character. Refusing to draw there would hide the cursor
    // for the commonest screen there is.
    const lines = placeCursor(parseAnsi('$'), at(4, 0));
    const found = cursorCell(lines);
    expect(found?.span.text).toBe(' ');
    expect(textOf(lines[0] ?? [])).toBe('$    ');
    // The padding is the pane's own colour, never the last run's -- a
    // background colour dragged across empty cells is a stripe the agent
    // never printed.
    expect((lines[0] ?? []).every((span) => span.bg === null)).toBe(true);
  });

  it('pads an empty line, which is what a blank screen with a cursor is', () => {
    const lines = placeCursor(parseAnsi(''), at(3, 0));
    expect(cursorCell(lines)?.span.text).toBe(' ');
    expect(textOf(lines[0] ?? [])).toBe('    ');
  });
});

describe('no cursor is better than a cursor in the wrong place', () => {
  const SCREEN = parseAnsi('one\ntwo\nthree');

  it('draws nothing at all when vam could not read the cursor', () => {
    // NOT row 0, column 0. This is the whole reason `unreadable` is a value.
    const lines = placeCursor(SCREEN, { kind: 'unreadable' });
    expect(cursorCell(lines)).toBe(null);
    expect(lines.map(textOf)).toEqual(['one', 'two', 'three']);
  });

  it('draws nothing when the application has hidden the cursor', () => {
    expect(cursorCell(placeCursor(SCREEN, { kind: 'hidden' }))).toBe(null);
  });

  it('draws nothing on a row the screen does not have', () => {
    // A capture that came back shorter than the pane tmux measured -- and a
    // row index that would otherwise be appended as a line the agent never
    // printed.
    expect(cursorCell(placeCursor(SCREEN, at(1, 9)))).toBe(null);
    expect(placeCursor(SCREEN, at(1, 9))).toHaveLength(3);
  });

  it('marks exactly one cell, on exactly the row asked for', () => {
    const found = cursorCell(placeCursor(SCREEN, at(1, 1)));
    expect(found?.row).toBe(1);
    expect(found?.span.text).toBe('w');
  });
});

describe('a cell is not a character, and the difference is measurable', () => {
  it('gives a double-width glyph the two cells tmux gave it', () => {
    // tmux composed the screen in cells: the CJK character occupies two, so
    // the `b` after it is at cell 3 and not at index 2.
    const lines = parseAnsi('a漢b');
    expect(cursorCell(placeCursor(lines, at(3, 0)))?.span.text).toBe('b');
    expect(cursorCell(placeCursor(lines, at(1, 0)))?.span.text).toBe('漢');
  });

  it('keeps a combining mark on the cell it belongs to', () => {
    // `e` + COMBINING ACUTE ACCENT is ONE cell, and the mark must travel with
    // its base: split off on its own it would be drawn as a floating accent.
    // SPELLED BY CODE POINT rather than typed, so that no editor's Unicode
    // normalisation can quietly turn it into a precomposed one character and
    // leave this asserting nothing about combining marks at all.
    const lines = parseAnsi('e\u0301x');
    expect(cursorCell(placeCursor(lines, at(0, 0)))?.span.text).toBe('e\u0301');
    expect(cursorCell(placeCursor(lines, at(1, 0)))?.span.text).toBe('x');
  });

  it('never splits a surrogate pair into half a character', () => {
    const lines = parseAnsi('a\u{1F600}b');
    const cell = cursorCell(placeCursor(lines, at(1, 0)))?.span.text;
    expect(cell).toBe('\u{1F600}');
    expect(cellWidth('\u{1F600}'.codePointAt(0) ?? 0)).toBe(2);
  });

  it('measures the three widths a terminal actually distinguishes', () => {
    expect(cellWidth('A'.codePointAt(0) ?? 0)).toBe(1);
    expect(cellWidth('─'.codePointAt(0) ?? 0)).toBe(1); // box drawing, narrow
    expect(cellWidth('漢'.codePointAt(0) ?? 0)).toBe(2);
    expect(cellWidth(0x0301)).toBe(0); // combining acute accent
    expect(cellWidth(0x200d)).toBe(0); // zero-width joiner
  });
});
