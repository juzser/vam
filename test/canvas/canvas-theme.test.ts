// @vitest-environment happy-dom
/**
 * The extracted THEME hook, asserted through its own return value -- not
 * through `Canvas`'s DOM. `'system'` resolves through the OS hook and
 * re-resolves when the OS hook fires; a concrete `'dark'`/`'light'` does not
 * subscribe at all.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCanvasTheme } from '../../src/renderer/canvas/canvas-theme.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';

/** The OS, as `matchMedia` reports it -- mutable, and countable in listeners. */
function fakeMatchMedia(initial: boolean) {
  const state = { light: initial };
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() {
      return state.light;
    },
    media: '(prefers-color-scheme: light)',
    addEventListener: (_event: 'change', listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: 'change', listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  } as unknown as MediaQueryList;
  return {
    matchMedia: vi.fn().mockReturnValue(query),
    flip(light: boolean) {
      state.light = light;
      act(() => {
        for (const listener of [...listeners]) {
          listener({ matches: light } as MediaQueryListEvent);
        }
      });
    },
    listenerCount: () => listeners.size,
  };
}

function prefs(overrides: Partial<Prefs>): Prefs {
  return { ...EMPTY_PREFS, ...overrides };
}

describe('useCanvasTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("'system' resolves through the OS hook", () => {
    const os = fakeMatchMedia(true);
    vi.stubGlobal('matchMedia', os.matchMedia);

    const { result } = renderHook(() => useCanvasTheme(prefs({ theme: 'system' })));

    expect(result.current.effective).toBe('light');
  });

  it("'system' re-resolves when the OS hook fires", () => {
    const os = fakeMatchMedia(true);
    vi.stubGlobal('matchMedia', os.matchMedia);

    const { result } = renderHook(() => useCanvasTheme(prefs({ theme: 'system' })));
    expect(result.current.effective).toBe('light');

    os.flip(false);

    expect(result.current.effective).toBe('dark');
  });

  it("a concrete 'dark'/'light' does not subscribe", () => {
    const os = fakeMatchMedia(true);
    vi.stubGlobal('matchMedia', os.matchMedia);

    renderHook(() => useCanvasTheme(prefs({ theme: 'dark' })));

    expect(os.listenerCount()).toBe(0);
  });
});
