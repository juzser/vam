/**
 * The split-pane layout tree.
 *
 * A15.1: a tab can be split horizontally or vertically, by dragging, within
 * one project. Once more than one pane exists at a time, every assumption
 * `DetailPanel` makes about being the only one becomes suspect — `outIsLive`,
 * the auto-follow `stuckRef`, the sticky IN, the per-session composer draft,
 * the view icons. `DetailPanel.tsx` is owned by a concurrent agent and
 * fenced off; the fix cannot live inside it. It lives here instead, as a data
 * structure: `Canvas.tsx` mounts one SEPARATE `DetailPanel` instance per leaf
 * of this tree, so the isolation these five things need is the ordinary
 * isolation between two React component instances, never a shared cell one
 * pane could stomp on. See `Canvas.tsx`'s own doc comment for how the tree is
 * wired to the render.
 *
 * Pure and total, the same discipline `prefs/panes.ts` holds itself to: every
 * function here is a plain function of its arguments, never throws, and a
 * lookup that finds nothing returns the input unchanged rather than crashing
 * — a drop target that raced a close, or a stale id left over from a closed
 * pane, must not bring the shell down.
 *
 * `row` = a vertical divider, panes side by side (vim `:vsplit`, VSCode
 * "Split Right"). `column` = a horizontal divider, panes stacked (vim
 * `:split`, VSCode "Split Down"). Named after the CSS flex-direction each one
 * renders with — `Canvas.tsx` reads `orientation` directly into a
 * `flex-row`/`flex-col` class, so there is one vocabulary, not two that could
 * drift.
 */

/** One pane: the session it shows, or `null` before the first model has
 *  loaded — the same pre-load state `focusedSessionId` already tolerates. */
export type Leaf = {
  readonly kind: 'leaf';
  readonly id: string;
  readonly sessionId: string | null;
};

/** A divider, and what it holds — two or more panes or nested splits, in
 *  the order they are drawn. */
export type Split = {
  readonly kind: 'split';
  readonly id: string;
  readonly orientation: SplitOrientation;
  readonly children: readonly SplitTree[];
};

export type SplitOrientation = 'row' | 'column';

export type SplitTree = Leaf | Split;

/** Which edge of a pane a drag was released over — the gesture that decides
 *  both the new split's orientation (`orientationFor`) and which side of the
 *  target the new pane lands on (`isBefore`). */
export type Edge = 'left' | 'right' | 'top' | 'bottom';

/** The layout before any split exists: one pane, holding one session (or
 *  none yet). */
export function singlePane(sessionId: string | null, id: string): SplitTree {
  return { kind: 'leaf', id, sessionId };
}

/** Every leaf, left to right and top to bottom as the tree draws them —
 *  depth-first over `children`, which is already in draw order. */
export function leaves(tree: SplitTree): readonly Leaf[] {
  return tree.kind === 'leaf' ? [tree] : tree.children.flatMap(leaves);
}

/** One leaf by id, wherever it sits in the tree, or `null` when nothing
 *  holds it — a pane that has already been closed, or an id from a stale
 *  closure. */
export function findLeaf(tree: SplitTree, id: string): Leaf | null {
  return leaves(tree).find((leaf) => leaf.id === id) ?? null;
}

/** Point one pane at a different session, leaving every other leaf alone.
 *  `sessionId` may be `null` — a deliberate "point at nothing", the same
 *  value the pre-load leaf starts with, not only a pre-load-only state. A
 *  no-op, not a crash, when `id` matches nothing — the same defensive
 *  contract `clampPaneWidth` holds for a garbage stored width. */
export function setPaneSession(tree: SplitTree, id: string, sessionId: string | null): SplitTree {
  if (tree.kind === 'leaf') {
    return tree.id === id ? { ...tree, sessionId } : tree;
  }
  return { ...tree, children: tree.children.map((child) => setPaneSession(child, id, sessionId)) };
}

function orientationFor(edge: Edge): SplitOrientation {
  return edge === 'left' || edge === 'right' ? 'row' : 'column';
}

function isBefore(edge: Edge): boolean {
  return edge === 'left' || edge === 'top';
}

