/**
 * The phone's back gesture, as three functions over a history-shaped object.
 *
 * No DOM here on purpose: the rule is "one entry per opened session, and the
 * chevron leaves none behind", and that is arithmetic on pushes and backs.
 */

import { describe, expect, it } from 'vitest';
import {
  closeSession,
  isSessionEntry,
  openSession,
  PHONE_HISTORY_MARK,
} from '../../src/renderer/phone/history.js';

function spyHistory() {
  const pushed: unknown[] = [];
  let backs = 0;
  return {
    pushed,
    get backs() {
      return backs;
    },
    history: {
      pushState: (data: unknown) => {
        pushed.push(data);
      },
      back: () => {
        backs += 1;
      },
    },
  };
}

describe('the phone back gesture', () => {
  it('pushes one marked entry when a session opens', () => {
    const spy = spyHistory();
    openSession(spy.history);
    expect(spy.pushed).toHaveLength(1);
    expect(isSessionEntry(spy.pushed[0])).toBe(true);
  });

  it('reads only its own entry as a session entry', () => {
    expect(isSessionEntry(null)).toBe(false);
    expect(isSessionEntry({ other: true })).toBe(false);
    expect(isSessionEntry({ [PHONE_HISTORY_MARK]: false })).toBe(false);
  });

  it('leaves no entry behind when the chevron closes the screen', () => {
    const spy = spyHistory();
    openSession(spy.history);
    closeSession(spy.history, true);
    expect(spy.backs).toBe(1);
  });

  it('does not go back a second time when the gesture already popped', () => {
    const spy = spyHistory();
    openSession(spy.history);
    // popstate has already fired: the entry is gone, and a `back()` here would
    // walk out of the app entirely.
    closeSession(spy.history, false);
    expect(spy.backs).toBe(0);
  });
});
