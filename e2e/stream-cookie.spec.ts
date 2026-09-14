/**
 * TWO CLAIMS ABOUT A BROWSER THAT NOTHING IN THE UNIT SUITE CAN CHECK.
 *
 * `src/main/remote/auth.ts` carries the live-updates design: `EventSource`
 * cannot send a header, a token in a query string is refused by name
 * (`server.ts` -- a proxy log and a browser history keep it whether or not it
 * is short-lived), so the stream's credential travels as an `HttpOnly`,
 * `Secure`, `SameSite=Strict` cookie. That design rests on two things the
 * BROWSER does, and a comment asserting either of them is a claim nobody ran:
 *
 *   1. A `Secure` cookie set over `http://127.0.0.1` IS stored and sent.
 *      `Secure` normally means HTTPS only -- which `tailscale serve` provides
 *      and a plain-HTTP origin does not -- but loopback is a
 *      potentially-trustworthy origin, and the spec carves it out. If that
 *      were wrong, every developer reaching the server directly on loopback
 *      would silently lose live updates while the phone kept them, which is
 *      the worst shape a bug can have: invisible to the person who would fix
 *      it. This is the check the reviewer asked for before it bit someone.
 *
 *   2. `EventSource` sends cookies on a SAME-ORIGIN stream without being
 *      asked. `withCredentials` exists for the cross-origin case; vam's page
 *      is served by the same server that answers `/api/stream`, so there
 *      should be nothing to opt into -- but "should" is the word this file
 *      exists to remove.
 *
 * WHAT THIS IS NOT. It does not test vam's server: the node server below is a
 * few lines written here that reproduce the cookie's ATTRIBUTES and the
 * stream's shape, so that what is measured is the browser and only the
 * browser. vam's own behaviour -- which routes honour the cookie, that
 * revocation cuts it, that pairing sets it -- is
 * `test/main/remote/stream-cookie.test.ts`, against the real
 * `startRemoteServer`. Two instruments, two questions.
 *
 * WHICH BROWSER THIS SPEAKS FOR. Chromium, which is this config's only
 * project -- and that is the browser the claim is ABOUT. Claim 1 is a question
 * about a plain-HTTP loopback origin, and the only thing that reaches vam that
 * way is a developer (or vam's own Electron shell, which is Chromium). The
 * phone reaches it through `tailscale serve`, over HTTPS, where `Secure` is
 * satisfied by the scheme and there is nothing to carve out. So iOS Safari's
 * loopback policy is not a gap here: no vam deployment puts Safari on a
 * plain-HTTP origin, and `vam-mobile-is-tailscale-serve` is why.
 *
 * It reaches no network: one node server on 127.0.0.1 with an ephemeral port,
 * torn down after each test. No token here is a real one.
 */

import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';

/** The attributes `streamCookie` sets. Pinned there; reproduced here. */
const COOKIE = 'vam_stream';
const TOKEN = 'a-token-no-server-minted';
const SET_COOKIE = `${COOKIE}=${TOKEN}; Path=/api/stream; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>cookie probe</title></head>
<body><script>
  window.probe = async function probe() {
    const paired = await fetch('/api/pair', { method: 'POST' });
    if (!paired.ok) return 'pair-refused';
    return await new Promise((resolve) => {
      const source = new EventSource('/api/stream');
      const done = (answer) => { source.close(); resolve(answer); };
      source.addEventListener('open', () => done('open'));
      source.addEventListener('error', () => done('error'));
      setTimeout(() => done('timeout'), 5000);
    });
  };
</script></body></html>`;

/**
 * A server that answers the stream ONLY to the cookie -- never to a header,
 * and never to nothing. That is what makes a passing result mean the cookie
 * arrived rather than that the stream would have opened anyway.
 */
function probeServer(options: { readonly honour: boolean }): Promise<{
  base: string;
  server: Server;
  sawCookie: () => boolean;
}> {
  let sawCookie = false;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method === 'POST' && path === '/api/pair') {
      response.setHeader('set-cookie', SET_COOKIE);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
      return;
    }
    if (path === '/api/stream') {
      const cookie = request.headers.cookie ?? '';
      const carried = cookie.includes(`${COOKIE}=${TOKEN}`);
      if (carried) sawCookie = true;
      if (!carried || !options.honour) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end('{"ok":false}');
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      response.write(': open\n\n');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      resolve({
        base: `http://127.0.0.1:${address.port}`,
        server,
        sawCookie: () => sawCookie,
      });
    });
  });
}

const shut = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });

test('a Secure cookie set over loopback is stored, and EventSource sends it', async ({
  page,
  context,
}) => {
  const { base, server, sawCookie } = await probeServer({ honour: true });
  try {
    await page.goto(base);
    const answer = await page.evaluate(() => (window as never as { probe(): Promise<string> }).probe());
    expect(
      answer,
      'the stream did not open, so either the Secure cookie was not stored over http://127.0.0.1 or EventSource did not send it',
    ).toBe('open');
    expect(sawCookie(), 'the stream request carried no cookie at all').toBe(true);

    // AND IT IS HttpOnly, measured rather than asserted from the string we
    // sent: the page must not be able to read the credential it is carrying.
    const readable = await page.evaluate(() => document.cookie);
    expect(readable).not.toContain(TOKEN);

    // The browser really did store it with the attributes vam sets.
    const stored = (await context.cookies()).find((c) => c.name === COOKIE);
    expect(stored).toBeTruthy();
    expect(stored?.httpOnly).toBe(true);
    expect(stored?.secure).toBe(true);
    expect(stored?.sameSite).toBe('Strict');
    expect(stored?.path).toBe('/api/stream');
  } finally {
    await shut(server);
  }
});

/**
 * THE NEGATIVE, so the test above is not a tautology. Same page, same cookie,
 * a server that refuses it: `EventSource` must report an error rather than an
 * open stream. Without this, a harness that reported 'open' for everything
 * would pass the first test and mean nothing.
 */
test('a refused stream is an error, not an open one', async ({ page }) => {
  const { base, server } = await probeServer({ honour: false });
  try {
    await page.goto(base);
    const answer = await page.evaluate(() => (window as never as { probe(): Promise<string> }).probe());
    expect(answer).toBe('error');
  } finally {
    await shut(server);
  }
});
