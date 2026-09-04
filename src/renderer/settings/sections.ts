/**
 * What the settings overlay is made of: its sections, and the geometry of the
 * little picture each layout choice draws.
 *
 * One list, read by both the nav and the panels, so a section cannot exist in
 * one and not the other. The layout half lives here rather than in the picker
 * because it is arithmetic — weights into rectangles — and arithmetic that a
 * test can read is arithmetic that can be wrong loudly.
 */

import { Bot, Columns3, Keyboard, type LucideIcon, Palette } from 'lucide-react';
import {
  ALL_VISIBLE,
  type ColumnId,
  canvasIsMain,
  columnOrder,
  LAYOUTS,
  type Layout,
  type LayoutName,
} from '../prefs/panes.js';

export type SectionId = 'appearance' | 'layout' | 'sessions' | 'keyboard';

/**
 * The order is hard-coded and never sorted: a nav that reorders under the
 * operator is a nav nobody learns. `appearance` is first because it is where
 * the overlay opens, which is also what keeps the theme assertions in
 * `Canvas.settings` reachable without navigating.
 */
export const SECTIONS: readonly {
  readonly id: SectionId;
  readonly label: string;
  readonly Icon: LucideIcon;
}[] = [
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'layout', label: 'Layout', Icon: Columns3 },
  // Before Keyboard rather than after it: Keyboard is the reference section
  // and the longest, and a list that ends in a reference reads as a list that
  // ended. Nothing else depends on the position.
  { id: 'sessions', label: 'Sessions', Icon: Bot },
  { id: 'keyboard', label: 'Keyboard', Icon: Keyboard },
];

/** The shipped layout is not in `LAYOUTS` — it is the absence of one, and it is
 *  what `z0` restores. Named here so the picker can offer a way back. */
export const FULL = 'full';
export type LayoutChoice = typeof FULL | LayoutName;

/**
 * Display order: most columns to fewest, so the row reads as a progressive
 * subtraction and the one layout that REORDERS sits beside the default it
 * reorders. Deliberately not `Object.keys(LAYOUTS)` order — that object's key
 * order is not a display concern and other code reads it — and deliberately a
 * rank per choice rather than a literal list, so a fifth layout fails to
 * compile here instead of quietly failing to appear.
 */
const DISPLAY_RANK = {
  full: 0,
  focusResponse: 1,
  noCanvas: 2,
  responseOnly: 3,
} satisfies Record<LayoutChoice, number>;

const CHOICES: LayoutChoice[] = [FULL, ...(Object.keys(LAYOUTS) as LayoutName[])];

export const LAYOUT_CHOICES: readonly LayoutChoice[] = CHOICES.sort(
  (a, b) => DISPLAY_RANK[a] - DISPLAY_RANK[b],
);

/**
 * The half of a tile's accessible name the picture carries and the label does
 * not: the columns, in the order they are drawn. A screen reader gets the
 * diagram's only content this way.
 */
export const LAYOUT_DESCRIPTION = {
  full: 'sidebar, canvas, then response',
  focusResponse: 'sidebar, response, then the canvas as a narrow strip on the right',
  noCanvas: 'sidebar, then response',
  responseOnly: 'the response fills the window',
} satisfies Record<LayoutChoice, string>;

/** The panes a choice means. `full` is `ALL_VISIBLE`, which is exactly what it
 *  means for no layout to be applied. */
export function layoutOf(choice: LayoutChoice): Layout {
  return choice === FULL ? ALL_VISIBLE : LAYOUTS[choice];
}

/** One rectangle of a diagram, in the 120x72 user space of its `viewBox`. */
export type DiagramColumn = {
  readonly id: ColumnId;
  readonly x: number;
  readonly width: number;
  readonly main: boolean;
};

/** Columns live in `x: 6..114`, `y: 6..66` — the ground keeps a 6-unit margin. */
export const DIAGRAM = { x: 6, y: 6, width: 108, height: 60, gap: 4 } as const;

/**
 * How wide each column is drawn, as flex weights over the room the gaps leave.
 *
 * The real numbers rounded: a 264px sidebar between bounds of 200..480, a
 * 320px detail floor, a 360px canvas floor — and the demoted canvas at
 * `CANVAS_STRIP` 300, narrower than the response beside it, which is the whole
 * of what the third tile has to show.
 */
const WEIGHTS = {
  full: { sidebar: 3, canvas: 7, detail: 4 },
  focusResponse: { sidebar: 3, detail: 7, canvas: 3 },
  noCanvas: { sidebar: 3, detail: 11 },
  responseOnly: { detail: 1 },
} satisfies Record<LayoutChoice, Partial<Record<ColumnId, number>>>;

/**
 * The blocks a choice draws, left to right, in the layout's REAL order.
 *
 * The main column is the canvas exactly while the canvas is the main column,
 * and the response otherwise. Note this is not "the last column in the order":
 * `focusResponse` draws the canvas last precisely BECAUSE it demoted it, and
 * `canvasIsMain` is the function that already knows so — see `panes.ts`, where
 * the same distinction decides the width arithmetic.
 */
export function diagramColumns(choice: LayoutChoice): readonly DiagramColumn[] {
  const layout = layoutOf(choice);
  const order = columnOrder(layout).filter((id) => layout[id]);
  const main: ColumnId = canvasIsMain(layout) ? 'canvas' : 'detail';
  const weights = WEIGHTS[choice] as Partial<Record<ColumnId, number>>;
  const total = order.reduce((sum, id) => sum + (weights[id] ?? 1), 0);
  const room = DIAGRAM.width - DIAGRAM.gap * (order.length - 1);
  let x = DIAGRAM.x;
  return order.map((id) => {
    const width = (room * (weights[id] ?? 1)) / total;
    const column = { id, x: round(x), width: round(width), main: id === main };
    x += width + DIAGRAM.gap;
    return column;
  });
}

/** Half a unit is invisible at 120 units wide and makes an assertion unreadable. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The canvas's dot lattice, clipped to its column — vam's own dotted ground,
 * and the one glyph that identifies the canvas wherever it sits, which is what
 * makes `focusResponse` legible as a reordering rather than as a different set
 * of columns.
 */
export function canvasDots(column: DiagramColumn): readonly { cx: number; cy: number }[] {
  const dots: { cx: number; cy: number }[] = [];
  for (let cy = 13; cy <= DIAGRAM.y + DIAGRAM.height - 4; cy += 9) {
    for (let cx = column.x + 6; cx <= column.x + column.width - 4; cx += 9) {
      dots.push({ cx: round(cx), cy });
    }
  }
  return dots;
}
