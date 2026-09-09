/**
 * SIZES ON THE SPLIT TREE — the model half of "add pane resizing when split".
 *
 * `split.ts` had no sizes at all: children were equal-share by construction,
 * so every pane of a split was `flex-1` and there was nothing a drag could
 * change. This file pins the rules that adding a size to each child creates,
 * and the ones that adding it MUST NOT break.
 *
 * The invariant, stated once and asserted from a dozen directions below:
 *
 *   for every split in every tree any operation in `split.ts` can produce,
 *   `splitSizes` returns exactly `children.length` finite fractions, each at
 *   least `sizeFloor(children.length)`, summing to 1.
 *
 * Sizes are FRACTIONS of the parent split's own extent, not pixels. `split.ts`
 * is pure and knows nothing about a viewport, and a fraction is the only unit
 * that survives a window resize, a nested split and a restore into a
 * differently-shaped shell without arithmetic at every reader.
 */

import { describe, expect, it } from 'vitest';
import {
  adoptOrphans,
  closePane,
  detachTab,
  dividerShare,
  leaves,
  MIN_PANE_PX,
  MIN_PANE_SHARE,
  normaliseTree,
  pruneClosedTabs,
  removeTab,
  resizeSplit,
  restoreLayout,
  type Split,
  type SplitTree,
  setPaneSession,
  singlePane,
  splitPane,
  splitSizes,
} from '../../src/renderer/canvas/split.js';

/** Every split node in a tree, wherever it sits. */
function splits(tree: SplitTree): readonly Split[] {
  return tree.kind === 'leaf' ? [] : [tree, ...tree.children.flatMap(splits)];
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** Fractions compared as fractions: 0.75 * (0.5 + 0.25) is not 0.5625 in
 *  binary floating point, and an exact `toEqual` on a size would be a test
 *  that pins the arithmetic's rounding rather than its rule. */
function expectShares(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [at, want] of expected.entries()) {
    expect(actual[at] ?? Number.NaN).toBeCloseTo(want, 10);
  }
}

/**
 * The whole invariant, applied to every split in a tree at once.
 *
 * Asserted against the STORED sizes as well as against `splitSizes`: a
 * normaliser that repairs a broken store on every read would make every
 * assertion below pass while the operations themselves quietly wrote
 * nonsense. `expectSized` checks that the repair had nothing to do.
 */
function expectSized(tree: SplitTree) {
  const all = splits(tree);
  for (const split of all) {
    const sizes = splitSizes(split);
    expect(sizes).toHaveLength(split.children.length);
    expect(sum(sizes)).toBeCloseTo(1, 10);
    for (const size of sizes) {
      expect(Number.isFinite(size)).toBe(true);
      expect(size).toBeGreaterThanOrEqual(MIN_PANE_SHARE / split.children.length - 1e-12);
    }
    // The store already holds what the reader would compute — nothing here
    // depends on read-time repair.
    expect(split.sizes).toBeDefined();
    expect([...(split.sizes ?? [])]).toHaveLength(sizes.length);
    for (const [at, stored] of (split.sizes ?? []).entries()) {
      expect(stored).toBeCloseTo(sizes[at] ?? Number.NaN, 10);
    }
  }
  return all;
}

describe('splitSizes — total over anything a store can hold', () => {
  const split = (children: number, sizes?: readonly number[]): Split => ({
    kind: 'split',
    id: 'sp',
    orientation: 'row',
    children: Array.from({ length: children }, (_, at) => singlePane(`s${at}`, `p${at}`)),
    ...(sizes === undefined ? {} : { sizes }),
  });

  it('equal shares when the split carries no sizes at all — the pre-resize layout', () => {
    expectShares(splitSizes(split(2)), [0.5, 0.5]);
    expectShares(splitSizes(split(4)), [0.25, 0.25, 0.25, 0.25]);
  });

  it('normalises sizes that do not sum to 1', () => {
    expectShares(splitSizes(split(2, [3, 1])), [0.75, 0.25]);
  });

  it('equal-shares the tail when the store holds FEWER sizes than children', () => {
    // Two remembered, three on screen: the store predates a third pane.
    const sizes = splitSizes(split(3, [0.7, 0.3]));
    expect(sizes).toHaveLength(3);
    expect(sum(sizes)).toBeCloseTo(1, 10);
    // The two that were remembered keep their RATIO; the newcomer gets an
    // equal share of the original whole, and everything is renormalised.
    expect((sizes[0] ?? 0) / (sizes[1] ?? 1)).toBeCloseTo(0.7 / 0.3, 10);
  });

  it('drops sizes the store holds for children that are gone', () => {
    const sizes = splitSizes(split(2, [0.2, 0.3, 0.5]));
    expect(sizes).toHaveLength(2);
    expect(sum(sizes)).toBeCloseTo(1, 10);
    expect((sizes[0] ?? 0) / (sizes[1] ?? 1)).toBeCloseTo(0.2 / 0.3, 10);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a negative', -4],
    ['zero', 0],
  ])('replaces %s with an equal share rather than producing a pane of no width', (_label, bad) => {
    const sizes = splitSizes(split(2, [bad, 0.5]));
    expect(sizes).toHaveLength(2);
    expect(sum(sizes)).toBeCloseTo(1, 10);
    for (const size of sizes) {
      expect(size).toBeGreaterThan(0);
    }
  });

  it('lifts a size below the floor UP to it, taking the room from the rest', () => {
    const sizes = splitSizes(split(2, [0.0001, 0.9999]));
    expect(sum(sizes)).toBeCloseTo(1, 10);
    expect(sizes[0]).toBeCloseTo(MIN_PANE_SHARE / 2, 10);
    expect(sizes[1]).toBeCloseTo(1 - MIN_PANE_SHARE / 2, 10);
  });

  it('falls back to equal shares when there are more children than the floor allows', () => {
    // With a floor of MIN_PANE_SHARE/n the floor scales, so this can never be
    // unsatisfiable -- asserted so a future flat floor cannot silently make it
    // so.
    const many = splitSizes(split(40));
    expect(many).toHaveLength(40);
    expect(sum(many)).toBeCloseTo(1, 10);
  });

  it('an empty split has no sizes rather than a division by zero', () => {
    expect(splitSizes({ kind: 'split', id: 'sp', orientation: 'row', children: [] })).toEqual([]);
  });
});

