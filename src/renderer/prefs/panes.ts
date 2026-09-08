/**
 * Bounds and drag arithmetic for the two panes vam draws: the sidebar
 * (session list) and the detail pane (the focused tab's content).
 *
 * Pure, and total. Every function here must survive garbage input — `0`,
 * a negative, `NaN`, `Infinity`, a number bigger than any screen — because
 * a stored width can be any of those (an older vam, a hand-edited
 * `localStorage`, or a browser resized while a value was mid-drag) and none
 * of them may crash the shell. See epic.md §4.2 for the numbers below.
 *
 * Clamping here is RENDER-TIME ONLY. `clampPaneWidth` and `renderedWidth`
 * are pure functions of (stored width, viewport) — they never write. The
 * stored width is what you dragged; the rendered width is the clamp of it
 * against whatever viewport happens to be current. An implementation that
 * calls these on the write path, rather than the render path, would lose a
 * person's real width the first time they resize their window narrow — see
 * epic.md §4.2 point 2.
 *
 * 0.2 migration, A12.1: the canvas column is gone, and with it the whole
 * reservation math this file used to carry — `CANVAS_MIN`, `CANVAS_STRIP`,
 * `canvasReserved`, `canvasIsMain`, `layoutForViewport`, the three named
 * `LAYOUTS` and the `order` a layout used to carry. vam is exactly two
 * panes now: the sidebar, and the detail pane, which fills everything to
 * the sidebar's right. There is nothing left to reorder and nothing left to
 * reserve room for, so those are deleted rather than kept as a reservation
 * of zero — dead branches that always evaluate to "nothing to protect" are
 * exactly the kind of silent complexity this codebase keeps finding.
 */

export type Pane = 'sidebar' | 'detail';

/**
 * Below this, the sidebar's own chrome — the workspace row's badge/tag and
 * the "New session" button with its `o` hint — starts to clip: the button's
 * own label breaks before content does. 200 is the round number above the
 * ~180px point where that clipping starts (epic.md §4.2).
 */
export const SIDEBAR_MIN = 200;

/**
 * The sidebar holds one-line session titles that already truncate; past
 * ~480px, additional width is whitespace taken from the detail pane — the
 * pane that shows the actual conversation (epic.md §4.2).
 */
export const SIDEBAR_MAX = 480;

/**
 * The detail pane must keep the prompt input usable and the two-line
 * `.vam-clamp-2` blocks reading as two lines of prose, and it hosts
 * review-queue rows with their own note inputs. 320 is the conventional
 * narrowest usable side panel and the first round number where the clamp
 * still clamps prose (epic.md §4.2).
 */
export const DETAIL_MIN = 320;

/**
 * How wide a detail pane may be STORED at.
 *
 * With no canvas to protect, the only bound left that is about the pane
 * rather than about the window is the narrowest window in which both
 * columns fit at their floors — the same discipline `PHONE_MAX_WIDTH`
 * (`phone/viewport.ts`) already follows for the boundary one level below
 * this one. A pane stored wider than that is not a wide pane, it is a
 * stored width no two-pane window could ever honour.
 *
 * In practice the detail pane's RENDERED width is always derived from the
 * viewport and the sidebar (see `layoutWidths`) rather than read from a
 * stored number — there is nothing left for it to be dragged against — so
 * this bound now only protects `clampPaneWidth('detail', …)` against a
 * garbage stored value, the same defensive job it has always done.
 */
export const DETAIL_MAX = SIDEBAR_MIN + DETAIL_MIN;

/**
 * Today's hardcoded values (`SessionList.tsx:154` and `DetailPanel.tsx:146`),
 * kept as the default so a browser with no stored prefs renders
 * pixel-identical to the pre-resize app (epic.md §4.1).
 */
export const DEFAULT_PANES: { readonly sidebar: number; readonly detail: number } = {
  sidebar: 264,
  detail: 408,
};

/**
 * How far one `<`/`>` chord press, or one arrow-key press on the resize
 * handle itself, moves a pane. One constant so the two keyboard routes to
 * the same action cannot silently drift apart into two different step
 * sizes — the worse bug the handle's own keyboard support would otherwise
 * risk introducing.
 */
export const PANE_RESIZE_STEP = 24;

