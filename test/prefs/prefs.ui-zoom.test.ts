// @vitest-environment happy-dom

/**
 * The app chrome's own zoom, 80..150% — #281's reversal. `shared/ui-zoom.ts`
 * carries the range and the clamp both processes hold this to; this file is
 * only the round trip through `prefs.ts` and the crossing into main.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  activatePrefs,
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setTheme,
  setUiZoom,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import { DEFAULT_UI_ZOOM, UI_ZOOM_MAX, UI_ZOOM_MIN } from '../../src/shared/ui-zoom.js';

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

describe('the UI zoom round-trips through the store', () => {
  it('defaults to unzoomed', () => {
    expect(EMPTY_PREFS.uiZoom).toBe(DEFAULT_UI_ZOOM);
  });

  it('writes and reads back a chosen zoom, disturbing no neighbour', () => {
    const storage = fake();
    writePrefs(storage, setUiZoom(setTheme(EMPTY_PREFS, 'system'), 130));
    const back = readPrefs(storage);
    expect(back.uiZoom).toBe(130);
    expect(back.theme).toBe('system');
  });

  it('defaults when the payload predates the field', () => {
    expect(stored({ theme: 'light' }).uiZoom).toBe(DEFAULT_UI_ZOOM);
  });

  it('clamps on the way in as well as on the way out', () => {
    expect(setUiZoom(EMPTY_PREFS, 9999).uiZoom).toBe(UI_ZOOM_MAX);
    expect(setUiZoom(EMPTY_PREFS, -5).uiZoom).toBe(UI_ZOOM_MIN);
    expect(stored({ uiZoom: 'huge' }).uiZoom).toBe(DEFAULT_UI_ZOOM);
  });
});

describe('the crossing into main', () => {
  it('pushes the zoom percent through window.api.prefs.setUiZoom on every read and write', () => {
    const setUiZoomSpy = vi.fn().mockResolvedValue(undefined);
    (globalThis as { window?: unknown }).window = {
      api: { prefs: { setUiZoom: setUiZoomSpy } },
    };
    try {
      activatePrefs(setUiZoom(EMPTY_PREFS, 120));
      expect(setUiZoomSpy).toHaveBeenCalledWith(120);
    } finally {
      (globalThis as { window?: unknown }).window = undefined;
    }
  });

  it('does not throw when window.api.prefs is absent, the browser build', () => {
    expect(() => activatePrefs(EMPTY_PREFS)).not.toThrow();
  });
});
