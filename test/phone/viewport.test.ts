// @vitest-environment happy-dom
/**
 * The breakpoint, and the fallback that keeps every other test on the desktop.
 *
 * The second half is the load-bearing one: `usePhoneViewport` answering `false`
 * where there is no `matchMedia` is what lets a whole second shell land without
 * a single edit to the 150-odd test files that render the columns.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PHONE_MAX_WIDTH,
  PHONE_QUERY,
  usePhoneViewport,
} from '../../src/renderer/phone/viewport.js';
import { DETAIL_MIN, SIDEBAR_MIN } from '../../src/renderer/prefs/panes.js';

type Listener = () => void;

/** A `matchMedia` whose one query can be flipped, with its listeners counted. */
function stubMatchMedia(matches: boolean) {
  const listeners: Listener[] = [];
  let current = matches;
  const query = {
    get matches() {
      return current;
    },
    addEventListener: (_: string, fn: Listener) => {
      listeners.push(fn);
    },
    removeEventListener: (_: string, fn: Listener) => {
      const at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
  const seen: string[] = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => {
      seen.push(q);
      return query;
    },
  });
  return {
    seen,
    listeners,
    flip(next: boolean) {
      current = next;
      for (const fn of [...listeners]) fn();
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('the phone breakpoint', () => {
  it('is derived from the two pane floors, not typed out', () => {
    expect(PHONE_MAX_WIDTH).toBe(SIDEBAR_MIN + DETAIL_MIN - 1);
    expect(PHONE_QUERY).toBe(`(max-width: ${SIDEBAR_MIN + DETAIL_MIN - 1}px)`);
  });

  it('is false where there is no matchMedia, so jsdom keeps the desktop shell', () => {
    Reflect.deleteProperty(window, 'matchMedia');
    const { result } = renderHook(() => usePhoneViewport());
    expect(result.current).toBe(false);
  });

  it('reads the phone query and tracks its changes', () => {
    const media = stubMatchMedia(true);
    const { result } = renderHook(() => usePhoneViewport());
    expect(media.seen).toContain(PHONE_QUERY);
    expect(result.current).toBe(true);

    act(() => media.flip(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes when it unmounts', () => {
    const media = stubMatchMedia(true);
    const { unmount } = renderHook(() => usePhoneViewport());
    expect(media.listeners).toHaveLength(1);
    unmount();
    expect(media.listeners).toHaveLength(0);
  });
});
