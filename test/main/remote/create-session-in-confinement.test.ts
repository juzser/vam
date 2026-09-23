/**
 * `POST /api/create-session-in`, the one optional-capability case AC7 makes
 * binding rather than incidental: `MainSource#createSession` is declared
 * with a `?` (`src/main/sources/source.ts:48`), so a `MainSource` may not
 * implement it at all. That must refuse -- byte-identically with every other
 * refusal this guard produces -- and it must refuse WITHOUT reading the
 * operator's project list, because the capability check is the FIRST thing
 * the guard does, before `options.source.load()` is even awaited.
 *
 * This lives in its own file, apart from `server.test.ts`, because AC7 names
 * it as a dedicated case and because the `load` spy's zero-calls assertion is
 * the instrument for an ordering requirement that is easy to lose among the
 * rest of the route's assertions.
 */

import { mkdir, mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceDirectory, Identity } from '../../../src/main/remote/auth.js';
import {
  createStreamRegistry,
  type RemoteServerOptions,
  startRemoteServer,
} from '../../../src/main/remote/server.js';
import type { MainSource } from '../../../src/main/sources/source.js';

const PAIRED: Identity = { deviceId: 'device-1', name: 'the paired phone' };
const TOKEN = 'a-token-this-server-minted';
const devices: DeviceDirectory = { find: (token) => (token === TOKEN ? PAIRED : null) };

const descriptor = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: { createSession: true },
  declines: {},
  viewerScope: 'operator',
} as unknown as MainSource['descriptor'];

const servers: Server[] = [];

async function start(source: MainSource): Promise<string> {
  const server = await startRemoteServer({
    port: 0,
    devices,
    allowWrites: true,
    source,
    subscribe: () => () => {},
    streams: createStreamRegistry(),
    audit: () => {},
  } satisfies RemoteServerOptions);
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the server did not bind a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

const post = (base: string, path: string, body: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('create-session-in: an absent createSession capability', () => {
  it(
    'refuses at HTTP 403 with the byte-identical unauthorized-directory body, never calls ' +
      "createSessionInDirectory, and never reads the operator's project list",
    async () => {
      const repo = await mkdtemp(join(tmpdir(), 'vam-member-repo-'));
      await mkdir(join(repo, '.git'), { recursive: true });

      const load = vi.fn(async () => []);
      const createSessionInDirectory = vi.fn(async () => null);
      const base = await start({
        descriptor,
        load,
        // `createSession` is ABSENT -- not a stub resolving null. A
        // `MainSource` that never implements the capability at all.
        createSessionInDirectory,
      });

      const response = await post(base, '/api/create-session-in', {
        cwd: repo,
        title: 'a run',
      });

      // NOT 200 -- the optional-call idiom `s.createSession?.(...) ?? null`
      // would silently answer `{ok:true,value:null}`, a false success on the
      // one route that spawns a live shell.
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        ok: false,
        error: {
          kind: 'refused',
          code: 'unauthorized-directory',
          message: expect.any(String),
        },
      });

      // NEVER falls back to the caller-named directory -- the bypass this
      // plan version exists to close.
      expect(createSessionInDirectory).not.toHaveBeenCalled();

      // ORDERING: the capability check runs BEFORE `load()` is awaited, so a
      // route that cannot spawn never reads the operator's project list.
      expect(load).not.toHaveBeenCalled();
    },
  );
});
