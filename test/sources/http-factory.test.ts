/**
 * The HTTP twin of the preload bridge.
 *
 * It is a twin and not a second design: `createSourceFromHttp` builds the same
 * `PreloadSourceApi` shape the preload exposes and hands it to the SAME
 * factory, so "absent means absent, never a stub and never a thrower" is
 * honoured by the one module that has ever honoured it. What is asserted here
 * is therefore the transport and the parity, not a re-derived capability rule.
 *
 * Nothing here reaches the network: the fetcher and the event stream are both
 * passed in.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SourceCapabilities } from '../../src/renderer/sources/port.js';
import { canSubscribeTo, canWriteTo } from '../../src/renderer/sources/port.js';
import { createSourceFromHttp, type HttpTransport } from '../../src/renderer/sources/http-factory.js';
import { createSourceFromPreload } from '../../src/renderer/sources/preload-factory.js';
import type { PreloadSourceApi, SourceDescriptor } from '../../src/shared/preload-api.js';

const CAPABILITIES: SourceCapabilities = {
  liveUpdates: true,
  recordPrompt: true,
  deliverPrompt: true,
  promptAttachments: false,
  slashCommands: false,
  renameSession: false,
  closeSession: true,
  createSession: true,
  governance: false,
  pullRequests: false,
  terminal: false,
  agentRoster: false,
};

const DESCRIPTOR: SourceDescriptor = {
  id: 'claude-code' as SourceDescriptor['id'],
  label: 'Claude Code, over HTTP',
  capabilities: CAPABILITIES,
  declines: {
    promptAttachments: 'no attachments over the remote endpoint',
    slashCommands: 'no slash commands over the remote endpoint',
    renameSession: 'the remote endpoint carries no rename route',
    governance: 'the remote endpoint carries no governance routes',
    pullRequests: 'not read remotely',
    terminal: 'the remote endpoint does not expose the terminal surface',
    agentRoster: 'not read remotely',
  },
  viewerScope: { kind: 'connection', note: 'one operator behind one Access policy' },
};

const PROJECTS = [{ id: 'p1', name: 'vam', sessions: [] }] as unknown as Awaited<
  ReturnType<PreloadSourceApi['load']>
>;

type Call = { url: string; init?: { method?: string; body?: string } };

/** A fetcher answering the server's envelopes, recording what was asked. */
function fetcher(
  answers: Record<string, unknown> = {},
): HttpTransport['fetch'] & { calls: Call[] } {
  const calls: Call[] = [];
  const fake = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, init });
    const body = answers[new URL(url, 'http://vam.test').pathname] ?? { ok: true, value: null };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    };
  }) as HttpTransport['fetch'] & { calls: Call[] };
  fake.calls = calls;
  return fake;
}

const READS = {
  '/api/describe': { ok: true, value: DESCRIPTOR },
  '/api/load': { ok: true, value: PROJECTS },
};

/** A stand-in for `EventSource`: one listener, ticked by the test. */
function stream() {
  const listeners: (() => void)[] = [];
  let closed = false;
  const open: HttpTransport['openStream'] = () => ({
    addEventListener: (_type, listener) => listeners.push(listener),
    close: () => {
      closed = true;
    },
  });
  return { open, tick: () => listeners.forEach((l) => l()), isClosed: () => closed };
}

describe('createSourceFromHttp', () => {
  it('builds the same source the preload factory builds from one descriptor', async () => {
    const api = {
      describe: async () => DESCRIPTOR,
      load: async () => PROJECTS,
      subscribe: () => () => {},
    } as unknown as PreloadSourceApi;
    const bridged = await createSourceFromPreload(api);
    const overHttp = await createSourceFromHttp({
      fetch: fetcher(READS),
      openStream: stream().open,
    });

    expect(overHttp.id).toBe(bridged.id);
    expect(overHttp.capabilities).toEqual(bridged.capabilities);
    expect(Object.keys(overHttp).sort()).toEqual(Object.keys(bridged).sort());
    expect(Object.keys(overHttp.write ?? {}).sort()).toEqual(Object.keys(bridged.write ?? {}).sort());
  });

  it('reads the model through /api/load', async () => {
    const fetch = fetcher(READS);
    const source = await createSourceFromHttp({ fetch, openStream: stream().open });
    expect(await source.load()).toEqual(PROJECTS);
    expect(fetch.calls.map((c) => c.url)).toContain('/api/load');
  });

  it('leaves a capability the server does not offer ABSENT, not present-and-failing', async () => {
    const source = await createSourceFromHttp({ fetch: fetcher(READS), openStream: stream().open });
    expect(source.capabilities.terminal).toBe(false);
    expect(source.governance).toBeUndefined();
    expect('governance' in source).toBe(false);
    expect(canWriteTo(source)).toBe(true);
    // `renameSession` is false in the served descriptor, so the member the
    // canvas would call must not exist at all.
    expect(source.write?.renameSession).toBeUndefined();
    expect('renameSession' in (source.write ?? {})).toBe(false);
    expect(source.declines.terminal).toMatch(/terminal/i);
  });

  it('drives an update from the server’s change stream', async () => {
    const sse = stream();
    const source = await createSourceFromHttp({ fetch: fetcher(READS), openStream: sse.open });
    expect(canSubscribeTo(source)).toBe(true);
    const onChange = vi.fn();
    const stop = canSubscribeTo(source) ? source.subscribe(onChange) : () => {};
    sse.tick();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(sse.isClosed()).toBe(true);
  });

  it('posts a write to its own route', async () => {
    const fetch = fetcher(READS);
    const source = await createSourceFromHttp({ fetch, openStream: stream().open });
    if (!canWriteTo(source)) throw new Error('the fixture descriptor says it can write');
    await source.write.recordPrompt('s1', 'hello');
    const call = fetch.calls.find((c) => c.url === '/api/record-prompt');
    expect(call?.init?.method).toBe('POST');
    expect(JSON.parse(call?.init?.body ?? '{}')).toEqual({ sessionId: 's1', prompt: 'hello' });
  });

  it('rethrows the server’s refusal whole, so its code survives the transport', async () => {
    const source = await createSourceFromHttp({
      fetch: fetcher({
        ...READS,
        '/api/close-session': {
          ok: false,
          error: { kind: 'refused', code: 'session-running', message: 'that one is busy' },
        },
      }),
      openStream: stream().open,
    });
    if (!canWriteTo(source)) throw new Error('the fixture descriptor says it can write');
    await expect(source.write.closeSession?.('s1')).rejects.toMatchObject({
      code: 'session-running',
    });
  });

  it('turns a dead transport into a SourceError rather than a raw network throw', async () => {
    const dead = (async () => {
      throw new Error('connection reset');
    }) as unknown as HttpTransport['fetch'];
    await expect(createSourceFromHttp({ fetch: dead, openStream: stream().open })).rejects.toMatchObject(
      { kind: 'unreachable' },
    );
  });
});
