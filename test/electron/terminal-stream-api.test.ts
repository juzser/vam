/**
 * The Terminal tab's STREAMING preload bridge (`createTerminalStreamApi`):
 * `open`/`close`/`write` forward to their channels, and `onData`/`onSeed`
 * filter a SHARED push channel by `streamId` -- main pushes `(streamId,
 * payload)` on one channel per event kind, not one channel per open stream,
 * so a wrapper that forgot the filter would hand every open tab every other
 * tab's bytes.
 *
 * Fake `ipcRenderer` shaped like `stream-subscribe.test.ts`'s own: a plain
 * Node `EventEmitter` for `on`/`removeListener`, `invoke` faked separately.
 */

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { createTerminalStreamApi } from '../../src/preload/api.js';

function fakeIpc() {
  const emitter = new EventEmitter();
  const invoke = vi.fn().mockResolvedValue(undefined);
  return {
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      emitter.on(channel, listener);
    },
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
      emitter.removeListener(channel, listener);
    },
    invoke,
    emitData: (streamId: string, chunk: string) =>
      emitter.emit(CHANNELS.terminalStreamData, {}, streamId, chunk),
    emitSeed: (streamId: string, seed: string) =>
      emitter.emit(CHANNELS.terminalStreamSeed, {}, streamId, seed),
    emitDown: (streamId: string, event: unknown) =>
      emitter.emit(CHANNELS.terminalStreamDown, {}, streamId, event),
    listenerCount: (channel: string) => emitter.listenerCount(channel),
  };
}

describe('createTerminalStreamApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('open() forwards projectId/rowId and returns the raw result', async () => {
    const ipc = fakeIpc();
    ipc.invoke.mockResolvedValueOnce({ ok: true, streamId: 's1', seed: 'hello' });
    const api = createTerminalStreamApi(ipc);

    const result = await api.open('proj-1', 'row-1');

    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.terminalStreamOpen, 'proj-1', 'row-1');
    expect(result).toEqual({ ok: true, streamId: 's1', seed: 'hello' });
  });

  it('open() omits rowId when absent', async () => {
    const ipc = fakeIpc();
    const api = createTerminalStreamApi(ipc);

    await api.open('proj-1');

    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.terminalStreamOpen, 'proj-1');
  });

  it('close() forwards the streamId and never throws when invoke rejects', async () => {
    const ipc = fakeIpc();
    ipc.invoke.mockRejectedValueOnce(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = createTerminalStreamApi(ipc);

    expect(() => api.close('s1')).not.toThrow();
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.terminalStreamClose, 's1');
    // Let the rejection's `.catch` handler actually run before asserting on it.
    await Promise.resolve();
    await Promise.resolve();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('write() forwards streamId/bytes and never throws when invoke rejects', async () => {
    const ipc = fakeIpc();
    ipc.invoke.mockRejectedValueOnce(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = createTerminalStreamApi(ipc);
    const bytes = new Uint8Array([1, 2, 3]);

    expect(() => api.write('s1', bytes)).not.toThrow();
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.terminalStreamWrite, 's1', bytes);
    await Promise.resolve();
    await Promise.resolve();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('onData delivers a push for the matching streamId', () => {
    const ipc = fakeIpc();
    const api = createTerminalStreamApi(ipc);
    const listener = vi.fn();

    api.onData('s1', listener);
    ipc.emitData('s1', 'chunk-a');

    expect(listener).toHaveBeenCalledWith('chunk-a');
  });

  it('onData discards a push for a DIFFERENT streamId on the same channel', () => {
    const ipc = fakeIpc();
    const api = createTerminalStreamApi(ipc);
    const listener = vi.fn();

    api.onData('s1', listener);
    ipc.emitData('s2', 'someone-elses-chunk');

    expect(listener).not.toHaveBeenCalled();
  });

  it("onData's unsubscribe removes the listener and returns the listener count to baseline", () => {
    const ipc = fakeIpc();
    const api = createTerminalStreamApi(ipc);
    const listener = vi.fn();
    const before = ipc.listenerCount(CHANNELS.terminalStreamData);

    const unsubscribe = api.onData('s1', listener);
    const during = ipc.listenerCount(CHANNELS.terminalStreamData);
    ipc.emitData('s1', 'first');
    unsubscribe();
    const after = ipc.listenerCount(CHANNELS.terminalStreamData);
    ipc.emitData('s1', 'second');

    expect(before).toBe(0);
    expect(during).toBe(1);
    expect(after).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("onData's unsubscribe is idempotent: calling it twice does not throw or double-remove", () => {
    const ipc = fakeIpc();
    const api = createTerminalStreamApi(ipc);
    const other = vi.fn();
    ipc.on(CHANNELS.terminalStreamData, other);

    const unsubscribe = api.onData('s1', vi.fn());
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();

    // The other listener on the same shared channel must still be there.
    expect(ipc.listenerCount(CHANNELS.terminalStreamData)).toBe(1);
  });

  it('onSeed delivers a push for the matching streamId and discards others', () => {
    const ipc = fakeIpc();
    const api = createTerminalStreamApi(ipc);
    const listener = vi.fn();

    api.onSeed('s1', listener);
    ipc.emitSeed('s2', 'not-mine');
    ipc.emitSeed('s1', 'fresh-screen');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('fresh-screen');
  });

  it("onSeed's unsubscribe removes the listener and is idempotent", () => {
    const ipc = fakeIpc();
    const api = createTerminalStreamApi(ipc);
    const listener = vi.fn();

    const unsubscribe = api.onSeed('s1', listener);
    unsubscribe();
    ipc.emitSeed('s1', 'ignored');
    expect(() => unsubscribe()).not.toThrow();

    expect(listener).not.toHaveBeenCalled();
    expect(ipc.listenerCount(CHANNELS.terminalStreamSeed)).toBe(0);
  });

  // Review finding: onDown had NO test coverage at all before this -- every
  // test above it exercised onData/onSeed and left onDown untouched, which
  // is exactly how TerminalStreamTab.tsx's own missing subscription (a
  // second finding on the same review pass) went unnoticed: nothing in
  // this suite would have failed either way.
  it('onDown delivers the event for the matching streamId and discards others', () => {
    const ipc = fakeIpc();
    const api = createTerminalStreamApi(ipc);
    const listener = vi.fn();

    api.onDown('s1', listener);
    ipc.emitDown('s2', { kind: 'reconnecting', attempt: 1 });
    ipc.emitDown('s1', { kind: 'gave-up', reason: 'session-gone' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ kind: 'gave-up', reason: 'session-gone' });
  });

  it("onDown's unsubscribe removes the listener and is idempotent", () => {
    const ipc = fakeIpc();
    const api = createTerminalStreamApi(ipc);
    const listener = vi.fn();

    const unsubscribe = api.onDown('s1', listener);
    unsubscribe();
    ipc.emitDown('s1', { kind: 'reconnecting', attempt: 1 });
    expect(() => unsubscribe()).not.toThrow();

    expect(listener).not.toHaveBeenCalled();
    expect(ipc.listenerCount(CHANNELS.terminalStreamDown)).toBe(0);
  });
});
