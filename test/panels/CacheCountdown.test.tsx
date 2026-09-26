// @vitest-environment happy-dom

/**
 * THE ROW'S OWN LEAF: given a session, draw the countdown or draw nothing.
 *
 * `domain/cache-timer.ts` already owns the maths and is pinned on its own;
 * this file is only about the paint -- the icon, the mm:ss text, the tooltip,
 * the phase colouring, and that it ticks off the SHARED clock rather than a
 * timer of its own (`cache-timer-clock.test.ts` pins the store; this proves a
 * mounted leaf actually re-renders when that store ticks).
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheCountdown } from '../../src/renderer/panels/CacheCountdown.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const session = {
  source: 'claude-code',
  status: 'idle' as const,
  lastCacheActivityAt: '2026-09-26T01:00:00.000Z',
  cacheTtlMs: 5 * 60 * 1000,
};

const START_MS = Date.parse(session.lastCacheActivityAt);

describe('CacheCountdown', () => {
  it('draws nothing when the state resolves to null', () => {
    const { container } = render(
      <CacheCountdown session={session} enabled={false} nowMs={() => START_MS} />,
    );
    expect(container.querySelector('[data-cache-timer]')).toBeNull();
  });

  it('draws the icon and the mm:ss text in the normal phase', () => {
    const { getByTestId } = render(
      <CacheCountdown session={session} enabled nowMs={() => START_MS} />,
    );
    const el = getByTestId('cache-timer');
    expect(el.getAttribute('data-cache-timer-phase')).toBe('normal');
    expect(el.textContent).toBe('5:00');
  });

  it('carries the warning phase in the last minute', () => {
    const { getByTestId } = render(
      <CacheCountdown session={session} enabled nowMs={() => START_MS + 5 * 60 * 1000 - 30_000} />,
    );
    expect(getByTestId('cache-timer').getAttribute('data-cache-timer-phase')).toBe('warning');
  });

  it('draws a quiet expired mark once the TTL elapses, with no countdown text', () => {
    const { getByTestId } = render(
      <CacheCountdown session={session} enabled nowMs={() => START_MS + 5 * 60 * 1000} />,
    );
    const el = getByTestId('cache-timer');
    expect(el.getAttribute('data-cache-timer-phase')).toBe('expired');
    expect(el.textContent).not.toMatch(/\d/);
  });

  it('carries an explanatory tooltip naming the TTL', () => {
    const { getByTestId } = render(
      <CacheCountdown session={session} enabled nowMs={() => START_MS} />,
    );
    expect(getByTestId('cache-timer').title).toMatch(/5 minutes/);
  });

  describe('a device clock that disagrees with the source’s own', () => {
    // `lastCacheActivityAt` is stamped on the SOURCE's clock
    // (`source.ts`'s own `nowMs`, the same figure `Session.age` already
    // uses); `cacheSourceNowMs` is that SAME clock's reading at the moment
    // this snapshot was taken. A paired phone's own `Date.now()` is a
    // DIFFERENT clock -- the operator's own report -- and can disagree by
    // minutes. `cacheSourceNowMs` reads one minute after
    // `lastCacheActivityAt`: by the SOURCE's own reckoning, 4 of 5 minutes
    // remain.
    const skewedSession = { ...session, cacheSourceNowMs: START_MS + 60_000 };

    it('corrects a device clock that runs ten minutes ahead of the source', () => {
      // Read naively (this device's raw `Date.now()` against the source-
      // stamped `lastCacheActivityAt`) this would already claim the entry
      // expired 5 minutes 59 seconds ago. Corrected for the OFFSET at
      // receipt, it must still read what the source itself would say: 4:00.
      const { getByTestId } = render(
        <CacheCountdown
          session={skewedSession}
          enabled
          nowMs={() => START_MS + 60_000 + 10 * 60_000}
        />,
      );
      expect(getByTestId('cache-timer').textContent).toBe('4:00');
    });

    it('keeps ticking at the device’s own pace once the offset is captured', () => {
      let now = START_MS + 60_000 + 10 * 60_000; // the receipt instant
      const { getByTestId, rerender } = render(
        <CacheCountdown session={skewedSession} enabled nowMs={() => now} />,
      );
      expect(getByTestId('cache-timer').textContent).toBe('4:00');

      // Thirty real seconds pass on THIS device's own clock, same session
      // object (no new poll) -- the offset captured at receipt must still
      // apply, landing on 3:30 by the source's clock, not a value the raw
      // device clock alone would produce.
      now += 30_000;
      rerender(<CacheCountdown session={skewedSession} enabled nowMs={() => now} />);
      expect(getByTestId('cache-timer').textContent).toBe('3:30');
    });

    it('reads the device clock as-is when the source never sent its own now', () => {
      // No `cacheSourceNowMs` at all -- an older poll, or a source this
      // has not been threaded through yet (`model.ts`'s own absent/null
      // convention) -- must not throw and must not invent an offset.
      const { getByTestId } = render(
        <CacheCountdown session={session} enabled nowMs={() => START_MS} />,
      );
      expect(getByTestId('cache-timer').textContent).toBe('5:00');
    });
  });

  describe('dropping off the shared clock once there is nothing left to redraw', () => {
    it('never subscribes at all for a row that is already expired at mount', async () => {
      const { cacheTimerClockListenerCount } = await import(
        '../../src/renderer/panels/cache-timer-clock.js'
      );
      const before = cacheTimerClockListenerCount();
      const { unmount } = render(
        <CacheCountdown session={session} enabled nowMs={() => START_MS + 5 * 60 * 1000} />,
      );
      expect(cacheTimerClockListenerCount()).toBe(before);
      unmount();
    });

    it('stays subscribed while its own countdown is still live', async () => {
      const { cacheTimerClockListenerCount } = await import(
        '../../src/renderer/panels/cache-timer-clock.js'
      );
      const before = cacheTimerClockListenerCount();
      const { unmount } = render(
        <CacheCountdown session={session} enabled nowMs={() => START_MS} />,
      );
      expect(cacheTimerClockListenerCount()).toBe(before + 1);
      unmount();
      expect(cacheTimerClockListenerCount()).toBe(before);
    });

    it('unsubscribes mid-life, the instant a live tick finds it expired', async () => {
      vi.useFakeTimers();
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const { cacheTimerClockListenerCount, useCacheTimerClockDriver } = await import(
        '../../src/renderer/panels/cache-timer-clock.js'
      );
      const { renderHook } = await import('@testing-library/react');
      renderHook(() => useCacheTimerClockDriver(true));

      let now = START_MS + 5 * 60 * 1000 - 1_000; // one second still live
      const before = cacheTimerClockListenerCount();
      render(<CacheCountdown session={session} enabled nowMs={() => now} />);
      expect(cacheTimerClockListenerCount()).toBe(before + 1);

      now = START_MS + 5 * 60 * 1000 + 1; // the next tick finds it expired
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(cacheTimerClockListenerCount()).toBe(before);
    });
  });

  it('re-renders its own text off the shared clock, not a private timer', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let now = START_MS;
    const { getByTestId } = render(<CacheCountdown session={session} enabled nowMs={() => now} />);
    expect(getByTestId('cache-timer').textContent).toBe('5:00');

    // The clock has moved a full minute, but NOTHING has ticked the shared
    // store yet -- so the leaf, which reads `Date.now()` only at render, must
    // still show the stale text. This is what proves it owns no timer of its
    // own: a private `setInterval` would already have re-rendered by now.
    now = START_MS + 61_000;
    expect(getByTestId('cache-timer').textContent).toBe('5:00');

    // NOW mount the one shared driver `SessionList.tsx` mounts once, and
    // advance it a single tick -- the leaf re-renders off THAT, not off its
    // own clock.
    const { useCacheTimerClockDriver } = await import(
      '../../src/renderer/panels/cache-timer-clock.js'
    );
    const { renderHook } = await import('@testing-library/react');
    renderHook(() => useCacheTimerClockDriver(true));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getByTestId('cache-timer').textContent).toBe('3:59');
  });
});
