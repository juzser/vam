import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { createUpdateApi } from '../../src/preload/api.js';
import type { UpdateStatus } from '../../src/shared/update.js';

function fakeIpc() {
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
  return {
    invoke: vi.fn(async (_channel: string, ..._args: unknown[]): Promise<unknown> => 'answer'),
    on: vi.fn((channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
    }),
    removeListener: vi.fn((channel: string, listener: (event: unknown) => void) => {
      listeners.get(channel)?.delete(listener);
    }),
    emit: (channel: string, ...args: unknown[]) => {
      for (const l of listeners.get(channel) ?? []) l({}, ...args);
    },
    count: (channel: string) => listeners.get(channel)?.size ?? 0,
  };
}

describe('createUpdateApi', () => {
  it('forwards each call to its channel, answering bare', async () => {
    const ipc = fakeIpc();
    const api = createUpdateApi(ipc);
    expect(await api.getStatus()).toBe('answer');
    expect(await api.check()).toBe('answer');
    expect(await api.download()).toBe('answer');
    expect(await api.dismiss()).toBe('answer');
    expect(await api.getAutoCheck()).toBe('answer');
    expect(await api.setAutoCheck(false)).toBe('answer');
    expect(await api.openNotes()).toBe('answer');
    expect(ipc.invoke.mock.calls).toEqual([
      [CHANNELS.updateGetStatus],
      [CHANNELS.updateCheck],
      [CHANNELS.updateDownload],
      [CHANNELS.updateDismiss],
      [CHANNELS.updateGetAutoCheck],
      [CHANNELS.updateSetAutoCheck, false],
      [CHANNELS.updateOpen],
    ]);
  });

  it('onStatus delivers pushed statuses and unsubscribes with the same reference', () => {
    const ipc = fakeIpc();
    const api = createUpdateApi(ipc);
    const seen: UpdateStatus[] = [];
    const off = api.onStatus((s) => seen.push(s));
    ipc.emit(CHANNELS.updateStatusChanged, { kind: 'idle' });
    expect(seen).toEqual([{ kind: 'idle' }]);
    off();
    expect(ipc.count(CHANNELS.updateStatusChanged)).toBe(0);
    ipc.emit(CHANNELS.updateStatusChanged, { kind: 'idle' });
    expect(seen).toHaveLength(1);
  });
});
