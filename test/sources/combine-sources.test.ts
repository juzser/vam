/**
 * Main holds a LIST of sources, and this is what a list of one, of none, and
 * of several each has to be.
 *
 * The property that matters most here is the FIRST one: a list of one member
 * must be that member, byte for byte, because Stage 0 of
 * `docs/design/a-second-source.md` is an architecture change that must carry
 * no behaviour with it. Everything else in this file is about a list of two,
 * which is what Stage 1 makes real.
 *
 * Every id, path and label below is invented. Nothing here reads the machine
 * it runs on.
 */

import { describe, expect, it } from 'vitest';
import { combineSources } from '../../src/main/sources/combine.js';
import type { MainSource } from '../../src/main/sources/source.js';
import type { Project } from '../../src/renderer/domain/model.js';
import type { SourceCapabilities, SourceDeclines } from '../../src/renderer/sources/port.js';

const NONE: SourceCapabilities = {
  liveUpdates: false,
  recordPrompt: false,
  deliverPrompt: false,
  promptAttachments: false,
  slashCommands: false,
  renameSession: false,
  closeSession: false,
  createSession: false,
  governance: false,
  pullRequests: false,
  terminal: false,
  agentRoster: false,
};

const session = (id: string) => ({
  id,
  title: id,
  icon: null,
  epic: null,
  status: 'idle' as const,
  runningAgents: 0,
  activity: null,
  age: null,
  branch: null,
  agents: [],
  decisions: [],
});

const project = (id: string, source: string, sessions: readonly string[]): Project => ({
  id,
  name: id,
  source,
  sessions: sessions.map(session),
});

function make(
  id: string,
  over: Partial<MainSource> & { readonly caps?: Partial<SourceCapabilities> } = {},
): MainSource {
  const { caps, ...rest } = over;
  return {
    descriptor: {
      id,
      label: id,
      capabilities: { ...NONE, ...caps },
      declines: {} as SourceDeclines,
      viewerScope: { kind: 'connection', note: `${id} note` },
    },
    load: () => Promise.resolve([]),
    ...rest,
  };
}

describe('combineSources, on a list of one', () => {
  it('is that source itself -- Stage 0 changes the shape and nothing else', () => {
    const only = make('claude-code');
    expect(combineSources([only])).toBe(only);
  });
});

describe('combineSources, on a list of none', () => {
  it('declines everything rather than claiming an empty canvas', async () => {
    const empty = combineSources([]);
    expect(Object.values(empty.descriptor.capabilities).every((v) => v === false)).toBe(true);
    // Every false capability carries words, which is `port.ts`'s rule.
    for (const key of Object.keys(NONE) as (keyof SourceCapabilities)[]) {
      expect(empty.descriptor.declines[key]).toBeTruthy();
    }
    await expect(empty.load()).resolves.toEqual([]);
  });
});

describe('combineSources, on a list of two', () => {
  it('concatenates the projects in the order the sources were given', async () => {
    const a = make('a', { load: () => Promise.resolve([project('p-a', 'a', ['s-a'])]) });
    const b = make('b', { load: () => Promise.resolve([project('p-b', 'b', ['s-b'])]) });
    const both = await combineSources([a, b]).load();
    expect(both.map((p) => p.id)).toEqual(['p-a', 'p-b']);
  });

  it('keeps one source answering when the other rejects', async () => {
    const a = make('a', { load: () => Promise.reject(new Error('a is broken')) });
    const b = make('b', { load: () => Promise.resolve([project('p-b', 'b', ['s-b'])]) });
    await expect(combineSources([a, b]).load()).resolves.toEqual([project('p-b', 'b', ['s-b'])]);
  });

  it('rejects, naming every source, only when no source answered at all', async () => {
    const a = make('a', { load: () => Promise.reject(new Error('a is broken')) });
    const b = make('b', { load: () => Promise.reject(new Error('b is broken')) });
    await expect(combineSources([a, b]).load()).rejects.toThrow(/a is broken.*b is broken/s);
  });

  it('ORs the capabilities and carries each member descriptor whole', () => {
    const a = make('a', { caps: { terminal: true, recordPrompt: true } });
    const b = make('b', { caps: { recordPrompt: true } });
    const combined = combineSources([a, b]).descriptor;
    expect(combined.capabilities.terminal).toBe(true);
    expect(combined.capabilities.recordPrompt).toBe(true);
    expect(combined.capabilities.governance).toBe(false);
    expect(combined.members?.map((m) => m.id)).toEqual(['a', 'b']);
    expect(combined.members?.[0]).toBe(a.descriptor);
  });

  it('attributes a decline to the source that wrote it, so two never merge into one', () => {
    const a = make('a', { caps: { terminal: true } });
    const b: MainSource = {
      ...make('b'),
      descriptor: {
        ...make('b').descriptor,
        declines: { terminal: 'b has no pane' },
      },
    };
    const combined = combineSources([a, b]).descriptor;
    // `terminal` is TRUE for the combination -- one member has it -- so the
    // combined declines must not carry b's words as though nobody had it.
    expect(combined.declines.terminal).toBeUndefined();
    expect(combined.members?.[1]?.declines.terminal).toBe('b has no pane');
  });

  it('carries a false capability with the declining sources named', () => {
    const a: MainSource = {
      ...make('a'),
      descriptor: { ...make('a').descriptor, declines: { governance: 'a keeps no ledger' } },
    };
    const b: MainSource = {
      ...make('b'),
      descriptor: { ...make('b').descriptor, declines: { governance: 'b keeps no ledger' } },
    };
    const combined = combineSources([a, b]).descriptor;
    expect(combined.declines.governance).toContain('a keeps no ledger');
    expect(combined.declines.governance).toContain('b keeps no ledger');
  });
});

