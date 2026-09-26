/**
 * `createNotifyApi`: the preload-side forwarder for desktop notifications
 * (`src/main/notify/ipc.ts`). `show` and `close` are plain invokes answering
 * bare; `onActivated` mirrors `createMainErrorsApi.subscribe`'s shape, with
 * a payload this time -- which session the clicked banner was about.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { createNotifyApi } from '../../src/preload/api.js';

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
    emitActivated: (payload: unknown) => emitter.emit(CHANNELS.notifyActivated, {}, payload),
    listenerCount: () => emitter.listenerCount(CHANNELS.notifyActivated),
  };
}

describe('createNotifyApi', () => {
  it('show forwards the request to vam:notify:show and answers its boolean', async () => {
    const ipc = fakeIpc();
    const request = { sourceId: 'claude-code', sessionId: 's1', title: 't', body: 'b' };
    expect(await createNotifyApi(ipc).show(request)).toBe(true);
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.notifyShow, request);
  });

  it('close forwards the target to vam:notify:close', async () => {
    const ipc = fakeIpc();
    await createNotifyApi(ipc).close({ sourceId: 'claude-code', sessionId: 's1' });
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.notifyClose, {
      sourceId: 'claude-code',
      sessionId: 's1',
    });
  });

  it('test asks vam:notify:test with no argument and answers the verdict', async () => {
    const ipc = fakeIpc();
    ipc.invoke.mockResolvedValueOnce({ kind: 'failed', reason: 'no' });
    expect(await createNotifyApi(ipc).test()).toEqual({ kind: 'failed', reason: 'no' });
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.notifyTest);
  });

  it('onActivated delivers the target and unsubscribes with the same reference', () => {
    const ipc = fakeIpc();
    const seen = vi.fn();
    const stop = createNotifyApi(ipc).onActivated(seen);
    ipc.emitActivated({ sourceId: 'claude-code', sessionId: 's1' });
    expect(seen).toHaveBeenCalledWith({ sourceId: 'claude-code', sessionId: 's1' });
    expect(ipc.listenerCount()).toBe(1);
    stop();
    expect(ipc.listenerCount()).toBe(0);
  });
});
