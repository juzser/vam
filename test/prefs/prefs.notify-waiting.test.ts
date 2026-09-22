// @vitest-environment happy-dom

/**
 * THE ONE NOTIFICATION SWITCH, and why it is only one.
 *
 * The same bargain every other preference here holds: a stored value read
 * back, normalised on both sides, surviving a neighbour's write. Deliberately
 * NOT here, and not coming: per-session mute, a per-status pick, a sound,
 * quiet hours, snooze. The OS owns sound and Do Not Disturb, and the operator
 * has already deleted one settings block for being unnecessary
 * (`prefs/tab-indicators.ts`).
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFY_WAITING, readNotifyWaiting } from '../../src/renderer/prefs/notify.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setFocusView,
  setNotifyWaiting,
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

describe('the default is on, because missing the moment is the complaint', () => {
  it('ships on, and an absent key reads as on', () => {
    expect(DEFAULT_NOTIFY_WAITING).toBe(true);
    expect(EMPTY_PREFS.notifyWaiting).toBe(true);
    expect(stored({}).notifyWaiting).toBe(true);
  });

  it('reads back a stored choice, and only a boolean is a choice', () => {
    expect(stored({ notifyWaiting: false }).notifyWaiting).toBe(false);
    expect(stored({ notifyWaiting: true }).notifyWaiting).toBe(true);
    for (const raw of ['off', 0, null, {}, [], 'false']) {
      expect(readNotifyWaiting(raw), JSON.stringify(raw)).toBe(DEFAULT_NOTIFY_WAITING);
      expect(stored({ notifyWaiting: raw }).notifyWaiting, JSON.stringify(raw)).toBe(
        DEFAULT_NOTIFY_WAITING,
      );
    }
  });
});

describe('the setter', () => {
  it('normalises on the way in and touches nothing else', () => {
    const next = setNotifyWaiting({ ...EMPTY_PREFS, focusView: true, outFontSize: 15 }, false);
    expect(next.notifyWaiting).toBe(false);
    expect(next.focusView).toBe(true);
    expect(next.outFontSize).toBe(15);
    expect(setNotifyWaiting(EMPTY_PREFS, 'no').notifyWaiting).toBe(DEFAULT_NOTIFY_WAITING);
  });

  it('survives a neighbour’s write and a round trip through storage', () => {
    const storage = fake(null);
    writePrefs(storage, setFocusView(setNotifyWaiting(EMPTY_PREFS, false), true));
    const back = readPrefs(storage);
    expect(back.notifyWaiting).toBe(false);
    expect(back.focusView).toBe(true);
  });
});
