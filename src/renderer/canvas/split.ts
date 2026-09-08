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

/**
 * One pane — VSCode's EDITOR GROUP, not one editor: it owns a list of open
 * tabs and which one of them is in front. That is the whole of the
 * operator's report that split panes still shared one strip of tabs; the
 * strip is drawn per leaf from `sessionIds` (see `Canvas.tsx`'s `renderLeaf`)
 * rather than once for the whole column.
 *
 * `sessionIds` is MEMBERSHIP, not display order. It was both once, and the
 * operator's word for the result was that the tabs in a pane came out
 * jumbled: a session picked in the sidebar was appended here, so the strip
 * and the sidebar listed the same sessions in two orders. The strip's order
 * now comes from `orderedPaneTabs` (`domain/selectors.ts`), the sidebar's
 * own — one vocabulary, the way `row`/`column` below is one. Nothing in this
 * file may sort the list, because the order depends on session status and
 * this file is deliberately blind to the model.
 *
 * `sessionId` is the tab in front — always a member of `sessionIds`, or
 * `null` when the pane holds nothing yet (the pre-load state
 * `focusedSessionId` already tolerates, now also the state a pane reaches
 * when every session it held has been closed). Kept as its own field rather
 * than an index into the list so every existing reader of
 * `findLeaf(...)?.sessionId` keeps meaning what it always meant.
 */
