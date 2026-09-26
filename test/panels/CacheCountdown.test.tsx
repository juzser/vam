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
