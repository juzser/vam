// @vitest-environment happy-dom

/**
 * THE ONE SWITCH FOR THE SIDEBAR'S CACHE-TIMER COUNTDOWN.
 *
 * The same bargain every other preference here holds: a stored value read
 * back, normalised on both sides, surviving a neighbour's write. Same
 * boolean shape as `notify.ts` and the same reason for the default -- see
 * `DEFAULT_CACHE_TIMER`'s own header.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_CACHE_TIMER, readCacheTimer } from '../../src/renderer/prefs/cache-timer.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setCacheTimer,
  setFocusView,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

function fake(initial: string | null): StorageLike & { readonly value: () => string | null } {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    value: () => value,
  };
}

const stored = (payload: Record<string, unknown>) => readPrefs(fake(JSON.stringify(payload)));

describe('the default is on -- the operator asked for it', () => {
  it('ships on, and an absent key reads as on', () => {
    expect(DEFAULT_CACHE_TIMER).toBe(true);
    expect(EMPTY_PREFS.cacheTimer).toBe(true);
    expect(stored({}).cacheTimer).toBe(true);
  });

  it('reads back a stored choice, and only a boolean is a choice', () => {
    expect(stored({ cacheTimer: false }).cacheTimer).toBe(false);
    expect(stored({ cacheTimer: true }).cacheTimer).toBe(true);
    for (const raw of ['off', 0, null, {}, [], 'false']) {
      expect(readCacheTimer(raw), JSON.stringify(raw)).toBe(DEFAULT_CACHE_TIMER);
      expect(stored({ cacheTimer: raw }).cacheTimer, JSON.stringify(raw)).toBe(DEFAULT_CACHE_TIMER);
    }
  });
});

describe('the setter', () => {
  it('normalises on the way in and touches nothing else', () => {
    const next = setCacheTimer({ ...EMPTY_PREFS, focusView: true, outFontSize: 15 }, false);
    expect(next.cacheTimer).toBe(false);
    expect(next.focusView).toBe(true);
    expect(next.outFontSize).toBe(15);
    expect(setCacheTimer(EMPTY_PREFS, 'no').cacheTimer).toBe(DEFAULT_CACHE_TIMER);
  });

  it('survives a neighbour’s write and a round trip through storage', () => {
    const storage = fake(null);
    writePrefs(storage, setFocusView(setCacheTimer(EMPTY_PREFS, false), true));
    const back = readPrefs(storage);
    expect(back.cacheTimer).toBe(false);
    expect(back.focusView).toBe(true);
  });
});
