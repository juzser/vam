/**
 * Bounds and drag arithmetic for the two resizable panes: the sidebar
 * (session list) and the detail pane (right-hand action panel).
 *
 * Pure, and total. Every function here must survive garbage input — `0`,
 * a negative, `NaN`, `Infinity`, a number bigger than any screen — because
 * a stored width can be any of those (an older vam, a hand-edited
 * `localStorage`, or a browser resized while a value was mid-drag) and none
 * of them may crash the canvas. See epic.md §4.2 for the numbers below.
 *
 * Clamping here is RENDER-TIME ONLY. `clampPaneWidth` and `renderedWidth`
 * are pure functions of (stored width, viewport) — they never write. The
 * stored width is what you dragged; the rendered width is the clamp of it
 * against whatever viewport happens to be current. An implementation that
 * calls these on the write path, rather than the render path, would lose a
 * person's real width the first time they resize their window narrow — see
 * epic.md §4.2 point 2.
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
 * ~480px, additional width is whitespace taken from the canvas — the pane
 * the product is named for (epic.md §4.2).
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
 * Symmetric to the sidebar: past this, the canvas becomes subordinate to a
 * detail pane rather than the other way around (epic.md §4.2).
 */
export const DETAIL_MAX = 640;

/**
 * The canvas must keep a session's fan legible; below ~360px the grid still
 * renders but is no longer a canvas (epic.md §4.2).
 */
export const CANVAS_MIN = 360;

/**
 * Today's hardcoded values (`SessionList.tsx:154` and `DetailPanel.tsx:146`),
 * kept as the default so a browser with no stored prefs renders
 * pixel-identical to the pre-resize app (epic.md §4.1).
 */
export const DEFAULT_PANES: { readonly sidebar: number; readonly detail: number } = {
  sidebar: 264,
  detail: 408,
};

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
 * viewport leaves after the other (already-rendered) pane and the canvas's
 * own floor, whichever is smaller — floored at this pane's MIN.
 *
 * Below `SIDEBAR_MIN + DETAIL_MIN + CANVAS_MIN = 880`, the absolute minimums
 * win and `CANVAS_MIN` yields: you can always drag a pane down to its
 * minimum, never below it (epic.md §4.2 point 4).
 */
