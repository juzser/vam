/**
 * `createMainErrorsApi`: the preload-side forwarder for main's own failure
 * buffer (`src/main/errors/log.ts`, over `src/main/errors/ipc.ts`).
 *
 * `list()` is a plain `invoke` -- no `unwrap`, because `vam:errors:get`
 * answers bare (see `src/main/errors/ipc.ts`). `subscribe` mirrors
 * `createStreamSubscribe`'s shape (AC-19's closure-identity rule applies
 * here too: `on` and `removeListener` must be given the SAME reference), but
 * it does not ALSO tell main anything -- unlike the change stream, there is
 * no resource on main's side to open or close per subscriber.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { createMainErrorsApi } from '../../src/preload/api.js';

function fakeIpc() {
  const emitter = new EventEmitter();
  const invoke = vi.fn().mockResolvedValue([]);
  return {
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      emitter.on(channel, listener);
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
      emitter.removeListener(channel, listener);
    },
    invoke,
    emitChanged: () => emitter.emit(CHANNELS.mainErrorsChanged),
    listenerCount: () => emitter.listenerCount(CHANNELS.mainErrorsChanged),
  };
}

describe('createMainErrorsApi', () => {
  it('list() forwards straight to vam:errors:get', async () => {
    const ipc = fakeIpc();
    ipc.invoke.mockResolvedValue([{ id: 1, at: '2024', action: 'a', code: 'c', message: 'm' }]);
    const api = createMainErrorsApi(ipc);

    const events = await api.list();

    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.mainErrorsGet);
    expect(events).toEqual([{ id: 1, at: '2024', action: 'a', code: 'c', message: 'm' }]);
  });

  it('delivers a payload-free tick on vam:errors:changed', () => {
    const ipc = fakeIpc();
    const onChange = vi.fn();
    const api = createMainErrorsApi(ipc);

    api.subscribe(onChange);
    ipc.emitChanged();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith();
  });

  it('unsubscribing returns the listener count to baseline', () => {
    const ipc = fakeIpc();
    const before = ipc.listenerCount();

    const stop = createMainErrorsApi(ipc).subscribe(vi.fn());
    const during = ipc.listenerCount();
    stop();
    const after = ipc.listenerCount();

    expect(before).toBe(0);
    expect(during).toBe(1);
    expect(after).toBe(0);
  });

  it('the closure passed to on() is the SAME reference passed to removeListener()', () => {
    const ipc = fakeIpc();
    const seen: { on?: unknown; removed?: unknown } = {};
    const wrapped = {
      on: (channel: string, listener: unknown) => {
        seen.on = listener;
        ipc.on(channel, listener as (...args: unknown[]) => void);
      },
      removeListener: (channel: string, listener: unknown) => {
        seen.removed = listener;
        ipc.removeListener(channel, listener as (...args: unknown[]) => void);
      },
      invoke: ipc.invoke,
    };

    const stop = createMainErrorsApi(wrapped).subscribe(vi.fn());
    stop();

    expect(seen.removed).toBe(seen.on);
  });
});
