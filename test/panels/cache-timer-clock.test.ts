// @vitest-environment happy-dom

/**
 * ONE SHARED CLOCK, drawn from underneath every row's countdown.
 *
 * `useVisibilityInterval` already owns the visibility/enabled shape
 * (`useVisibilityInterval.test.ts` pins it in isolation); this file is the
 * one thing this module adds on top: every subscriber wakes off the SAME
 * tick, and the driver -- not a subscriber -- is the only thing that ever
 * asks for a timer. The single-driver-for-N-rows guarantee itself is proven
 * at the integration level (`SessionList.cache-timer.test.tsx`), where N real
 * countdown rows share one `window.setInterval` call; this file is the pure
 * store underneath that guarantee.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  subscribeCacheTimerClock,
  useCacheTimerClockDriver,
} from '../../src/renderer/panels/cache-timer-clock.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const spyVisibility = () => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

describe('the shared clock', () => {
  it('wakes every subscriber from one driver, once a second while enabled', () => {
    vi.useFakeTimers();
    spyVisibility();
    renderHook(() => useCacheTimerClockDriver(true));

    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeCacheTimerClock(a);
    const unsubB = subscribeCacheTimerClock(b);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(a).toHaveBeenCalledTimes(4);
    expect(b).toHaveBeenCalledTimes(4);

    unsubA();
    unsubB();
  });

  it('never ticks a subscriber that has unsubscribed', () => {
    vi.useFakeTimers();
    spyVisibility();
    renderHook(() => useCacheTimerClockDriver(true));

    const a = vi.fn();
    const unsubA = subscribeCacheTimerClock(a);
    unsubA();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(a).not.toHaveBeenCalled();
  });

  it('runs no timer at all while the driver is disabled', () => {
    vi.useFakeTimers();
    spyVisibility();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    renderHook(() => useCacheTimerClockDriver(false));
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
