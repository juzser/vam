/**
 * Marking the cell tmux says the cursor is on, in a screen that has already
 * been turned into styled runs.
 *
 * WHY THIS IS ARITHMETIC AND NOT A LOOKUP. tmux answers in CELLS -- `cursor_x`
 * counts columns of the composed grid -- while what the tab holds by the time
 * anything can be drawn is `parseAnsi`'s runs, built from a capture whose
 * escape bytes occupy no cell at all. Indexing the raw line by `cursor_x` is
 * the obvious implementation and it is wrong the moment the agent's output is
 * coloured, which is most of the time: MEASURED on a live pane, the cursor's
 * own row was 7 characters of capture holding 2 cells of screen, so the naive
 * index landed inside an escape sequence. It is also wrong in the way that
 * survives review, because it is right for every screenshot of plain text.
 *
 * AND A CELL IS NOT A CHARACTER EITHER. A CJK glyph takes two cells, a
 * combining accent takes none, and a code point is not a UTF-16 unit. Counting
 * any of those wrong shifts the caret along the line by one cell per glyph, so
 * `cellWidth` below does the standard three-way measure rather than assume.
 *
 * IT IS STILL NOT A TERMINAL EMULATOR (`terminal-ansi.ts`, `sources/tmux/
 * argv.ts`). Nothing here moves a cursor, scrolls a region or interprets a
 * motion sequence; tmux composed the screen and tmux said where the cursor
 * ended up. This puts a mark on that one cell of that one snapshot.
 *
 * A pure function over data, exactly as its neighbour is: it never throws, it
 * builds nothing but plain objects, and it is given somebody else's agent's
 * output to walk.
 */

import type { PaneCursor } from '../../shared/terminal.js';
import type { AnsiSpan } from './terminal-ansi.js';

/**
 * A run of the screen, and whether the cursor is on it.
 *
 * `cursor` is on the SPAN rather than being a coordinate the drawing code
 * re-derives, because a second place that computes "which cell is this" is a
 * second place that can disagree with tmux. Exactly one span of one line ever
 * carries `true`, and a cursor span is always exactly one cell wide.
 */
export type ScreenSpan = AnsiSpan & { readonly cursor: boolean };

/** The pane's own look: what a cell past the end of a captured line wears. */
const BLANK: Omit<AnsiSpan, 'text'> = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strike: false,
};

/**
 * Code points that occupy TWO cells -- the East Asian Wide and Fullwidth
 * blocks, plus the emoji planes.
 *
 * A TABLE AND NOT A PROPERTY ESCAPE because JavaScript exposes no
 * `East_Asian_Width` to `\p{...}`, and the nearest thing that is exposed --
 * `\p{Extended_Pictographic}` -- is wrong in the direction that matters: it
 * includes `(c)`, `(tm)` and the dingbats, which every terminal draws in one
 * cell, so using it would shift the caret left on any line containing one.
 * These ranges are the conventional `wcwidth` set, which is what tmux itself
 * measures with.
 */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff], // kana, Hangul compatibility jamo, CJK compatibility
  [0x3400, 0x4dbf], // CJK unified ideographs extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo extended A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
  [0x1f300, 0x1f64f], // emoji: symbols, pictographs, emoticons
  [0x1f680, 0x1f6ff], // emoji: transport and map
  [0x1f900, 0x1f9ff], // emoji: supplemental symbols, people
  [0x20000, 0x2fffd], // CJK plane 2
  [0x30000, 0x3fffd], // CJK plane 3
];

/**
 * Marks that occupy NO cell: they compose onto the character before them.
 *
 * `Mn`/`Me` is every combining mark, which is what a Vietnamese or Thai line
 * is full of and what a variation selector is. `Cf` is the invisible
 * formatting controls, of which the zero-width joiner is the one that actually
 * turns up -- it is what holds a multi-code-point emoji together, and counting
 * it as a cell would push the caret one right for every joined emoji on the
 * line.
 */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;

/**
 * How many cells one code point takes: 0, 1 or 2.
 *
 * Exported because it is the one piece of this file that can be wrong without
 * any test of `placeCursor` noticing -- a table with a range typed one digit
 * out still places the caret correctly on every ASCII line there is.
 */
