/**
 * The retired delivery channel, and what survived it.
 *
 * `deliver.ts` once ran `claude --resume <id> -p`. That channel is gone (its
 * own header carries the argument), so there is nothing here to spawn and no
 * argv to classify. What remains is one pure helper -- `sessionIdOf`, which
 * turns a renderer row id into the session it addresses -- and the generic IPC
 * write surface, which routes `recordPrompt` to whatever a source implements.
 *
 * No spawn, no tmux, no network. Every identifier here is invented.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { registerSourceIpc } from '../../src/main/ipc/handlers.js';
import { sessionIdOf } from '../../src/main/sources/claude-code/deliver.js';
import type { MainSource } from '../../src/main/sources/source.js';

// Invented, not a real session id: vam is public.
const SESSION = '11111111-2222-3333-4444-555555555555';

describe('sessionIdOf', () => {
  it('recovers the bare session id from a row key that carries the process id', () => {
    expect(sessionIdOf(`${SESSION}#4399`)).toBe(SESSION);
  });

  it('leaves a bare session id alone', () => {
    expect(sessionIdOf(SESSION)).toBe(SESSION);
  });
});

describe('registerSourceIpc, once a source can actually write', () => {
  const descriptorWith = (recordPrompt: boolean) => ({
    id: 'test',
    label: 'test',
    capabilities: {
      liveUpdates: false,
      recordPrompt,
      deliverPrompt: recordPrompt,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: false,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines: recordPrompt ? {} : { recordPrompt: 'no' },
    viewerScope: { kind: 'connection' as const, note: 'test' },
  });

  const wire = (source: MainSource) => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerSourceIpc({ handle: (c, l) => void handlers.set(c, l) }, source);
    return (...args: unknown[]) => handlers.get(CHANNELS.recordPrompt)?.({}, ...args);
  };

  it('reaches the source write surface instead of answering not-implemented', async () => {
    const seen: [string, string][] = [];
    const call = wire({
      descriptor: descriptorWith(true),
      load: () => Promise.resolve([]),
      recordPrompt: async (sessionId, prompt) => {
        seen.push([sessionId, prompt]);
        return null;
      },
    });
    expect(await call('sess', 'hello')).toEqual({ ok: true, value: undefined });
    expect(seen).toEqual([['sess', 'hello']]);
  });

  it("returns the source's refusal with its own code and message intact", async () => {
    const refusal = { kind: 'refused' as const, code: 'no-terminal', message: 'no pane' };
    const call = wire({
      descriptor: descriptorWith(true),
      load: () => Promise.resolve([]),
      recordPrompt: async () => refusal,
    });
    expect(await call('sess', 'hello')).toEqual({ ok: false, error: refusal });
  });

  it('still refuses when the capability is advertised but no write surface exists', async () => {
    const call = wire({ descriptor: descriptorWith(true), load: () => Promise.resolve([]) });
    const result = (await call('sess', 'hello')) as { ok: boolean; error: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('not-implemented');
  });

  it('still validates before it ever reaches the write surface', async () => {
    let called = false;
    const call = wire({
      descriptor: descriptorWith(true),
      load: () => Promise.resolve([]),
      recordPrompt: async () => {
        called = true;
        return null;
      },
    });
    const result = (await call('', 'hello')) as { ok: boolean; error: { code: string } };
    expect(result.error.code).toBe('invalid-payload');
    expect(called).toBe(false);
  });

  it("refuses in the source's own words when the capability is false", async () => {
    const call = wire({
      descriptor: descriptorWith(false),
      load: () => Promise.resolve([]),
      recordPrompt: async () => null,
    });
    const result = (await call('sess', 'hello')) as { ok: boolean; error: { message: string } };
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe('no');
  });
});
