/**
 * `bridgeMainErrors`: the RENDERER-side half of the ordering fix for a
 * main-process failure that can happen before any renderer exists.
 *
 * `src/main/errors/log.ts` buffers unconditionally in main, whether or not a
 * renderer is listening. `list()` (`src/preload/api.ts`'s `MainErrorsApi`)
 * always answers the WHOLE backlog, oldest first, never a delta -- so the
 * FIRST pull this file makes, on mount, recovers everything recorded before
 * this renderer existed. `subscribe`'s tick is only ever "call `list()`
 * again"; `lastId` is what keeps that second (and third, ...) pull from
 * re-recording an entry already fed into `recordFailure`.
 *
 * Every event this feeds in becomes an ordinary `LoggedEvent`
 * (`src/renderer/errors/log.ts`) -- same `recordFailure` call site every
 * renderer-originated failure already uses, so it is scrubbed by the SAME
 * gate (`src/renderer/errors/scrub.ts`, at report-composition time) with no
 * second code path to keep in sync.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { MainErrorsApi } from '../../src/preload/api.js';
import { clearEvents, loggedEvents } from '../../src/renderer/errors/log.js';
import { bridgeMainErrors } from '../../src/renderer/errors/main-errors-bridge.js';

type MainFailureEvent = { id: number; at: string; action: string; code: string; message: string };

function fakeApi(initial: MainFailureEvent[] = []) {
  let events = initial;
  const listeners = new Set<() => void>();
  return {
    api: {
      list: () => Promise.resolve(events),
      subscribe: (onChange: () => void) => {
        listeners.add(onChange);
        return () => {
          listeners.delete(onChange);
        };
      },
    } satisfies MainErrorsApi,
    setEvents(next: MainFailureEvent[]) {
      events = next;
    },
    tick() {
      for (const listener of listeners) listener();
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

const event = (id: number, message = 'm'): MainFailureEvent => ({
  id,
  at: '2024-01-01T00:00:00.000Z',
  action: 'start the remote endpoint',
  code: 'remote-port-in-use',
  message,
});

beforeEach(() => {
  clearEvents();
});

describe('bridgeMainErrors', () => {
  it('recovers a backlog recorded before this bridge ever ran -- the ordering case', async () => {
    // Main recorded these BEFORE any renderer, let alone this bridge,
    // existed -- exactly `startRemoteTransport`'s own failure, which runs
    // before `createWindow()`.
    const fake = fakeApi([event(1, 'port 58217 is taken'), event(2, 'still taken')]);

    bridgeMainErrors(fake.api);
    await Promise.resolve();
    await Promise.resolve();

    expect(loggedEvents()).toHaveLength(2);
    expect(loggedEvents().map((e) => e.message)).toContain('port 58217 is taken');
  });

  it('feeds a NEW entry on a tick without re-recording the backlog', async () => {
    const fake = fakeApi([event(1, 'first')]);
    bridgeMainErrors(fake.api);
    await Promise.resolve();
    await Promise.resolve();
    expect(loggedEvents()).toHaveLength(1);

    fake.setEvents([event(1, 'first'), event(2, 'second')]);
    fake.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(loggedEvents()).toHaveLength(2);
    expect(
      loggedEvents()
        .map((e) => e.message)
        .sort(),
    ).toEqual(['first', 'second']);
  });

  it('a tick with nothing new adds nothing', async () => {
    const fake = fakeApi([event(1, 'first')]);
    bridgeMainErrors(fake.api);
    await Promise.resolve();
    await Promise.resolve();

    fake.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(loggedEvents()).toHaveLength(1);
  });

  it('the returned cleanup unsubscribes from the api', () => {
    const fake = fakeApi([]);
    const stop = bridgeMainErrors(fake.api);
    expect(fake.listenerCount()).toBe(1);
    stop();
    expect(fake.listenerCount()).toBe(0);
  });

  it('records under the action and code the main-side event carried, so the report path sees them', async () => {
    const fake = fakeApi([
      {
        id: 1,
        at: '2024',
        action: 'set up remote access',
        code: 'remote-setup-failed',
        message: 'ENOSPC',
      },
    ]);
    bridgeMainErrors(fake.api);
    await Promise.resolve();
    await Promise.resolve();

    const [logged] = loggedEvents();
    expect(logged?.action).toBe('set up remote access');
    expect(logged?.code).toBe('remote-setup-failed');
    expect(logged?.kind).toBe('failure');
  });
});
