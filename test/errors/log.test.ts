/**
 * The event log: what it records, what it refuses to call an error, and the
 * bound that keeps a long session from growing it without limit.
 *
 * The distinction this file pins hardest is vam's own: a refusal vam INTENDED
 * (close declining an interactive session vam never started) is correct
 * behaviour. It is recorded -- it is still worth seeing -- but under a
 * different kind, so that a list of failures stays a list of things that are
 * broken. Burying one real fault under twenty correct "no"s is the failure
 * mode this whole feature exists to end.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearEvents,
  EVENT_CAPACITY,
  failureEvents,
  loggedEvents,
  noteFailure,
  recordFailure,
  recordRefusal,
  subscribeEvents,
} from '../../src/renderer/errors/log.js';

beforeEach(() => {
  clearEvents();
});

describe('recordFailure', () => {
  it('records the code, the message and the action attempted', () => {
    recordFailure('close session', { code: 'cli-failed', message: 'pairing refused' });
    const [event] = loggedEvents();
    expect(event?.code).toBe('cli-failed');
    expect(event?.message).toBe('pairing refused');
    expect(event?.action).toBe('close session');
    expect(event?.kind).toBe('failure');
    expect(Number.isNaN(Date.parse(event?.at ?? ''))).toBe(false);
  });

  it('records a plain Error under a code that says the shape was unstructured', () => {
    recordFailure('load projects', new Error('socket hung up'));
    const [event] = loggedEvents();
    expect(event?.message).toBe('socket hung up');
    expect(event?.code).toBe('unknown');
  });

  it('records a thrown non-error without crashing', () => {
    recordFailure('load projects', 'boom');
    expect(loggedEvents()[0]?.message).toBe('boom');
  });
});

describe('noteFailure', () => {
  it('returns the sentence the status bar already showed, and logs on the way', () => {
    const line = noteFailure('send prompt', { code: 'session-running', message: 'busy' });
    expect(line).toBe('session-running: busy');
    expect(loggedEvents()).toHaveLength(1);
  });
});

describe('an intended refusal', () => {
  it('is not an error', () => {
    recordRefusal('close session', 'this source cannot close sessions');
    expect(failureEvents()).toHaveLength(0);
    const [event] = loggedEvents();
    expect(event?.kind).toBe('refusal');
    expect(event?.code).toBe('declined');
  });

  it('does not hide a real failure recorded beside it', () => {
    recordRefusal('close session', 'this source cannot close sessions');
    recordFailure('close session', { code: 'cli-failed', message: 'pairing refused' });
    expect(failureEvents().map((event) => event.code)).toEqual(['cli-failed']);
  });
});

describe('the ring buffer', () => {
  it('is bounded and drops the oldest', () => {
    for (let index = 0; index < EVENT_CAPACITY + 5; index += 1) {
      recordFailure('load projects', { code: `code-${index}`, message: 'x' });
    }
    const events = loggedEvents();
    expect(events).toHaveLength(EVENT_CAPACITY);
    // Newest first, and the five oldest are gone rather than merely pushed down.
    expect(events[0]?.code).toBe(`code-${EVENT_CAPACITY + 4}`);
    expect(events.map((event) => event.code)).not.toContain('code-0');
    expect(events.map((event) => event.code)).not.toContain('code-4');
  });

  it('gives every event a distinct id, so React keys survive the drop', () => {
    recordFailure('a', 'one');
    recordFailure('b', 'two');
    const ids = loggedEvents().map((event) => event.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('subscribeEvents', () => {
  it('notifies on record and stops on unsubscribe', () => {
    const listener = vi.fn();
    const stop = subscribeEvents(listener);
    recordFailure('a', 'one');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    recordFailure('b', 'two');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies on clear, so an open view empties with the log', () => {
    const listener = vi.fn();
    const stop = subscribeEvents(listener);
    clearEvents();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('persistence', () => {
  it('is deliberately absent -- the log is memory only', () => {
    recordFailure('a', 'one');
    // Nothing here writes: no storage bridge is touched, and a reload starts
    // empty. Persisting would put operator paths on disk, which is the exact
    // hazard the scrubber exists to contain on the one path that leaves.
    expect(globalThis.localStorage).toBeUndefined();
  });
});
