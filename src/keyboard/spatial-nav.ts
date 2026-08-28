/**
 * Geometric `hjkl` navigation for the canvas.
 *
 * docs/design/canvas-layout.md §4 fixes the rule this module exists to keep:
 * movement is computed from the nodes' real coordinates **at the moment the key
 * is pressed**, never from a cached index. That is the whole condition under
 * which drag-and-drop and keyboard navigation can share one canvas — an index
 * built at render time is wrong the instant anything moves, and wrong silently,
 * because it still returns a node.
 *
 * So this is a pure function over rectangles. It holds no state, subscribes to
 * nothing, and is given the geometry rather than reading it: the caller passes
 * whatever ReactFlow currently reports. Nothing here can go stale, because
 * nothing here is remembered.
 */

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type NavNode = {
  readonly id: string;
  readonly rect: Rect;
};

/** `h` `j` `k` `l`, spelled out — the caller maps the key, this maps the space. */
export type Direction = 'left' | 'down' | 'up' | 'right';

type Axis = {
  /** Which coordinate the move travels along. */
  readonly along: 'x' | 'y';
  /** +1 when the move increases that coordinate, -1 when it decreases it. */
  readonly sign: 1 | -1;
};

const AXES: Readonly<Record<Direction, Axis>> = {
  left: { along: 'x', sign: -1 },
  right: { along: 'x', sign: 1 },
  up: { along: 'y', sign: -1 },
  down: { along: 'y', sign: 1 },
};

type Span = { readonly min: number; readonly max: number; readonly centre: number };

function spans(rect: Rect, along: 'x' | 'y'): { primary: Span; perpendicular: Span } {
  const horizontal = along === 'x';
  const primaryMin = horizontal ? rect.x : rect.y;
  const primarySize = horizontal ? rect.width : rect.height;
  const perpMin = horizontal ? rect.y : rect.x;
  const perpSize = horizontal ? rect.height : rect.width;
  return {
    primary: {
      min: primaryMin,
      max: primaryMin + primarySize,
      centre: primaryMin + primarySize / 2,
    },
    perpendicular: { min: perpMin, max: perpMin + perpSize, centre: perpMin + perpSize / 2 },
  };
}

/**
 * Whether two spans share any of the axis across the direction of travel — i.e.
 * whether the candidate is on the origin's row (for `h`/`l`) or column (for
 * `j`/`k`).
 *
 * Strict `<` and `>` on both sides, so a *touching* edge is not an overlap. It
 * was tempting to express this as "distance apart is zero", but that conflates
 * the two: a span ending exactly where the next begins has zero distance and no
 * shared pixels, and the version of this function that measured distance called
 * them the same thing. Asking the question directly makes the boundary case
 * decidable instead of leaving it to rounding.
 */
function overlaps(a: Span, b: Span): boolean {
  return a.min < b.max && a.max > b.min;
}

type Candidate = {
  readonly id: string;
  /** Distance travelled along the move's own axis. Always > 0. */
  readonly reach: number;
  /** How far off-centre it sits, used only to separate equals. */
  readonly offCentre: number;
};

/**
 * The node `direction` should land on, or `null` when there is nothing that way.
 *
 * **Strictly positional.** A candidate must be ahead on the axis *and* share the
 * origin's row (for `h`/`l`) or column (for `j`/`k`). Nothing else qualifies:
 * there is no diagonal fallback and no wrapping to the far side of the canvas.
 * `l` means "the thing to my right", and a node that is to the right but far
 * below is not that — moving there is the cursor going somewhere the eye did not
 * point, which on a canvas you navigate by muscle is worse than not moving.
 * Nodes that no direction reaches are reached by `f` and the palette, which is
 * what those exist for.
 *
 * Rows are bands, not lines: any overlap at all counts, so nodes of different
 * heights still reach each other. A touching edge does not, because zero shared
 * pixels is not a shared row and treating it as one would put the boundary case
 * at the mercy of rounding.
 *
 * Ordering among the qualifiers: nearest along the axis, then least off-centre,
 * then by id. That last key is not decoration — without it the answer would
 * depend on the order ReactFlow happened to hand over its nodes, so the same
 * canvas could navigate differently between two renders that look identical.
 *
 * @throws if `fromId` names no node — a caller navigating from a node that is
 * not on the canvas has a bug, and returning `null` would hide it as "edge of
 * the canvas".
 */
export function nextNode(
  nodes: readonly NavNode[],
  fromId: string,
  direction: Direction,
): string | null {
  const origin = nodes.find((node) => node.id === fromId);
  if (origin === undefined) {
    throw new Error(`nextNode: no node with id "${fromId}" on the canvas.`);
  }

  const axis = AXES[direction];
  const from = spans(origin.rect, axis.along);

  const candidates: Candidate[] = [];
  for (const node of nodes) {
    if (node.id === origin.id) {
      continue;
    }
    const to = spans(node.rect, axis.along);
    const reach = (to.primary.centre - from.primary.centre) * axis.sign;
    if (reach <= 0) {
      continue; // level with the origin, or behind it
    }
    if (!overlaps(from.perpendicular, to.perpendicular)) {
      continue; // off the row/column entirely — not in this direction
    }
    candidates.push({
      id: node.id,
      reach,
      offCentre: Math.abs(to.perpendicular.centre - from.perpendicular.centre),
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  let best = candidates[0] as Candidate;
  for (const candidate of candidates) {
    if (isBetter(candidate, best)) {
      best = candidate;
    }
  }
  return best.id;
}

function isBetter(candidate: Candidate, incumbent: Candidate): boolean {
  if (candidate.reach !== incumbent.reach) {
    return candidate.reach < incumbent.reach;
  }
  if (candidate.offCentre !== incumbent.offCentre) {
    return candidate.offCentre < incumbent.offCentre;
  }
  return candidate.id < incumbent.id;
}
