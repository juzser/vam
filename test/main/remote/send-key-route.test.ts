/**
 * `/api/send-key`, at the HTTP layer -- auth, the allowlist's 400, the
 * read-only 404, and the "at least one claude-code source" gate. The actual
 * tmux resolution is `send-key.test.ts`'s job; this file mocks
 * `sendRemoteKey` out so a request here can never reach a real tmux, and
 * asserts the ROUTE forwards exactly what it was given and exactly what came
 * back.
 *
 * Every other write route already gets this coverage in `server.test.ts`
 * (auth, pairing, rate limits, the read-only 404) -- this file exists
 * because `/api/send-key` is the one write whose `call` does not dispatch
 * through a `MainSource`, so it needs its own seam to mock rather than
 * reusing that file's `makeSource()`.
 */

import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sendRemoteKey = vi.fn();

vi.mock('../../../src/main/remote/send-key.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/remote/send-key.js')>(
    '../../../src/main/remote/send-key.js',
  );
  return { ...actual, sendRemoteKey };
});

const { startRemoteServer } = await import('../../../src/main/remote/server.js');
const { isRemoteKeyId } = await import('../../../src/main/remote/send-key.js');
type RemoteServerOptions = Parameters<typeof startRemoteServer>[0];
type MainSource = import('../../../src/main/sources/source.js').MainSource;

const PAIRED = { deviceId: 'device-1', name: 'the paired phone' };
const TOKEN = 'a-token-this-server-minted';
const devices = { find: (token: string) => (token === TOKEN ? PAIRED : null) };

function makeSource(id = 'claude-code'): MainSource {
  return {
    descriptor: {
      id,
      label: id,
      capabilities: { recordPrompt: true },
      declines: {},
      viewerScope: { kind: 'connection', note: 'test' },
    } as unknown as MainSource['descriptor'],
    load: async () => [],
    recordPrompt: async () => null,
  };
}

const servers: Server[] = [];

async function start(over: Partial<RemoteServerOptions> = {}): Promise<string> {
  const server = await startRemoteServer({
    port: 0,
    devices,
    allowWrites: true,
    sources: [makeSource()],
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

const post = (base: string, body: unknown, token: string | null = TOKEN): Promise<Response> =>
  fetch(`${base}/api/send-key`, {
    method: 'POST',
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

afterEach(async () => {
  sendRemoteKey.mockReset();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('/api/send-key: authentication and pairing are unchanged', () => {
  it('refuses an unpaired caller with the one 401 this server ever sends', async () => {
    const response = await post(await start(), { sessionId: 's1', key: 'escape' }, null);
    expect(response.status).toBe(401);
    expect(sendRemoteKey).not.toHaveBeenCalled();
  });

  it('refuses a forged token the same way', async () => {
    const response = await post(
      await start(),
      { sessionId: 's1', key: 'escape' },
      'not-the-real-token',
    );
    expect(response.status).toBe(401);
    expect(sendRemoteKey).not.toHaveBeenCalled();
  });
});

describe('/api/send-key: read-only mode carries no route at all', () => {
  it('answers 404, never a polite refusal', async () => {
    const base = await start({ allowWrites: false });
    const response = await post(base, { sessionId: 's1', key: 'escape' });
    expect(response.status).toBe(404);
    expect(sendRemoteKey).not.toHaveBeenCalled();
  });
});

describe('/api/send-key: the allowlist is enforced before anything is sent', () => {
  const rejected = ['Escape', 'up', 'down', 'C-c', 'wheel', '', 'ESCAPE', 123, null];

  for (const key of rejected) {
    it(`refuses ${JSON.stringify(key)} with 400, and calls sendRemoteKey with nothing`, async () => {
      const response = await post(await start(), { sessionId: 's1', key });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(sendRemoteKey).not.toHaveBeenCalled();
    });
  }

  it('refuses a missing sessionId with 400', async () => {
    const response = await post(await start(), { key: 'escape' });
    expect(response.status).toBe(400);
    expect(sendRemoteKey).not.toHaveBeenCalled();
  });

  it('the real isRemoteKeyId agrees: every rejected value above is really not one of the six', () => {
    for (const key of rejected) {
      expect(isRemoteKeyId(key)).toBe(false);
    }
  });
});

describe('/api/send-key: an allowed key reaches sendRemoteKey exactly once, with exactly what was sent', () => {
  it('forwards sessionId and key, and relays a successful delivery', async () => {
    sendRemoteKey.mockResolvedValueOnce(null);
    const base = await start();
    const response = await post(base, { sessionId: 'row-1', key: 'enter' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, value: null });
    expect(sendRemoteKey).toHaveBeenCalledTimes(1);
    expect(sendRemoteKey).toHaveBeenCalledWith('row-1', 'enter');
  });

  it('relays a refusal from sendRemoteKey verbatim, never re-wrapped', async () => {
    sendRemoteKey.mockResolvedValueOnce({
      kind: 'refused',
      code: 'no-terminal',
      message: 'vam has no terminal it owns for session row-1',
    });
    const base = await start();
    const response = await post(base, { sessionId: 'row-1', key: 'tab' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      error: {
        kind: 'refused',
        code: 'no-terminal',
        message: 'vam has no terminal it owns for session row-1',
      },
    });
  });
});

describe('/api/send-key: no claude-code source, no attempt at all', () => {
  it('refuses without ever calling sendRemoteKey, on a Codex-only deployment', async () => {
    const base = await start({ sources: [makeSource('codex')] });
    const response = await post(base, { sessionId: 's1', key: 'escape' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unsupported:sendKey');
    expect(sendRemoteKey).not.toHaveBeenCalled();
  });
});
