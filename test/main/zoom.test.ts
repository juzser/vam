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
});
