/**
 * A peer that resets the connection AFTER the SSE headers have been sent
 * fires neither `end` on the response nor `error` on the request -- once the
 * response has begun, the failure surfaces on the response object itself,
 * which `connect()` left unlistened. `registerStreamIpc` has already
 * returned by then, so nothing else notices: the canvas silently stops
 * updating for the life of the process.
 *
 * The reconnect delay is injected here (a real, if unused-in-production,
 * parameter of `createNodeEventSource`) rather than asserted against real
 * wall-clock margins: this machine has been measured stretching an 11ms
 * operation past five seconds under load, so a bound tuned to the typical
 * case flakes. Draining the injected delay to near-zero lets every
 * assertion below be "did a second request arrive" rather than "did it
 * arrive within some duration".
 */
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeEventSource } from '../../src/main/stream/event-source.js';

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

/** A server that writes SSE headers, then destroys the socket mid-stream on every request. */
function serveMidStreamReset(): Promise<{ url: string; requestCount: () => number }> {
  let count = 0;
  return new Promise((resolve) => {
    const created = createServer((_req, res) => {
      count += 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': connected\n\n');
      // A delay lets the client actually read the flushed data before the
      // reset, which is what puts the failure on the RESPONSE (`error`,
      // no `end`) rather than on the request -- an immediate destroy() with
      // unread bytes still buffered surfaces as `req.on('error')`, which the
      // pre-fix code already handled and would make this test pass for the
      // wrong reason.
      setTimeout(() => res.socket?.destroy(), 20);
    });
    server = created;
    created.listen(0, '127.0.0.1', () => {
      const { port } = created.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}/`, requestCount: () => count });
    });
  });
}

describe('a mid-stream connection reset (headers sent, then destroyed)', () => {
  it('reconnects instead of going silent', async () => {
    const { url, requestCount } = await serveMidStreamReset();
    const source = createNodeEventSource(url, { reconnectMs: 5 });
    try {
      await expect
        .poll(() => requestCount(), { timeout: 8000, interval: 20 })
        .toBeGreaterThanOrEqual(2);
    } finally {
      source.close();
    }
  }, 10000);

  it('dispatches exactly one error per reset, not one per listener firing', async () => {
    const { url, requestCount } = await serveMidStreamReset();
    const source = createNodeEventSource(url, { reconnectMs: 30 });
    const errors: unknown[] = [];
    source.addEventListener('error', (event) => errors.push(event));
    try {
      // A count read at one instant against a count read at another is
      // racy by construction -- so this does not compare two independent
      // reads taken moments apart. It instead uses an ordering guarantee
      // that holds regardless of how much the machine stretches wall time:
      // `scheduleReconnect` only arms a timer, and that timer can only fire
      // in a LATER turn of the event loop. Every listener a single socket
      // teardown can fire (`end`/`error`/`aborted`/`close`) is emitted (or
      // `process.nextTick`-deferred from) the SAME synchronous origin, and
      // Node fully drains the `nextTick` queue before advancing the loop to
      // the next timers phase. So by the moment request N is observed, the
      // (N-1)th reset's failure has been *completely* processed -- every
      // one of its listener firings already happened -- with NO possible
      // straggler still in flight. `requestCount` and `errors.length` are
      // therefore read together, synchronously, with no `await` between
      // them: nothing else can run in that gap to change either number.
      let seenRequests = 0;
      await expect
        .poll(
          () => {
            seenRequests = requestCount();
            return seenRequests;
          },
          { timeout: 8000, interval: 5 },
        )
        .toBeGreaterThanOrEqual(4);
      expect(errors.length).toBe(seenRequests - 1);
    } finally {
      source.close();
    }
  }, 10000);

  it('close() during the reconnect window prevents the reconnect', async () => {
    const { url, requestCount } = await serveMidStreamReset();
    const source = createNodeEventSource(url, { reconnectMs: 200 });
    await expect
      .poll(() => requestCount(), { timeout: 8000, interval: 20 })
      .toBeGreaterThanOrEqual(1);
    source.close();
    const countAtClose = requestCount();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(requestCount()).toBe(countAtClose);
  }, 10000);
});
