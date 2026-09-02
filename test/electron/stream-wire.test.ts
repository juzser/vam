/**
 * The wire formats main's SSE adapter must accept, and the limit it must
 * refuse.
 *
 * These exist because the adapter is the OTHER HALF of "two transports, one
 * port": the browser build uses the DOM's own `EventSource`, which accepts
 * CRLF, LF and a lone CR. An adapter that accepts only LF makes the desktop
 * build silently stop updating against a server the browser build handles
 * fine -- no error, no reconnect, just an app that looks idle.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { createNodeEventSource } from '../../src/main/stream/event-source.js';

const servers: Server[] = [];
afterAll(() => {
  for (const server of servers) server.close();
});

/** An SSE endpoint that writes one `change` frame using `eol` to end lines. */
function serveFrame(eol: string): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`event: change${eol}data: {"sessions":["a"],"at":"t"}${eol}${eol}`);
    });
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve(`http://127.0.0.1:${port}/`);
    });
  });
}

/** Resolves with the first `change` payload, or undefined if none arrives. */
function firstChange(url: string, ms = 1500): Promise<string | undefined> {
  const source = createNodeEventSource(url);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      source.close();
      resolve(undefined);
    }, ms);
    source.addEventListener('change', (event) => {
      clearTimeout(timer);
      source.close();
      resolve(event.data);
    });
  });
}

describe('the SSE line endings the specification permits', () => {
  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])(
    'dispatches a frame terminated with %s',
    async (_name, eol) => {
      const url = await serveFrame(eol);
      expect(await firstChange(url)).toContain('"sessions":["a"]');
    },
    8000,
  );
});

describe('an endpoint that never terminates a frame', () => {
  it("does not grow main's buffer without bound", async () => {
    // Streams far past the cap with no blank line anywhere.
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = `data: ${'x'.repeat(100_000)}\n`;
      for (let i = 0; i < 15; i += 1) res.write(chunk);
    });
    servers.push(server);
    const url = await new Promise<string>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number };
        resolve(`http://127.0.0.1:${port}/`);
      });
    });

    // The cap surfaces as an `error` frame; without it this would simply
    // accumulate and the assertion below would time out instead.
    const source = createNodeEventSource(url);
    const errored = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 3000);
      source.addEventListener('error', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    source.close();
    expect(errored, 'the oversized frame should have been abandoned').toBe(true);
  }, 10000);
});
