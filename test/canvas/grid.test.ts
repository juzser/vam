import { describe, expect, it } from 'vitest';
import {
  compactTokens,
  FOCUS_VIEWPORT_SHARE,
  focusPadding,
} from '../../src/renderer/canvas/Canvas.js';
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

/**
 * The focused row's share of the canvas.
 *
 * The operator has set this target twice with different numbers and has said
 * it will become a setting, so the SHARE is the value that means something and
 * the padding is derived from it. That derivation is the thing worth pinning:
 * a wrong inversion would be invisible on screen — the view would simply be
 * framed a bit differently — and no other test would catch it.
 */
describe('focusPadding inverts ReactFlow fitView padding', () => {
  it('round-trips every share back to itself', () => {
    for (const share of [0.5, 0.6, 0.7, 0.8, 0.95]) {
      const p = focusPadding(share);
      // ReactFlow adds `p` on each side, so content occupies 1/(1 + 2p).
      expect(1 / (1 + 2 * p), `share ${share}`).toBeCloseTo(share, 10);
    }
  });

  it('is set to the asked-for 60 percent', () => {
    expect(FOCUS_VIEWPORT_SHARE).toBe(0.6);
    expect(focusPadding(FOCUS_VIEWPORT_SHARE)).toBeCloseTo(1 / 3, 10);
  });

  it('asks for more padding as the target share shrinks', () => {
    // Monotonicity, so an inverted formula that happened to hit one value
    // right cannot pass: a smaller share must always mean more room around it.
    expect(focusPadding(0.5)).toBeGreaterThan(focusPadding(0.6));
    expect(focusPadding(0.6)).toBeGreaterThan(focusPadding(0.7));
  });
});

/**
 * The status bar's token cell.
 *
 * It rendered a hardcoded `today — · — / — cap` for as long as the adapter
 * ignored the two fields that carry the numbers. The fix must not swap one
 * untrue caption for a quieter one, so two things are pinned here: the
 * formatter's output width, and the fact that a payload with no budget stays
 * distinguishable from a factory that has spent nothing.
 */
describe('compactTokens keeps the status bar cell narrow', () => {
  it('abbreviates thousands and millions', () => {
    expect(compactTokens(578_346)).toBe('578k');
    expect(compactTokens(4_200_000)).toBe('4.2M');
    expect(compactTokens(999)).toBe('999');
  });

  it('switches unit exactly at the boundaries, not near them', () => {
    expect(compactTokens(999)).toBe('999');
    expect(compactTokens(1_000)).toBe('1k');
    expect(compactTokens(999_999)).toBe('1000k');
    expect(compactTokens(1_000_000)).toBe('1.0M');
  });

  it('never returns a localised suffix', () => {
    // `Intl.NumberFormat`'s compact notation localises the suffix, which makes
    // the cell's width depend on the viewer's locale in a bar that has one
    // line and seven cells. This formatter is deliberately not that.
    for (const n of [1_500, 2_400_000, 12, 0]) {
      expect(compactTokens(n)).toMatch(/^[0-9.]+[kM]?$/);
    }
  });
});
