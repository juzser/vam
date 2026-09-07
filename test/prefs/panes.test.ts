/**
 * The pure arithmetic behind pane resizing: bounds, the drag ceiling, and
 * what actually reaches the DOM. No storage, no DOM — see `prefs.test.ts`
 * for the persistence half.
 *
 * 0.2 migration, A12.1: rewritten for the two-pane shell. The canvas
 * reservation this file used to pin (`CANVAS_MIN`, `CANVAS_STRIP`,
 * `canvasIsMain`, the three `LAYOUTS`) is gone along with the column it
 * protected — every number below is re-derived for a world with exactly two
 * panes, not adjusted from the three-column figures.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_VISIBLE,
  clampPaneWidth,
  DEFAULT_PANES,
  DETAIL_MAX,
  DETAIL_MIN,
  dragCeiling,
  layoutWidths,
  type Pane,
  renderedWidth,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from '../../src/renderer/prefs/panes.js';
import { readPrefs, type StorageLike } from '../../src/renderer/prefs/prefs.js';

const PANES: { pane: Pane; min: number; max: number; fallback: number }[] = [
  { pane: 'sidebar', min: SIDEBAR_MIN, max: SIDEBAR_MAX, fallback: DEFAULT_PANES.sidebar },
  { pane: 'detail', min: DETAIL_MIN, max: DETAIL_MAX, fallback: DEFAULT_PANES.detail },
];

describe('clampPaneWidth is total', () => {
  for (const { pane, min, max, fallback } of PANES) {
    describe(`for the ${pane} pane`, () => {
      const table: [number, number][] = [
        [-1, min],
        [0, min],
        [1, min],
        [min - 1, min],
        [min, min],
        [min + 1, min + 1],
        [max - 1, max - 1],
        [max, max],
        [max + 1, max],
        [1e9, max],
      ];
      for (const [input, expected] of table) {
        it(`clamps ${input} to ${expected}`, () => {
          expect(clampPaneWidth(pane, input)).toBe(expected);
        });
      }

      it('returns the default, never NaN or 0, for NaN', () => {
        const out = clampPaneWidth(pane, Number.NaN);
        expect(out).toBe(fallback);
        expect(Number.isNaN(out)).toBe(false);
        expect(out).not.toBe(0);
      });

      it('returns the default for +Infinity', () => {
        expect(clampPaneWidth(pane, Number.POSITIVE_INFINITY)).toBe(fallback);
      });

      it('returns the default for -Infinity', () => {
        expect(clampPaneWidth(pane, Number.NEGATIVE_INFINITY)).toBe(fallback);
      });

      it('returns the default for a non-number', () => {
        const notANumber = 'not a width' as unknown as number;
        expect(clampPaneWidth(pane, notANumber)).toBe(fallback);
      });
    });
  }
});

describe('dragCeiling: the narrow-viewport rule', () => {
  for (const { pane, min, max } of PANES) {
    it(`floors at ${pane}'s MIN when the viewport is below the 520 floor`, () => {
      // 400 < SIDEBAR_MIN + DETAIL_MIN (520): the absolute minimums win.
      const other = pane === 'sidebar' ? DETAIL_MIN : SIDEBAR_MIN;
      expect(dragCeiling(pane, other, 400)).toBe(min);
    });

    it(`never exceeds ${pane}'s MAX on a very wide viewport`, () => {
      expect(dragCeiling(pane, 0, 100000)).toBe(max);
    });

    it(`is never NaN or negative for a viewport of 0`, () => {
      const out = dragCeiling(pane, 0, 0);
      expect(Number.isNaN(out)).toBe(false);
      expect(out).toBeGreaterThanOrEqual(min);
    });
  }

  it('gives what the viewport leaves once the other pane is subtracted, nothing more', () => {
    // viewport 1200, detail rendered at 408: sidebar's ceiling is
    // 1200 - 408 = 792, capped at SIDEBAR_MAX.
    expect(dragCeiling('sidebar', 408, 1200)).toBe(SIDEBAR_MAX);
    // A narrower detail leaves the sidebar room to prove the subtraction is
    // real rather than always hitting the MAX cap.
    expect(dragCeiling('sidebar', 900, 1200)).toBe(1200 - 900);
  });
});

describe('renderedWidth: what reaches the DOM', () => {
  it('renders the default for both panes on a first-time (untouched) viewport', () => {
    expect(renderedWidth('sidebar', DEFAULT_PANES.sidebar, DEFAULT_PANES.detail, 1400)).toBe(
      DEFAULT_PANES.sidebar,
    );
    expect(renderedWidth('detail', DEFAULT_PANES.detail, DEFAULT_PANES.sidebar, 1400)).toBe(
      DEFAULT_PANES.detail,
    );
  });

  for (const { pane, min } of PANES) {
    it(`clamps a huge stored width down to the live ceiling at a narrow viewport (${pane})`, () => {
      const other = pane === 'sidebar' ? DETAIL_MIN : SIDEBAR_MIN;
      // 400 is below SIDEBAR_MIN + DETAIL_MIN (520), so the floor binds.
      expect(renderedWidth(pane, 1e9, other, 400)).toBe(min);
    });

    it(`clamps a stored 0 up to MIN (${pane})`, () => {
      expect(renderedWidth(pane, 0, 0, 2000)).toBe(min);
    });

    it(`falls back to the default for a stored NaN (${pane})`, () => {
      const { fallback } = PANES.find((p) => p.pane === pane) as { fallback: number };
      expect(renderedWidth(pane, Number.NaN, 0, 2000)).toBe(fallback);
    });
  }
});

/**
 * A width stored under the old three-column cap has to load, clamp per
 * FIELD, and leave every unrelated preference alone.
 */
