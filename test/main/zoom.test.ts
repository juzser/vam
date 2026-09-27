/**
 * `lockZoom`, against a recording double: the two things the launch harness
 * cannot read back are `setVisualZoomLevelLimits` (no getter) and the
 * listener registrations. The listener's EFFECT is asserted on a live
 * webContents in `test/electron/launch.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { lockZoom, type ZoomLockable } from '../../src/main/zoom.js';

function recorder() {
  const limits: Array<[number, number]> = [];
  const levels: number[] = [];
  const factors: number[] = [];
  const listeners = new Map<string, Array<() => void>>();
  const contents: ZoomLockable = {
    setVisualZoomLevelLimits: (minimum, maximum) => void limits.push([minimum, maximum]),
    setZoomFactor: (factor) => void factors.push(factor),
    setZoomLevel: (level) => void levels.push(level),
    on: (event, listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return contents;
    },
  };
  return { contents, limits, levels, factors, listeners };
}

describe('lockZoom', () => {
  it('pins the visual (pinch) zoom limits to exactly 1', () => {
    const r = recorder();
    lockZoom(r.contents);
    expect(r.limits).toEqual([[1, 1]]);
  });

  it('resets factor and level immediately', () => {
    const r = recorder();
    lockZoom(r.contents);
    expect(r.factors).toEqual([1]);
    expect(r.levels).toEqual([0]);
  });

  it.each(['zoom-changed', 'did-finish-load'] as const)('resets again on %s', (event) => {
    const r = recorder();
    lockZoom(r.contents);
    const listener = r.listeners.get(event)?.[0];
    expect(listener, `nothing listens for ${event}`).toBeTypeOf('function');
    listener?.();
    // One reset at registration, one from the event.
    expect(r.levels).toEqual([0, 0]);
    expect(r.factors).toEqual([1, 1]);
  });

  /**
   * #281's reversal: an operator-chosen UI zoom (`prefs/ui-zoom.ts`) now has
   * to survive the exact reset this file exists to run. `getFactor` is read
   * LIVE -- called again on every reset, never snapshotted once at
   * registration -- because the operator can change the setting after a
   * window already has a `zoom-changed` listener attached to it, and that
   * listener has to reset to the NEW value, not the one in force when the
   * window opened. A plain `factor` parameter, captured by `lockZoom`'s own
   * closure, would freeze the first value forever.
   */
  describe('with an operator-chosen factor', () => {
    it('resets to it, immediately and on both events', () => {
      const r = recorder();
      let factor = 1.1;
      lockZoom(r.contents, () => factor);
      expect(r.factors).toEqual([1.1]);
      r.listeners.get('zoom-changed')?.[0]?.();
      expect(r.factors).toEqual([1.1, 1.1]);
      // The level is still always 0 -- only the FACTOR carries the zoom; a
      // stray level would double it (electron composes the two).
      expect(r.levels).toEqual([0, 0]);
    });

    it('reads the getter again on every reset, never a value snapshotted once', () => {
      const r = recorder();
      let factor = 1;
      lockZoom(r.contents, () => factor);
      factor = 1.25;
      r.listeners.get('did-finish-load')?.[0]?.();
      expect(r.factors).toEqual([1, 1.25]);
    });

    it('still pins the pinch limits to exactly 1, whatever the factor is', () => {
      const r = recorder();
      lockZoom(r.contents, () => 1.25);
      expect(r.limits).toEqual([[1, 1]]);
    });
  });
});
