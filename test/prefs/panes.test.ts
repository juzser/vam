/**
 * The pure arithmetic behind pane resizing: bounds, the drag ceiling, and
 * what actually reaches the DOM. No storage, no DOM — see `prefs.test.ts`
 * for the persistence half.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_VISIBLE,
  CANVAS_MIN,
  CANVAS_STRIP,
  canvasIsMain,
  clampPaneWidth,
  DEFAULT_PANES,
  DETAIL_MAX,
  DETAIL_MIN,
  dragCeiling,
  LAYOUTS,
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
    it(`floors at ${pane}'s MIN when the viewport is below the 880 floor`, () => {
      // 700 < SIDEBAR_MIN + DETAIL_MIN + CANVAS_MIN (880): the absolute
      // minimums win and CANVAS_MIN yields (epic.md §4.2 point 4).
      const other = pane === 'sidebar' ? DETAIL_MIN : SIDEBAR_MIN;
      expect(dragCeiling(pane, other, 700)).toBe(min);
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

  it('gives what the viewport leaves once the other pane and the canvas floor are subtracted', () => {
    // viewport 1200, detail rendered at 408: sidebar's ceiling is
    // 1200 - 408 - 360 = 432, inside [SIDEBAR_MIN, SIDEBAR_MAX].
    expect(dragCeiling('sidebar', 408, 1200)).toBe(1200 - 408 - CANVAS_MIN);
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
      expect(renderedWidth(pane, 1e9, other, 700)).toBe(min);
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
 * `DETAIL_MAX` is a claim about the CANVAS, so it may only bind where the
 * canvas is the main column.
 *
 * "Symmetric to the sidebar: past this, the canvas becomes subordinate to a
 * detail pane rather than the other way around." That reasoning is sound for
 * the shipped layout and backwards for `focusResponse`, whose entire purpose
 * is that the canvas IS subordinate — capping the detail pane there to protect
 * the canvas defends something the layout deliberately demoted.
 *
 * The bound is already derived rather than flat: `canvasIsMain` picks the
 * branch and `canvasReserved` prices the canvas, so what is left for the detail
 * pane is the viewport minus the two floors that genuinely have to survive —
 * the sidebar's, and the strip's. These pin that per layout, which is the one
 * thing the existing coverage did not do for `focusResponse`.
 */
describe("the detail pane's ceiling is the layout's, not one constant", () => {
  const STORED = { sidebar: DEFAULT_PANES.sidebar, detail: 4000 };
  const VIEWPORT = 1400;

  it('holds the detail pane at DETAIL_MAX where the canvas is the main column', () => {
    expect(canvasIsMain(ALL_VISIBLE)).toBe(true);
    expect(layoutWidths(ALL_VISIBLE, STORED, VIEWPORT).detail).toBe(DETAIL_MAX);
  });

  it('lets it past DETAIL_MAX in focusResponse, where the canvas is a strip', () => {
    expect(canvasIsMain(LAYOUTS.focusResponse)).toBe(false);
    const { sidebar, detail } = layoutWidths(LAYOUTS.focusResponse, STORED, VIEWPORT);
    expect(detail).toBeGreaterThan(DETAIL_MAX);
    // Derived, not a second magic number: what is preserved is the sidebar's
    // width and the strip's own floor, and the detail pane takes the rest.
    expect(detail).toBe(VIEWPORT - sidebar - CANVAS_STRIP);
  });

  it("never eats the strip's floor, however wide the detail pane is stored", () => {
    for (const viewport of [820, 1000, 1400, 2600]) {
      const { sidebar, detail } = layoutWidths(LAYOUTS.focusResponse, STORED, viewport);
      expect(viewport - sidebar - detail).toBe(CANVAS_STRIP);
      expect(sidebar).toBeGreaterThanOrEqual(SIDEBAR_MIN);
      expect(detail).toBeGreaterThanOrEqual(DETAIL_MIN);
    }
  });

  /**
   * The subtractive layouts, asked the same question: with no canvas at all,
   * what is `DETAIL_MAX` protecting? Nothing — and it already does not apply.
   */
  it('does not apply in the two subtractive layouts, which have no canvas to protect', () => {
    for (const layout of [LAYOUTS.noCanvas, LAYOUTS.responseOnly]) {
      expect(canvasIsMain(layout)).toBe(false);
      const { sidebar, detail } = layoutWidths(layout, STORED, VIEWPORT);
      expect(detail).toBeGreaterThan(DETAIL_MAX);
      expect(sidebar + detail).toBe(VIEWPORT);
    }
  });
});

/**
 * A width stored under the old flat cap has to load, clamp per FIELD, and
 * leave every unrelated preference alone.
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
        focusViewportShare: 0.42,
      }),
    );
    // Per field: the sidebar is out of range and lands on its own MAX, and
    // that does not drag the detail pane to a default it never had.
    expect(prefs.panes.sidebar).toBe(SIDEBAR_MAX);
    expect(prefs.panes.detail).toBe(DETAIL_MAX);
    // Unrelated preferences are untouched by the clamp.
    expect(prefs.theme).toBe('light');
    expect(prefs.focusViewportShare).toBe(0.42);
  });

  it('renders that stored width past the old cap once the layout allows it', () => {
    const prefs = readPrefs(storageHolding({ panes: { sidebar: 264, detail: 900 } }));
    expect(layoutWidths(ALL_VISIBLE, prefs.panes, 1400).detail).toBe(DETAIL_MAX);
    expect(layoutWidths(LAYOUTS.focusResponse, prefs.panes, 1400).detail).toBeGreaterThan(
      DETAIL_MAX,
    );
  });
});