describe('a width stored under the old cap survives the read', () => {
  const KEY = 'vam.prefs.v1';

  function storageHolding(payload: unknown): StorageLike {
    const value = JSON.stringify(payload);
    return {
      getItem: (key: string) => (key === KEY ? value : null),
      setItem: () => undefined,
    };
  }

  it('clamps the width per field and resets nothing else', () => {
    const prefs = readPrefs(
      storageHolding({
        panes: { sidebar: 4000, detail: 900 },
        theme: 'light',
      }),
    );
    // Per field: the sidebar is out of range and lands on its own MAX, and
    // that does not drag the detail pane to a default it never had.
    expect(prefs.panes.sidebar).toBe(SIDEBAR_MAX);
    expect(prefs.panes.detail).toBe(DETAIL_MAX);
    // Unrelated preferences are untouched by the clamp.
    expect(prefs.theme).toBe('light');
  });

  it('renders the detail pane as everything the sidebar leaves, regardless of what was stored', () => {
    const prefs = readPrefs(storageHolding({ panes: { sidebar: 264, detail: 900 } }));
    const { detail } = layoutWidths(ALL_VISIBLE, prefs.panes, 1400);
    // The stored 900 (or the old 640 ceiling before it) never bound this —
    // the detail pane has no stored width of its own to be capped at; it is
    // the viewport minus the sidebar.
    expect(detail).toBe(1400 - prefs.panes.sidebar);
  });
});

/**
 * The two columns must always add up to exactly the window, at every width
 * either pane is stored at.
 *
 * Visibility (a pane hidden entirely) is its own file —
 * `test/prefs/pane-visibility.test.ts` — matching the split the arithmetic
 * itself already had before this migration: this file is `ALL_VISIBLE`
 * throughout.
 */
describe('the two columns always add up to the viewport', () => {
  const LAPTOPS = [520, 700, 900, 1280, 1366, 1400, 1440, 1512, 1728, 2560];

  it('sums to the viewport at every laptop width, with the sidebar stored wide', () => {
    for (const viewport of LAPTOPS) {
      const { sidebar, detail } = layoutWidths(
        ALL_VISIBLE,
        { sidebar: DEFAULT_PANES.sidebar, detail: 4000 },
        viewport,
      );
      expect(sidebar + detail, `${viewport}`).toBe(viewport);
      expect(sidebar, `${viewport}`).toBeGreaterThanOrEqual(SIDEBAR_MIN);
      expect(detail, `${viewport}`).toBeGreaterThanOrEqual(DETAIL_MIN);
    }
  });

  it('commits the width the drag proposed, rather than snapping back', () => {
    for (const proposed of [220, 264, 300, 360]) {
      const drawn = layoutWidths(ALL_VISIBLE, { sidebar: proposed, detail: 408 }, 1400).sidebar;
      expect(drawn, `${proposed}`).toBe(proposed);
    }
  });

  it('prices the sidebar against a width it could actually be drawn at', () => {
    // A hand-edited sidebar past its own MAX must not starve the detail pane
    // of more room than the sidebar could ever really occupy.
    const { sidebar, detail } = layoutWidths(ALL_VISIBLE, { sidebar: 4000, detail: 4000 }, 1400);
    expect(sidebar).toBe(SIDEBAR_MAX);
    expect(detail).toBe(1400 - SIDEBAR_MAX);
  });

  it('leaves the sidebar draggable — the ceiling is above the floor once the window has room to spare', () => {
    // 520 itself is the exact floor sum (SIDEBAR_MIN + DETAIL_MIN): the
    // ceiling equals the floor there and the handle cannot move, which is
    // the correct boundary behaviour, not a bug — so it is excluded here and
    // covered by its own test above (`dragCeiling`'s narrow-viewport rule).
    for (const viewport of LAPTOPS.filter((v) => v > SIDEBAR_MIN + DETAIL_MIN)) {
      const ceiling = dragCeiling('sidebar', DETAIL_MIN, viewport);
      expect(ceiling, `${viewport}`).toBeGreaterThan(SIDEBAR_MIN);
    }
  });
});
