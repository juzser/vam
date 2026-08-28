import { describe, expect, it } from 'vitest';
import { type NavNode, nextNode } from '../../src/keyboard/spatial-nav.js';

/**
 * Geometry mirroring the canvas in docs/design/canvas-layout.md §3: two project
 * groups side by side, sessions stacked inside each.
 *
 *      x:0        x:400       x:700
 *  y:0  ┌─ A1 ─┐              ┌─ B1 ─┐
 *  y:100└──────┘              └──────┘
 *  y:200┌─ A2 ─┐
 *  y:300└──────┘
 */
const CANVAS: NavNode[] = [
  { id: 'A1', rect: { x: 0, y: 0, width: 300, height: 100 } },
  { id: 'A2', rect: { x: 0, y: 200, width: 300, height: 100 } },
  { id: 'B1', rect: { x: 700, y: 0, width: 300, height: 100 } },
];

describe('nextNode', () => {
  it('moves right to the node beside it, across project groups', () => {
    expect(nextNode(CANVAS, 'A1', 'right')).toBe('B1');
  });

  it('moves down within a group', () => {
    expect(nextNode(CANVAS, 'A1', 'down')).toBe('A2');
  });

  it('moves back up', () => {
    expect(nextNode(CANVAS, 'A2', 'up')).toBe('A1');
  });

  it('returns null at the edge of the canvas', () => {
    expect(nextNode(CANVAS, 'A1', 'left')).toBeNull();
    expect(nextNode(CANVAS, 'A1', 'up')).toBeNull();
    expect(nextNode(CANVAS, 'B1', 'right')).toBeNull();
  });

  it('prefers the node sharing the row over a nearer one that does not', () => {
    // `near` is closer in raw distance but sits far off the row; `far` is
    // straight ahead. Straight ahead wins — that is what makes `l` predictable.
    const nodes: NavNode[] = [
      { id: 'origin', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'near', rect: { x: 120, y: 900, width: 100, height: 100 } },
      { id: 'far', rect: { x: 600, y: 0, width: 100, height: 100 } },
    ];
    expect(nextNode(nodes, 'origin', 'right')).toBe('far');
  });

  it('refuses to move diagonally when nothing shares the row', () => {
    // Strictly positional: `l` means "the thing to my right", and a node that is
    // to the right *and far below* is not that. Reaching it is what `f` and the
    // palette are for. Moving there would be the cursor going somewhere the
    // eye did not point.
    const nodes: NavNode[] = [
      { id: 'origin', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'offrow', rect: { x: 300, y: 900, width: 100, height: 100 } },
    ];
    expect(nextNode(nodes, 'origin', 'right')).toBeNull();
  });

  it('never wraps around to the far side of the canvas', () => {
    const nodes: NavNode[] = [
      { id: 'left', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'right', rect: { x: 400, y: 0, width: 100, height: 100 } },
    ];
    expect(nextNode(nodes, 'right', 'right')).toBeNull();
    expect(nextNode(nodes, 'left', 'left')).toBeNull();
  });

  it('picks the nearest when several share the row', () => {
    const nodes: NavNode[] = [
      { id: 'origin', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'mid', rect: { x: 200, y: 0, width: 100, height: 100 } },
      { id: 'end', rect: { x: 900, y: 0, width: 100, height: 100 } },
    ];
    expect(nextNode(nodes, 'origin', 'right')).toBe('mid');
    expect(nextNode(nodes, 'mid', 'right')).toBe('end');
  });

  it('does not depend on the order the nodes arrive in', () => {
    const shuffled = [...CANVAS].reverse();
    expect(nextNode(shuffled, 'A1', 'right')).toBe(nextNode(CANVAS, 'A1', 'right'));
    expect(nextNode(shuffled, 'A1', 'down')).toBe(nextNode(CANVAS, 'A1', 'down'));
  });

  it('breaks an exact tie by id, so the answer is never array order', () => {
    const nodes: NavNode[] = [
      { id: 'origin', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'zeta', rect: { x: 300, y: 0, width: 100, height: 100 } },
      { id: 'alpha', rect: { x: 300, y: 0, width: 100, height: 100 } },
    ];
    expect(nextNode(nodes, 'origin', 'right')).toBe('alpha');
    expect(nextNode([...nodes].reverse(), 'origin', 'right')).toBe('alpha');
  });

  it('answers from the coordinates it is given, so dragging cannot stale it', () => {
    // The whole reason §4 computes geometry at keypress instead of caching an
    // index: drag B1 below A1 and `l` must stop finding it, while `j` starts.
    const dragged: NavNode[] = [
      { id: 'A1', rect: { x: 0, y: 0, width: 300, height: 100 } },
      { id: 'B1', rect: { x: 0, y: 400, width: 300, height: 100 } },
    ];
    expect(nextNode(dragged, 'A1', 'right')).toBeNull();
    expect(nextNode(dragged, 'A1', 'down')).toBe('B1');
  });

  it('refuses an origin id that is not on the canvas', () => {
    expect(() => nextNode(CANVAS, 'ghost', 'right')).toThrow(/ghost/);
  });

  it('returns null when the origin is the only node', () => {
    expect(nextNode([CANVAS[0] as NavNode], 'A1', 'right')).toBeNull();
  });

  it('counts a partial overlap as sharing the row', () => {
    // Rows are bands, not lines. Two nodes of different heights that overlap at
    // all are on the same run of the canvas as far as the eye is concerned, so
    // `l` must reach across.
    const nodes: NavNode[] = [
      { id: 'origin', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'grazing', rect: { x: 300, y: 90, width: 100, height: 400 } },
    ];
    expect(nextNode(nodes, 'origin', 'right')).toBe('grazing');
  });

  it('treats a touching edge as not overlapping', () => {
    // `grazing` starts exactly where the origin ends. Zero shared pixels is not
    // a shared row, and calling it one would make the boundary case depend on
    // rounding.
    const nodes: NavNode[] = [
      { id: 'origin', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'touching', rect: { x: 300, y: 100, width: 100, height: 400 } },
    ];
    expect(nextNode(nodes, 'origin', 'right')).toBeNull();
  });

  it('among equals on the same row, the better centred one wins', () => {
    // Same distance ahead, both overlap the row, so neither reach nor drift
    // separates them — only how squarely they line up with the origin.
    const nodes: NavNode[] = [
      { id: 'origin', rect: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'skewed', rect: { x: 300, y: 50, width: 100, height: 100 } },
      { id: 'squared', rect: { x: 300, y: 20, width: 100, height: 100 } },
    ];
    expect(nextNode(nodes, 'origin', 'right')).toBe('squared');
  });
});
