/**
 * Visibility, as arithmetic and as a stored preference.
 *
 * The DOM half of this — that a hidden pane is unmounted rather than narrow,
 * and that the handlers refuse to point at one — is
 * `test/canvas/Canvas.pane-visibility.test.tsx`. What is left here is the two
 * pure pieces: what a pane is worth in width when its sibling is not drawn,
 * and what `readPrefs` does with a payload written before any of this existed.
 *
 * 0.2 migration, A12.1: `LAYOUTS` and the canvas reservation it protected
 * (`CANVAS_MIN`, `DETAIL_MAX` as a canvas-shaped bound) are gone with the
 * canvas column. There are two panes, `sidebar` and `detail`, and hiding
 * either hands the survivor the WHOLE viewport — nothing is reserved for a
 * column that no longer exists.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_VISIBLE,
  DEFAULT_PANES,
  DETAIL_MIN,
  layoutWidths,
  type PaneVisibility,
} from '../../src/renderer/prefs/panes.js';
import { EMPTY_PREFS, readPrefs, type StorageLike } from '../../src/renderer/prefs/prefs.js';

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
  it('renders both panes normally when both are drawn', () => {
    expect(layoutWidths(ALL_VISIBLE, STORED, 1400)).toEqual({
      sidebar: 264,
      detail: 1400 - 264,
    });
  });

  it('gives a hidden pane 0 — the one place a 0 width is legal', () => {
    expect(layoutWidths(visibility({ sidebar: false }), STORED, 1400).sidebar).toBe(0);
    expect(layoutWidths(visibility({ detail: false }), STORED, 1400).detail).toBe(0);
  });

  it('hands the survivor the whole viewport, whichever pane is hidden', () => {
    const sidebarHidden = layoutWidths(
      visibility({ sidebar: false }),
      { sidebar: 264, detail: 640 },
      900,
    );
    expect(sidebarHidden).toEqual({ sidebar: 0, detail: 900 });
    const detailHidden = layoutWidths(
      visibility({ detail: false }),
      { sidebar: 264, detail: 640 },
      900,
    );
    expect(detailHidden).toEqual({ sidebar: 900, detail: 0 });
  });

  it('never lets the sidebar squeeze the detail pane below its minimum', () => {
    const { sidebar, detail } = layoutWidths(ALL_VISIBLE, { sidebar: 480, detail: 408 }, 700);
    expect(detail).toBe(DETAIL_MIN);
    expect(sidebar).toBe(700 - DETAIL_MIN);
  });

  it('is total: garbage stored widths land on the pane defaults, never NaN', () => {
    const { sidebar, detail } = layoutWidths(
      ALL_VISIBLE,
      { sidebar: Number.NaN, detail: Number.POSITIVE_INFINITY },
      1200,
    );
    expect(sidebar).toBe(DEFAULT_PANES.sidebar);
    expect(Number.isFinite(detail)).toBe(true);
  });
});

describe('the flag round-trips, and an older payload has none', () => {
  it('defaults to both drawn when there is nothing stored', () => {
    expect(readPrefs(null).paneVisibility).toEqual(ALL_VISIBLE);
    expect(EMPTY_PREFS.paneVisibility).toEqual(ALL_VISIBLE);
  });

  it('reads back a payload written before visibility existed', () => {
    // Exactly today's shipped shape: widths and icons, no version field, no
    // `paneVisibility` key. It must come back with every pane drawn rather
    // than as a blank window.
    const old = { panes: { sidebar: 300, detail: 500 }, theme: 'light', icons: {} };
    const prefs = readPrefs(storage(old));
    expect(prefs.paneVisibility).toEqual(ALL_VISIBLE);
    expect(prefs.panes).toEqual({ sidebar: 300, detail: 500 });
    expect(prefs.theme).toBe('light');
  });

  it('reads back a 0.1 payload carrying the canvas field and an order — both unread, neither an error', () => {
    // A11/A12's decision, verified: dropped fields sit unread, per A4.1 —
    // there is no migration to write, because `canvas` and `order` are
    // simply not in the type this version parses into.
    const old = {
      paneVisibility: {
        sidebar: true,
        canvas: false,
        detail: true,
        order: ['sidebar', 'canvas', 'detail'],
      },
    };
    expect(readPrefs(storage(old)).paneVisibility).toEqual(ALL_VISIBLE);
  });

  it('is defensive per field, like every other preference', () => {
    // A half-written or hand-edited value must not hide a pane by accident:
    // only an explicit `false` hides anything.
    const prefs = readPrefs(storage({ paneVisibility: { sidebar: 'no', detail: false } }));
    expect(prefs.paneVisibility).toEqual({ sidebar: true, detail: false });
    expect(readPrefs(storage({ paneVisibility: 7 })).paneVisibility).toEqual(ALL_VISIBLE);
  });
});
