/**
 * The UI zoom clamp: one table, read by main (which trusts nothing the
 * renderer sends it) and by the renderer's own `Stepper` row and chord
 * handler alike. See `src/shared/ui-zoom.ts`'s own header for why the numbers
 * live here rather than in either process.
 */

import { describe, expect, it } from 'vitest';
import {
  clampUiZoomPercent,
  DEFAULT_UI_ZOOM,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  UI_ZOOM_STEP,
} from '../../src/shared/ui-zoom.js';

describe('clampUiZoomPercent', () => {
  it('keeps a value already inside the offered range', () => {
    expect(clampUiZoomPercent(110)).toBe(110);
  });

  it('floors below the minimum', () => {
    expect(clampUiZoomPercent(10)).toBe(UI_ZOOM_MIN);
  });

  it('ceilings above the maximum', () => {
    expect(clampUiZoomPercent(1000)).toBe(UI_ZOOM_MAX);
  });

  it.each([undefined, null, 'huge', Number.NaN, {}, []])(
    'is total: %p reads back as the default',
    (raw) => {
      expect(clampUiZoomPercent(raw)).toBe(DEFAULT_UI_ZOOM);
    },
  );

  it('the default is inside the offered range', () => {
    expect(DEFAULT_UI_ZOOM).toBeGreaterThanOrEqual(UI_ZOOM_MIN);
    expect(DEFAULT_UI_ZOOM).toBeLessThanOrEqual(UI_ZOOM_MAX);
  });

  it('the range is evenly divided by the step, so every offered value lands exactly', () => {
    expect((UI_ZOOM_MAX - UI_ZOOM_MIN) % UI_ZOOM_STEP).toBe(0);
  });
});
