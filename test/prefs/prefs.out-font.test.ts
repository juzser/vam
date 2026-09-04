// @vitest-environment happy-dom

/** The `out` pane's text size: one stored number, and everything that must
 *  survive a payload predating it. `#122`'s focus share established that
 *  `readPrefs`, not the setter, is where the clamp belongs. */

import { describe, expect, it } from 'vitest';
import {
  applyOutFontSize,
  clampOutFontSize,
  DEFAULT_OUT_FONT_SIZE,
  EMPTY_PREFS,
  OUT_FONT_SIZE_MAX,
  OUT_FONT_SIZE_MIN,
  OUT_FONT_SIZE_VAR,
  readPrefs,
  type StorageLike,
  setFocusShare,
  setOutFontSize,
  setTheme,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

const KEY = 'vam.prefs.v1';

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) this.value = value;
    },
  };
}

const stored = (payload: object) => readPrefs(fake(JSON.stringify(payload)));

describe('the out text size round-trips', () => {
  it('has a real range, defaulting to the size the body already gives out', () => {
    // `styles.css` says `body { font-size: 12px }` and `out` inherited it.
    expect(DEFAULT_OUT_FONT_SIZE).toBe(12);
    expect(OUT_FONT_SIZE_MIN).toBeLessThan(DEFAULT_OUT_FONT_SIZE);
    expect(OUT_FONT_SIZE_MAX).toBeGreaterThan(DEFAULT_OUT_FONT_SIZE);
  });

  it('writes and reads back a chosen size, disturbing no neighbour', () => {
    const storage = fake();
    writePrefs(storage, setOutFontSize(setFocusShare(setTheme(EMPTY_PREFS, 'system'), 0.9), 15));
    const back = readPrefs(storage);
    expect(back.outFontSize).toBe(15);
    expect(back.theme).toBe('system');
    expect(back.focusViewportShare).toBe(0.9);
  });

  it('defaults when the payload predates the field — which every payload does', () => {
    const back = stored({ theme: 'light', focusViewportShare: 0.9 });
    expect(back.outFontSize).toBe(DEFAULT_OUT_FONT_SIZE);
    expect(back.theme).toBe('light');
    expect(back.focusViewportShare).toBe(0.9);
  });

  it('clamps a hand-edited value on READ, not only on write', () => {
    for (const [raw, want] of [
      [1, OUT_FONT_SIZE_MIN],
      [400, OUT_FONT_SIZE_MAX],
    ] as const) {
      const back = stored({ outFontSize: raw, theme: 'light' });
      expect(back.outFontSize, `stored ${raw}`).toBe(want);
      expect(back.theme, 'one bad field costs only itself').toBe('light');
    }
  });

  it('falls back to the default for anything that is not a usable number', () => {
    for (const raw of ['14', null, {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      const back = stored({ outFontSize: raw });
      expect(back.outFontSize, JSON.stringify(raw)).toBe(DEFAULT_OUT_FONT_SIZE);
    }
    // And on the way in as well, so nothing downstream has to wonder.
    expect(setOutFontSize(EMPTY_PREFS, 999).outFontSize).toBe(OUT_FONT_SIZE_MAX);
    expect(setOutFontSize(EMPTY_PREFS, 0).outFontSize).toBe(OUT_FONT_SIZE_MIN);
    expect(clampOutFontSize(Number.NaN)).toBe(DEFAULT_OUT_FONT_SIZE);
  });
});

describe('the chosen size reaches the document', () => {
  it('is put on the root as a custom property, in px, and changes when it changes', () => {
    const root = document.createElement('div');
    applyOutFontSize(16, root);
    expect(root.style.getPropertyValue(OUT_FONT_SIZE_VAR)).toBe('16px');
    applyOutFontSize(11, root);
    expect(root.style.getPropertyValue(OUT_FONT_SIZE_VAR)).toBe('11px');
    // Clamped at the DOM edge too, so no caller can route round the bounds.
    applyOutFontSize(999, root);
    expect(root.style.getPropertyValue(OUT_FONT_SIZE_VAR)).toBe(`${OUT_FONT_SIZE_MAX}px`);
    expect(() => applyOutFontSize(14, null)).not.toThrow();
  });

  it('is applied by the read path, not only by the writer', () => {
    readPrefs(fake(JSON.stringify({ outFontSize: 17 })));
    expect(document.documentElement.style.getPropertyValue(OUT_FONT_SIZE_VAR)).toBe('17px');
  });
});
