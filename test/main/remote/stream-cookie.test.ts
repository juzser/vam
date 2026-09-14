/**
 * THE ONE CREDENTIAL, CARRIED TWO WAYS — and only one of them reaches the
 * stream.
 *
 * THE PROBLEM. `/api/stream` is server-sent events, and `EventSource` cannot
 * send a header. Every other route is a `fetch` and carries
 * `Authorization: Bearer`; the stream could carry nothing, so a paired phone
 * loaded the app, read the model once, and then never updated. The obvious fix
 * -- a token in the query string -- is refused by name in `server.ts`: a
 * credential in a URL is written into proxy logs and browser history, and a
 * short-lived one narrows the window without changing what is written down.
 *
 * THE SHAPE CHOSEN, and the two questions it had to answer.
 *
 * IS IT A SECOND CREDENTIAL? No, and that is structural rather than
 * promised. The cookie carries the SAME per-device token the header carries,
 * it is resolved through the SAME `DeviceDirectory.find`, and it is issued
 * only to a request that has already proved itself with the header. It is a
 * re-presentation of a credential the caller already holds, not a grant of its
 * own -- so there is no state in which the cookie is valid and the token is
 * not.
 *
 * IS IT A SECOND WAY IN? Only to `/api/stream`. The cookie is scoped by
 * `Path` and, more to the point, is not READ anywhere else: every other route
 * answers 401 to a cookie-only request, which is what the sweep below holds.
 * `SameSite=Strict` means a cross-site request never carries it at all, and a
 * cookie that only a read-only event stream honours is not a CSRF lever over
 * the write routes even if that ever changed.
 *
 * DOES REVOCATION CUT IT? Yes, and by construction rather than by a second
 * revocation path: `find` is the only resolver, so a device removed from the
 * directory fails both carriers in the same statement. The journey at the
 * bottom is the test that says so -- pair, stream, revoke, stream refused --
 * because a stream test that only proves a paired device connects proves the
 * easy half.
 */

import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authenticateStream,
  cookieTokenFrom,
  type DeviceDirectory,
  type Identity,
  STREAM_COOKIE,
  streamCookie,
} from '../../../src/main/remote/auth.js';
import type { PairOutcome } from '../../../src/main/remote/pairing.js';
import {
  createStreamRegistry,
  type RemoteServerOptions,
  registeredRoutePaths,
  startRemoteServer,
} from '../../../src/main/remote/server.js';
import type { MainSource } from '../../../src/main/sources/source.js';
import type { Project } from '../../../src/renderer/domain/model.js';

const PAIRED: Identity = { deviceId: 'device-1', name: 'the paired phone' };
const TOKEN = 'a-token-this-server-minted';

const PROJECTS: readonly Project[] = [
  { id: 'p1', name: 'demo', sessions: [] } as unknown as Project,
];

const descriptor = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: { recordPrompt: true, closeSession: true },
  declines: {},
  viewerScope: 'operator',
} as unknown as MainSource['descriptor'];

const source: MainSource = {
  descriptor,
  load: async () => PROJECTS,
  closeSession: async () => null,
  recordPrompt: async () => null,
} as unknown as MainSource;

/** A directory a test can revoke from, which is the whole subject below. */
function directory(): DeviceDirectory & { revoke(): void } {
  let live = true;
  return {
    find: (token) => (live && token === TOKEN ? PAIRED : null),
    revoke: () => {
      live = false;
    },
  };
}

const servers: Server[] = [];
const aborts: AbortController[] = [];

