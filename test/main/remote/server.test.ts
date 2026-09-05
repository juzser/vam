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
 * Every token here is a literal invented for the test, no device name is a
 * real one, and every request goes to 127.0.0.1. Nothing reaches a network.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SourceError } from '../../../src/main/ipc/channels.js';
import type { DeviceDirectory, Identity } from '../../../src/main/remote/auth.js';
import type { PairOutcome } from '../../../src/main/remote/pairing.js';
import {
  createStreamRegistry,
  type RemoteServerOptions,
  startRemoteServer,
} from '../../../src/main/remote/server.js';
import type { MainSource } from '../../../src/main/sources/source.js';
import type { Project } from '../../../src/renderer/domain/model.js';

const PAIRED: Identity = { deviceId: 'device-1', name: 'the paired phone' };
const TOKEN = 'a-token-this-server-minted';

const PROJECTS: readonly Project[] = [
  { id: 'p1', name: 'demo', sessions: [] } as unknown as Project,
];

/** A directory holding exactly one paired device. `devices.ts` is where the
 *  real one lives; here the point is what the SERVER does with its answer. */
const devices: DeviceDirectory = { find: (token) => (token === TOKEN ? PAIRED : null) };

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
    devices,
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

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const get = (base: string, path: string, token: string | null = TOKEN): Promise<Response> =>
  fetch(`${base}${path}`, { headers: token === null ? {} : bearer(token) });

