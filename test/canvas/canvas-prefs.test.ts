// @vitest-environment happy-dom
/**
 * The extracted PREFS + PANE-WIDTH hook, asserted through its own return
 * value -- not through `Canvas`'s DOM. Three cases carry the load-bearing
 * rules: `savePrefs` persists through the injected storage and is readable
 * back, `onPaneChange` moves the live width without persisting, and the
 * following `onPaneCommit` persists it and clears the live override.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCanvasPrefs } from '../../src/renderer/canvas/canvas-prefs.js';
import { readPrefs, type StorageLike } from '../../src/renderer/prefs/prefs.js';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('useCanvasPrefs', () => {
  it('savePrefs persists through the injected storage and is readable back', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useCanvasPrefs(storage));

    act(() => {
      result.current.savePrefs({ ...result.current.prefs, theme: 'light' });
    });

    expect(result.current.prefs.theme).toBe('light');
    expect(readPrefs(storage).theme).toBe('light');
  });

  it('onPaneChange moves the live width without persisting', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useCanvasPrefs(storage));
    const before = readPrefs(storage).panes.sidebar;

    act(() => {
      result.current.onPaneChange('sidebar', 321);
    });

    expect(result.current.sidebarWidth).toBe(321);
    expect(readPrefs(storage).panes.sidebar).toBe(before);
  });

  it('the following onPaneCommit persists it and clears the live override', () => {
    const storage = fakeStorage();
    const { result } = renderHook(() => useCanvasPrefs(storage));

    act(() => {
      result.current.onPaneChange('sidebar', 321);
    });
    act(() => {
      result.current.onPaneCommit('sidebar', 321);
    });

    expect(readPrefs(storage).panes.sidebar).toBe(321);
    expect(result.current.prefs.panes.sidebar).toBe(321);
  });
});
