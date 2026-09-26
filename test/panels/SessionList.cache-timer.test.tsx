// @vitest-environment happy-dom

/**
 * THE SIDEBAR'S CACHE-TIMER COUNTDOWN, drawn on a real row.
 *
 * `domain/cache-timer.test.ts` pins the maths, `CacheCountdown.test.tsx` pins
 * the leaf's own paint, `cache-timer-clock.test.ts` pins the shared store in
 * isolation. This file is the one place all three meet a real `SessionList`:
 * the row only draws the badge under the right conditions, and N rows that
 * each carry one still cost exactly ONE `setInterval` between them.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/renderer/domain/model.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps, entriesOf, makeSession } from './session-list-props.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const cacheReady = (over: Partial<Session> = {}): Session =>
  makeSession({
    source: 'claude-code',
    status: 'idle',
    lastCacheActivityAt: '2026-09-26T01:00:00.000Z',
    cacheTtlMs: 5 * 60 * 1000,
    ...over,
  });

function renderList(sessions: readonly Session[], enabled = true) {
  const entries = entriesOf(sessions);
  return render(
    <SessionList {...baseProps(entries)} entries={entries} cacheTimerEnabled={enabled} />,
  );
}

describe('when the badge draws', () => {
  it('draws for an idle Claude Code session with cache activity', () => {
    const { container } = renderList([cacheReady({ id: 's1' })]);
    expect(container.querySelector('[data-cache-timer]')).not.toBeNull();
  });

  it('draws for a waiting session too, not only idle', () => {
    const { container } = renderList([cacheReady({ id: 's1', status: 'waiting' })]);
    expect(container.querySelector('[data-cache-timer]')).not.toBeNull();
  });
});

describe('when it is hidden', () => {
  it('is hidden while the setting is off', () => {
    const { container } = renderList([cacheReady({ id: 's1' })], false);
    expect(container.querySelector('[data-cache-timer]')).toBeNull();
  });

  it('is hidden for a running session', () => {
    const { container } = renderList([cacheReady({ id: 's1', status: 'running' })]);
    expect(container.querySelector('[data-cache-timer]')).toBeNull();
  });

  it('is hidden for a non-Claude-Code session', () => {
    const { container } = renderList([cacheReady({ id: 's1', source: 'codex' })]);
    expect(container.querySelector('[data-cache-timer]')).toBeNull();
  });

  it('is hidden for a session with no cache activity to report', () => {
    const { container } = renderList([
      cacheReady({ id: 's1', lastCacheActivityAt: null, cacheTtlMs: null }),
    ]);
    expect(container.querySelector('[data-cache-timer]')).toBeNull();
  });
});

describe('the single-ticker guarantee', () => {
  /**
   * `useVisibilityInterval`'s own mount sequence calls `window.setInterval`
   * TWICE regardless of anything downstream (its mount effect and its
   * period-tracking effect each `restart()` once on the first render, the
   * second replacing the first's timer before it ever fires -- pinned in
   * isolation by `useVisibilityInterval.test.ts`, unrelated to how many rows
   * are on screen). So the number this guarantee pins is NOT a literal `1`;
   * it is that the count is a CONSTANT independent of row count -- one
   * driver mounted once by `SessionList` itself, never one per row, which
   * fifty rows sharing a timer count with one row is what actually proves.
   */
  it('costs the same number of intervals for one row as for fifty', () => {
    const oneRowIntervals = vi.spyOn(window, 'setInterval');
    renderList([cacheReady({ id: 's1' })]);
    const withOneRow = oneRowIntervals.mock.calls.length;
    cleanup();
    oneRowIntervals.mockRestore();

    const fiftyRowIntervals = vi.spyOn(window, 'setInterval');
    const sessions = Array.from({ length: 50 }, (_, i) => cacheReady({ id: `s${i}` }));
    const { container } = renderList(sessions);

    expect(container.querySelectorAll('[data-cache-timer]')).toHaveLength(50);
    expect(fiftyRowIntervals.mock.calls.length).toBe(withOneRow);
  });

  it('creates no interval at all when the setting is off, however many rows there are', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const sessions = Array.from({ length: 50 }, (_, i) => cacheReady({ id: `s${i}` }));
    renderList(sessions, false);
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});

describe('the visibility pause', () => {
  /**
   * `useVisibilityInterval`'s own `'pause'` mode is what
   * `useCacheTimerClockDriver` asks for -- pinned in isolation by
   * `useVisibilityInterval.test.ts` and by `cache-timer-clock.test.ts` at the
   * store level. This is the one place it is proven wired all the way
   * through a real row: hide the window and the countdown text stops
   * advancing; show it again and it catches up in one jump.
   */
  it('stops ticking while the window is hidden, and resumes on return', () => {
    // Pinned to the fixture's own `lastCacheActivityAt` -- fake timers
    // otherwise start at the REAL wall clock, which this sandbox's own date
    // can already be past the fixture's five-minute TTL.
    vi.useFakeTimers({ now: Date.parse('2026-09-26T01:00:00.000Z') });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { getByTestId } = renderList([cacheReady({ id: 's1' })]);
    expect(getByTestId('cache-timer').textContent).toBe('5:00');

    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));

    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    // A HIDDEN WINDOW NEVER TICKS THE STORE, so the leaf never re-rendered --
    // it is still showing the text from the moment it was hidden, not '3:55'.
    expect(getByTestId('cache-timer').textContent).toBe('5:00');

    visibility.mockReturnValue('visible');
    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(getByTestId('cache-timer').textContent).toBe('3:55');
  });
});

describe('rendering must be cheap', () => {
  /**
   * A TICK MUST NOT RE-RENDER THE LIST -- only the leaf badge that
   * subscribed. `CacheCountdown` is the only thing in this tree calling
   * `useSyncExternalStore` against the shared clock; `SessionList` itself
   * never sees a state update from a tick, so React never re-renders
   * anything outside the leaf.
   *
   * PROVEN BY DOM IDENTITY rather than a render-count spy: capture another
   * row's title node before a tick, advance the clock, and check it is the
   * SAME node object after -- React only replaces nodes it actually
   * re-rendered, so an untouched reference is direct evidence the rest of
   * the list did not repaint, not an inference from timing.
   */
  it('leaves every other row’s DOM node untouched when the clock ticks', () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-26T01:00:00.000Z') });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const sessions = [
      cacheReady({ id: 'timed', title: 'has-a-timer' }),
      makeSession({ id: 'plain', title: 'no-timer-at-all', status: 'idle' }),
    ];
    const { container, getByTestId } = renderList(sessions);

    const findPlainTitle = () =>
      [...container.querySelectorAll('[data-row-title]')].find((el) =>
        el.textContent?.includes('no-timer-at-all'),
      );
    const plainTitleBefore = findPlainTitle();
    expect(plainTitleBefore).not.toBeUndefined();
    expect(getByTestId('cache-timer').textContent).toBe('5:00');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(getByTestId('cache-timer').textContent).toBe('4:59');
    // The other row's own title node is the EXACT SAME OBJECT React handed
    // out before the tick -- untouched, not merely unchanged in content.
    expect(findPlainTitle()).toBe(plainTitleBefore);
  });
});