const post = (
  base: string,
  path: string,
  body: unknown,
  token: string = TOKEN,
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...bearer(token), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

afterEach(async () => {
  listeners.clear();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('startRemoteServer', () => {
  it('refuses to start with no device registry, and says why', async () => {
    await expect(start({ devices: undefined })).rejects.toThrow(/device registry/i);
  });

  it('refuses any bind address other than loopback, because Serve proxies there', async () => {
    await expect(start({ host: '0.0.0.0' })).rejects.toThrow(/127\.0\.0\.1/);
  });

  it('binds loopback only, never a routable address', async () => {
    const server = await startRemoteServer({
      port: 0,
      devices,
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
  it('refuses an unpaired request, carrying no token at all', async () => {
    const response = await get(await start(), '/api/load', null);
    expect(response.status).toBe(401);
  });

  it('refuses a forged token', async () => {
    expect((await get(await start(), '/api/load', 'not-a-token-we-minted')).status).toBe(401);
  });

  it('refuses a token that was revoked -- the directory is consulted per request', async () => {
    let live = true;
    const revocable: DeviceDirectory = { find: (t) => (live && t === TOKEN ? PAIRED : null) };
    const base = await start({ devices: revocable });
    expect((await get(base, '/api/load')).status).toBe(200);
    live = false;
    expect((await get(base, '/api/load')).status).toBe(401);
  });

  it('reads no identity out of a Tailscale header, which anything local can forge', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/load`, {
      headers: { 'tailscale-user-login': 'someone@example.test' },
    });
    expect(response.status).toBe(401);
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

  it('answers the descriptor, projected onto the routes it serves', async () => {
    const response = await get(await start(), '/api/describe');
    const body = (await response.json()) as { ok: true; value: MainSource['descriptor'] };
    expect(body.ok).toBe(true);
    expect(body.value.id).toBe(descriptor.id);
    expect(body.value.capabilities.recordPrompt).toBe(true);
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
    expect(audit).toHaveBeenCalledWith(expect.stringContaining(PAIRED.name));
    expect(audit).toHaveBeenCalledWith(expect.stringContaining(PAIRED.deviceId));
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
      headers: bearer(TOKEN),
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

  it('starts a session in a project, and one in a directory', async () => {
    const createSession = vi.fn(async () => null);
    const createSessionInDirectory = vi.fn(async () => null);
    const base = await start({ source: makeSource({ createSession, createSessionInDirectory }) });
    await post(base, '/api/create-session', { projectId: 'p1', title: 'a run' });
    await post(base, '/api/create-session-in', { cwd: '/somewhere/else', title: 'a run' });
    expect(createSession).toHaveBeenCalledWith('p1', 'a run', undefined);
    expect(createSessionInDirectory).toHaveBeenCalledWith('/somewhere/else', 'a run', undefined);
  });

  it("refuses a relative directory, which would resolve against main's own cwd", async () => {
    const createSessionInDirectory = vi.fn(async () => null);
    const base = await start({ source: makeSource({ createSessionInDirectory }) });
    const response = await post(base, '/api/create-session-in', { cwd: 'else', title: 'a run' });
    expect(response.status).toBe(400);
    expect(createSessionInDirectory).not.toHaveBeenCalled();
  });

  it('drops a body far larger than any real prompt instead of buffering it', async () => {
    const recordPrompt = vi.fn(async () => null);
    const base = await start({ source: makeSource({ recordPrompt }) });
    const huge = JSON.stringify({ sessionId: 's1', prompt: 'x'.repeat(3_000_000) });
    await fetch(`${base}/api/record-prompt`, {
      method: 'POST',
      headers: bearer(TOKEN),
      body: huge,
    }).catch(() => undefined);
    expect(recordPrompt).not.toHaveBeenCalled();
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

  it('drops the stream of a device whose pairing was revoked', async () => {
    const streams = createStreamRegistry();
    const base = await start({ streams });
    const response = await get(base, '/api/stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    expect(listeners.size).toBe(1);
    streams.closeFor(PAIRED.deviceId);
    // The connection ENDS: a revoked device must not keep a socket it opened
    // while it was still paired.
    await vi.waitFor(async () => expect((await reader.read()).done).toBe(true));
    expect(listeners.size).toBe(0);
  });

  it('leaves other devices connected when one is revoked', async () => {
    const streams = createStreamRegistry();
    const base = await start({ streams });
    const response = await get(base, '/api/stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    streams.closeFor('some-other-device');
    expect(listeners.size).toBe(1);
    await reader.cancel();
  });
});

/**
 * `/api/pair` is the ONE route an unpaired caller may reach, and it exists
 * only while the operator has the pairing screen open. Everything else is
 * behind the token this route is the only way to obtain.
 */
describe('the pairing route', () => {
  const pair = (base: string, body: unknown): Promise<Response> =>
    fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const stubPairing = (outcome: PairOutcome) => ({
    submit: async () => outcome,
  });

  it('is unreachable when no pairing screen is open -- 401, like any stranger', async () => {
    const base = await start();
    expect((await pair(base, { code: 'ABCD2345', name: 'a phone' })).status).toBe(401);
  });

  it('hands the token over exactly once, on a correct code', async () => {
    const granted: PairOutcome = { ok: true, identity: PAIRED, token: 'a-fresh-token' };
    const base = await start({ pairing: stubPairing(granted) });
    const response = await pair(base, { code: 'ABCD2345', name: 'a phone' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      value: { token: 'a-fresh-token', deviceId: PAIRED.deviceId, name: PAIRED.name },
    });
  });

  it('refuses a wrong code with 401 and the reason the phone must show', async () => {
    const base = await start({ pairing: stubPairing({ ok: false, reason: 'burned' }) });
    const response = await pair(base, { code: 'ZZZZZZZZ', name: 'a phone' });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { message: 'burned' } });
  });

  it('refuses a body of the wrong shape before pairing sees it', async () => {
    const submit = vi.fn(async () => ({ ok: false, reason: 'wrong-code' }) as PairOutcome);
    const base = await start({ pairing: { submit } });
    expect((await pair(base, { code: 42 })).status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it('carries no token in the URL, only in the body', async () => {
    const minted = 'zzz-minted-token-zzz';
    const base = await start({
      pairing: stubPairing({ ok: true, identity: PAIRED, token: minted }),
    });
    const response = await pair(base, { code: 'ABCD2345', name: 'a phone' });
    expect(response.url).not.toContain(minted);
    expect(new URL(response.url).search).toBe('');
  });

  it('rejects a GET on it, which would put a code in a server log', async () => {
    const base = await start({ pairing: stubPairing({ ok: false, reason: 'no-code' }) });
    expect((await get(base, '/api/pair', null)).status).toBe(401);
  });
});

/**
 * A route this server does not carry is not a capability the browser may be
 * shown. The descriptor main holds describes what the DESKTOP source can do;
 * over HTTP, `renameSession`, governance and the whole terminal surface have
 * no route, and in read-only mode neither do the writes. The client is told
 * `false` with a reason, rather than left to discover it by calling.
 */
describe('the descriptor the server serves', () => {
  const full = {
    ...descriptor,
    capabilities: {
      liveUpdates: true,
      recordPrompt: true,
      deliverPrompt: true,
      promptAttachments: true,
      slashCommands: true,
      renameSession: true,
      closeSession: true,
      createSession: true,
      governance: true,
      pullRequests: true,
      terminal: true,
      agentRoster: true,
    },
    declines: {},
  } as unknown as MainSource['descriptor'];

  const served = async (over: Partial<RemoteServerOptions> = {}) => {
    const base = await start({ source: makeSource({ descriptor: full }), ...over });
    const body = (await (await get(base, '/api/describe')).json()) as {
      value: MainSource['descriptor'];
    };
    return body.value;
  };

  it('turns off every capability whose member has no route here', async () => {
    const value = await served();
    expect(value.capabilities.terminal).toBe(false);
    expect(value.capabilities.renameSession).toBe(false);
    expect(value.capabilities.governance).toBe(false);
    // Served routes stay true.
    expect(value.capabilities.closeSession).toBe(true);
    expect(value.capabilities.liveUpdates).toBe(true);
  });

  it('writes a decline for each one, in the server’s own words', async () => {
    const value = await served();
    expect(value.declines.terminal).toMatch(/terminal/i);
    expect(value.declines.renameSession).toBeTruthy();
    expect(value.declines.governance).toBeTruthy();
  });

  it('turns off every write capability when the write routes are unregistered', async () => {
    const value = await served({ allowWrites: false });
    expect(value.capabilities.recordPrompt).toBe(false);
    expect(value.capabilities.deliverPrompt).toBe(false);
    expect(value.capabilities.closeSession).toBe(false);
    expect(value.capabilities.createSession).toBe(false);
    expect(value.declines.recordPrompt).toMatch(/read-only/i);
  });
});

/**
 * The page itself. An asset is served by the SAME request path as the API, so
 * identity is verified before the file is opened -- a static file that could be
 * fetched by someone `/api/load` would refuse is a way around the door.
 */
describe('static assets', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vam-web-'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>vam</title>');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'assets', 'app.js'), 'export const vam = 1;\n');
    await writeFile(join(root, '..', 'outside.txt'), 'not yours');
  });

  it('refuses an asset to a caller with no verified identity', async () => {
    const response = await get(await start({ webRoot: root }), '/', null);
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('refuses an asset to a forged assertion', async () => {
    const base = await start({ webRoot: root });
    expect((await get(base, '/assets/app.js', 'not-a-token-we-minted')).status).toBe(401);
  });

  it('serves the page at the root to a verified identity', async () => {
    const response = await get(await start({ webRoot: root }), '/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<title>vam</title>');
  });

  it('serves a nested asset with its own content type', async () => {
    const response = await get(await start({ webRoot: root }), '/assets/app.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
  });

  it('will not walk out of the web root', async () => {
    const base = await start({ webRoot: root });
    expect((await get(base, '/../outside.txt')).status).toBe(404);
    expect((await get(base, '/%2e%2e/outside.txt')).status).toBe(404);
  });

  it('never answers an /api path with a file', async () => {
    const base = await start({ webRoot: root });
    const response = await get(base, '/api/index.html');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('answers 404 for any path when no web root is configured', async () => {
    expect((await get(await start(), '/')).status).toBe(404);
  });
});