describe('combineSources routing', () => {
  const load = (id: string, sessions: readonly string[]) => () =>
    Promise.resolve([project(`p-${id}`, id, sessions)]);

  it('sends a write to the source whose load() produced that session', async () => {
    const reached: string[] = [];
    const a = make('a', {
      caps: { recordPrompt: true },
      load: load('a', ['s-a']),
      recordPrompt: async (id) => {
        reached.push(`a:${id}`);
        return null;
      },
    });
    const b = make('b', {
      caps: { recordPrompt: true },
      load: load('b', ['s-b']),
      recordPrompt: async (id) => {
        reached.push(`b:${id}`);
        return null;
      },
    });
    const combined = combineSources([a, b]);
    await combined.load();
    expect(await combined.recordPrompt?.('s-b', 'hello')).toBeNull();
    expect(reached).toEqual(['b:s-b']);
  });

  it('refuses a session no source has ever claimed rather than guessing', async () => {
    const a = make('a', {
      caps: { recordPrompt: true },
      load: load('a', ['s-a']),
      recordPrompt: async () => null,
    });
    const combined = combineSources([a]);
    // A list of one IS the member, so route through a list of two to reach
    // the combining code with a session nobody owns.
    const two = combineSources([a, make('b', { load: load('b', ['s-b']) })]);
    await two.load();
    expect(await two.recordPrompt?.('s-nobody', 'hello')).toMatchObject({
      kind: 'refused',
      code: 'unknown-session',
    });
    expect(combined).toBe(a);
  });

  it('refuses a write issued before any load(), because nothing is claimed yet', async () => {
    const a = make('a', { caps: { recordPrompt: true }, recordPrompt: async () => null });
    const b = make('b', { caps: { recordPrompt: true }, recordPrompt: async () => null });
    expect(await combineSources([a, b]).recordPrompt?.('s-a', 'hi')).toMatchObject({
      code: 'unknown-session',
    });
  });

  it('routes createSession by PROJECT id, which is the only id it is given', async () => {
    const reached: string[] = [];
    const a = make('a', {
      caps: { createSession: true, recordPrompt: true },
      load: load('a', ['s-a']),
      createSession: async (p) => {
        reached.push(`a:${p}`);
        return null;
      },
    });
    const b = make('b', {
      caps: { createSession: true, recordPrompt: true },
      load: load('b', ['s-b']),
      createSession: async (p) => {
        reached.push(`b:${p}`);
        return null;
      },
    });
    const combined = combineSources([a, b]);
    await combined.load();
    await combined.createSession?.('p-b', 'a title');
    expect(reached).toEqual(['b:p-b']);
  });

  it('routes a history read to the owning source and answers unavailable for an unknown one', async () => {
    const a = make('a', {
      load: load('a', ['s-a']),
      readHistory: async () => ({ kind: 'page', turns: [], cursor: null, reachedStart: true }),
    });
    const b = make('b', { load: load('b', ['s-b']) });
    const combined = combineSources([a, b]);
    await combined.load();
    expect(await combined.readHistory?.('s-a', null)).toMatchObject({ kind: 'page' });
    expect(await combined.readHistory?.('s-nobody', null)).toMatchObject({
      kind: 'unavailable',
    });
    // b carries no `readHistory` member at all: that is an answer, not a crash.
    expect(await combined.readHistory?.('s-b', null)).toMatchObject({ kind: 'unavailable' });
  });

  it('answers an agent-work read for an unknown session without reaching a source', async () => {
    const a = make('a', { load: load('a', ['s-a']) });
    const b = make('b', { load: load('b', ['s-b']) });
    const combined = combineSources([a, b]);
    await combined.load();
    expect(await combined.readAgentWork?.('s-nobody', 'agent-1')).toMatchObject({
      kind: 'unavailable',
    });
  });
});