async function start(over: Partial<RemoteServerOptions> = {}): Promise<string> {
  const server = await startRemoteServer({
    port: 0,
    devices: directory(),
    allowWrites: true,
    source,
    subscribe: () => () => {},
    audit: () => {},
    ...over,
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the server did not bind a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const cookie = (token: string) => ({ cookie: `${STREAM_COOKIE}=${token}` });

/** Opens the stream and hangs up, so a test never leaks a live connection. */
function openStream(base: string, headers: Record<string, string>): Promise<Response> {
  const abort = new AbortController();
  aborts.push(abort);
  return fetch(`${base}/api/stream`, { headers, signal: abort.signal });
}

afterEach(async () => {
  for (const abort of aborts.splice(0)) abort.abort();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('reading the token out of a Cookie header', () => {
  it('finds vam’s cookie among others', () => {
    expect(cookieTokenFrom(`theme=dark; ${STREAM_COOKIE}=abc; other=1`)).toBe('abc');
  });

  it('is nothing when the header is absent or holds no vam cookie', () => {
    expect(cookieTokenFrom(undefined)).toBeNull();
    expect(cookieTokenFrom('theme=dark')).toBeNull();
    expect(cookieTokenFrom(`${STREAM_COOKIE}=`)).toBeNull();
  });

  /**
   * The same rule `bearerFrom` applies to a repeated `Authorization`: picking
   * one of two credentials is a decision no parser should make on the
   * operator's behalf, and a caller that can get a second cookie in front of
   * the first is a caller choosing which identity the server sees.
   */
  it('refuses a repeated vam cookie rather than picking one', () => {
    expect(cookieTokenFrom(`${STREAM_COOKIE}=abc; ${STREAM_COOKIE}=def`)).toBeNull();
  });

  it('refuses a value far above any token this server mints', () => {
    expect(cookieTokenFrom(`${STREAM_COOKIE}=${'x'.repeat(10_000)}`)).toBeNull();
  });
});

describe('authenticateStream', () => {
  it('accepts the header, exactly as every other route does', () => {
    expect(authenticateStream(`Bearer ${TOKEN}`, undefined, directory())).toEqual({
      ok: true,
      identity: PAIRED,
    });
  });

  it('accepts the cookie when there is no header', () => {
    expect(authenticateStream(undefined, `${STREAM_COOKIE}=${TOKEN}`, directory())).toEqual({
      ok: true,
      identity: PAIRED,
    });
  });

  /**
   * ONE CREDENTIAL PER REQUEST. A present-but-broken header is a caller
   * asserting an identity; falling through to a cookie would let a second
   * value silently answer for the first, and "which of the two did the server
   * believe" is not a question this code should be able to raise.
   */
  it('does not let a cookie rescue a malformed header', () => {
    expect(authenticateStream('Bearer', `${STREAM_COOKIE}=${TOKEN}`, directory())).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('refuses a revoked device through the cookie, same as through the header', () => {
    const devices = directory();
    devices.revoke();
    expect(authenticateStream(undefined, `${STREAM_COOKIE}=${TOKEN}`, devices)).toEqual({
      ok: false,
      reason: 'unknown-device',
    });
  });
});

describe('the cookie vam sets', () => {
  it('is HttpOnly, Secure, SameSite=Strict and scoped to the stream', () => {
    const header = streamCookie(TOKEN);
    expect(header).toContain(`${STREAM_COOKIE}=${TOKEN}`);
    // HttpOnly: no script may read it, which is the whole reason it can carry
    // a credential a query string may not.
    expect(header).toContain('HttpOnly');
    // Secure: HTTPS only, which `tailscale serve` provides.
    expect(header).toContain('Secure');
    // Strict: a cross-site request never carries it at all.
    expect(header).toContain('SameSite=Strict');
    // Scoped: the browser does not attach it to any other route.
    expect(header).toContain('Path=/api/stream');
  });
});

/**
 * THE BROWSER-SIDE MEASUREMENT LIVES IN `e2e/stream-cookie.spec.ts`, which
 * reproduces this header's ATTRIBUTES against a real Chromium -- whether a
 * `Secure` cookie is stored over `http://127.0.0.1` and whether `EventSource`
 * sends it -- because no unit environment can answer either. It has to
 * reproduce the string rather than import it (Playwright does not load this
 * process's modules), so this asserts the two have not drifted apart. A
 * measurement of the wrong cookie is worse than none.
 */
describe('the browser probe measures the cookie vam actually sets', () => {
  it('matches, attribute for attribute', () => {
    const spec = readFileSync(
      new URL('../../../e2e/stream-cookie.spec.ts', import.meta.url),
      'utf8',
    );
    const literal = /^const SET_COOKIE = `(.+)`;$/m.exec(spec)?.[1];
    expect(literal, 'e2e/stream-cookie.spec.ts no longer declares SET_COOKIE').toBeDefined();
    const probe = (literal as string)
      // biome-ignore-start lint/suspicious/noTemplateCurlyInString: these are the spec's own literal placeholders, read as text out of its source — interpolating them here is exactly the bug this substitution exists to avoid
      .replace('${COOKIE}', STREAM_COOKIE)
      .replace('${TOKEN}', 'a-token-no-server-minted');
    // biome-ignore-end lint/suspicious/noTemplateCurlyInString: see above
    expect(probe).toBe(streamCookie('a-token-no-server-minted'));
  });
});

describe('the server, end to end', () => {
  it('opens the stream for a cookie alone — the EventSource case', async () => {
    const base = await start();
    const answer = await openStream(base, cookie(TOKEN));
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toContain('text/event-stream');
  });

  it('refuses an unknown token in the cookie with the same uniform 401', async () => {
    const base = await start();
    const answer = await openStream(base, cookie('not-a-token'));
    expect(answer.status).toBe(401);
    expect(await answer.json()).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated' },
    });
  });

  /**
   * THE SWEEP, over `registeredRoutePaths` rather than a list, so a route
   * added later is covered by it on the day it is added. The cookie is for
   * `/api/stream` and for nothing else: every other path must answer 401 to a
   * caller holding nothing but the cookie.
   */
  it('honours the cookie on the stream and on no other route', async () => {
    const base = await start();
    const paths = registeredRoutePaths({
      port: 0,
      devices: directory(),
      allowWrites: true,
      source,
      subscribe: () => () => {},
    });
    expect(paths).toContain('/api/stream');
    expect(paths.length).toBeGreaterThan(3);
    for (const path of paths) {
      if (path === '/api/stream') continue;
      const answer = await fetch(`${base}${path}`, { headers: cookie(TOKEN) });
      expect(
        answer.status,
        `${path} honoured the stream cookie, which is a second way into the API`,
      ).toBe(401);
    }
  });

  it('re-issues the cookie to a request that proved itself with the header', async () => {
    const base = await start();
    const answer = await fetch(`${base}/api/describe`, { headers: bearer(TOKEN) });
    expect(answer.status).toBe(200);
    const set = answer.headers.get('set-cookie') ?? '';
    expect(set).toContain(`${STREAM_COOKIE}=${TOKEN}`);
    expect(set).toContain('HttpOnly');
  });

  /**
   * A COOKIE MAY NOT RENEW ITSELF, which is what keeps it a copy of the token
   * rather than a credential with a life of its own. The renewal reads the
   * token out of the HEADER that was just verified; a cookie-only request has
   * no header, so it gets nothing back and its expiry stands. A device whose
   * stored token is gone therefore loses the stream when the cookie lapses,
   * instead of streaming for ever off a cookie that keeps re-minting itself.
   */
  it('does not let a cookie-only request extend its own cookie', async () => {
    const base = await start();
    const answer = await openStream(base, cookie(TOKEN));
    expect(answer.status).toBe(200);
    expect(answer.headers.get('set-cookie')).toBeNull();
  });

  it('sets no cookie for a caller it refused', async () => {
    const base = await start();
    const answer = await fetch(`${base}/api/describe`, { headers: bearer('not-a-token') });
    expect(answer.status).toBe(401);
    expect(answer.headers.get('set-cookie')).toBeNull();
  });

  it('sets the cookie on a successful pair, so the first stream already works', async () => {
    const pairing = {
      submit: async (): Promise<PairOutcome> => ({ ok: true, identity: PAIRED, token: TOKEN }),
    };
    const base = await start({ pairing });
    const answer = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ABCD1234', name: 'the phone' }),
    });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('set-cookie') ?? '').toContain(`${STREAM_COOKIE}=${TOKEN}`);
    // The token is still in the BODY too: the phone keeps it for the header
    // every other route needs. The cookie carries the same value, not a
    // second one.
    expect(await answer.json()).toMatchObject({ ok: true, value: { token: TOKEN } });
  });

  it('sets no cookie on a refused pair', async () => {
    const pairing = {
      submit: async (): Promise<PairOutcome> => ({ ok: false, reason: 'no-code' as never }),
    };
    const base = await start({ pairing });
    const answer = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'WRONG', name: 'the phone' }),
    });
    expect(answer.status).toBe(401);
    expect(answer.headers.get('set-cookie')).toBeNull();
  });
});

/**
 * PAIR, STREAM, REVOKE, STREAM REFUSED. The whole point: a cookie the browser
 * keeps sending is a credential with its own lifetime unless revocation
 * reaches it, and the half that is easy to get right (a paired device
 * connects) proves nothing about the half that matters.
 */
describe('the journey', () => {
  it('cuts a revoked device’s stream, both the open one and the next', async () => {
    const devices = directory();
    const streams = createStreamRegistry();
    const base = await start({ devices, streams });

    const live = await openStream(base, cookie(TOKEN));
    expect(live.status).toBe(200);

    // The desktop revokes the device. Two things must follow: the connection
    // already open is hung up on, and a fresh one is refused.
    devices.revoke();
    streams.closeFor(PAIRED.deviceId);

    // The open stream ends rather than reading on. Draining it is the
    // assertion: a stream that outlived the pairing would never finish.
    const reader = live.body?.getReader();
    expect(reader).toBeDefined();
    for (;;) {
      const chunk = await (reader as ReadableStreamDefaultReader<Uint8Array>).read();
      if (chunk.done) break;
    }

    const again = await openStream(base, cookie(TOKEN));
    expect(again.status).toBe(401);
  });
});
