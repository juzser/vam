/**
 * Wires main's own change-stream subscription to `webContents.send`.
 *
 * Main owns the transport: it opens ONE `openChangeStream` (the same parser
 * `src/shared/stream.ts` gives the browser build) against black-smith's
 * `/api/stream`, injecting its own `EventSource` implementation
 * (`./event-source.ts`), and rebroadcasts every `change` frame to the
 * renderer, payload-free (AC-18 -- the data comes back through `load()`).
 *
 * The connection is REF-COUNTED against `vam:stream:subscribe` /
 * `vam:stream:unsubscribe`: it opens on the first subscribe and closes when
 * the last one drops, rather than living for the whole process -- the
 * connection is a resource, and "unsubscribing actually unsubscribes"
 * (AC-17) is honoured all the way to the socket it started, not just the
 * renderer-side listener.
 */

import { openChangeStream } from '../../shared/stream.js';
import { CHANNELS } from '../ipc/channels.js';

export type IpcMainLike = {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
};

export type WebContentsLike = {
  send(channel: string, ...args: unknown[]): void;
};

export type RegisterStreamOptions = {
  readonly url: string;
  readonly createEventSource?: (url: string) => EventSource;
};

/**
 * Registers `vam:stream:subscribe` and `vam:stream:unsubscribe`.
 *
 * Any error opening the stream is caught here and never crosses the bridge:
 * a `node:http`/`node:https` failure can carry a hostname, a stack, or (via
 * a malformed URL) other local detail, and vam ships publicly. It is logged
 * to main's own console -- which never reaches the renderer -- and the
 * handler still resolves, with `false`, rather than reject.
 */
export function registerStreamIpc(
  ipcMain: IpcMainLike,
  webContents: WebContentsLike,
  options: RegisterStreamOptions,
): void {
  let refCount = 0;
  let stream: { close(): void } | null = null;

  ipcMain.handle(CHANNELS.streamSubscribe, () => {
    refCount += 1;
    if (stream !== null) return true;
    try {
      stream = openChangeStream({
        url: options.url,
        createEventSource: options.createEventSource,
        onChange: () => {
          webContents.send(CHANNELS.stream);
        },
      });
      return true;
    } catch (error) {
      console.error('vam: failed to open the change stream:', error);
      return false;
    }
  });

  ipcMain.handle(CHANNELS.streamUnsubscribe, () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && stream !== null) {
      stream.close();
      stream = null;
    }
    return true;
  });
}
