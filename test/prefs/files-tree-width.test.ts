/**
 * THE FILE TREE'S WIDTH ARITHMETIC — the half of the resizer that is a pure
 * function, tested where it lives rather than through the component.
 *
 * The one rule that is easy to write and expensive to get wrong is the LAST
 * describe below: the container clamp is RENDER-ONLY. The Files tab is not
 * unmounted when another tab shows (`FilesTab.tsx`'s own header: it is
 * removed from layout with `hidden`/`display: none` so unsaved text
 * survives), and a `display: none` element measures 0px. A clamp that took
 * that 0 seriously would shrink the operator's chosen width to the floor the
 * first time they looked at the Terminal tab, permanently, and nothing about
 * that failure would look like a bug in a resizer.
 */

import { describe, expect, it } from 'vitest';
import {
  COLUMN_GAP,
  clampStoredTreeWidth,
  renderedTreeWidth,
  TREE_WIDTH_DEFAULT,
  TREE_WIDTH_MAX,
  TREE_WIDTH_MIN,
  treeWidthCeiling,
} from '../../src/renderer/prefs/files-tree-width.js';

describe('clampStoredTreeWidth is total', () => {
  it('keeps a width that is already inside the bounds', () => {
    expect(clampStoredTreeWidth(300)).toBe(300);
  });

  it('raises a width below the floor to the floor', () => {
    expect(clampStoredTreeWidth(10)).toBe(TREE_WIDTH_MIN);
    expect(clampStoredTreeWidth(0)).toBe(TREE_WIDTH_MIN);
    expect(clampStoredTreeWidth(-9000)).toBe(TREE_WIDTH_MIN);
  });

  it('lowers a width above the cap to the cap', () => {
    expect(clampStoredTreeWidth(99_999)).toBe(TREE_WIDTH_MAX);
  });

  /** A hand-edited `localStorage`, an older vam, a devtools `Infinity`. None
   *  of them may render a column of `NaN` pixels — which is a tree that has
   *  vanished, not a tree that failed to load. */
  it('answers the DEFAULT for anything that is not a finite number', () => {
    expect(clampStoredTreeWidth(Number.NaN)).toBe(TREE_WIDTH_DEFAULT);
    expect(clampStoredTreeWidth(Number.POSITIVE_INFINITY)).toBe(TREE_WIDTH_DEFAULT);
    expect(clampStoredTreeWidth('216')).toBe(TREE_WIDTH_DEFAULT);
    expect(clampStoredTreeWidth(null)).toBe(TREE_WIDTH_DEFAULT);
    expect(clampStoredTreeWidth(undefined)).toBe(TREE_WIDTH_DEFAULT);
    expect(clampStoredTreeWidth({ width: 200 })).toBe(TREE_WIDTH_DEFAULT);
  });
});

describe('the live ceiling keeps the editor the larger half', () => {
  /**
   * The invariant the `TREE_WIDTH` clamp was built to hold and that a drag
   * handle would otherwise let the operator break: the tree may never take
   * more than the editor. Asserted as arithmetic here and as RECTANGLES in
   * `e2e/files-tree-resize-shots.mjs`, which is the one that can fail for a
   * reason this file cannot see.
   */
  it('never lets the tree exceed half of what the two columns share', () => {
    for (const container of [291, 400, 640, 807, 1200]) {
      const ceiling = treeWidthCeiling(container);
      const editor = container - COLUMN_GAP - ceiling;
      expect(editor).toBeGreaterThanOrEqual(ceiling);
    }
  });

  it('is the stored cap on a container wide enough not to bind', () => {
    expect(treeWidthCeiling(4000)).toBe(TREE_WIDTH_MAX);
  });

  it('is half the columns on a container narrow enough to bind', () => {
    expect(treeWidthCeiling(807)).toBe(Math.floor((807 - COLUMN_GAP) / 2));
  });

  /**
   * CSS's own rule, kept: `min-width` beats `max-width`, so a container too
   * narrow for both floors renders the tree at its floor and lets the editor
   * — which has `min-w-0` — take the squeeze. That is what ships today and
   * this arithmetic must not silently change it.
   */
  it('never falls below the floor, however narrow the container gets', () => {
    expect(treeWidthCeiling(200)).toBe(TREE_WIDTH_MIN);
    expect(treeWidthCeiling(1)).toBe(TREE_WIDTH_MIN);
  });
});

describe('the container clamp is RENDER-ONLY — a hidden pane must not shrink a chosen width', () => {
  /**
   * The trap orca's own comment names, and it applies to vam more sharply:
   * orca's tree unmounts while collapsed, vam's is merely `display: none`
   * behind another tab. A 0px measurement is "unknown", never "very narrow".
   */
  it('treats a 0px container as unknown and honours the stored width whole', () => {
    expect(renderedTreeWidth(400, 0)).toBe(400);
    expect(treeWidthCeiling(0)).toBe(TREE_WIDTH_MAX);
  });

  it('treats a non-finite container the same way', () => {
    expect(renderedTreeWidth(400, Number.NaN)).toBe(400);
    expect(renderedTreeWidth(400, Number.POSITIVE_INFINITY)).toBe(400);
    expect(renderedTreeWidth(400, -1)).toBe(400);
  });

  it('clamps against a container it CAN measure, without changing the stored number', () => {
    // 291px is what the two columns share at vam's narrowest legal pane.
    expect(renderedTreeWidth(400, 291)).toBe(Math.floor((291 - COLUMN_GAP) / 2));
    // …and the same stored 400 comes back whole once there is room for it.
    expect(renderedTreeWidth(400, 1200)).toBe(400);
  });

  it('still floors a rendered width, so a narrow pane never draws a sliver', () => {
    expect(renderedTreeWidth(TREE_WIDTH_MIN, 200)).toBe(TREE_WIDTH_MIN);
    expect(renderedTreeWidth(10, 200)).toBe(TREE_WIDTH_MIN);
  });

  it('is total over a garbage stored width at any container size', () => {
    expect(renderedTreeWidth(Number.NaN, 1200)).toBe(TREE_WIDTH_DEFAULT);
    expect(renderedTreeWidth('wide', 0)).toBe(TREE_WIDTH_DEFAULT);
  });
});

describe('the numbers themselves', () => {
  /** 7.5rem and 13.5rem at a 16px root — what `TREE_WIDTH` ships as today, so
   *  an operator who never drags sees no move. */
  it('floors at the readable-name width the clamp already used', () => {
    expect(TREE_WIDTH_MIN).toBe(120);
  });

  it('defaults to the width a wide pane already draws', () => {
    expect(TREE_WIDTH_DEFAULT).toBe(216);
  });

  it('caps a STORED width well above the old render cap, or a drag buys nothing', () => {
    expect(TREE_WIDTH_MAX).toBeGreaterThan(TREE_WIDTH_DEFAULT);
  });
});
