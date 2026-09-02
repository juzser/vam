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
 */
export function cellOrigin(index: number): { x: number; y: number } {
  const column = index % GRID.columns;
  const row = Math.floor(index / GRID.columns);
  return {
    x: GRID.padding + column * (CELL.width + GRID.columnGap),
    y: GRID.padding + row * (CELL.height + GRID.rowGap),
  };
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