describe('a new pane takes HALF the pane it split — nothing else moves', () => {
  it('the first split is an even two', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    expectSized(tree);
    expectShares(splitSizes(tree as Split), [0.5, 0.5]);
  });

  it('a third pane halves the one it split and leaves its sibling alone', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'right', 's3', 'p3');
    expectSized(tree);
    // p1 keeps the half it had; p2's half is now p2 and p3.
    expectShares(splitSizes(tree as Split), [0.5, 0.25, 0.25]);
  });

  it('halves the pane it split even when that pane is not the equal share', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = resizeSplit(tree, tree.id, 0, 0.8);
    tree = splitPane(tree, 'p1', 'right', 's3', 'p3');
    expectSized(tree);
    expectShares(splitSizes(tree as Split), [0.4, 0.4, 0.2]);
  });

  it('a split on the OTHER axis nests, and the nested pair is an even two', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = resizeSplit(tree, tree.id, 0, 0.7);
    tree = splitPane(tree, 'p2', 'bottom', 's3', 'p3');
    expectSized(tree);
    // The outer row is untouched: p2's slot still holds 0.3, and the nested
    // column divides that slot evenly.
    expectShares(splitSizes(tree as Split), [0.7, 0.3]);
    const nested = (tree as Split).children[1];
    expect(nested?.kind).toBe('split');
    expectShares(splitSizes(nested as Split), [0.5, 0.5]);
  });
});

describe('closing a pane gives its room to the survivors, in proportion', () => {
  it('the survivors keep their ratio to each other', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'right', 's3', 'p3');
    // p1 0.5 | p2 0.25 | p3 0.25, then p1 grows against p2.
    tree = resizeSplit(tree, tree.id, 0, 0.8);
    const before = splitSizes(tree as Split);
    expectShares(before, [0.6, 0.15, 0.25]);
    const closed = closePane(tree, 'p2') as SplitTree;
    expectSized(closed);
    const after = splitSizes(closed as Split);
    expect(sum(after)).toBeCloseTo(1, 10);
    // 0.6 : 0.25 before, 0.6 : 0.25 after — the freed 0.15 is shared out in
    // proportion, so neither survivor jumps past the other.
    expect((after[0] ?? 0) / (after[1] ?? 1)).toBeCloseTo(0.6 / 0.25, 10);
  });

  it('a collapsed split hands its whole slot to the child that is left', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = resizeSplit(tree, tree.id, 0, 0.7);
    tree = splitPane(tree, 'p2', 'bottom', 's3', 'p3');
    // p1 0.7 | (p2 / p3) 0.3 — close p3, the column collapses to p2, and p2
    // takes the whole 0.3 slot the column had.
    const closed = closePane(tree, 'p3') as SplitTree;
    expectSized(closed);
    expectShares(splitSizes(closed as Split), [0.7, 0.3]);
    expect(leaves(closed).map((leaf) => leaf.id)).toEqual(['p1', 'p2']);
  });

  it('returns the SAME tree when the id is not in it — no size churn', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = resizeSplit(tree, tree.id, 0, 0.7);
    expect(closePane(tree, 'ghost')).toBe(tree);
  });

  it('a pruned pane frees its room the same way a closed one does', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'right', 's3', 'p3');
    tree = resizeSplit(tree, tree.id, 1, 0.8);
    const pruned = pruneClosedTabs(tree, (id) => id !== 's2');
    expectSized(pruned);
    expect(leaves(pruned).map((leaf) => leaf.id)).toEqual(['p1', 'p3']);
  });
});

