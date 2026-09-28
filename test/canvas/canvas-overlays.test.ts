// @vitest-environment happy-dom
/**
 * The extracted OVERLAY-VISIBILITY hook, asserted through its own return
 * value -- not through `Canvas`'s DOM. The load-bearing rules: `settingsSection`
 * defaults to `null` (settings-views restructure, item C -- it used to
 * default to `'interface'`, the cards restructure's renaming of the old
 * `appearance` default, but a non-null value here is now read as an EXPLICIT
 * deep link that overrides the last-viewed-section fallback
 * `SettingsOverlay` itself applies, and a generic open has no deep link to
 * name); opening the palette closes nothing else; `settingsSection` survives
 * a close and reopen (it records today's behaviour, not a chosen one); and
 * `confirmForceClose` holds its payload.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCanvasOverlays } from '../../src/renderer/canvas/canvas-overlays.js';

describe('useCanvasOverlays', () => {
  // NULL, NOT 'interface' -- settings-views restructure, item C. A non-null
  // `settingsSection` is an explicit deep link (Remote, Stats) that always
  // wins over the last-viewed-section fallback `SettingsOverlay` itself
  // applies (`readLastSection`) when `initialSection` is undefined; a
  // generic open has no deep link to name, so it stays null and lets that
  // fallback -- 'interface' only on a machine with no history yet -- decide.
  it('settingsSection defaults to null, so a generic open never overrides the last-viewed section', () => {
    const { result } = renderHook(() => useCanvasOverlays());

    expect(result.current.settingsSection).toBe(null);
  });

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
      result.current.setConfirmForceClose({
        sessionId: 's1',
        title: 'Session One',
        reason: 'busy',
      });
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
