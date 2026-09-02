/**
 * AC-17/AC-18/AC-19: `subscribe`'s preload-side implementation, tested
 * against a fake `ipcRenderer` shaped exactly like the real one -- a plain
 * Node `EventEmitter` for `on`/`removeListener`, and `listenerCount` to prove
 * the leak criterion (AC-17) directly: a listener that survives its
 * unsubscribe is a listener count that never returns to baseline.
 *
 * `invoke` is faked separately (not through the emitter) since the real
 * `ipcRenderer.invoke` is request/response, not an event.
 */

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { createStreamSubscribe } from '../../src/preload/api.js';

function fakeIpc() {
  const emitter = new EventEmitter();
  const invoke = vi.fn().mockResolvedValue(true);
  return {
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      emitter.on(channel, listener);
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
      emitter.removeListener(channel, listener);
    },
    invoke,
    emitChange: () => emitter.emit(CHANNELS.stream, {}),
    listenerCount: () => emitter.listenerCount(CHANNELS.stream),
  };
}

describe('createStreamSubscribe (AC-17, AC-18, AC-19)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers exactly one tick per change, and the tick carries no argument', () => {
    const ipc = fakeIpc();
    const onChange = vi.fn();
    const subscribe = createStreamSubscribe(ipc);

    subscribe(onChange);
    ipc.emitChange();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith();
  });

  it('tells main it is interested, over vam:stream:subscribe', () => {
    const ipc = fakeIpc();
    const subscribe = createStreamSubscribe(ipc);

    subscribe(vi.fn());

    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.streamSubscribe);
  });

  // AC-17's core claim: after unsubscribe, a second change delivers NONE, and
  // the channel's listener count returns to its pre-subscribe value -- not
  // merely "no more calls observed", which a leaked-but-inert listener would
  // also satisfy by accident.
  it('unsubscribing stops delivery and returns the listener count to baseline', () => {
    const ipc = fakeIpc();
    const onChange = vi.fn();
    const before = ipc.listenerCount();

    const unsubscribe = createStreamSubscribe(ipc)(onChange);
    const during = ipc.listenerCount();
    ipc.emitChange();
    unsubscribe();
    const after = ipc.listenerCount();
    ipc.emitChange();

    expect(before).toBe(0);
    expect(during).toBe(1);
    expect(after).toBe(before);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.streamUnsubscribe);
  });

  // AC-19, negatively: the wrong idiom -- handing the renderer's OWN callback
  // straight to `ipcRenderer.on`/`removeListener` instead of a preload-side
  // closure -- happens to still remove correctly in THIS fake (a plain
  // EventEmitter matches by reference either way), but is exactly the shape
  // AC-19 forbids. The real falsifier (api.ts's unsubscribe rebuilt to pass
  // `onChange` straight to `removeListener` while `on` was given a distinct
  // wrapping closure, matching real electron's context-bridge proxy losing
  // identity) is captured as an artifact rather than kept as a permanent
  // test, per the task's "capture that run" instruction -- a temporarily
  // broken implementation is not something a regression suite should hold.
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

    const unsubscribe = createStreamSubscribe(wrapped)(vi.fn());
    unsubscribe();

    expect(seen.removed).toBe(seen.on);
  });
});