function bounds(pane: Pane): { min: number; max: number; fallback: number } {
  return pane === 'sidebar'
    ? { min: SIDEBAR_MIN, max: SIDEBAR_MAX, fallback: DEFAULT_PANES.sidebar }
    : { min: DETAIL_MIN, max: DETAIL_MAX, fallback: DEFAULT_PANES.detail };
}

/**
 * Total: any input maps into `[MIN, MAX]` for the given pane. A non-finite
 * or non-number input returns that pane's DEFAULT — never `NaN`, never `0` —
 * because a garbage width silently rendering at `0` would be a pane that has
 * vanished, not a pane that failed to load.
 */
export function clampPaneWidth(pane: Pane, width: number): number {
  const { min, max, fallback } = bounds(pane);
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, width));
}

/**
 * The live ceiling a drag may reach: the pane's own MAX, or whatever the
 * viewport leaves after the other (already-rendered) pane, whichever is
 * smaller — floored at this pane's MIN.
 *
 * Below `SIDEBAR_MIN + DETAIL_MIN = 520`, the absolute minimums win: you can
 * always drag a pane down to its minimum, never below it.
 */
export function dragCeiling(pane: Pane, otherRendered: number, viewportWidth: number): number {
  const { min, max } = bounds(pane);
  const ceiling = Math.min(max, viewportWidth - otherRendered);
  return Math.max(min, ceiling);
}

/**
 * What actually reaches the DOM: the stored width, clamped against the
 * current viewport and the other pane's own rendered width. Pure — calling
 * this on a viewport change must never write to storage; only a real drag
 * end or chord press does that (epic.md §4.2 point 2, AC-2(c)).
 */
export function renderedWidth(
  pane: Pane,
  storedWidth: number,
  otherStored: number,
  viewportWidth: number,
): number {
  const ceiling = dragCeiling(pane, otherStored, viewportWidth);
  return Math.min(ceiling, clampPaneWidth(pane, storedWidth));
}

/**
 * Which panes are drawn at all.
 *
 * Visibility is NOT a width. Every function above floors at the pane's MIN,
 * on purpose (see `clampPaneWidth`), so "hide it by storing 0" renders a 200px
 * sidebar. A pane is hidden by not being mounted, and this is the flag that
 * says so. It is stored NEXT TO `panes`, never inside it, so the width
 * arithmetic and its stored payloads stay exactly as they were.
 */
export type PaneVisibility = {
  readonly sidebar: boolean;
  readonly detail: boolean;
};

/** The shipped layout: both panes drawn. */
export const ALL_VISIBLE: PaneVisibility = { sidebar: true, detail: true };

/**
 * The two rendered widths, for a given visibility.
 *
 * Four rules:
 *
 * 1. A hidden pane renders at 0 — it is not drawn, so it has no width. This
 *    is the one place a 0 is legal, and it never reaches storage.
 * 2. A hidden pane costs its sibling nothing: the survivor takes the whole
 *    viewport.
 * 3. With both panes drawn, the sidebar is priced first — clamped to its own
 *    bounds and to whatever the viewport leaves once the detail pane's own
 *    floor is protected — and the detail pane takes what is left over. The
 *    detail pane has no stored width of its own to defend: it is the
 *    column that fills everything to the sidebar's right (A12.1), so unlike
 *    the sidebar there is nothing here for a drag to propose against it.
 * 4. Every branch is total over garbage input: `clampPaneWidth` already is,
 *    and nothing here divides by a width that could be zero or NaN.
 */
export function layoutWidths(
  visible: PaneVisibility,
  stored: { readonly sidebar: number; readonly detail: number },
  viewportWidth: number,
): { readonly sidebar: number; readonly detail: number } {
  if (!visible.sidebar) {
    return { sidebar: 0, detail: visible.detail ? Math.max(DETAIL_MIN, viewportWidth) : 0 };
  }
  if (!visible.detail) {
    return { sidebar: Math.max(SIDEBAR_MIN, viewportWidth), detail: 0 };
  }
  const sidebar = Math.min(
    clampPaneWidth('sidebar', stored.sidebar),
    Math.max(SIDEBAR_MIN, viewportWidth - DETAIL_MIN),
  );
  return { sidebar, detail: Math.max(DETAIL_MIN, viewportWidth - sidebar) };
}
