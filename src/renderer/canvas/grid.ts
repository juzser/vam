// Pure geometry for the ADE mockup's canvas grid. No React, no
// @xyflow/react, no domain model — plain arithmetic over the numbers
// transcribed in factory/specs/active/vam-canvas-topology/epic.md section 3.

export const CELL = { width: 580, height: 290 };

export const GRID = { columns: 2, padding: 16, rowGap: 64, columnGap: 72 };

export const INFO_SIZE = { width: 220, height: 174 };

export const STEP_SIZE = { width: 250, height: 90 };

export const STEP_SLOTS = 3;

// The session card is vertically centred in the cell (epic.md section 3.2):
// (290 − 174) / 2 = 58. Derived, not hard-coded, so the card stays centred
// if either size ever moves.
export const INFO_OFFSET = { x: 0, y: (CELL.height - INFO_SIZE.height) / 2 };

export const STEP_ORIGIN = { x: 330, y: 0 };

export const STEP_PITCH = 100;

export const FAN = { x: 220, width: 110, elbow: 45 };

export const PILL_SIZE = { width: 58, height: 20 };

/**
 * The top-left corner of cell `index` (0-based, reading order) within the
 * canvas grid, in cell coordinates.
 *
 * `columns` defaults to `GRID.columns` (the grid's usual width) but is a
 * parameter, not the constant itself: a narrow canvas pane lays out with
 * `columns=1` instead (see `columnsForWidth`), and this function stays
 * ignorant of why — it only ever places, never measures.
 */
export function cellOrigin(
  index: number,
  columns: number = GRID.columns,
): { x: number; y: number } {
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: GRID.padding + column * (CELL.width + GRID.columnGap),
    y: GRID.padding + row * (CELL.height + GRID.rowGap),
  };
}

/**
 * How many grid columns fit legibly in a canvas pane `widthPx` device pixels
 * wide, at a REFERENCE `zoom`.
 *
 * `GRID.columns` cells span, in canvas units, `GRID.padding` once (the
 * leading edge only — `cellOrigin` never adds a matching trailing padding,
 * and this does not invent one) plus the cells themselves plus the gaps
 * between them:
 *
 *     GRID.padding + GRID.columns * CELL.width + (GRID.columns - 1) * GRID.columnGap
 *
 * which is 16 + 2*580 + 1*72 = 1248 canvas units at the shipped GRID. At
 * `zoom`, that span occupies `span * zoom` device pixels — a pane narrower
 * than that cannot show every column without shrinking the cards, and
 * `CELL.width` is fixed on purpose. Below the threshold this returns 1, so
 * every card gets the pane's full width instead of a half that was too
 * narrow to read; at or above it, `GRID.columns`.
 *
 * `zoom` MUST be a fixed reference (the caller passes `DEFAULT_VIEWPORT.zoom`,
 * the canvas's fixed opening zoom — see that constant's own comment in
 * `Canvas.tsx`), never the live viewport zoom the operator is actively
 * scrolling. This function stays pure either way, but wiring in a live zoom
 * would make the ARRANGEMENT depend on how far zoomed in the operator
 * happens to be: a wheel notch could cross the threshold mid-gesture and
 * rearrange every node, which is the opening-zoom mistake `DEFAULT_VIEWPORT`
 * was already corrected for, in the other direction. Zoom scales what is on
 * screen; it must never decide what is on screen.
 */
export function columnsForWidth(widthPx: number, zoom: number): number {
  const span = GRID.padding + GRID.columns * CELL.width + (GRID.columns - 1) * GRID.columnGap;
  return widthPx >= span * zoom ? GRID.columns : 1;
}

/**
 * The top-left corner of step slot `slot` (0-based) within a cell.
 */
export function stepSlotOffset(slot: number): { x: number; y: number } {
  return { x: STEP_ORIGIN.x, y: STEP_ORIGIN.y + slot * STEP_PITCH };
}

/**
 * The SVG `d` path strings for a session's fan: a trunk from the session
 * card to the spine, a spine spanning the targets' vertical centres, and one
 * branch per target. `sourceX`/`sourceY` are the trunk's start (cell
 * coordinates); `targets` are the branches' y-coordinates.
 */
export function fanPaths(
  sourceX: number,
  sourceY: number,
  targets: readonly number[],
): { trunk: string; spine: string; branches: readonly string[] } {
  const elbowX = sourceX + FAN.elbow;
  const targetX = sourceX + FAN.width;
  const spineTop = Math.min(...targets);
  const spineBottom = Math.max(...targets);
  return {
    trunk: `M${sourceX} ${sourceY} H${elbowX}`,
    spine: `M${elbowX} ${spineTop} V${spineBottom}`,
    branches: targets.map((ty) => `M${elbowX} ${ty} H${targetX}`),
  };
}