export function cellWidth(codePoint: number): number {
  if (ZERO_WIDTH.test(String.fromCodePoint(codePoint))) return 0;
  for (const [start, end] of WIDE) {
    if (codePoint >= start && codePoint <= end) return 2;
    if (codePoint < start) break;
  }
  return 1;
}

/**
 * How many cells a string occupies, counting by CODE POINT.
 *
 * `for...of` over a string iterates code points and not UTF-16 units, which is
 * what keeps an emoji from being counted as two cells by accident of its
 * surrogate pair -- and, in the splitter below, from being cut in half into
 * two lone surrogates that render as replacement characters.
 */
const cellsIn = (text: string): number => {
  let cells = 0;
  for (const char of text) cells += cellWidth(char.codePointAt(0) ?? 0);
  return cells;
};

/** Every span of a line, with nothing marked. */
const plain = (spans: readonly AnsiSpan[]): readonly ScreenSpan[] =>
  spans.map((span) => ({ ...span, cursor: false }));

/**
 * The screen with one cell marked, or the screen exactly as it was.
 *
 * THE ONLY TWO OUTCOMES ARE "the right cell" AND "no cell", which is the rule
 * this whole feature is built on (`shared/terminal.ts`, `PaneCursor`): a
 * caret in the wrong place is a false claim about where a keystroke goes,
 * while a missing one is the surface vam had yesterday. `hidden`,
 * `unreadable`, and a row the capture does not have all take the second
 * branch, and none of them is ever quietly turned into row 0, column 0.
 *
 * The row count is never changed -- a cursor beyond the last captured line
 * does NOT grow the screen a line the agent never printed.
 */
export function placeCursor(
  lines: readonly (readonly AnsiSpan[])[],
  cursor: PaneCursor,
): readonly (readonly ScreenSpan[])[] {
  if (cursor.kind !== 'at') return lines.map(plain);
  const target = lines[cursor.row];
  if (target === undefined) return lines.map(plain);
  return lines.map((spans, row) =>
    row === cursor.row ? mark(target, cursor.column) : plain(spans),
  );
}

/**
 * One line, with the cell at `column` split out as its own span.
 *
 * THE PADDING BRANCH IS NOT AN EDGE CASE, it is the common one. `capture-pane`
 * strips the trailing spaces tmux padded the row with (measured: not one line
 * of a real 222-column pane came back with a trailing space), and a shell or
 * an agent's prompt leaves the cursor exactly one cell past its last visible
 * character. Refusing to draw there would hide the cursor on the screen it is
 * most often on.
 *
 * The padding wears the PANE'S look and not the last run's: a background
 * colour dragged across cells the agent never printed is a stripe vam invented.
 */
function mark(spans: readonly AnsiSpan[], column: number): readonly ScreenSpan[] {
  const out: ScreenSpan[] = [];
  let cell = 0;
  let placed = false;
  for (const span of spans) {
    if (placed) {
      out.push({ ...span, cursor: false });
      continue;
    }
    const width = cellsIn(span.text);
    if (cell + width <= column) {
      cell += width;
      out.push({ ...span, cursor: false });
      continue;
    }
    // The cursor is inside THIS run. Walk it by code point to find which one
    // owns the cell, and split the run into at most three.
    let before = '';
    let at = '';
    let after = '';
    for (const char of span.text) {
      if (placed) {
        // A zero-width mark immediately after the cursor's character composes
        // ONTO it, so it travels with the cell rather than being left to be
        // drawn as a floating accent on the run behind.
        if (after === '' && cellWidth(char.codePointAt(0) ?? 0) === 0) at += char;
        else after += char;
        continue;
      }
      const w = cellWidth(char.codePointAt(0) ?? 0);
      if (w > 0 && cell <= column && column < cell + w) {
        at = char;
        placed = true;
      } else {
        before += char;
      }
      cell += w;
    }
    if (before !== '') out.push({ ...span, text: before, cursor: false });
    if (at !== '') out.push({ ...span, text: at, cursor: true });
    if (after !== '') out.push({ ...span, text: after, cursor: false });
  }
  if (placed) return out;
  // Past the end of the captured line: pad to the column with the pane's own
  // blank, then the cursor's own cell.
  if (column > cell) out.push({ ...BLANK, text: ' '.repeat(column - cell), cursor: false });
  out.push({ ...BLANK, text: ' ', cursor: true });
  return out;
}