describe('sizes survive the operations that do NOT change the child count', () => {
  const sized = () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    return resizeSplit(tree, tree.id, 0, 0.65);
  };

  it('detachTab leaves the pane, and its size, exactly where they were', () => {
    const tree = setPaneSession(sized(), 'p1', 's3');
    const after = detachTab(tree, 'p1', 's3');
    expectSized(after);
    expectShares(splitSizes(after as Split), splitSizes(tree as Split));
  });

  it('adoptOrphans does not move a divider', () => {
    const tree = sized();
    const after = adoptOrphans(tree, ['s7', 's8'], 'p2');
    expectSized(after);
    expectShares(splitSizes(after as Split), splitSizes(tree as Split));
  });

  it('setPaneSession does not move a divider', () => {
    const tree = sized();
    expectShares(splitSizes(setPaneSession(tree, 'p2', 's9') as Split), [0.65, 0.35]);
  });

  it('removeTab keeps the divider when the pane survives', () => {
    const tree = setPaneSession(sized(), 'p1', 's3');
    const after = removeTab(tree, 'p1', 's3') as SplitTree;
    expectSized(after);
    expectShares(splitSizes(after as Split), [0.65, 0.35]);
  });
});

describe('resizeSplit — moving ONE divider, between one adjacent pair', () => {
  const three = () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'right', 's3', 'p3');
    return tree;
  };

  it('the pair exchanges room and every other sibling stays put', () => {
    const tree = three();
    // [0.5, 0.25, 0.25]; drag the divider between p2 and p3 so p2 takes 3/4
    // of THEIR pair (0.5 of the whole) rather than 3/4 of the whole.
    const after = resizeSplit(tree, tree.id, 1, 0.75);
    expectSized(after);
    expectShares(splitSizes(after as Split), [0.5, 0.375, 0.125]);
  });

  it('reaches a divider inside a NESTED split', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = splitPane(tree, 'p2', 'bottom', 's3', 'p3');
    const nested = (tree as Split).children[1] as Split;
    const after = resizeSplit(tree, nested.id, 0, 0.25);
    expectSized(after);
    // The outer row never moved.
    expectShares(splitSizes(after as Split), [0.5, 0.5]);
    expectShares(splitSizes((after as Split).children[1] as Split), [0.25, 0.75]);
  });

  it('clamps a share that would leave a pane below the floor', () => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    const after = resizeSplit(tree, tree.id, 0, 0.999);
    expectSized(after);
    const sizes = splitSizes(after as Split);
    expect(sizes[1]).toBeCloseTo(MIN_PANE_SHARE / 2, 10);
    expect(sizes[0]).toBeCloseTo(1 - MIN_PANE_SHARE / 2, 10);
  });

  it.each([
    ['a split id nothing holds', 'ghost', 0, 0.75],
    ['an index past the last divider', 'self', 1, 0.75],
    ['a negative index', 'self', -1, 0.75],
    ['a NaN share', 'self', 0, Number.NaN],
    ['an Infinite share', 'self', 0, Number.POSITIVE_INFINITY],
  ])('is a no-op, not a crash, for %s', (_label, id, at, share) => {
    const tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    const after = resizeSplit(tree, id === 'self' ? tree.id : id, at as number, share as number);
    expect(after).toBe(tree);
  });

  it('is a no-op on a leaf — the tree is not a split at all', () => {
    const tree = singlePane('s1', 'p1');
    expect(resizeSplit(tree, 'p1', 0, 0.75)).toBe(tree);
  });
});

describe('dividerShare — the pixel arithmetic a drag does, in one pure place', () => {
  it('is the first pane’s share of the pair', () => {
    expect(dividerShare(300, 1000, MIN_PANE_PX)).toBeCloseTo(0.3, 10);
  });

  it('never lets either pane of the pair fall below the pixel minimum', () => {
    expect(dividerShare(0, 1000, 160)).toBeCloseTo(0.16, 10);
    expect(dividerShare(1000, 1000, 160)).toBeCloseTo(0.84, 10);
    expect(dividerShare(-4000, 1000, 160)).toBeCloseTo(0.16, 10);
  });

  it('splits a pair too narrow for two minimums down the middle', () => {
    // 200px cannot hold two 160px panes. Halving is the only answer that
    // treats them alike, and it is reachable: it is what a fresh split is.
    expect(dividerShare(10, 200, 160)).toBe(0.5);
  });

  it.each([
    ['a NaN position', Number.NaN, 1000],
    ['a NaN pair', 300, Number.NaN],
    ['a zero-width pair', 300, 0],
    ['a negative pair', 300, -100],
    ['an Infinite pair', 300, Number.POSITIVE_INFINITY],
  ])('answers 0.5 rather than NaN for %s', (_label, first, pair) => {
    expect(dividerShare(first as number, pair as number, MIN_PANE_PX)).toBe(0.5);
  });
});