export type Leaf = {
  readonly kind: 'leaf';
  readonly id: string;
  readonly sessionId: string | null;
  readonly sessionIds: readonly string[];
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
  return { kind: 'leaf', id, sessionId, sessionIds: sessionId === null ? [] : [sessionId] };
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

/** Rebuild one leaf in place, leaving every other leaf (and the shape of the
 *  tree) alone. Identity-preserving: a leaf `f` returns unchanged, and every
 *  split above it, come back as the same object. */
function mapLeaf(tree: SplitTree, id: string, f: (leaf: Leaf) => Leaf): SplitTree {
  if (tree.kind === 'leaf') {
    return tree.id === id ? f(tree) : tree;
  }
  const children = tree.children.map((child) => mapLeaf(child, id, f));
  return children.every((child, at) => child === tree.children[at]) ? tree : { ...tree, children };
}

/**
 * OPEN a session in one pane and bring it to the front — VSCode's "open in
 * the active group": a session the pane does not hold yet joins the pane's
 * membership as a new tab, and one it already holds is simply activated
 * rather than duplicated. Appending is arbitrary and means nothing on
 * screen — see `Leaf` on why the strip's order is not read from here.
 *
 * `sessionId` may be `null` — a deliberate "point at nothing", the same
 * value the pre-load leaf starts with. It clears which tab is in front and
 * leaves the pane's own list alone: nothing was closed, the keyboard just
 * has nowhere to be. A no-op, not a crash, when `id` matches nothing — the
 * same defensive contract `clampPaneWidth` holds for a garbage stored width.
 */
export function setPaneSession(tree: SplitTree, id: string, sessionId: string | null): SplitTree {
  return mapLeaf(tree, id, (leaf) => {
    if (sessionId === null) {
      return leaf.sessionId === null ? leaf : { ...leaf, sessionId: null };
    }
    const sessionIds = leaf.sessionIds.includes(sessionId)
      ? leaf.sessionIds
      : [...leaf.sessionIds, sessionId];
    return { ...leaf, sessionId, sessionIds };
  });
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
  const newLeaf: Leaf = { kind: 'leaf', id: newId, sessionId, sessionIds: [sessionId] };

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

/** Which tab takes the front when `removed` leaves: the one to its right,
 *  and the one to its left when it was last — VSCode's own rule, and the
 *  only one that keeps closing a run of tabs from jumping across the strip. */
function neighbourOf(sessionIds: readonly string[], removed: string): string | null {
  const at = sessionIds.indexOf(removed);
  return sessionIds[at + 1] ?? sessionIds[at - 1] ?? null;
}

/**
 * Take one tab out of one pane — what a drag MOVING a tab into another pane
 * does to the pane it came from, and what closing a tab does.
 *
 * A pane left with no tabs at all is CLOSED, exactly the way VSCode drops an
 * empty editor group rather than leaving a titled void on screen; `null`
 * means "cannot", the same word `closePane` already uses, for the one case
 * where that would empty the shell entirely (the last tab of the last pane).
 * A pane id nothing holds, or a session that pane does not hold, returns the
 * tree unchanged — a drop that raced a close is not a reason to corrupt the
 * layout.
 */
export function removeTab(tree: SplitTree, paneId: string, sessionId: string): SplitTree | null {
  const leaf = findLeaf(tree, paneId);
  if (leaf === null || !leaf.sessionIds.includes(sessionId)) {
    return tree;
  }
  return leaf.sessionIds.length === 1
    ? closePane(tree, paneId)
    : detachTab(tree, paneId, sessionId);
}

/**
 * Take one tab out of one pane and LEAVE THE PANE, even holding nothing —
 * what `zv`/`zs` do to the pane they split, where `removeTab` above is what a
 * CLOSE does.
 *
 * The operator's report: "when I split a tab, I still see that tab showing in
 * both panes." The chord used to hand the new pane a copy (vim's `:split`,
 * VSCode's "Split Editor"); it moves the tab now, so a session is in exactly
 * one pane whichever way it got there — the drag gesture already moved.
 *
 * The one thing this does NOT share with `removeTab` is what happens to a
 * pane left with nothing, and that is a policy difference rather than a
 * parameter: a close means the operator is done with that pane's last piece
 * of work, so the pane goes, while a split is a request for two panes and
 * answering it with one would be answering a different question. The emptied
 * pane stays, drawing the strip's own "no sessions open" line.
 *
 * The tab that takes the front is `neighbourOf`'s, the same right-then-left
 * rule a close uses -- one rule, read twice -- and `null` when nothing is
 * left, which is the state `Leaf.sessionId` already documents.
 */
export function detachTab(tree: SplitTree, paneId: string, sessionId: string): SplitTree {
  const leaf = findLeaf(tree, paneId);
  if (leaf === null || !leaf.sessionIds.includes(sessionId)) {
    return tree;
  }
  return mapLeaf(tree, paneId, (target) => ({
    ...target,
    sessionIds: target.sessionIds.filter((id) => id !== sessionId),
    sessionId:
      target.sessionId === sessionId ? neighbourOf(target.sessionIds, sessionId) : target.sessionId,
  }));
}

/**
 * Which pane holds this session, or `null` if none does.
 *
 * The lookup behind "a session lives in exactly one pane": picking a session
 * in the sidebar while ANOTHER pane already holds it moves the keyboard to
 * that pane instead of opening a second copy — the operator's
 * one-session-two-panes report arriving through the sidebar rather than
 * through the split chord. First match wins, and the rule everywhere else in
 * this file is what keeps there from being a second.
 */
export function paneHolding(tree: SplitTree, sessionId: string): string | null {
  return leaves(tree).find((leaf) => leaf.sessionIds.includes(sessionId))?.id ?? null;
}

/**
 * Drop every tab whose session is no longer open, wherever it sits.
 *
 * A session can be closed from four places (the sidebar row's `×`, a tab's
 * own `×`, the `x` chord, the session ending on its own), and a pane holding
 * its id would otherwise keep drawing a tab for something that is gone. One
 * reconciliation over the whole tree covers all four rather than four call
 * sites that each have to remember.
 *
 * Panes emptied this way close, as in `removeTab` — except the LAST pane,
 * which is left holding nothing rather than closed, because an empty shell
 * is not a state this can be allowed to reach. Returns the SAME tree when
 * nothing was stale, so the effect that calls it on every model refresh
 * cannot churn the render.
 */
export function pruneClosedTabs(
  tree: SplitTree,
  isOpen: (sessionId: string) => boolean,
): SplitTree {
  const emptied: string[] = [];
  const mapped = mapEveryLeaf(tree, (leaf) => {
    const kept = leaf.sessionIds.filter((id) => isOpen(id));
    if (kept.length === leaf.sessionIds.length) {
      return leaf;
    }
    if (kept.length === 0) {
      emptied.push(leaf.id);
    }
    const sessionId =
      leaf.sessionId !== null && kept.includes(leaf.sessionId) ? leaf.sessionId : (kept[0] ?? null);
    return { ...leaf, sessionIds: kept, sessionId };
  });
  let result = mapped;
  for (const id of emptied) {
    const next = closePane(result, id);
    if (next !== null) {
      result = next;
    }
  }
  return result;
}

/** `mapLeaf` over EVERY leaf at once, identity-preserving the same way. */
function mapEveryLeaf(tree: SplitTree, f: (leaf: Leaf) => Leaf): SplitTree {
  if (tree.kind === 'leaf') {
    return f(tree);
  }
  const children = tree.children.map((child) => mapEveryLeaf(child, f));
  return children.every((child, at) => child === tree.children[at]) ? tree : { ...tree, children };
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

/**
 * A project's remembered layout, brought back — reconciled, never replayed.
 *
 * A15.7, the operator's report: "when I split, switch to another project and
 * then come back, the split state is lost." A15.5 collapsed to one pane on
 * every project switch, the smaller of the two answers it named; this is the
 * other one, VSCode's — a layout per workspace, reopened on return.
 *
 * The reason the larger answer was deferred is the whole of what this
 * function does: sessions END while their project is off screen, so a stored
 * tree can name things that are no longer there. Trusting it would bring
 * back exactly the stale-tab bug A15.5 was written to kill. So:
 *
 * 1. every tab whose session is gone is dropped, and a pane emptied that way
 *    closes (`pruneClosedTabs`);
 * 2. if nothing at all survived, the answer is ONE pane holding the session
 *    just picked, under `fallbackId` — a restore must never show a blank
 *    shell;
 * 3. otherwise the picked session is opened in the pane that had focus in
 *    this project, or in the leftmost surviving pane when that one went with
 *    its sessions — UNLESS a surviving pane already holds it, in which case
 *    the keyboard goes there and nothing is opened. #268's rule is that a
 *    session lives in exactly one pane, and this was the last route that
 *    broke it: coming back by clicking a session another remembered pane
 *    held added a second copy of it here, and two `TerminalTab`s over one
 *    tmux session each `resize` it to their own width. `paneHolding` is the
 *    same answer the sidebar already gives.
 *
 * Returns the pane the keyboard should land in alongside the tree, because
 * only this function knows which of the three cases happened. Pure and total
 * like everything else here: `isOpen` decides what still exists, and no
 * lookup that misses can throw.
 */
export function restoreLayout(
  stored: SplitTree,
  isOpen: (sessionId: string) => boolean,
  sessionId: string,
  focusedPaneId: string,
  fallbackId: string,
): { readonly tree: SplitTree; readonly paneId: string } {
  const pruned = pruneClosedTabs(stored, isOpen);
  const surviving = leaves(pruned).filter((leaf) => leaf.sessionIds.length > 0);
  const target =
    surviving.find((leaf) => leaf.sessionIds.includes(sessionId)) ??
    surviving.find((leaf) => leaf.id === focusedPaneId) ??
    surviving[0];
  if (target === undefined) {
    return { tree: singlePane(sessionId, fallbackId), paneId: fallbackId };
  }
  return { tree: setPaneSession(pruned, target.id, sessionId), paneId: target.id };
}
