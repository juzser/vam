/**
 * The one number `main/zoom.ts`'s `lockZoom` reads live, and the one place it
 * is written from an IPC call (`main/zoom-ipc.ts`) — split out of `zoom.ts`
 * itself so that file's own tests stay pure (a fresh recorder, no leaked
 * module state) while `lockZoom`'s production caller (`main/index.ts`) still
 * gets one persistent factor shared by every `webContents` this app creates.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { currentZoomFactor, setZoomPercent } from '../../src/main/zoom-state.js';
import { DEFAULT_UI_ZOOM, UI_ZOOM_MAX, UI_ZOOM_MIN } from '../../src/shared/ui-zoom.js';

describe('zoom-state', () => {
  beforeEach(() => {
    // Every test starts from the shipped default — see `setZoomPercent`'s own
    // reset call below, which exists for exactly this.
    setZoomPercent(DEFAULT_UI_ZOOM);
  });

  it('starts at the default, as a FACTOR (percent / 100)', () => {
    expect(currentZoomFactor()).toBe(1);
  });

  it('setZoomPercent moves the factor read back afterwards', () => {
    setZoomPercent(120);
    expect(currentZoomFactor()).toBe(1.2);
  });

  it('clamps whatever it is given — main trusts nothing the renderer sends', () => {
    setZoomPercent(9999);
    expect(currentZoomFactor()).toBe(UI_ZOOM_MAX / 100);
    setZoomPercent(-50);
    expect(currentZoomFactor()).toBe(UI_ZOOM_MIN / 100);
    setZoomPercent('huge' as unknown as number);
    expect(currentZoomFactor()).toBe(DEFAULT_UI_ZOOM / 100);
  });

  it('returns the clamped percent it actually stored', () => {
    expect(setZoomPercent(9999)).toBe(UI_ZOOM_MAX);
  });
});
