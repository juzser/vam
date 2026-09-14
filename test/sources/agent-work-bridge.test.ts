/**
 * The route one subagent's work takes to a renderer, on BOTH transports.
 *
 * The rule `history-bridge.test.ts` states and this file obeys: vam's phone
 * access is `tailscale serve` in front of the remote server, not the Electron
 * bridge, so a channel wired only to `ipcRenderer.invoke` is a feature that
 * silently does not exist on the surface the operator asked for it on. The
 * Agents tab is exactly the kind of thing someone opens while away from the
 * machine, so every case below is asserted twice.
 */

import { describe, expect, it } from 'vitest';
import { registerSourceIpc } from '../../src/main/ipc/handlers.js';
import { FIXTURE_SOURCE } from '../../src/main/sources/fixture-source.js';
import type { MainSource } from '../../src/main/sources/source.js';
import { createPreloadApi } from '../../src/preload/api.js';
import { createHttpSourceApi } from '../../src/renderer/sources/http-factory.js';
import type { AgentWork } from '../../src/shared/agent-work.js';

const WORK: AgentWork = {
  kind: 'work',
  turns: [
    {
      id: 'agent-a:tail:0',
      label: 'agent-a',
      input: 'the brief the parent wrote',
      output: 'what it has said so far',
      commands: [],
      errorCount: 0,
      promptedAt: '2026-01-01T10:00:00.000Z',
      latestAt: '2026-01-01T10:05:00.000Z',
      steps: [{ id: 'agent-a:tail:0:0', label: 'Bash: run the tests', failed: false }],
    },
  ],
  brief: null,
  whole: true,
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

const sourceWith = (readAgentWork: MainSource['readAgentWork']): MainSource => ({
  ...FIXTURE_SOURCE,
  readAgentWork,
});

/** The api a desktop renderer gets, over a real clone boundary. */
function desktop(source: MainSource) {
  const pair = ipcPair();
  registerSourceIpc(pair.ipcMain, source);
  return { api: createPreloadApi(pair.ipcRenderer), handlers: pair.handlers };
}

/** The api a phone gets: the same call, over `fetch` against the remote server. */
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
          json: async () => ({
            ok: false,
            error: { kind: 'refused', code: 'no-such-route', message: 'no' },
          }),
        };
      }
      return { status: 200, statusText: 'OK', json: async () => route(body) };
    },
    openStream: () => ({ addEventListener: () => {}, close: () => {} }),
  });
  return { api, seen };
}

describe('the agent-work channel, on the desktop bridge', () => {
  it('is registered, and carries the work across the clone boundary intact', async () => {
    const { api } = desktop(sourceWith(async () => WORK));
    await expect(api.agentWork('sess-1#1', 'agent-a')).resolves.toEqual(WORK);
  });

  it('hands main the row and the agent the renderer asked about', async () => {
    const asked: unknown[] = [];
    const { api } = desktop(
      sourceWith(async (sessionId, agentId) => {
        asked.push([sessionId, agentId]);
        return WORK;
      }),
    );
    await api.agentWork('sess-1#1', 'agent-a');
    expect(asked).toEqual([['sess-1#1', 'agent-a']]);
  });

  /**
   * THE AGENT ID IS NOT TRUSTED AT THE BOUNDARY EITHER. `agent-work.ts` checks
   * it again before it becomes a path -- two checks, because this one is about
   * the SHAPE of the call and that one is about what a file name may be.
   */
  it('refuses an argument it does not trust, without reaching the source', async () => {
    let reached = false;
    const { api } = desktop(
      sourceWith(async () => {
        reached = true;
        return WORK;
      }),
    );
    for (const [sessionId, agentId] of [
      ['', 'agent-a'],
      ['sess-1', ''],
    ]) {
      const answer = await api.agentWork(sessionId as string, agentId as string);
      expect(answer.kind).toBe('unavailable');
      if (answer.kind !== 'unavailable') return;
      expect(answer.error).toMatchObject({ kind: 'refused', code: 'invalid-payload' });
    }
    expect(reached).toBe(false);
  });

  it('says so, rather than throwing, when the source has no agent surface', async () => {
    const { api } = desktop(FIXTURE_SOURCE);
    const answer = await api.agentWork('sess-1', 'agent-a');
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error.code).toBe('unsupported:agent-work');
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
    const answer = await api.agentWork('sess-1', 'agent-a');
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error.code).toBe('bridge-failed');
  });

  /**
   * AND AN ORDINARY EMPTY ANSWER IS NOT A FAILURE. An agent that has been
   * asked something and has not answered yet is the commonest thing the
   * operator will open this tab onto.
   */
  it('carries a read with no turns as work, not as an error', async () => {
    const empty: AgentWork = { kind: 'work', turns: [], brief: null, whole: true };
    const { api } = desktop(sourceWith(async () => empty));
    await expect(api.agentWork('sess-1', 'agent-a')).resolves.toEqual(empty);
  });
});

describe('the agent-work channel, on the phone', () => {
  it('asks the route the server registers, with the row and the agent', async () => {
    const { api, seen } = browser({
      '/api/agent-work': () => ({ ok: true, value: WORK }),
    });
    await expect(api.agentWork('sess-1#1', 'agent-a')).resolves.toEqual(WORK);
    expect(seen).toEqual([
      { url: '/api/agent-work', body: { sessionId: 'sess-1#1', agentId: 'agent-a' } },
    ]);
  });

  /**
   * THE ONE THIS FILE EXISTS FOR. A channel wired to IPC alone answers
   * `no-such-route` here -- which is a real answer and not a crash, and it must
   * land in the arm the type already has rather than as a rejection.
   */
  it('turns an unregistered route into the unavailable branch', async () => {
    const { api } = browser({});
    const answer = await api.agentWork('sess-1', 'agent-a');
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error.code).toBe('no-such-route');
  });

  it('forwards the source’s own words when the server could not read', async () => {
    const { api } = browser({
      '/api/agent-work': () => ({
        ok: true,
        value: {
          kind: 'unavailable',
          error: { kind: 'unreachable', code: 'agent:unreadable', message: 'could not open it' },
        },
      }),
    });
    const answer = await api.agentWork('sess-1', 'agent-a');
    expect(answer.kind === 'unavailable' && answer.error.code).toBe('agent:unreadable');
  });

  it('turns a dead tunnel into the unavailable branch, never a rejection', async () => {
    const api = createHttpSourceApi({
      fetch: async () => {
        throw new Error('network down');
      },
      openStream: () => ({ addEventListener: () => {}, close: () => {} }),
    });
    const answer = await api.agentWork('sess-1', 'agent-a');
    expect(answer.kind).toBe('unavailable');
    if (answer.kind !== 'unavailable') return;
    expect(answer.error.code).toBe('transport-failed');
  });
});
