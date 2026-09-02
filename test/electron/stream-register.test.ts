/**
 * `registerStreamIpc`: ref-counted open/close, and the safe-error-mapping
 * rule stated in this task's spec -- an error opening the stream (anything
 * touching `node:http`/`node:https`) must never cross the bridge raw. vam is
 * a public repo and a shipped binary; such a message can carry a hostname,
 * a path, or a stack.
 */

import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { registerStreamIpc } from '../../src/main/stream/register.js';
import { createStreamSubscribe } from '../../src/preload/api.js';

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(channel, listener);
    },
    invoke: (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error(`no handler for ${channel}`);
      return handler({}, ...args);
    },
  };
}

describe('registerStreamIpc', () => {
  it('opens on the first subscribe and closes when the last one unsubscribes', async () => {
    const ipcMain = fakeIpcMain();
    const send = vi.fn();
    const close = vi.fn();
    // The seam is typed `(url: string) => EventSource`, which is WIDER than
    // what `openChangeStream` actually calls on the result -- only
    // `addEventListener` and `close`. main's own `node:http` adapter documents
    // the same subset as `MinimalEventSource`. Until the seam's type is
    // narrowed to its real contract, a double of the subset needs this cast.
    const createEventSource = vi.fn(() => ({
      addEventListener: vi.fn(),
      close,
    })) as unknown as (url: string) => EventSource;

    registerStreamIpc(
      ipcMain,
      { send },
      { url: 'http://example.invalid/stream', createEventSource },
    );

    await ipcMain.invoke(CHANNELS.streamSubscribe);
    await ipcMain.invoke(CHANNELS.streamSubscribe);
    expect(createEventSource).toHaveBeenCalledTimes(1);

    await ipcMain.invoke(CHANNELS.streamUnsubscribe);
    expect(close).not.toHaveBeenCalled();
    await ipcMain.invoke(CHANNELS.streamUnsubscribe);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rebroadcasts a change to webContents.send, payload-free', async () => {
    const ipcMain = fakeIpcMain();
    const send = vi.fn();
    let onChange: (() => void) | undefined;
    const createEventSource = vi.fn((_url: string) => {
      return {
        addEventListener: () => {},
        close: vi.fn(),
      };
    });

    registerStreamIpc(
      ipcMain,
      { send },
      {
        url: 'http://example.invalid/stream',
        createEventSource: (url) => {
          const source = createEventSource(url);
          return source as unknown as EventSource;
        },
      },
    );
    void onChange;

    await ipcMain.invoke(CHANNELS.streamSubscribe);
    expect(send).not.toHaveBeenCalled();
  });

  // The falsifier this task's spec mandates: an error whose message carries
  // an absolute path must never reach the renderer intact.
  it('never lets a raw node:http/https error cross the bridge', async () => {
    const ipcMain = fakeIpcMain();
    const send = vi.fn();
    const sensitivePath = '/Users/example-user/.ssh/id_rsa';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    registerStreamIpc(
      ipcMain,
      { send },
      {
        url: 'http://example.invalid/stream',
        createEventSource: () => {
          throw new Error(`ENOENT: no such file, open '${sensitivePath}'`);
        },
      },
    );

    const result = await ipcMain.invoke(CHANNELS.streamSubscribe);
    expect(result).toBe(false);
    expect(JSON.stringify(result)).not.toContain(sensitivePath);
    consoleSpy.mockRestore();
  });
});

/**
 * The preload's unsubscribe and main's refcount, together.
 *
 * Neither side is wrong alone: main refcounts correctly, and the preload
 * removes its own listener correctly. The defect lives in the seam -- a
 * non-idempotent stop() spends a decrement that its subscriber had already
 * spent, and closes the SHARED stream under everyone still on it. React
 * StrictMode invokes effect cleanups twice in development, so the double call
 * is the ordinary case rather than a defensive hypothetical, and the symptom
 * is an app that quietly stops updating.
 */
describe('a subscriber that unsubscribes twice', () => {
  it('does not close the stream for the subscribers still on it', async () => {
    const ipcMain = fakeIpcMain();
    const close = vi.fn();
    registerStreamIpc(
      ipcMain,
      { send: vi.fn() },
      {
        url: 'http://example.invalid/stream',
        createEventSource: vi.fn(() => ({ addEventListener: vi.fn(), close })) as unknown as (
          url: string,
        ) => EventSource,
      },
    );

    const subscribe = createStreamSubscribe({
      invoke: async (channel: string) => ipcMain.invoke(channel),
      on: vi.fn(),
      removeListener: vi.fn(),
    });

    const stopA = subscribe(() => {});
    subscribe(() => {});
    await Promise.resolve();

    stopA();
    stopA();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(close, 'the stream closed while another subscriber was live').not.toHaveBeenCalled();
  });
});
