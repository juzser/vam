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

import { DETAIL_MIN } from '../prefs/panes.js';

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

/**
 * A divider, and what it holds — two or more panes or nested splits, in the
 * order they are drawn.
 *
 * `sizes` is how much of THIS split's extent each child takes, as a fraction:
 * one entry per child, summing to 1. Fractions and not pixels because this
 * file is pure and knows nothing about a viewport, and because a fraction is
 * the only unit that survives a window resize, a nested split and a restore
 * into a differently-shaped shell without arithmetic at every reader.
 *
 * OPTIONAL, and absent means EQUAL SHARES — which is exactly what every child
 * was before this field existed. That is the whole migration: a tree
 * remembered by a build that predates resizing carries no `sizes` and reads
 * back as the equal-share layout it was drawn as. Nothing has to detect a
 * version, and there is no discard path to get wrong.
 *
 * Nothing may read this field directly. `splitSizes` is the reader, and it is
 * total over anything a store can hold — the wrong number of entries, `NaN`,
 * a negative, a set that sums to 300 — because a remembered layout can be any
 * of those and none of them may put a pane on screen at no width.
 */
export type Split = {
  readonly kind: 'split';
  readonly id: string;
  readonly orientation: SplitOrientation;
  readonly children: readonly SplitTree[];
  readonly sizes?: readonly number[];
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

// ---------------------------------------------------------------------------
// SIZES. Two floors, with two different jobs, and neither can do the other's.
// ---------------------------------------------------------------------------

/**
 * THE STRUCTURAL FLOOR: no child of a split may ever take less than
 * `MIN_PANE_SHARE / children.length` of it.
 *
 * A share and not a pixel count, because this is the guard that has to hold
 * where there are no pixels to consult — a remembered layout being read back,
 * a size arriving as `NaN`, a split whose store says `[0, 0, 0]`. It answers
 * exactly one question: is any pane about to be drawn at no width at all.
 * Scaled by the child count rather than flat, so it stays SATISFIABLE: a flat
 * 0.1 over eleven children asks for 1.1 of a whole, which is not a floor, it
 * is a crash waiting for the eleventh split.
 *
 * At the default two-pane split this is 0.15 — a sixth of the pair. It is
 * deliberately looser than what a drag will let you reach (`MIN_PANE_PX`
 * below), because a floor that bites during ordinary dragging would silently
 * overrule the pixel one on a wide screen.
 */
export const MIN_PANE_SHARE = 0.3;

/**
 * THE USABILITY FLOOR: how small, in pixels, a drag may make a pane.
 *
 * `DETAIL_MIN` ITSELF, not a number of its own. A split pane IS a detail
 * pane — the same `DetailPanel`, the same transcript column, the same
 * composer — so "how narrow can this be and stay usable" is a question this
 * codebase has already answered, with its reasons written down: the prompt
 * input stays usable, the two-line `.vam-clamp-2` blocks still read as two
 * lines of prose, and the review-queue rows keep their note inputs. A second
 * constant for one question is how two answers drift apart.
 *
 * MEASURED, not assumed. A first attempt used 176px, on the theory that a
 * pane narrower than a whole sidebar could still draw a strip and a composer.
 * It can, and the result is not usable: at 176px the floating view-icon pill
 * covers the first prompt bubble's text, and a question card's "Chat about
 * this" option prints on top of its own explanation. At `DETAIL_MIN` both are
 * clean. The screenshots are in the PR.
 *
 * The same number on BOTH axes. A stacked pane's contents are the same
 * contents; 320px of height is a tab strip, several lines of transcript and
 * the composer, which is the same "still usable" this is asking about.
 *
 * Applied by `dividerShare`, the one place a pointer position or an arrow key
 * becomes a share. It is deliberately NOT applied on the read path: a layout
 * remembered on a wide screen and restored on a narrow one has panes below
 * this, and re-clamping on read would silently rewrite what the operator
 * arranged the first time their window got small (`prefs/panes.ts` learnt
 * exactly that lesson — clamping belongs on the render path, never on the
 * store). A pair with no room for two of these is halved instead, which is
 * `dividerShare`'s own documented degenerate case.
 */
export const MIN_PANE_PX = DETAIL_MIN;

/** The structural floor for a split of `count` children. */
function sizeFloor(count: number): number {
  return count <= 0 ? 0 : Math.min(MIN_PANE_SHARE / count, 1 / count);
}

/**
 * Raise every entry below `floor` up to it, taking the difference from the
 * entries above it in proportion to how far above they are.
 *
 * Sum-preserving whenever the input sums to 1 and `floor <= 1 / length`,
 * which `sizeFloor` guarantees: the deficit `Σ(floor − v)` over the short
 * entries can never exceed the surplus `Σ(v − floor)` over the tall ones,
 * because their difference is `length * floor − 1 <= 0`.
 */
function liftToFloor(sizes: readonly number[], floor: number): readonly number[] {
  if (sizes.every((size) => size >= floor)) {
    return sizes;
  }
  const deficit = sizes.reduce((total, size) => total + Math.max(0, floor - size), 0);
  const surplus = sizes.reduce((total, size) => total + Math.max(0, size - floor), 0);
  if (surplus <= 0) {
    return sizes.map(() => 1 / sizes.length);
  }
  const take = Math.min(1, deficit / surplus);
  return sizes.map((size) => (size < floor ? floor : size - (size - floor) * take));
}

/**
 * Anything a store can hold, turned into exactly `count` usable fractions.
 *
 * Every entry that is not a finite positive number — absent, `NaN`,
 * `Infinity`, zero, negative, a string that got in through a JSON round trip
 * — is replaced by an EQUAL SHARE of the original whole rather than dropped,
 * so a split remembered with two sizes and restored holding three keeps the
 * ratio of the two it remembers and gives the newcomer an average slot. The
 * result is then renormalised to sum to 1 and lifted to the floor.
 */
function normaliseSizes(sizes: readonly number[] | undefined, count: number): readonly number[] {
  if (count <= 0) {
    return [];
  }
  const equal = 1 / count;
  const raw = Array.from({ length: count }, (_, at) => {
    const size = sizes?.[at];
    return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : equal;
  });
  const total = raw.reduce((sum, size) => sum + size, 0);
  // `total` cannot be zero: every entry is either a positive stored size or
  // `equal`, which is positive for any `count > 0`.
  return liftToFloor(
    raw.map((size) => size / total),
    sizeFloor(count),
  );
}

/**
 * A split's child sizes, as fractions summing to 1 — THE ONLY reader of
 * `Split.sizes`.
 *
 * Total: always exactly `children.length` finite entries, every one at least
 * `sizeFloor(children.length)`, whatever the split carries.
 */
export function splitSizes(split: Split): readonly number[] {
  return normaliseSizes(split.sizes, split.children.length);
}

/** A split carrying `sizes`, normalised on the way IN so the store and the
 *  reader never disagree — every writer below goes through here. */
function withSizes(split: Split, sizes: readonly number[]): Split {
  return { ...split, sizes: normaliseSizes(sizes, split.children.length) };
}

/**
 * The repair pass: every split in the tree, rewritten with sizes that fit its
 * own children.
 *
 * `splitSizes` already repairs on every read, so this changes nothing about
 * what is DRAWN. What it changes is what is written back: a layout restored
 * from a store that predates sizes, or one whose sizes no longer line up with
 * its children, is normalised ONCE here rather than re-derived by every
 * reader forever. `restoreLayout` is the only caller, because a restore is
 * the only moment a tree arrives from outside this file's own arithmetic.
 *
 * Identity-preserving where there is nothing to repair, the same contract
 * `mapLeaf` and `pruneClosedTabs` hold, so a restore of an already-normal
 * layout cannot churn the render.
 */
export function normaliseTree(tree: SplitTree): SplitTree {
  if (tree.kind === 'leaf') {
    return tree;
  }
  const children = tree.children.map(normaliseTree);
  const sizes = splitSizes(tree);
  const unchanged =
    children.every((child, at) => child === tree.children[at]) &&
    tree.sizes !== undefined &&
    tree.sizes.length === sizes.length &&
    tree.sizes.every((size, at) => size === sizes[at]);
  return unchanged ? tree : { ...tree, children, sizes };
}

/**
 * Where a divider should sit, given where the pointer is — the one place a
 * pixel becomes a share, and the one place `MIN_PANE_PX` is applied.
 *
 * `firstPx` is how wide (or tall) the divider's LEADING pane would be if the
 * pointer were obeyed exactly; `pairPx` is the two panes' combined extent. A
 * drag moves one divider, so only that adjacent pair exchanges room and every
 * other sibling of the split stays exactly where it is — the same rule vim,
 * tmux and VSCode all use, and the only one under which dragging one edge
 * cannot reflow the whole layout.
 *
 * Total, and every degenerate case answers 0.5: a pair with no measurable
 * extent (a hidden or not-yet-laid-out split), a non-finite pointer, and a
 * pair too narrow to hold two minimums at once. Halving is not a shrug in
 * that last case — it is the only division that treats the two alike, and it
 * is a state the layout already reaches, because it is what a fresh split is.
 */
/**
 * Is there MORE THAN ONE legal position for this divider?
 *
 * `dividerShare` below answers 0.5 for a pair too narrow to hold two
 * minimums, which is the right arithmetic and the wrong thing to do in
 * silence: a handle that accepts a grab, moves nothing and says nothing
 * teaches the operator that resizing is broken rather than that the two panes
 * are already at their floor. This is the predicate that lets the handle
 * withdraw its affordance and refuse ALOUD instead — "absent, not dimmed",
 * the rule `newTabInPane` and the sidebar's New session already follow.
 *
 * Deliberately about the WHOLE GESTURE and not about one frame of it: a drag
 * that runs into the floor part-way is ordinary, and stays silent. This only
 * answers false where the divider could not move from where it stands even by
 * a pixel. Four panes side by side on a 1280px screen is the case that
 * reaches it — 508px between two panes that each need `MIN_PANE_PX`.
 *
 * STRICTLY greater: a pair of exactly `2 * minPx` has exactly one legal
 * position, and one position is not a range.
 */
export function canDivide(pairPx: number, minPx: number): boolean {
  if (!Number.isFinite(pairPx) || !Number.isFinite(minPx)) {
    return false;
  }
  return pairPx > Math.max(0, minPx) * 2;
}

export function dividerShare(firstPx: number, pairPx: number, minPx: number): number {
  if (!Number.isFinite(firstPx) || !Number.isFinite(pairPx) || pairPx <= 0) {
    return 0.5;
  }
  const min = Number.isFinite(minPx) ? Math.max(0, minPx) : 0;
  if (pairPx < min * 2) {
    return 0.5;
  }
  const floor = min / pairPx;
  return Math.min(1 - floor, Math.max(floor, firstPx / pairPx));
}

/** Rebuild one split in place, leaving every other node alone.
 *  Identity-preserving, exactly as `mapLeaf` is for leaves. */
function mapSplit(tree: SplitTree, id: string, f: (split: Split) => Split): SplitTree {
  if (tree.kind === 'leaf') {
    return tree;
  }
  if (tree.id === id) {
    return f(tree);
  }
  const children = tree.children.map((child) => mapSplit(child, id, f));
  return children.every((child, at) => child === tree.children[at]) ? tree : { ...tree, children };
}

/**
 * MOVE ONE DIVIDER: the one between children `at` and `at + 1` of the split
 * `splitId`, so that the leading child takes `share` of THEIR COMBINED
 * extent.
 *
 * A share of the pair rather than of the whole split, because that is what
 * makes the gesture absolute: the handle can recompute it from the pointer's
 * live position on every move without accumulating drift, and a three-pane
 * row keeps its third pane exactly where it was.
 *
 * Total, and a no-op — the SAME tree object back — for every miss this file's
 * contract already covers: a split id nothing holds, an index that is not a
 * divider, a non-finite share. The share is clamped so neither of the pair
 * falls through the structural floor; the pixel floor is `dividerShare`'s and
 * has been applied before the number gets here.
 */
export function resizeSplit(
  tree: SplitTree,
  splitId: string,
  at: number,
  share: number,
): SplitTree {
  if (!Number.isFinite(share) || !Number.isInteger(at) || at < 0) {
    return tree;
  }
  return mapSplit(tree, splitId, (split) => {
    const sizes = splitSizes(split);
    const first = sizes[at];
    const second = sizes[at + 1];
    if (first === undefined || second === undefined) {
      return split;
    }
    const pair = first + second;
    const floor = sizeFloor(sizes.length) / pair;
    const clamped = Math.min(1 - floor, Math.max(floor, share));
    const next = [...sizes];
    next[at] = pair * clamped;
    next[at + 1] = pair * (1 - clamped);
    return withSizes(split, next);
  });
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

  // A NEW PANE TAKES HALF THE PANE IT SPLIT, and nothing else moves — tmux's
  // rule, and the only one that is the same sentence in both shapes below: a
  // wrapper divides its slot evenly, and a sibling insert halves the target's
  // own share and leaves every other sibling untouched.
  function wrap(target: SplitTree): Split {
    return {
      kind: 'split',
      id: `split-${newId}`,
      orientation,
      children: before ? [newLeaf, target] : [target, newLeaf],
      sizes: [0.5, 0.5],
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
      // The target's own share, halved, in the two slots that replace it —
      // both halves are equal, so `before` does not change the arithmetic,
      // only which of them holds the new leaf.
      const sizes = [...splitSizes(node)];
      const half = (sizes[index] ?? 0) / 2;
      sizes.splice(index, 1, half, half);
      return withSizes({ ...node, children }, sizes);
    }
    const children = [...node.children];
    children[index] = wrap(children[index] as SplitTree);
    // The nested split stands in the slot the target held, at the size the
    // target held it, so the surrounding row or column does not move.
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
  const mapped = tree.children.map((child) => closePane(child, id));
  if (mapped.every((child, at) => child === tree.children[at])) {
    // Nothing here held it. The SAME object back, so a miss cannot churn the
    // render and cannot rewrite sizes that were already right.
    return tree;
  }
  const sizes = splitSizes(tree);
  const children: SplitTree[] = [];
  const kept: number[] = [];
  for (const [at, child] of mapped.entries()) {
    if (child !== null) {
      children.push(child);
      kept.push(sizes[at] ?? 0);
    }
  }
  if (children.length === 0) {
    return null;
  }
  const only = children[0];
  // THE FREED ROOM GOES TO THE SURVIVORS IN PROPORTION — `withSizes`
  // renormalises what is left, so two panes that stood at 2:1 still stand at
  // 2:1 once the third goes. There is no "which neighbour gets it" case to
  // get wrong, and a split that collapses to its only child hands that child
  // the whole slot the split occupied, because the child now IS that slot.
  return children.length === 1 && only !== undefined
    ? only
    : withSizes({ ...tree, children }, kept);
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
 *    the keyboard goes there and nothing is opened. PR 268's rule is that a
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
  // 0. THE SIZES ARE REPAIRED BEFORE ANYTHING ELSE READS THEM. A restore is
  //    the one moment a tree arrives from outside this file's own arithmetic,
  //    so it is the one moment sizes can fail to describe the children they
  //    are stored beside: a layout remembered before resizing existed carries
  //    none at all, and one remembered with two panes can come back holding
  //    three. Neither may crash, drop a pane or draw one at no width — see
  //    `normaliseSizes`, which answers all three by treating every unusable
  //    entry as an equal share rather than as a reason to discard the layout.
  const pruned = pruneClosedTabs(normaliseTree(stored), isOpen);
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

/**
 * EVERY SESSION OF A PROJECT IS A TAB OF EXACTLY ONE PANE — the membership
 * half of it. Every id in `sessionIds` that NO pane holds joins
 * `targetPaneId`; every id some pane already holds is left exactly where it
 * is.
 *
 * A11.1, the operator's answer to how many of a project's sessions should be
 * tabs: "all of them, always". PR 263 built per-pane strips and narrowed it
 * to "every session the pane opened", which is how a project with two
 * sessions came to open showing one tab. Adopting only what nothing holds is
 * what lets that rule and PR 268's — a session lives in exactly ONE pane —
 * be true together: a `zv` MOVES a tab, so it orphans nothing, so the pane
 * it deliberately emptied stays empty rather than being refilled from under
 * the split that just made it.
 *
 * Appended, never sorted — `Leaf`'s rule, and the strip reads
 * `orderedPaneTabs` for what the operator actually sees. The tab in FRONT is
 * left alone: adopting is not a reason to move the keyboard off what it was
 * pointed at.
 *
 * The one place this file's "a lookup that misses returns the input
 * unchanged" contract would be wrong: a stale `targetPaneId` would silently
 * leave sessions with no tab anywhere, which is the bug, not a defence
 * against it. So a target nothing holds falls back to the first leaf — there
 * is always at least one — and the adoption still happens. Returns the SAME
 * tree when there is nothing to adopt, so the effect that calls it on every
 * model refresh cannot churn the render.
 */
export function adoptOrphans(
  tree: SplitTree,
  sessionIds: readonly string[],
  targetPaneId: string,
): SplitTree {
  const all = leaves(tree);
  const held = new Set(all.flatMap((leaf) => leaf.sessionIds));
  const orphans = sessionIds.filter((id) => !held.has(id));
  if (orphans.length === 0) {
    return tree;
  }
  const target = findLeaf(tree, targetPaneId) ?? all[0];
  if (target === undefined) {
    return tree;
  }
  return mapLeaf(tree, target.id, (leaf) => ({
    ...leaf,
    sessionIds: [...leaf.sessionIds, ...orphans],
  }));
}