describe('restoreLayout — an old stored layout, whose sizes do not fit it', () => {
  it('accepts a layout saved before sizes existed and gives it equal shares', () => {
    // Exactly what every operator has on the first run after this change: a
    // tree the previous build wrote, with no `sizes` anywhere.
    const stored: SplitTree = {
      kind: 'split',
      id: 'sp',
      orientation: 'row',
      children: [singlePane('s1', 'p1'), singlePane('s2', 'p2'), singlePane('s3', 'p3')],
    };
    const { tree, paneId } = restoreLayout(stored, () => true, 's2', 'p2', 'fresh');
    expectSized(tree);
    expect(paneId).toBe('p2');
    expect(leaves(tree).map((leaf) => leaf.id)).toEqual(['p1', 'p2', 'p3']);
    expectShares(splitSizes(tree as Split), [1 / 3, 1 / 3, 1 / 3]);
  });

  it('repairs a layout remembered with two children and restored holding three', () => {
    const stored: SplitTree = {
      kind: 'split',
      id: 'sp',
      orientation: 'row',
      children: [singlePane('s1', 'p1'), singlePane('s2', 'p2'), singlePane('s3', 'p3')],
      sizes: [0.6, 0.4],
    };
    const { tree } = restoreLayout(stored, () => true, 's1', 'p1', 'fresh');
    const [split] = expectSized(tree);
    expect(split?.children).toHaveLength(3);
  });

  it('drops the sizes of panes whose sessions ended off screen', () => {
    const stored: SplitTree = {
      kind: 'split',
      id: 'sp',
      orientation: 'row',
      children: [singlePane('s1', 'p1'), singlePane('s2', 'p2'), singlePane('s3', 'p3')],
      sizes: [0.2, 0.5, 0.3],
    };
    const { tree } = restoreLayout(stored, (id) => id !== 's2', 's1', 'p1', 'fresh');
    expectSized(tree);
    expect(leaves(tree).map((leaf) => leaf.id)).toEqual(['p1', 'p3']);
    // 0.2 : 0.3 survives the loss of the middle pane.
    const sizes = splitSizes(tree as Split);
    expect((sizes[0] ?? 0) / (sizes[1] ?? 1)).toBeCloseTo(0.2 / 0.3, 10);
  });

  it.each([
    ['garbage', [Number.NaN, 'x' as unknown as number, -1]],
    ['every entry zero', [0, 0, 0]],
    ['one enormous entry', [1e300, 1, 1]],
  ])('never produces a pane of no width from %s sizes', (_label, sizes) => {
    const stored: SplitTree = {
      kind: 'split',
      id: 'sp',
      orientation: 'row',
      children: [singlePane('s1', 'p1'), singlePane('s2', 'p2'), singlePane('s3', 'p3')],
      sizes: sizes as readonly number[],
    };
    const { tree } = restoreLayout(stored, () => true, 's1', 'p1', 'fresh');
    expectSized(tree);
    expect(leaves(tree)).toHaveLength(3);
  });

  it('keeps a layout whose sizes DO fit, untouched, across the round trip', () => {
    let stored = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    stored = resizeSplit(stored, stored.id, 0, 0.72);
    const { tree } = restoreLayout(stored, () => true, 's1', 'p1', 'fresh');
    expectShares(splitSizes(tree as Split), [0.72, 0.28]);
  });
});

describe('normaliseTree — the repair pass, identity-preserving when there is nothing to repair', () => {
  it('returns the SAME object for a tree already normalised', () => {
    let tree = splitPane(singlePane('s1', 'p1'), 'p1', 'right', 's2', 'p2');
    tree = resizeSplit(tree, tree.id, 0, 0.65);
    expect(normaliseTree(tree)).toBe(tree);
  });

  it('returns the SAME object for a leaf', () => {
    const tree = singlePane('s1', 'p1');
    expect(normaliseTree(tree)).toBe(tree);
  });

  it('reaches a nested split whose sizes are missing', () => {
    const stored: SplitTree = {
      kind: 'split',
      id: 'outer',
      orientation: 'row',
      sizes: [0.5, 0.5],
      children: [
        singlePane('s1', 'p1'),
        {
          kind: 'split',
          id: 'inner',
          orientation: 'column',
          children: [singlePane('s2', 'p2'), singlePane('s3', 'p3')],
        },
      ],
    };
    expectSized(normaliseTree(stored));
  });
});
