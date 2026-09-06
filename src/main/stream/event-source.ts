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

/**
 * The most we will hold for a single unterminated frame. Real frames here are
 * a session-id list; this is orders of magnitude above them and still small
 * enough that a hostile or broken endpoint cannot exhaust main.
 */
const MAX_BUFFER_CHARS = 1_000_000;

/** How long to wait before reconnecting after the stream ends or errors. */
const RECONNECT_MS = 3_000;

/** The exact surface `openChangeStream` calls on what `createEventSource` returns. */
export type MinimalEventSource = {
  addEventListener(type: string, listener: FrameListener): void;
  close(): void;
};

/**
 * `reconnectMs` overrides `RECONNECT_MS` for tests only -- production never
 * passes it. It exists so a reconnect test can assert on REACHING the retry
 * rather than on its wall-clock timing: this machine has been measured
 * stretching an 11ms operation past five seconds under load, so a bound
 * tuned to the typical delay would flake.
 */
export function createNodeEventSource(
  url: string,
  options?: { readonly reconnectMs?: number },
): MinimalEventSource {
  const reconnectMs = options?.reconnectMs ?? RECONNECT_MS;
  const listeners = new Map<string, Set<FrameListener>>();
  let closed = false;
  let buffer = '';
  // Set when a chunk ended with CR, so a LF opening the next chunk is read as
  // the second half of one CRLF rather than a second line break.
  let skipLeadingLf = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentReq: ReturnType<typeof httpRequest> | null = null;
  // Guards a single connection attempt against dispatching more than one
  // `error` / reconnect for one drop: a mid-stream reset can fire several of
  // `end`/`error`/`aborted`/`close` for the SAME failure. Reset at the top of
  // each `connect()`, so the NEXT attempt's failure is still reported.
  let failureHandled = false;

  const dispatch = (type: string, data: string | undefined) => {
    for (const listener of listeners.get(type) ?? []) {
      listener({ data });
    }
  };

  // The single funnel for "this connection attempt has failed" -- whether
  // that surfaced as the response ending, a request-level error, a
  // mid-stream reset landing on the response, or the buffer cap tripping.
  // Guarded by `failureHandled` so a reset that fires more than one of
  // those events still produces exactly one `error` dispatch and exactly
  // one scheduled reconnect (the existing `reconnectTimer !== null` guard on
  // `scheduleReconnect` only covers the SECOND part of that).
  const handleFailure = () => {
    if (closed || failureHandled) return;
    failureHandled = true;
    dispatch('error', undefined);
    scheduleReconnect();
  };

  // Frames are separated by a blank line; within a frame, `event:` names it
  // (default `message`) and one or more `data:` lines carry the payload.
  //
  // The spec permits a line to end with CRLF, LF **or** a lone CR, so the wire
  // is normalised to LF before any boundary search. Searching for '\n\n'
  // directly is what a CRLF server defeats: its separator is '\r\n\r\n',
  // which never matches, so every frame is dropped in silence and the buffer
  // grows for the life of the connection. The browser's own EventSource
  // handles all three, and this adapter is the other half of "two transports,
  // one port" -- they have to agree on the wire, not just on the port.
  //
  // A CRLF pair split across two chunks would otherwise normalise to two LFs
  // and fabricate a frame boundary. Holding the trailing CR back instead is
  // worse: a CR-terminated final line would then wait for a chunk that may
  // never come. So the CR is translated immediately and a LEADING LF in the
  // next chunk is swallowed as the other half of that pair.
  const consume = (raw: string) => {
    let text = raw;
    if (skipLeadingLf && text.startsWith('\n')) {
      text = text.slice(1);
    }
    skipLeadingLf = text.endsWith('\r');
    buffer += text.replace(/\r\n|\r/g, '\n');
    // An endpoint that never sends a blank line would otherwise grow this
    // without limit inside MAIN -- unsandboxed, hosting every window. Drop the
    // connection instead; the reconnect path gives it a clean start.
    if (buffer.length > MAX_BUFFER_CHARS) {
      buffer = '';
      currentReq?.destroy();
      currentReq = null;
      handleFailure();
      return;
    }
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
    }, reconnectMs);
    reconnectTimer.unref?.();
  };

  function connect(): void {
    if (closed) return;
    failureHandled = false;
    const client = url.startsWith('https:') ? httpsRequest : httpRequest;
    const req = client(url, { headers: { accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', consume);
      // A response that completes normally (`end`) is itself abnormal for
      // SSE, which never ends on its own -- treated as a failure, same as
      // today. `error` and `aborted` cover a reset the request/response
      // pair itself reports. `close` is the catch-all: Node's own docs note
      // a peer that resets the connection AFTER headers were sent can fire
      // `close` on the response with none of `end`/`error`/`aborted` --
      // exactly the corner this fixes. All four funnel into the same
      // once-per-attempt guard.
      res.on('end', handleFailure);
      res.on('error', handleFailure);
      res.on('aborted', handleFailure);
      res.on('close', handleFailure);
    });
    req.on('error', handleFailure);
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