/**
 * Split `targetId`'s pane, inserting a new leaf for `sessionId` at `edge`.
 *
 * Three shapes, depending on what already surrounds the target:
 *
 * 1. The target is the whole tree (no parent yet): wrap it in a fresh split.
 * 2. The target's parent already splits on the SAME axis (`left`/`right`
 *    against an existing `row`, `top`/`bottom` against an existing
 *    `column`): the new pane joins as a SIBLING, not a nested split-of-a-
 *    split — three panes side by side stay one row, the way a fourth
 *    `:vsplit` in vim adds a column rather than nesting one.
 * 3. The target's parent splits on the OTHER axis: only the target itself is
 *    wrapped in a new nested split, so the surrounding layout is undisturbed.
 *
 * A missing `targetId` returns the tree unchanged — the drop raced a close,
 * or the drag payload named a pane that is no longer there, and neither is
 * a reason to corrupt the layout.
 */
export function splitPane(
  tree: SplitTree,
  targetId: string,
  edge: Edge,
  sessionId: string,
  newId: string,
): SplitTree {
  const orientation = orientationFor(edge);
  const before = isBefore(edge);
  const newLeaf: Leaf = { kind: 'leaf', id: newId, sessionId };

  function wrap(target: SplitTree): Split {
    return {
      kind: 'split',
      id: `split-${newId}`,
      orientation,
      children: before ? [newLeaf, target] : [target, newLeaf],
    };
  }

  function insertInto(node: SplitTree): SplitTree {
    if (node.kind === 'leaf') {
      return node.id === targetId ? wrap(node) : node;
    }
    const index = node.children.findIndex(
      (child) => child.kind === 'leaf' && child.id === targetId,
    );
    if (index === -1) {
      // Not a direct child — recurse into whichever nested split (if any)
      // actually contains it. A leaf child that is not the target is
      // returned as-is, which is what stops this from ever touching a
      // sibling subtree the target is not inside.
      return { ...node, children: node.children.map(insertInto) };
    }
    if (node.orientation === orientation) {
      const children = [...node.children];
      children.splice(before ? index : index + 1, 0, newLeaf);
      return { ...node, children };
    }
    const children = [...node.children];
    children[index] = wrap(children[index] as SplitTree);
    return { ...node, children };
  }

  return insertInto(tree);
}

/**
 * Remove one pane. `null` means "cannot" — closing the LAST pane would leave
 * nothing to show, so the caller must check `leaves(tree).length > 1` before
 * calling this and refuse aloud rather than pass an id this returns `null`
 * for; the shape here just makes that state unrepresentable rather than
 * silently emptying the shell.
 *
 * A split left with exactly one child COLLAPSES into that child directly —
 * closing a pane must never leave a one-child split standing, which is a
 * divider with nothing to divide.
 */
export function closePane(tree: SplitTree, id: string): SplitTree | null {
  if (tree.kind === 'leaf') {
    return tree.id === id ? null : tree;
  }
  const children = tree.children
    .map((child) => closePane(child, id))
    .filter((child): child is SplitTree => child !== null);
  if (children.length === 0) {
    return null;
  }
  const only = children[0];
  return children.length === 1 && only !== undefined ? only : { ...tree, children };
}

/** Cycle the focused pane among every leaf, wrapping at both ends — the same
 *  "a closed ring, so it wraps" shape `h`/`l` already give the tab strip
 *  (`Canvas.tsx`'s `move` case), extended one level up to panes. A single
 *  pane, or an id nothing holds, is a no-op rather than a refusal here; the
 *  caller is what knows whether to say so out loud. */
export function stepPane(tree: SplitTree, currentId: string, delta: 1 | -1): string {
  const all = leaves(tree);
  if (all.length <= 1) {
    return currentId;
  }
  const at = all.findIndex((leaf) => leaf.id === currentId);
  if (at === -1) {
    return currentId;
  }
  const next = all[(at + delta + all.length) % all.length];
  return next?.id ?? currentId;
}

/**
 * Which edge of a `width`×`height` rect the point `(x, y)` is closest to —
 * the whole hit-test a drop needs, and pure so it can be proven with plain
 * numbers rather than a `getBoundingClientRect` happy-dom cannot honour (see
 * `PaneResizer.test.tsx`'s own note on that).
 */
export function nearestEdge(x: number, y: number, width: number, height: number): Edge {
  const distances: readonly [Edge, number][] = [
    ['left', x],
    ['right', width - x],
    ['top', y],
    ['bottom', height - y],
  ];
  let bestEdge: Edge = 'right';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [candidateEdge, distance] of distances) {
    if (distance < bestDistance) {
      bestDistance = distance;
      bestEdge = candidateEdge;
    }
  }
  return bestEdge;
}
