import { describe, expect, it } from 'vitest';
import { type FlowNodeLike, toNavNodes } from '../../src/renderer/canvas/nav-nodes.js';

const NODES: FlowNodeLike[] = [
  { id: 'p1', position: { x: 100, y: 50 }, measured: { width: 352, height: 400 } },
  { id: 's1', parentId: 'p1', position: { x: 16, y: 40 }, measured: { width: 320, height: 168 } },
  { id: 'p2', position: { x: 600, y: 50 }, measured: { width: 352, height: 240 } },
  { id: 's2', parentId: 'p2', position: { x: 16, y: 40 }, measured: { width: 320, height: 168 } },
];

describe('toNavNodes', () => {
  it("adds the parent's offset, because a child's position is relative to it", () => {
    const [s1] = toNavNodes(NODES, ['s1']);
    expect(s1?.rect).toEqual({ x: 116, y: 90, width: 320, height: 168 });
  });

  it('leaves a top-level node where it is', () => {
    const [p1] = toNavNodes(NODES, ['p1']);
    expect(p1?.rect.x).toBe(100);
    expect(p1?.rect.y).toBe(50);
  });

  it('returns the navigable nodes in the order asked for, not canvas order', () => {
    expect(toNavNodes(NODES, ['s2', 's1']).map((n) => n.id)).toEqual(['s2', 's1']);
  });

  it('returns only what was asked for, so groups never become destinations', () => {
    expect(toNavNodes(NODES, ['s1', 's2']).map((n) => n.id)).toEqual(['s1', 's2']);
  });

  it('reflects a drag, which is the whole reason this runs at keypress', () => {
    const dragged = NODES.map((node) =>
      node.id === 's1' ? { ...node, position: { x: 16, y: 300 } } : node,
    );
    expect(toNavNodes(dragged, ['s1'])[0]?.rect.y).toBe(350);
  });

  it('falls back to the requested size before ReactFlow has measured', () => {
    const unmeasured: FlowNodeLike[] = [
      { id: 'a', position: { x: 0, y: 0 }, width: 320, height: 168 },
    ];
    expect(toNavNodes(unmeasured, ['a'])[0]?.rect).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 168,
    });
  });

  it('treats a node with no size at all as zero rather than crashing', () => {
    const sizeless: FlowNodeLike[] = [{ id: 'a', position: { x: 5, y: 5 } }];
    expect(toNavNodes(sizeless, ['a'])[0]?.rect.width).toBe(0);
  });

  it('skips an id that is not on the canvas', () => {
    expect(toNavNodes(NODES, ['ghost', 's1']).map((n) => n.id)).toEqual(['s1']);
  });

  it('skips a node whose parent is missing rather than misplacing it', () => {
    // Returning it at its relative coordinates would put it in the wrong
    // coordinate space, and navigation would confidently pick the wrong node.
    const orphan: FlowNodeLike[] = [
      { id: 'x', parentId: 'gone', position: { x: 16, y: 40 }, measured: { width: 1, height: 1 } },
    ];
    expect(toNavNodes(orphan, ['x'])).toEqual([]);
  });
});
