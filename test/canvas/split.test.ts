/**
 * The split-pane layout tree, in isolation from React and from Canvas.
 *
 * A15.1: a tab can be split horizontally or vertically, only within one
 * project, by dragging. `DetailPanel` is fenced (owned by a concurrent
 * agent), so the isolation every split pane needs — `outIsLive`, the
 * auto-follow `stuckRef`, the sticky IN, the per-session composer draft, the
 * view icons — has to come from mounting a SEPARATE `DetailPanel` instance
 * per pane, never from sharing one. This module is the pure data structure
 * that makes that possible: a tree of leaves (one session each) and splits
 * (an orientation and two-or-more children), with no React and no DOM, so
 * every rule about how a split is built, closed or walked can be proven
 * directly rather than through a rendered tree.
 *
 * `row` = a vertical divider, panes side by side (vim `:vsplit`). `column` =
 * a horizontal divider, panes stacked (vim `:split`). Named after the CSS
 * flex-direction each one renders with, since that is what `Canvas.tsx`
 * actually reads.
 */

import { describe, expect, it } from 'vitest';
import {
  closePane,
  findLeaf,
  leaves,
  nearestEdge,
  type SplitTree,
  setPaneSession,
  singlePane,
  splitPane,
  stepPane,
} from '../../src/renderer/canvas/split.js';

describe('singlePane', () => {
  it('is one leaf holding the given session', () => {
    const tree = singlePane('s1', 'pane-1');
    expect(tree).toEqual({ kind: 'leaf', id: 'pane-1', sessionId: 's1' });
  });

  it('tolerates no session at all — the pre-load state', () => {
    const tree = singlePane(null, 'pane-1');
    expect(tree).toEqual({ kind: 'leaf', id: 'pane-1', sessionId: null });
  });
});

describe('leaves — walks the tree left to right, top to bottom', () => {
  it('is just itself for a single leaf', () => {
    expect(leaves(singlePane('s1', 'pane-1'))).toEqual([
      { kind: 'leaf', id: 'pane-1', sessionId: 's1' },
    ]);
  });

  it('flattens a split in child order', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    expect(leaves(tree).map((l) => l.id)).toEqual(['p1', 'p2']);
  });

  it('flattens nested splits depth-first', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'bottom', 's3', 'p3');
    // p1 | (p2 above p3)
    expect(leaves(tree).map((l) => l.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('findLeaf', () => {
  it('finds a leaf by id anywhere in the tree', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'bottom', 's3', 'p3');
    expect(findLeaf(tree, 'p3')).toEqual({ kind: 'leaf', id: 'p3', sessionId: 's3' });
  });

  it('is null for an id nothing holds', () => {
    expect(findLeaf(singlePane('s1', 'p1'), 'nope')).toBeNull();
  });
});

describe('setPaneSession', () => {
  it('replaces only the matching leaf’s session', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = setPaneSession(tree, 'p2', 's9');
    expect(findLeaf(tree, 'p1')?.sessionId).toBe('s1');
    expect(findLeaf(tree, 'p2')?.sessionId).toBe('s9');
  });

  it('reaches a leaf nested under two levels of split', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'bottom', 's3', 'p3');
    tree = setPaneSession(tree, 'p3', 's9');
    expect(findLeaf(tree, 'p3')?.sessionId).toBe('s9');
    expect(findLeaf(tree, 'p1')?.sessionId).toBe('s1');
  });

  it('is a no-op, not a crash, when the id is not in the tree', () => {
    const tree = singlePane('s1', 'p1');
    expect(setPaneSession(tree, 'ghost', 's9')).toEqual(tree);
  });

  it('accepts null — pointing a pane at nothing, not only the pre-load state', () => {
    const tree = setPaneSession(singlePane('s1', 'p1'), 'p1', null);
    expect(findLeaf(tree, 'p1')?.sessionId).toBeNull();
  });
});

describe('splitPane — orientation and side', () => {
  it('left puts the new pane BEFORE the target, in a row (side-by-side)', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'left', 's2', 'p2');
    expect(tree).toMatchObject({
      kind: 'split',
      orientation: 'row',
      children: [
        { kind: 'leaf', id: 'p2', sessionId: 's2' },
        { kind: 'leaf', id: 'p1', sessionId: 's1' },
      ],
    });
  });

  it('right puts the new pane AFTER the target, in a row', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    expect(tree).toMatchObject({
      kind: 'split',
      orientation: 'row',
      children: [
        { kind: 'leaf', id: 'p1' },
        { kind: 'leaf', id: 'p2' },
      ],
    });
  });

  it('top puts the new pane BEFORE the target, in a column (stacked)', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'top', 's2', 'p2');
    expect(tree).toMatchObject({
      kind: 'split',
      orientation: 'column',
      children: [{ id: 'p2' }, { id: 'p1' }],
    });
  });

  it('bottom puts the new pane AFTER the target, in a column', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'bottom', 's2', 'p2');
    expect(tree).toMatchObject({
      kind: 'split',
      orientation: 'column',
      children: [{ id: 'p1' }, { id: 'p2' }],
    });
  });
});

