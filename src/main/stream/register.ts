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
/**
 * How long an idle stream stays open after its last subscriber leaves.
 *
 * Bounds connection churn: without it, a compromised renderer driving
 * subscribe/unsubscribe in a loop makes the privileged main process open and
 * tear down a real connection per cycle, at IPC speed, against whatever host
 * the stream URL names.
 */
export const CLOSE_LINGER_MS = 1_000;

export function registerStreamIpc(
  ipcMain: IpcMainLike,
  webContents: WebContentsLike,
  options: RegisterStreamOptions,
): void {
  let refCount = 0;
  let stream: { close(): void } | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  ipcMain.handle(CHANNELS.streamSubscribe, () => {
    refCount += 1;
    // A pending close means the stream is still open and was about to be
    // dropped; the new subscriber cancels that and reuses it.
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
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
    if (refCount === 0 && stream !== null && closeTimer === null) {
      // Linger rather than close at once. The renderer is the untrusted side
      // and main is the privileged one, so closing on the instant lets the
      // renderer set the rate at which main makes outbound connections: a
      // subscribe/unsubscribe loop becomes a connect/destroy loop against
      // whatever host the stream URL names, at IPC speed. The linger bounds
      // that to one connection per window no matter how fast it is driven.
      //
      // It also removes a real reconnect: a component remounting (React
      // StrictMode does exactly this) unsubscribes and resubscribes within
      // milliseconds, and used to drop and rebuild the socket every time.
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (refCount === 0 && stream !== null) {
          stream.close();
          stream = null;
        }
      }, CLOSE_LINGER_MS);
      closeTimer.unref?.();
    }
    return true;
  });
}
