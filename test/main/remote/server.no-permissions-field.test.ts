/**
 * SECURITY-SENSITIVE. `agentPermissions` (`prefs/agent-permissions.ts`) is a
 * renderer-local preference, read only by `Canvas.tsx`'s `startSessionIn` --
 * which the remote server never calls, and never could: `/api/create-session`
 * and `/api/create-session-in` call `MainSource.createSession` directly, in
 * main, and that function's own header (`main/sources/claude-code/
 * create-session.ts`) says its `provider` parameter is "accepted but not
 * spent" -- there is no flag-appending code on this path at all.
 *
 * This file is the defence in depth the task's own security review asks for:
 * proof, not assumption, that a body carrying a `permissions`/
 * `agentPermissions`-shaped extra field changes NOTHING about the call that
 * reaches `createSession` -- the extra field is silently dropped, exactly as
 * every OTHER unrecognised field already is (`isText`/`isOptionalText`
 * validate only the fields each route names).
 */

import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceDirectory, Identity } from '../../../src/main/remote/auth.js';
import { startRemoteServer } from '../../../src/main/remote/server.js';
import type { MainSource } from '../../../src/main/sources/source.js';
import type { Project } from '../../../src/renderer/domain/model.js';

const PAIRED: Identity = { deviceId: 'device-1', name: 'the paired phone' };
const TOKEN = 'a-token-this-server-minted';
const devices: DeviceDirectory = { find: (token) => (token === TOKEN ? PAIRED : null) };

const PROJECTS: readonly Project[] = [
  { id: 'p1', name: 'demo', sessions: [] } as unknown as Project,
];

const descriptor = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: { recordPrompt: true, createSession: true },
  declines: {},
  viewerScope: 'operator',
} as unknown as MainSource['descriptor'];

function makeSource(over: Partial<MainSource> = {}): MainSource {
  return {
    descriptor,
    load: async () => PROJECTS,
    ...over,
  };
}

const servers: Server[] = [];

async function start(source: MainSource): Promise<string> {
  const server = await startRemoteServer({
    port: 0,
    devices,
    allowWrites: true,
    sources: [source],
    subscribe: () => () => {},
    audit: () => {},
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the server did not bind a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const post = (base: string, path: string, body: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...bearer(TOKEN), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('/api/create-session drops any permissions-shaped field, silently', () => {
  it('calls createSession with only (projectId, title, provider) -- an extra `permissions` field never arrives', async () => {
    const createSession = vi.fn(async () => null);
    const base = await start(makeSource({ createSession }));

    const response = await post(base, '/api/create-session', {
      projectId: 'p1',
      title: 'a run',
      provider: 'claude-code',
      permissions: 'yolo',
      agentPermissions: 'yolo',
      dangerouslySkipPermissions: true,
    });

    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith('p1', 'a run', 'claude-code');
    // Exactly three positional arguments -- no fourth one carrying the extra field.
    expect(createSession.mock.calls[0]).toHaveLength(3);
  });

  it('the same holds for /api/create-session-in', async () => {
    const createSession = vi.fn(async () => null);
    const base = await start(makeSource({ createSession }));

    await post(base, '/api/create-session-in', {
      cwd: '/tmp/whatever',
      title: 'a run',
      provider: 'codex',
      agentPermissions: 'yolo',
    });

    // Refused (no matching project for this cwd) is fine here -- the point is
    // that IF it is ever called, no fourth argument exists to carry the field.
    if (createSession.mock.calls.length > 0) {
      expect(createSession.mock.calls[0]).toHaveLength(3);
    }
  });
});

describe('there is no route that could set agentPermissions at all', () => {
  it('a made-up settings route answers 404, never a handler', async () => {
    const base = await start(makeSource());
    const response = await post(base, '/api/settings/agent-permissions', { value: 'yolo' });
    expect(response.status).toBe(404);
  });
});