describe('splitPane — a third pane joins an existing split as a sibling', () => {
  it('does not nest when the new edge matches the parent’s own orientation', () => {
    // p1 | p2, then split p2 to its right — same axis, so p3 joins the row.
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'right', 's3', 'p3');
    expect(tree.kind).toBe('split');
    expect(tree).toMatchObject({ orientation: 'row' });
    expect(leaves(tree).map((l) => l.id)).toEqual(['p1', 'p2', 'p3']);
    // Exactly one split node, not split-of-a-split.
    if (tree.kind === 'split') {
      expect(tree.children).toHaveLength(3);
    }
  });

  it('nests when the new edge crosses the parent’s own orientation', () => {
    // p1 | p2 (row), then split p2 downward — a different axis, so p2 alone
    // becomes a nested column, and the row still has exactly two slots.
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'bottom', 's3', 'p3');
    expect(tree).toMatchObject({ kind: 'split', orientation: 'row' });
    if (tree.kind === 'split') {
      expect(tree.children).toHaveLength(2);
      expect(tree.children[0]).toMatchObject({ kind: 'leaf', id: 'p1' });
      expect(tree.children[1]).toMatchObject({ kind: 'split', orientation: 'column' });
    }
    expect(leaves(tree).map((l) => l.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('splitPane — total over a missing target', () => {
  it('returns the tree unchanged rather than crashing', () => {
    const tree = singlePane('s1', 'p1');
    expect(splitPane(tree, 'ghost', 'right', 's2', 'p2')).toEqual(tree);
  });
});

describe('closePane', () => {
  it('refuses to close the only pane — null means "cannot"', () => {
    expect(closePane(singlePane('s1', 'p1'), 'p1')).toBeNull();
  });

  it('collapses a two-pane split back to a single leaf', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    const closed = closePane(tree, 'p2');
    expect(closed).toEqual({ kind: 'leaf', id: 'p1', sessionId: 's1' });
  });

  it('collapses a three-pane row down to two, not down to one', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'right', 's3', 'p3');
    const closed = closePane(tree, 'p2') as SplitTree;
    expect(leaves(closed).map((l) => l.id)).toEqual(['p1', 'p3']);
    expect(closed.kind).toBe('split');
  });

  it('collapses a nested split when closing leaves it with one child', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'bottom', 's3', 'p3');
    // p1 | (p2 / p3) -- close p3, the nested column collapses to p2 alone,
    // and the outer row is left with exactly p1 | p2.
    const closed = closePane(tree, 'p3') as SplitTree;
    expect(leaves(closed).map((l) => l.id)).toEqual(['p1', 'p2']);
    expect(closed).toMatchObject({
      kind: 'split',
      orientation: 'row',
      children: [
        { kind: 'leaf', id: 'p1' },
        { kind: 'leaf', id: 'p2' },
      ],
    });
  });

  it('is a no-op when the id is not in the tree', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    expect(closePane(tree, 'ghost')).toEqual(tree);
  });
});

describe('stepPane — cycling focus among leaves, wrapping at both ends', () => {
  it('steps forward and wraps past the last pane', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'right', 's3', 'p3');
    expect(stepPane(tree, 'p1', 1)).toBe('p2');
    expect(stepPane(tree, 'p3', 1)).toBe('p1');
  });

  it('steps backward and wraps past the first pane', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    expect(stepPane(tree, 'p1', -1)).toBe('p2');
    expect(stepPane(tree, 'p2', -1)).toBe('p1');
  });

  it('is a no-op with only one pane', () => {
    expect(stepPane(singlePane('s1', 'p1'), 'p1', 1)).toBe('p1');
  });

  it('is a no-op when the current id is not in the tree', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    expect(stepPane(tree, 'ghost', 1)).toBe('ghost');
  });
});

describe('nearestEdge — pure hit-testing for a drop, no DOM required', () => {
  it('picks the edge the point is closest to', () => {
    expect(nearestEdge(2, 50, 100, 100)).toBe('left');
    expect(nearestEdge(98, 50, 100, 100)).toBe('right');
    expect(nearestEdge(50, 2, 100, 100)).toBe('top');
    expect(nearestEdge(50, 98, 100, 100)).toBe('bottom');
  });

  it('is total over a degenerate zero-size rect', () => {
    expect(['left', 'right', 'top', 'bottom']).toContain(nearestEdge(0, 0, 0, 0));
  });
});
