/**
 * A minimal server-sent-events client over `node:http`/`node:https`.
 *
 * It satisfies exactly the subset of the DOM `EventSource` that
 * `src/shared/stream.ts`'s `createEventSource` seam needs:
 * `addEventListener('hello' | 'change' | 'error', listener)` and `close()`.
 * Nothing else -- no `readyState`, no `onmessage`, no `withCredentials`.
 *
 * It exists because Electron's main process has no global `EventSource`.
 * That is a MEASUREMENT, and it is re-taken on every harness run rather than
 * recorded here once: `test/electron/probe.cjs` runs in main and reports
 * `typeof EventSource`, and `launch.test.ts` asserts it is `undefined`. Plain
 * `node` is a different runtime and would be the wrong process to ask.
 *
 * So if a future Electron ships a global `EventSource`, that test fails and
 * someone reconsiders this file, instead of it outliving its own reason.
 *
 * The browser build never imports this file; it keeps the DOM's own
 * `EventSource` through `stream.ts`'s own default.
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

type FrameListener = (event: { readonly data?: string }) => void;

/** How long to wait before reconnecting after the stream ends or errors. */
const RECONNECT_MS = 3_000;

/** The exact surface `openChangeStream` calls on what `createEventSource` returns. */
export type MinimalEventSource = {
  addEventListener(type: string, listener: FrameListener): void;
  close(): void;
};

export function createNodeEventSource(url: string): MinimalEventSource {
  const listeners = new Map<string, Set<FrameListener>>();
  let closed = false;
  let buffer = '';
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentReq: ReturnType<typeof httpRequest> | null = null;

  const dispatch = (type: string, data: string | undefined) => {
    for (const listener of listeners.get(type) ?? []) {
      listener({ data });
    }
  };

  // Frames are separated by a blank line; within a frame, `event:` names it
  // (default `message`) and one or more `data:` lines carry the payload.
  const consume = (chunk: string) => {
    buffer += chunk;
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let eventType = 'message';
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) {
          eventType = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
        }
      }
      if (dataLines.length > 0) {
        dispatch(eventType, dataLines.join('\n'));
      }
      boundary = buffer.indexOf('\n\n');
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
    reconnectTimer.unref?.();
  };

  function connect(): void {
    if (closed) return;
    const client = url.startsWith('https:') ? httpsRequest : httpRequest;
    const req = client(url, { headers: { accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', consume);
      res.on('end', () => {
        if (!closed) {
          dispatch('error', undefined);
          scheduleReconnect();
        }
      });
    });
    req.on('error', () => {
      if (!closed) {
        dispatch('error', undefined);
        scheduleReconnect();
      }
    });
    // The connection is long-lived by design (SSE never completes on its
    // own); `unref` keeps it from being the reason the process can't exit --
    // main's own quit sequence, not an idle socket, decides that.
    req.on('socket', (socket) => socket.unref());
    req.end();
    currentReq = req;
  }

  connect();

  return {
    addEventListener(type: string, listener: FrameListener) {
      const set = listeners.get(type) ?? new Set<FrameListener>();
      set.add(listener);
      listeners.set(type, set);
    },
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      currentReq?.destroy();
      currentReq = null;
    },
  };
}
