/**
 * How far the sidebar must scroll to show the focused row.
 *
 * A module of its own for the same reason `stick-to-bottom.ts` is one: the
 * decision is arithmetic, the DOM half is four property reads, and happy-dom
 * reports 0 for every rect and scroll metric — so a test driving the effect
 * would assert the environment rather than the rule. The rule takes numbers
 * and is tested directly; `SessionList` owns only the wiring that reads those
 * numbers off a real element.
 */

/** A row's box in the scroller's content, and the scroller's own window onto it. */
export type RevealGeometry = {
  /** The row's top, in content coordinates — i.e. what `scrollTop` would have to be to put it at the top edge. */
  readonly rowTop: number;
  readonly rowHeight: number;
  readonly scrollTop: number;
  /** The scroller's visible height (`clientHeight`). */
  readonly viewportHeight: number;
};

/**
 * The `scrollTop` that reveals the row, or `null` when none is needed.
 *
 * Two rules, and the second is the one worth stating. There is no margin and
 * no centring: a row that is already fully visible returns `null` and does not
 * move, and a row hanging ten pixels below the fold scrolls ten pixels. `j`
 * and `k` walk this list constantly, so anything that repositions a row you
 * can already see reads as jitter — a worse bug than the one this fixes.
 *
 * A row taller than the viewport is out of view at both edges at once. It
 * aligns to the top, because a long row's beginning is the part that names it.
 */
export function revealScrollTop(g: RevealGeometry): number | null {
  // An unmeasured scroller (happy-dom, or a first paint) knows nothing worth
  // acting on, and scrolling to 0 on that evidence would be a jump the user
  // never asked for.
  if (g.viewportHeight <= 0) {
    return null;
  }
  if (g.rowTop < g.scrollTop) {
    return Math.max(0, g.rowTop);
  }
  const overshoot = g.rowTop + g.rowHeight - (g.scrollTop + g.viewportHeight);
  if (overshoot > 0) {
    // Clamped to the row's own top so a row taller than the viewport lands at
    // its beginning instead of scrolling past it.
    return Math.max(0, Math.min(g.rowTop, g.scrollTop + overshoot));
  }
  return null;
}
