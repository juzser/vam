/**
 * The remote server: what it will answer, to whom, and what it will not even
 * have a route for.
 *
 * The read-only assertions here check for **404**, not for a polite refusal.
 * Capability gating in this app lives in the renderer
 * (`src/renderer/sources/preload-factory.ts`), which over a network is a
 * client politely not asking. A route that exists and declines is one bug away
 * from a route that exists and complies; a route that was never registered
 * cannot be reached by any request at all.
 *
 * Every key pair and token is generated in-process, and every request goes to
 * 127.0.0.1. Nothing here reaches Cloudflare.
 */

import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { Server } from 'node:http';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SourceError } from '../../../src/main/ipc/channels.js';
import type { AccessAuth } from '../../../src/main/remote/auth.js';
import { type RemoteServerOptions, startRemoteServer } from '../../../src/main/remote/server.js';
import type { MainSource } from '../../../src/main/sources/source.js';
import type { Project } from '../../../src/renderer/domain/model.js';

const AUDIENCE = 'test-audience-tag';
const ISSUER = 'https://example.test';

const PROJECTS: readonly Project[] = [
  { id: 'p1', name: 'demo', sessions: [] } as unknown as Project,
];

let auth: AccessAuth;
let privateKey: KeyObject;

const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(over: Record<string, unknown> = {}): string {
  const header = { alg: 'RS256', kid: 'key-one' };
  const payload = {
    aud: [AUDIENCE],
    iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 600,
    email: 'operator@example.test',
    ...over,
  };
  const body = `${b64(header)}.${b64(payload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(body);
  return `${body}.${signer.sign(privateKey).toString('base64url')}`;
}

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key-one' };
  auth = { audience: AUDIENCE, issuer: ISSUER, keys: async () => [jwk] };
});

const descriptor = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: { recordPrompt: true, closeSession: true },
  declines: {},
  viewerScope: 'operator',
} as unknown as MainSource['descriptor'];

function makeSource(over: Partial<MainSource> = {}): MainSource {
  return {
    descriptor,
    load: async () => PROJECTS,
    closeSession: async () => null,
    recordPrompt: async () => null,
    ...over,
  };
}

const servers: Server[] = [];
const listeners = new Set<() => void>();

async function start(over: Partial<RemoteServerOptions> = {}): Promise<string> {
  const server = await startRemoteServer({
    port: 0,
    auth,
    allowWrites: true,
    source: makeSource(),
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
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

const get = (base: string, path: string, jwt: string | null = token()): Promise<Response> =>
  fetch(`${base}${path}`, {
    headers: jwt === null ? {} : { 'cf-access-jwt-assertion': jwt },
  });

const post = (base: string, path: string, body: unknown, jwt: string = token()): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'cf-access-jwt-assertion': jwt, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

afterEach(async () => {
  listeners.clear();
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('startRemoteServer', () => {
  it('refuses to start with no Access configuration, and says why', async () => {
    await expect(start({ auth: undefined })).rejects.toThrow(/Cloudflare Access/i);
  });

  it('refuses to start when the audience or issuer is blank', async () => {
    await expect(start({ auth: { ...auth, audience: '' } })).rejects.toThrow(/Cloudflare Access/i);
  });

  it('binds loopback only, never a routable address', async () => {
    const server = await startRemoteServer({
      port: 0,
      auth,
      allowWrites: false,
      source: makeSource(),
      subscribe: () => () => {},
    });
    servers.push(server);
    const address = server.address();
    expect(typeof address === 'object' && address !== null && address.address).toBe('127.0.0.1');
  });
});

describe('identity', () => {
  it('refuses a request carrying no assertion at all', async () => {
    const response = await get(await start(), '/api/load', null);
    expect(response.status).toBe(401);
  });

  it('refuses a forged assertion', async () => {
    const base = await start();
    const [head, payload] = token().split('.');
    const forged = `${head}.${payload}.${Buffer.from('nope').toString('base64url')}`;
    expect((await get(base, '/api/load', forged)).status).toBe(401);
  });

  it('refuses an expired assertion', async () => {
    const base = await start();
    const expired = token({ exp: Math.floor(Date.now() / 1000) - 1 });
    expect((await get(base, '/api/load', expired)).status).toBe(401);
  });

  it('refuses an assertion minted for another Access application', async () => {
    const base = await start();
    expect((await get(base, '/api/load', token({ aud: ['elsewhere'] }))).status).toBe(401);
  });

  it('checks identity before the route exists, so an unknown path is 401 too', async () => {
    expect((await get(await start(), '/api/nothing-here', null)).status).toBe(401);
  });
});

describe('read routes', () => {
  it('answers the model', async () => {
    const response = await get(await start(), '/api/load');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, value: PROJECTS });
  });

  it('answers the descriptor', async () => {
    const response = await get(await start(), '/api/describe');
    expect(await response.json()).toEqual({ ok: true, value: descriptor });
  });

  it('forwards a source failure as an envelope rather than a crash', async () => {
    const base = await start({
      source: makeSource({
        load: async () => {
          throw new Error('the transcript directory is gone');
        },
      }),
    });
    const response = await get(base, '/api/load');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { kind: 'unreachable', code: 'source-failed' },
    });
  });

  it('404s a path it does not serve', async () => {
    expect((await get(await start(), '/api/whatever')).status).toBe(404);
  });
});

describe('read-only mode', () => {
  it('does not register the write routes AT ALL -- 404, not a refusal', async () => {
    const base = await start({ allowWrites: false });
    for (const path of [
      '/api/close-session',
      '/api/record-prompt',
      '/api/create-session',
      '/api/create-session-in',
    ]) {
      const response = await post(base, path, { sessionId: 's1' });
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toMatch(/refus|capab/i);
    }
  });

  it('never reaches the source, even with a valid identity', async () => {
    const closeSession = vi.fn(async () => null);
    const base = await start({ allowWrites: false, source: makeSource({ closeSession }) });
    await post(base, '/api/close-session', { sessionId: 's1' });
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('still serves the read routes', async () => {
    expect((await get(await start({ allowWrites: false }), '/api/load')).status).toBe(200);
  });
});

describe('write routes', () => {
  it('closes a session and audits the act with the identity that asked', async () => {
    const closeSession = vi.fn(async () => null);
    const audit = vi.fn();
    const base = await start({ source: makeSource({ closeSession }), audit });
    const response = await post(base, '/api/close-session', { sessionId: 'session-1' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, value: null });
    expect(closeSession).toHaveBeenCalledWith('session-1');
    expect(audit).toHaveBeenCalledWith(
      expect.stringContaining('operator@example.test'),
    );
  });

  it("forwards the source's own refusal, whole", async () => {
    const refusal: SourceError = {
      kind: 'refused',
      code: 'session-busy',
      message: 'that one is a terminal you are sitting in',
    };
    const base = await start({ source: makeSource({ closeSession: async () => refusal }) });
    const response = await post(base, '/api/close-session', { sessionId: 'session-1' });
    expect(await response.json()).toEqual({ ok: false, error: refusal });
  });

  it('refuses a payload of the wrong shape before the source sees it', async () => {
    const closeSession = vi.fn(async () => null);
    const base = await start({ source: makeSource({ closeSession }) });
    const response = await post(base, '/api/close-session', { sessionId: 42 });
    expect(response.status).toBe(400);
    expect(closeSession).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/close-session`, {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token() },
      body: 'not json at all',
    });
    expect(response.status).toBe(400);
  });

  it('records a prompt', async () => {
    const recordPrompt = vi.fn(async () => null);
    const base = await start({ source: makeSource({ recordPrompt }) });
    const response = await post(base, '/api/record-prompt', {
      sessionId: 'session-1',
      prompt: 'go on then',
    });
    expect(response.status).toBe(200);
    expect(recordPrompt).toHaveBeenCalledWith('session-1', 'go on then');
  });

  it('says so when a member the descriptor advertises is not wired in main', async () => {
    const base = await start({ source: makeSource({ closeSession: undefined }) });
    const response = await post(base, '/api/close-session', { sessionId: 'session-1' });
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'not-implemented' } });
  });

  it('rejects a GET on a write route', async () => {
    expect((await get(await start(), '/api/close-session')).status).toBe(405);
  });
});

describe('SSE', () => {
  it('delivers an update when the change stream ticks', async () => {
    const base = await start();
    const response = await get(base, '/api/stream');
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    // The stream opens with a comment, which is what proves a listener is now
    // attached: emitting before that races the subscription.
    await reader.read();
    expect(listeners.size).toBe(1);
    for (const listener of listeners) {
      listener();
    }
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('event: change');
    await reader.cancel();
  });

  it('unsubscribes when the client goes away', async () => {
    const base = await start();
    const response = await get(base, '/api/stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    expect(listeners.size).toBe(1);
    await reader.cancel();
    await vi.waitFor(() => expect(listeners.size).toBe(0));
  });
});
