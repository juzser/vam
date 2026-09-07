/**
 * MAIN's own failure buffer -- the backlog half of the ordering fix.
 *
 * A main-process startup failure (the remote endpoint refusing to bind, most
 * often) can happen before any renderer exists to receive a push: main
 * attempts it before `createWindow()` runs. `recordMainFailure` must work
 * with zero listeners -- the record itself must never depend on anyone being
 * subscribed yet -- and `mainFailures()` must hand back everything recorded
 * so far, in order, whenever it is finally asked. That is what lets a late
 * subscriber recover a backlog it was not present for.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPACITY,
  clearMainFailures,
  mainFailures,
  recordMainFailure,
  subscribeMainFailures,
} from '../../../src/main/errors/log.js';

beforeEach(() => {
  clearMainFailures();
});

describe('recordMainFailure', () => {
  it('records the action, the code and the message', () => {
    recordMainFailure('start the remote endpoint', 'remote-port-in-use', 'port 58217 is taken');
    const [event] = mainFailures();
    expect(event?.action).toBe('start the remote endpoint');
    expect(event?.code).toBe('remote-port-in-use');
    expect(event?.message).toBe('port 58217 is taken');
    expect(Number.isNaN(Date.parse(event?.at ?? ''))).toBe(false);
  });

  it('works with nobody subscribed yet -- the backlog case', () => {
    // No `subscribeMainFailures` call anywhere above this line: this is the
    // exact shape of a failure recorded before `createWindow()` has run.
    expect(() =>
      recordMainFailure('start the remote endpoint', 'remote-bind-failed', 'EACCES'),
    ).not.toThrow();
    expect(mainFailures()).toHaveLength(1);
  });

  it('gives every event a distinct, increasing id', () => {
    recordMainFailure('a', 'code-a', 'one');
    recordMainFailure('b', 'code-b', 'two');
    const [first, second] = mainFailures();
    expect(first?.id).toBeLessThan(second?.id ?? 0);
  });

  it('keeps insertion order -- oldest first, unlike the renderer log', () => {
    recordMainFailure('a', 'code-a', 'one');
    recordMainFailure('b', 'code-b', 'two');
    expect(mainFailures().map((event) => event.code)).toEqual(['code-a', 'code-b']);
  });
});

describe('the bound', () => {
  it('is bounded and drops the oldest', () => {
    for (let index = 0; index < CAPACITY + 5; index += 1) {
      recordMainFailure('a', `code-${index}`, 'x');
    }
    const events = mainFailures();
    expect(events).toHaveLength(CAPACITY);
    expect(events.map((event) => event.code)).not.toContain('code-0');
    expect(events[events.length - 1]?.code).toBe(`code-${CAPACITY + 4}`);
  });
});

describe('subscribeMainFailures', () => {
  it('notifies on record and stops on unsubscribe', () => {
    const listener = vi.fn();
    const stop = subscribeMainFailures(listener);
    recordMainFailure('a', 'code-a', 'one');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    recordMainFailure('b', 'code-b', 'two');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('mainFailures', () => {
  it('returns a live read, not a stale snapshot from before clearMainFailures', () => {
    recordMainFailure('a', 'code-a', 'one');
    clearMainFailures();
    expect(mainFailures()).toHaveLength(0);
  });
});
