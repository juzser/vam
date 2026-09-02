import { describe, expect, it } from 'vitest';
import {
  CELL,
  cellOrigin,
  fanPaths,
  GRID,
  INFO_OFFSET,
  INFO_SIZE,
  PILL_SIZE,
  STEP_ORIGIN,
  STEP_PITCH,
  STEP_SIZE,
  STEP_SLOTS,
  stepSlotOffset,
} from '../../src/renderer/canvas/grid.js';

describe('constants', () => {
  it('matches epic.md section 3.1-3.3', () => {
    expect(CELL).toEqual({ width: 580, height: 290 });
    expect(GRID).toEqual({ columns: 2, padding: 16, rowGap: 64, columnGap: 72 });
    expect(INFO_SIZE).toEqual({ width: 220, height: 174 });
    expect(STEP_SIZE).toEqual({ width: 250, height: 90 });
    expect(STEP_SLOTS).toBe(3);
    expect(STEP_ORIGIN).toEqual({ x: 330, y: 0 });
    expect(STEP_PITCH).toBe(100);
    expect(PILL_SIZE).toEqual({ width: 58, height: 20 });
  });

  it('derives INFO_OFFSET.y from CELL.height and INFO_SIZE.height', () => {
    expect(INFO_OFFSET.x).toBe(0);
    expect(INFO_OFFSET.y).toBe((CELL.height - INFO_SIZE.height) / 2);
    expect(INFO_OFFSET.y).toBe(58);
  });
});

describe('cellOrigin', () => {
  it('places cell 0 at the grid padding', () => {
    expect(cellOrigin(0)).toEqual({ x: 16, y: 16 });
  });

  it('advances by cell width plus column gap across a row', () => {
    expect(cellOrigin(1)).toEqual({ x: 668, y: 16 });
  });

  it('advances by cell height plus row gap down a column', () => {
    expect(cellOrigin(2)).toEqual({ x: 16, y: 370 });
  });

  it('places cell 5 (row 2, column 1)', () => {
    expect(cellOrigin(5)).toEqual({ x: 668, y: 724 });
  });
});

describe('stepSlotOffset', () => {
  it('places slot 0 at STEP_ORIGIN', () => {
    expect(stepSlotOffset(0)).toEqual({ x: 330, y: 0 });
  });

  it('places slot 1 one pitch below slot 0', () => {
    expect(stepSlotOffset(1)).toEqual({ x: 330, y: 100 });
  });

  it('places slot 2 two pitches below slot 0', () => {
    expect(stepSlotOffset(2)).toEqual({ x: 330, y: 200 });
  });
});

describe('fanPaths', () => {
  it('draws trunk, spine and one branch per target for three targets', () => {
    const result = fanPaths(220, 145, [45, 145, 245]);
    expect(result.trunk).toBe('M220 145 H265');
    expect(result.spine).toBe('M265 45 V245');
    expect(result.branches).toEqual(['M265 45 H330', 'M265 145 H330', 'M265 245 H330']);
  });

  it('draws a zero-length spine for a single target, never Infinity or a throw', () => {
    const result = fanPaths(220, 145, [145]);
    expect(result.spine).toBe('M265 145 V145');
    expect(result.trunk).toBe('M220 145 H265');
    expect(result.branches).toEqual(['M265 145 H330']);
  });
});
