/**
 * The thumb maths, tested without a DOM.
 *
 * `measure` is exported for exactly this: the geometry is where an overlay
 * scrollbar goes wrong (a thumb that overhangs the track at the bottom, or one
 * that appears on a list short enough not to scroll), and none of it needs a
 * browser to check.
 */

import { describe, expect, it } from 'vitest';
import { measure } from '../../src/renderer/panels/OverlayScroll.js';

describe('measure', () => {
  it('shows nothing when the content fits', () => {
    expect(measure({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }).needed).toBe(false);
    expect(measure({ scrollTop: 0, scrollHeight: 120, clientHeight: 300 }).needed).toBe(false);
  });

  it('shows nothing before the element has been laid out', () => {
    // clientHeight 0 with a real scrollHeight is the first paint. Dividing by
    // it would give a NaN thumb rendered at NaNpx.
    const m = measure({ scrollTop: 0, scrollHeight: 900, clientHeight: 0 });
    expect(m.needed).toBe(false);
    expect(Number.isNaN(m.height)).toBe(false);
  });

  it('sizes the thumb by the visible fraction', () => {
    // A third of the content is visible, so the thumb is a third of the track.
    const m = measure({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 });
    expect(m.height).toBe(100);
    expect(m.top).toBe(0);
  });

  it('lands the thumb flush with the bottom, never past it', () => {
    // The trap: scaling `top` by clientHeight rather than by the TRAVEL leaves
    // the thumb hanging its own height below the track at full scroll.
    const m = measure({ scrollTop: 600, scrollHeight: 900, clientHeight: 300 });
    expect(m.top + m.height).toBe(300);
    expect(m.top).toBe(200);
  });

  it('keeps a grabbable thumb in a very long list', () => {
    // 1/100th of 300px would be a 3px dot.
    const m = measure({ scrollTop: 0, scrollHeight: 30_000, clientHeight: 300 });
    expect(m.height).toBe(24);
    // And the floor must not push it past the bottom either.
    const end = measure({ scrollTop: 29_700, scrollHeight: 30_000, clientHeight: 300 });
    expect(end.top + end.height).toBe(300);
  });
});