export function dragCeiling(pane: Pane, otherRendered: number, viewportWidth: number): number {
  const { min, max } = bounds(pane);
  const ceiling = Math.min(max, viewportWidth - otherRendered - CANVAS_MIN);
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
 *
 * The canvas is in here even though it has no stored width: it is the third
 * column, it is the thing the subtractive layouts below hide, and a visibility
 * record that could not name it would push that knowledge into the render tree.
 * Three named fields rather than a keyed map, for the reason `Prefs.panes`
 * already gives: the columns are known at compile time.
 */
export type PaneVisibility = {
  readonly sidebar: boolean;
  readonly canvas: boolean;
  readonly detail: boolean;
};

/** The shipped layout: everything on screen. */
export const ALL_VISIBLE: PaneVisibility = { sidebar: true, canvas: true, detail: true };

/**
 * A column id. The three columns are still known at compile time — what stopped
 * being known when the focus layout arrived is their SEQUENCE, which is why
 * this type exists next to `PaneVisibility` rather than replacing it.
 */
export type ColumnId = 'sidebar' | 'canvas' | 'detail';

/** The sequence the app has always drawn: the canvas in the middle. */
export const DEFAULT_ORDER = ['sidebar', 'canvas', 'detail'] as const satisfies readonly ColumnId[];

/**
 * A layout: which columns are drawn, and in what order.
 *
 * The order is OPTIONAL and absent means `DEFAULT_ORDER`, per field, the same
 * defence `prefs.ts` uses everywhere else — a payload written before this field
 * existed reads back as the shipped sequence rather than as an empty row of
 * columns.
 */
export type Layout = PaneVisibility & { readonly order?: readonly ColumnId[] };

/** Total: a layout's sequence, whether or not it named one. */
export function columnOrder(layout: Layout): readonly ColumnId[] {
  return layout.order ?? DEFAULT_ORDER;
}

/**
 * Is the canvas the column the layout is built around?
 *
 * The canvas is the main column exactly while it is drawn and is not the
 * TRAILING one: in the shipped sequence it sits in the middle with a fixed
 * pane on either side, so it takes whatever room is left. Demote it to the
 * right-hand end and the response inherits that job, which is the whole of
 * what "canvas is secondary" means for the width arithmetic. Derived from the
 * order rather than carried as a third field, so a layout cannot declare a
 * main column its own sequence contradicts.
 */
export function canvasIsMain(layout: Layout): boolean {
  const order = columnOrder(layout);
  return layout.canvas && order[order.length - 1] !== 'canvas';
}

/**
 * The demoted canvas's width — its own floor, not `CANVAS_MIN`'s.
 *
 * `CANVAS_MIN` is 360 because below that "the grid still renders but is no
 * longer a canvas", and that judgement was made about a canvas that is the
 * primary surface, showing every session's fan. The strip is a different
 * object with a different job: it draws ONLY the focused session's chain (see
 * `Canvas.tsx`), so what it has to keep legible is one row of cards, not a
 * whole workspace. 300 is the width at which that row still reads at the
 * default zoom, and it is deliberately BELOW `CANVAS_MIN` — a strip that had
 * to clear the primary canvas's floor would not be a demotion, it would be the
 * same canvas with less room to say the same thing. This is the answer to
 * "is a narrow canvas still a canvas": not the same one, so not the same floor.
 */
export const CANVAS_STRIP = 300;

/**
 * The named layouts, keyboard-reachable (`chords.ts`).
 *
 * Two of the three are subtractive — they hide columns and change nothing else
 * — and stay exactly as they shipped, order and all. The third is the reason
 * `Layout` carries an order at all: it reorders rather than subtracts.
 */
export const LAYOUTS = {
  /** The response, alone: the detail pane is the whole window. */
  responseOnly: { sidebar: false, canvas: false, detail: true },
  /** List plus response, for reading and answering without the graph. */
  noCanvas: { sidebar: true, canvas: false, detail: true },
  /**
   * The response in the middle and the canvas demoted to a right-hand strip
   * showing the focused session alone: everything is still on screen, but the
   * response is what the window is about.
   */
  focusResponse: {
    sidebar: true,
    canvas: true,
    detail: true,
    order: ['sidebar', 'detail', 'canvas'],
  },
} as const satisfies Readonly<Record<string, Layout>>;

export type LayoutName = keyof typeof LAYOUTS;

/**
 * The two rendered widths, for a given layout.
 *
 * Derived from the layout's ORDER, not from a `visible.canvas` test: the
 * question the arithmetic actually asks is which column takes the leftover
 * room, and that is `canvasIsMain`. Four rules, and the last three are why
 * this exists rather than two bare `renderedWidth` calls:
 *
 * 1. A hidden pane renders at 0 — it is not drawn, so it has no width. This
 *    is the one place a 0 is legal, and it never reaches storage.
 * 2. A hidden pane costs its sibling nothing. `renderedWidth` subtracts the
 *    other pane's width from what the viewport can give this one; passing a
 *    hidden pane's stored 320 there would let an unmounted detail pane keep
 *    taking room away from a visible sidebar.
 * 3. With the canvas hidden there is no `CANVAS_MIN` to reserve and nothing
 *    to be subordinate to, so the survivors divide the whole viewport and the
 *    detail pane takes what is left over — deliberately past `DETAIL_MAX`,
 *    because that bound exists to stop the detail pane overshadowing the
 *    canvas, and there is no canvas.
 * 4. With the canvas demoted, the same thing happens with one difference: the
 *    strip is reserved out of the viewport first. `DETAIL_MAX` is passed here
 *    too, and for the same reason — a layout whose point is that the response
 *    is the main column cannot then cap the response at 640.
 */
export function layoutWidths(
  layout: Layout,
  stored: { readonly sidebar: number; readonly detail: number },
  viewportWidth: number,
): { readonly sidebar: number; readonly detail: number } {
  if (canvasIsMain(layout)) {
    return {
      sidebar: layout.sidebar
        ? renderedWidth('sidebar', stored.sidebar, layout.detail ? stored.detail : 0, viewportWidth)
        : 0,
      detail: layout.detail
        ? renderedWidth('detail', stored.detail, layout.sidebar ? stored.sidebar : 0, viewportWidth)
        : 0,
    };
  }
  // Whatever the canvas still costs when it is not the main column: nothing at
  // all when it is hidden, one strip when it is demoted.
  const reserved = layout.canvas ? CANVAS_STRIP : 0;
  if (!layout.detail) {
    return {
      sidebar: layout.sidebar ? Math.max(SIDEBAR_MIN, viewportWidth - reserved) : 0,
      detail: 0,
    };
  }
  const sidebar = layout.sidebar
    ? Math.min(
        clampPaneWidth('sidebar', stored.sidebar),
        Math.max(SIDEBAR_MIN, viewportWidth - DETAIL_MIN - reserved),
      )
    : 0;
  return { sidebar, detail: Math.max(DETAIL_MIN, viewportWidth - sidebar - reserved) };
}
