/**
 * The pure arithmetic behind pane resizing: bounds, the drag ceiling, and
 * what actually reaches the DOM. No storage, no DOM — see `prefs.test.ts`
 * for the persistence half.
 */

import { describe, expect, it } from 'vitest';
import {
  CANVAS_MIN,
  clampPaneWidth,
  DEFAULT_PANES,
  DETAIL_MAX,
  DETAIL_MIN,
  dragCeiling,
  type Pane,
  renderedWidth,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from '../../src/renderer/prefs/panes.js';

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
