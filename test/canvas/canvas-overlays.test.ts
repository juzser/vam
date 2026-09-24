// @vitest-environment happy-dom
/**
 * The extracted OVERLAY-VISIBILITY hook, asserted through its own return
 * value -- not through `Canvas`'s DOM. Three cases carry the load-bearing
 * rules: opening the palette closes nothing else, `settingsSection` survives
 * a close and reopen (it records today's behaviour, not a chosen one), and
 * `confirmForceClose` holds its payload.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCanvasOverlays } from '../../src/renderer/canvas/canvas-overlays.js';

describe('useCanvasOverlays', () => {
  it('opening the palette closes nothing else', () => {
    const { result } = renderHook(() => useCanvasOverlays());

    act(() => {
      result.current.setPaletteOpen(true);
    });

    expect(result.current.paletteOpen).toBe(true);
    expect(result.current.keySheetOpen).toBe(false);
    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.errorLogOpen).toBe(false);
    expect(result.current.confirmForceClose).toBe(null);
  });

  it('settingsSection survives a close and reopen of Settings', () => {
    const { result } = renderHook(() => useCanvasOverlays());

    act(() => {
      result.current.setSettingsSection('remote');
      result.current.setSettingsOpen(true);
    });
    act(() => {
      result.current.setSettingsOpen(false);
    });
    act(() => {
      result.current.setSettingsOpen(true);
    });

    expect(result.current.settingsSection).toBe('remote');
  });

  it('confirmForceClose holds its payload', () => {
    const { result } = renderHook(() => useCanvasOverlays());

    act(() => {
      result.current.setConfirmForceClose({ sessionId: 's1', title: 'Session One', reason: 'busy' });
    });

    expect(result.current.confirmForceClose).toEqual({
      sessionId: 's1',
      title: 'Session One',
      reason: 'busy',
    });

    act(() => {
      result.current.setConfirmForceClose(null);
    });

    expect(result.current.confirmForceClose).toBe(null);
  });
});
