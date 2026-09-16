/**
 * HOW WIDE THE FILE TREE IS, once the operator can drag it.
 *
 * Pure, and total, for the reason `panes.ts` gives at length: a stored width
 * can be anything a previous vam, a hand-edited `localStorage` or a devtools
 * session left behind -- `0`, a negative, `NaN`, `Infinity`, a string -- and
 * none of them may render a column that has vanished rather than one that
 * failed to load.
 *
 * ── CLAMPING HERE IS RENDER-TIME ONLY ────────────────────────────────────
 * `renderedTreeWidth` is a pure function of (stored width, container width).
 * It never writes. The STORED width is what the operator dragged; the
 * RENDERED width is that number clamped against whatever container happens to
 * be on screen right now. An implementation that called this on the WRITE
 * path would lose the operator's real width the first time the pane narrowed
 * -- the same rule `clampPaneWidth`/`renderedWidth` already hold in
 * `panes.ts`, and the same one orca's own file-tree hook records as a comment.
 *
 * AND IT MATTERS MORE HERE THAN IT DOES IN EITHER OF THOSE PLACES. The Files
 * tab is NOT unmounted when another tab shows: `FilesTab.tsx`'s own header
 * explains that it is removed from layout with `hidden` (`display: none`) so
 * that unsaved text survives a switch to Terminal and back. A `display: none`
 * element measures 0px. If a 0 were taken as "a very narrow container" rather
 * than as "no measurement", one look at the Terminal tab would collapse the
 * operator's chosen width to the floor and keep it there -- and nothing about
 * that failure looks like a bug in a resizer. So: a container of 0, a
 * negative, or a non-finite number is UNKNOWN, and an unknown container
 * clamps nothing.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * The floor, unchanged from the clamp that shipped before the handle existed:
 * `min-w-[7.5rem]`, 120px at a 16px root. Below it a row shows an ellipsis
 * and no name, which is not a tree. It is also the width the editor is
 * measured against at vam's narrowest legal pane (`DETAIL_MIN`, 320px) in
 * `e2e/files-tab-keyboard-shots.mjs`.
 */
export const TREE_WIDTH_MIN = 120;

/**
 * What a tree with no stored width of its own renders at: `max-w-[13.5rem]`,
 * 216px, which is exactly what the old `w-[38%] max-w-[13.5rem]` clamp
 * already drew on any pane wide enough to reach its cap. Shipping the handle
 * therefore moves nothing on screen for an operator who never touches it --
 * the same discipline `DEFAULT_PANES` follows, and the reason a first drag
 * starts from the width that was already there rather than jumping.
 */
export const TREE_WIDTH_DEFAULT = 216;

/**
 * How wide the tree may be STORED at.
 *
 * The bound that actually binds in practice is `treeWidthCeiling` below --
 * half of what the two columns share -- so this one only has to be large
 * enough that a drag on a wide pane is not fighting it, and small enough that
 * a stored number past it is recognisably not a width anyone chose. 480 is
 * `SIDEBAR_MAX`'s number and it is here for `SIDEBAR_MAX`'s own reason: both
 * are one-line, truncating name columns sitting beside the thing the operator
 * is actually reading, and past ~480px the extra width is whitespace taken
 * from that thing.
 */
export const TREE_WIDTH_MAX = 480;

/**
 * The `gap-1.5` between the editor column and the tree, in pixels, so the
 * half-and-half arithmetic below is measuring the space the two columns
 * really share rather than the space plus the seam between them. Six pixels
 * of error would be invisible in every unit test and is exactly the size of
 * mistake that makes "the editor keeps the larger half" false by one pixel --
 * which is why the property is ALSO asserted as rectangles against real
 * Chromium in `e2e/files-tree-resize-shots.mjs`.
 */
export const COLUMN_GAP = 6;

/** Whether a container measurement means anything at all. See this module's
 *  header: `display: none` measures 0, and 0 is not "narrow". */
function measured(containerWidth: number): boolean {
  return (
    typeof containerWidth === 'number' && Number.isFinite(containerWidth) && containerWidth > 0
  );
}

/**
 * Total: any input maps into `[MIN, MAX]`. A non-finite or non-number input
 * returns the DEFAULT rather than `NaN` or `0`, for `clampPaneWidth`'s reason.
 *
 * This is the ONLY clamp on the write path. It knows nothing about a
 * container, which is what makes it safe to call when a width is being
 * stored.
 */
export function clampStoredTreeWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    return TREE_WIDTH_DEFAULT;
  }
  return Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, width));
}

/**
 * The widest the tree may RENDER against a given container: the stored cap,
 * or half of what the two columns share, whichever is smaller -- floored at
 * `TREE_WIDTH_MIN`.
 *
 * HALF, so the editor always keeps at least as much as the tree. That is the
 * property the `max-w-[13.5rem]` cap was standing in for ("capped so it can
 * never take the editor's"), restated as the invariant it was really about
 * rather than as a number that happened to satisfy it at one pane width.
 *
 * FLOORED LAST, which reproduces CSS's own precedence: `min-width` beats
 * `max-width`, so a container too narrow for both floors draws the tree at
 * its floor and lets the editor -- which carries `min-w-0` -- take the
 * squeeze. That is what ships today, and a resizer is not the change that
 * should quietly reverse it.
 */
export function treeWidthCeiling(containerWidth: number): number {
  if (!measured(containerWidth)) {
    return TREE_WIDTH_MAX;
  }
  const half = Math.floor((containerWidth - COLUMN_GAP) / 2);
  return Math.max(TREE_WIDTH_MIN, Math.min(TREE_WIDTH_MAX, half));
}

/**
 * What actually reaches the DOM. Pure: calling this on a resize, on a tab
 * switch, or on any other render must never write anything back -- see this
 * module's header for what it would cost if it did.
 */
export function renderedTreeWidth(stored: unknown, containerWidth: number): number {
  return Math.min(treeWidthCeiling(containerWidth), clampStoredTreeWidth(stored));
}
