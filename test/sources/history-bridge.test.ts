/**
 * The route a backward page takes to a renderer, on BOTH transports.
 *
 * vam's phone access is `tailscale serve` in front of the remote server, not
 * the Electron bridge (`docs/` and `main/remote/serve.ts`), so a channel wired
 * only to `ipcRenderer.invoke` is a feature that silently does not exist on the
 * surface the operator asked for it on. Every case below is therefore asserted
 * twice: once across a structured-clone IPC boundary, once across the HTTP one.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { registerSourceIpc } from '../../src/main/ipc/handlers.js';
import { FIXTURE_SOURCE } from '../../src/main/sources/fixture-source.js';
import type { MainSource } from '../../src/main/sources/source.js';
import { createPreloadApi } from '../../src/preload/api.js';
import { createHttpSourceApi } from '../../src/renderer/sources/http-factory.js';
import type { TranscriptPage } from '../../src/shared/history.js';

const PAGE: TranscriptPage = {
  kind: 'page',
  turns: [
    {
      id: 'sess-1:@40',
      label: 'claude-code',
      input: 'the older ask',
      output: 'the older answer',
      commands: [],
      errorCount: 0,
    },
  ],
  cursor: 'sess-1:@40',
  reachedStart: false,
};

function ipcPair() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(channel, (...args: unknown[]) => listener({}, ...args));
    },
  };
  const ipcRenderer = {
    async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error(`no handler for ${channel}`);
      return structuredClone(await handler(...(structuredClone(args) as unknown[])));
    },
  };
  return { ipcMain, ipcRenderer, handlers };
}

const sourceWith = (readHistory: MainSource['readHistory']): MainSource => ({
  ...FIXTURE_SOURCE,
  readHistory,
});

/** The api a desktop renderer gets, over a real clone boundary. */
function desktop(source: MainSource) {
  const pair = ipcPair();
  registerSourceIpc(pair.ipcMain, source);
  return { api: createPreloadApi(pair.ipcRenderer), handlers: pair.handlers };
}

/** The api a phone gets: the same calls, over `fetch` against the remote server. */
function browser(routes: Record<string, (body: unknown) => unknown>) {
  const seen: { url: string; body: unknown }[] = [];
  const api = createHttpSourceApi({
    fetch: async (url, init) => {
      const body = init?.body === undefined ? undefined : JSON.parse(init.body);
      seen.push({ url, body });
      const route = routes[url];
      if (route === undefined) {
        return {
          status: 404,
          statusText: 'no such route',
          json: async () => ({ ok: false, error: { kind: 'refused', code: 'no-such-route', message: 'no' } }),
        };
      }
      return { status: 200, statusText: 'OK', json: async () => route(body) };
    },
    openStream: () => ({ addEventListener: () => {}, close: () => {} }),
  });
  return { api, seen };
}

describe('the history channel', () => {
  it('is registered, and carries a page across the clone boundary intact', async () => {
    const { api } = desktop(sourceWith(async () => PAGE));
    await expect(api.history('sess-1#1', null)).resolves.toEqual(PAGE);
  });

  it('hands main the cursor the renderer asked with', async () => {
    const asked: unknown[] = [];
    const { api } = desktop(
      sourceWith(async (sessionId, cursor) => {
        asked.push([sessionId, cursor]);
        return PAGE;
      }),
    );
    await api.history('sess-1#1', 'sess-1:@4096');
    await api.history('sess-1#1', null);
    expect(asked).toEqual([
      ['sess-1#1', 'sess-1:@4096'],
      ['sess-1#1', null],
    ]);
  });

  it('refuses an argument it does not trust, without reaching the source', async () => {
    let reached = false;
    const { api } = desktop(
      sourceWith(async () => {
        reached = true;
        return PAGE;
      }),
    );
    const answer = await api.history('', null);
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error).toMatchObject({ kind: 'refused', code: 'invalid-payload' });
    expect(reached).toBe(false);
  });

  it('says so, rather than throwing, when the source cannot page at all', async () => {
    const { api } = desktop(FIXTURE_SOURCE);
    const answer = await api.history('sess-1', null);
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error.code).toBe('unsupported:history');
  });

  /**
   * The failure this test exists for: a bridge member that REJECTS makes every
   * caller write a try/catch to discover a state the answer type already has a
   * branch for, and the one that forgets draws nothing at all.
   */
  it('turns a transport failure into the unavailable branch, never a rejection', async () => {
    const api = createPreloadApi({
      invoke: async () => {
        throw new Error('the bridge is gone');
      },
    });
    const answer = await api.history('sess-1', null);
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error.message).toContain('the bridge is gone');
  });
});

describe('the history route, which is the one a phone reaches', () => {
  it('asks the remote endpoint and unwraps its envelope', async () => {
    const { api, seen } = browser({
      '/api/history': () => ({ ok: true, value: PAGE }),
    });
    await expect(api.history('sess-1#1', 'sess-1:@40')).resolves.toEqual(PAGE);
    expect(seen).toEqual([
      { url: '/api/history', body: { sessionId: 'sess-1#1', cursor: 'sess-1:@40' } },
    ]);
  });

  it('reports a route the server does not carry as unavailable, not as an empty page', async () => {
    const { api } = browser({});
    const answer = await api.history('sess-1', null);
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error.code).toBe('no-such-route');
    // The one thing it must never look like: a session with nothing older.
    expect(answer).not.toMatchObject({ kind: 'page' });
  });

  it('reports the tunnel being down as unavailable too', async () => {
    const api = createHttpSourceApi({
      fetch: async () => {
        throw new Error('Failed to fetch');
      },
      openStream: () => ({ addEventListener: () => {}, close: () => {} }),
    });
    const answer = await api.history('sess-1', null);
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error.code).toBe('transport-failed');
  });
});
