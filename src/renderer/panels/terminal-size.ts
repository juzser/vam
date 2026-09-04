/**
 * How big the tmux session has to be for its screen to fit the pane.
 *
 * WHY THIS IS NOT A STYLESHEET. `tmux capture-pane` returns the screen tmux
 * has ALREADY composed, at the size the session was given when `new-session`
 * created it -- 80x24 unless something said otherwise, and nothing here ever
 * did. Every line longer than that width was wrapped, or truncated, by tmux
 * before vam saw a character of it. No amount of CSS on the wrapper can undo a
 * break that is already in the text. The only thing that makes the screen fit
 * is telling tmux the size, and tmux is told in CELLS.
 *
 * So the wrapper's pixels have to become columns and rows, and the conversion
 * needs the size of one rendered character. That size is MEASURED, never
 * assumed: the width-to-height ratio of a monospace face is a property of the
 * face, the size, the platform's hinting and the operator's zoom -- Geist Mono
 * at 10.5px measures 6.6015625px per advance here, and a plausible-looking 0.6
 * ratio would have been out by a column every seventeen.
 *
 * Kept pure and kept apart from the component for a reason that is a fact
 * about the test environment rather than a taste: happy-dom performs no
 * layout, so `getBoundingClientRect` is zeros and `clientWidth` is whatever a
 * test wrote. Arithmetic that a layout engine cannot be borrowed to check has
 * to be checkable without one.
 */

import {
  MAX_COLUMNS,
  MAX_ROWS,
  MIN_COLUMNS,
  MIN_ROWS,
  type PaneSize,
} from '../../shared/terminal.js';

/** A rectangle in CSS pixels -- the wrapper's content box, or one character. */
export type Box = { readonly width: number; readonly height: number };

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

const usable = (value: number): boolean => Number.isFinite(value) && value > 0;

/**
 * The size to give tmux, or `null` when the question cannot yet be answered.
 *
 * `null` IS THE IMPORTANT RETURN. A pane that has not been laid out reports a
 * zero box, and a hidden one can report a negative rectangle; both are "vam
 * does not know yet", and both would floor to the clamp minimum if they were
 * treated as measurements. That would resize the operator's session to 20x5
 * on every mount, which is not a smaller mistake than not resizing at all --
 * it is a visible one, in someone else's work.
 */
export function fitPane(box: Box, cell: Box): PaneSize | null {
  if (!usable(box.width) || !usable(box.height) || !usable(cell.width) || !usable(cell.height)) {
    return null;
  }
  // FLOOR, both ways. A column the wrapper can only half show is a column that
  // wraps on screen, which is the whole defect being removed here.
  return {
    columns: clamp(Math.floor(box.width / cell.width), MIN_COLUMNS, MAX_COLUMNS),
    rows: clamp(Math.floor(box.height / cell.height), MIN_ROWS, MAX_ROWS),
  };
}

/**
 * Whether a freshly measured size is the one tmux was last told.
 *
 * This is what keeps a drag from spawning a `tmux resize-window` per animation
 * frame: a pane resizer moves in pixels and a terminal changes in cells, so
 * most frames of a drag produce the size that is already in force. `null` --
 * nothing measured yet -- is deliberately NOT equal to anything, so the first
 * measurement after mount is always sent.
 */
export function sameSize(previous: PaneSize | null, next: PaneSize): boolean {
  return previous !== null && previous.columns === next.columns && previous.rows === next.rows;
}
