/**
 * Visibility, as arithmetic and as a stored preference.
 *
 * The DOM half of this — that a hidden pane is unmounted rather than narrow,
 * and that the handlers refuse to point at one — is
 * `test/canvas/Canvas.pane-visibility.test.tsx`. What is left here is the two
 * pure pieces: what a pane is worth in width when its sibling is not drawn,
 * and what `readPrefs` does with a payload written before any of this existed.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_VISIBLE,
  CANVAS_MIN,
  DEFAULT_PANES,
  DETAIL_MAX,
  DETAIL_MIN,
  LAYOUTS,
  layoutWidths,
  type PaneVisibility,
  SIDEBAR_MAX,
} from '../../src/renderer/prefs/panes.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setLayout,
} from '../../src/renderer/prefs/prefs.js';

const STORED = { sidebar: 264, detail: 408 };

function visibility(over: Partial<PaneVisibility>): PaneVisibility {
  return { ...ALL_VISIBLE, ...over };
}

/** A `Storage` holding exactly one payload, the way a browser would. */
function storage(payload: unknown): StorageLike {
  return {
    getItem: () => (payload === undefined ? null : JSON.stringify(payload)),
    setItem: () => {},
  };
}

describe('a hidden pane is worth no width, and costs its sibling none', () => {
  it('renders both panes normally when all three columns are drawn', () => {
    expect(layoutWidths(ALL_VISIBLE, STORED, 1400)).toEqual({ sidebar: 264, detail: 408 });
  });

  it('gives a hidden pane 0 — the one place a 0 width is legal', () => {
    expect(layoutWidths(visibility({ sidebar: false }), STORED, 1400).sidebar).toBe(0);
    expect(layoutWidths(visibility({ detail: false }), STORED, 1400).detail).toBe(0);
  });

  it('stops charging the survivor for a sibling that is not drawn', () => {
    // 900 is narrow enough that the sibling's width is the binding constraint:
    // with the sidebar drawn the detail pane can only reach
    // 900 - 264 - CANVAS_MIN, which is under DETAIL_MIN, so it clamps to 320.
    const withSidebar = layoutWidths(ALL_VISIBLE, { sidebar: 264, detail: 640 }, 900);
    expect(withSidebar.detail).toBe(DETAIL_MIN);
    // Hidden, the sidebar costs nothing and the detail pane gets what is left
    // over the canvas's own floor.
    const without = layoutWidths(
      visibility({ sidebar: false }),
      { sidebar: 264, detail: 640 },
      900,
    );
    expect(without.detail).toBe(900 - CANVAS_MIN);
  });

  it('still leaves the canvas its floor while the canvas is drawn', () => {
    const wide = layoutWidths(visibility({ sidebar: false }), { sidebar: 264, detail: 4000 }, 1400);
    expect(wide.detail).toBe(DETAIL_MAX);
    expect(1400 - wide.detail).toBeGreaterThanOrEqual(CANVAS_MIN);
  });
});

describe('with the canvas gone the survivors divide the window', () => {
  it('gives the detail pane the whole width when it is alone (response only)', () => {
    expect(layoutWidths(LAYOUTS.responseOnly, STORED, 1200)).toEqual({ sidebar: 0, detail: 1200 });
  });

  it('lets it past DETAIL_MAX, because that bound was about the canvas', () => {
    expect(layoutWidths(LAYOUTS.responseOnly, STORED, 1200).detail).toBeGreaterThan(DETAIL_MAX);
  });

  it('keeps the sidebar at its dragged width and hands over the rest (no canvas)', () => {
    expect(layoutWidths(LAYOUTS.noCanvas, STORED, 1200)).toEqual({ sidebar: 264, detail: 936 });
  });

  it('never lets the sidebar squeeze the detail pane below its minimum', () => {
    const { sidebar, detail } = layoutWidths(LAYOUTS.noCanvas, { sidebar: 480, detail: 408 }, 700);
    expect(detail).toBe(DETAIL_MIN);
    expect(sidebar).toBe(700 - DETAIL_MIN);
    expect(sidebar).toBeLessThanOrEqual(SIDEBAR_MAX);
  });

  it('is total: garbage stored widths land on the pane defaults, never NaN', () => {
    const { sidebar, detail } = layoutWidths(
      LAYOUTS.noCanvas,
      { sidebar: Number.NaN, detail: Number.POSITIVE_INFINITY },
      1200,
    );
    expect(sidebar).toBe(DEFAULT_PANES.sidebar);
    expect(Number.isFinite(detail)).toBe(true);
  });
});

describe('the flag round-trips, and an older payload has none', () => {
  it('defaults to all three drawn when there is nothing stored', () => {
    expect(readPrefs(null).paneVisibility).toEqual(ALL_VISIBLE);
    expect(EMPTY_PREFS.paneVisibility).toEqual(ALL_VISIBLE);
  });

  it('reads back a payload written before visibility existed', () => {
    // Exactly today's shipped shape: widths and icons, no version field, no
    // `paneVisibility` key. It must come back with every pane drawn rather
    // than as a blank canvas.
    const old = { panes: { sidebar: 300, detail: 500 }, theme: 'light', icons: {} };
    const prefs = readPrefs(storage(old));
    expect(prefs.paneVisibility).toEqual(ALL_VISIBLE);
    expect(prefs.panes).toEqual({ sidebar: 300, detail: 500 });
    expect(prefs.theme).toBe('light');
  });

  it('round-trips a stored layout', () => {
    const written = setLayout(EMPTY_PREFS, 'responseOnly');
    expect(readPrefs(storage(JSON.parse(JSON.stringify(written)))).paneVisibility).toEqual(
      LAYOUTS.responseOnly,
    );
  });

  it('is defensive per field, like every other preference', () => {
    // A half-written or hand-edited value must not hide a pane by accident:
    // only an explicit `false` hides anything.
    const prefs = readPrefs(storage({ paneVisibility: { sidebar: 'no', canvas: false } }));
    expect(prefs.paneVisibility).toEqual({ sidebar: true, canvas: false, detail: true });
    expect(readPrefs(storage({ paneVisibility: 7 })).paneVisibility).toEqual(ALL_VISIBLE);
  });

  it('leaves the widths alone when the layout changes', () => {
    // The whole point of storing this next to `panes` rather than in it.
    const dragged = { ...EMPTY_PREFS, panes: { sidebar: 300, detail: 500 } };
    expect(setLayout(dragged, 'responseOnly').panes).toEqual(dragged.panes);
  });
});
