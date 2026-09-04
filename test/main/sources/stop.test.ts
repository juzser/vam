/**
 * Stopping a background Claude Code session.
 *
 * The spawn itself is never exercised -- running `claude stop` in a test
 * would kill one of the operator's real sessions. Argv, classification and
 * the interactive refusal are pure, and they are what this asserts, exactly
 * as `deliver.test.ts`'s subject is split.
 */

import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { registerSourceIpc } from '../../../src/main/ipc/handlers.js';
import { CLAUDE_CODE_SOURCE } from '../../../src/main/sources/claude-code/source.js';
import type { MainSource } from '../../../src/main/sources/source.js';
import {
  classifyStopFailure,
  stopArgv,
  stopSession,
  type StoppableAgent,
} from '../../../src/main/sources/claude-code/stop.js';

const background: StoppableAgent = {
  key: 'sess-1#4242',
  sessionId: 'sess-1',
  kind: 'background',
  name: 'nightly sweep',
};
const interactive: StoppableAgent = {
  key: 'sess-2#77',
  sessionId: 'sess-2',
  kind: 'interactive',
  name: 'my terminal',
};

describe('stopArgv', () => {
  it('is exactly `stop <sessionId>`, with the id as one element', () => {
    expect(stopArgv('sess-1')).toEqual(['stop', 'sess-1']);
  });

  it('never carries the row id, whose `#<pid>` half is not a session', () => {
    expect(stopArgv('sess-1')).not.toContain('sess-1#4242');
  });
});

describe('stopSession', () => {
  it('stops a background session and reports success', async () => {
    const stop = vi.fn(async () => null);
    await expect(stopSession([background], 'sess-1#4242', stop)).resolves.toBeNull();
    expect(stop).toHaveBeenCalledWith('sess-1');
  });

  it('SPAWNS NOTHING for an interactive session and names the real remedy', async () => {
    const stop = vi.fn(async () => null);
    const error = await stopSession([interactive], 'sess-2#77', stop);
    expect(stop).not.toHaveBeenCalled();
    expect(error?.kind).toBe('refused');
    expect(error?.code).toBe('interactive-session');
    expect(error?.message).toContain('my terminal');
    expect(error?.message).toMatch(/terminal/i);
  });

  it('reports a stop failure rather than claiming the session went away', async () => {
    const failure = { kind: 'refused', code: 'cli-failed', message: 'no' } as const;
    const stop = vi.fn(async () => failure);
    await expect(stopSession([background], 'sess-1#4242', stop)).resolves.toEqual(failure);
  });

  it('refuses a row it cannot find, rather than stopping some other session', async () => {
    const stop = vi.fn(async () => null);
    const error = await stopSession([background], 'ghost#1', stop);
    expect(stop).not.toHaveBeenCalled();
    expect(error?.code).toBe('unknown-session');
  });
});

describe('classifyStopFailure', () => {
  it('calls a missing binary unreachable', () => {
    expect(
      classifyStopFailure({ failure: { message: 'x', code: 'ENOENT' }, stderr: '', sessionId: 's' })
        .kind,
    ).toBe('unreachable');
  });

  it('calls a timeout unreachable', () => {
    const error = classifyStopFailure({
      failure: { message: 'x', killed: true },
      stderr: '',
      sessionId: 's',
    });
    expect(error.kind).toBe('unreachable');
    expect(error.code).toBe('timed-out');
  });

  it("carries the CLI's own words for anything else", () => {
    const error = classifyStopFailure({
      failure: { message: 'exit 1' },
      stderr: 'no such background session',
      sessionId: 's',
    });
    expect(error.kind).toBe('refused');
    expect(error.code).toBe('cli-failed');
    expect(error.message).toContain('no such background session');
  });

  it('falls back to the spawn message when the CLI said nothing', () => {
    expect(
      classifyStopFailure({ failure: { message: 'exit 1' }, stderr: '   ', sessionId: 's' }).message,
    ).toContain('exit 1');
  });
});

describe('the close-session channel, once the source can actually stop one', () => {
  const descriptor = {
    id: 'test',
    label: 'test',
    capabilities: {
      liveUpdates: false,
      recordPrompt: false,
      deliverPrompt: false,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: true,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines: {},
    viewerScope: { kind: 'connection' as const, note: 'test' },
  };

  const wire = (source: MainSource) => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerSourceIpc({ handle: (c, l) => void handlers.set(c, l) }, source);
    return (...args: unknown[]) => handlers.get(CHANNELS.closeSession)?.({}, ...args);
  };

  it('reaches the source instead of answering not-implemented', async () => {
    const seen: string[] = [];
    const call = wire({
      descriptor,
      load: () => Promise.resolve([]),
      closeSession: async (sessionId) => {
        seen.push(sessionId);
        return null;
      },
    });
    expect(await call('sess#1')).toEqual({ ok: true, value: undefined });
    expect(seen).toEqual(['sess#1']);
  });

  it("returns the source's refusal with its code and message intact", async () => {
    const refusal = { kind: 'refused' as const, code: 'interactive-session', message: 'yours' };
    const call = wire({
      descriptor,
      load: () => Promise.resolve([]),
      closeSession: async () => refusal,
    });
    expect(await call('sess#1')).toEqual({ ok: false, error: refusal });
  });

  it('validates before it ever reaches the source', async () => {
    let called = false;
    const call = wire({
      descriptor,
      load: () => Promise.resolve([]),
      closeSession: async () => {
        called = true;
        return null;
      },
    });
    const result = (await call('')) as { ok: boolean; error: { code: string } };
    expect(result.error.code).toBe('invalid-payload');
    expect(called).toBe(false);
  });
});

describe('the Claude Code source itself', () => {
  it('advertises closeSession and carries a member for it', () => {
    expect(CLAUDE_CODE_SOURCE.descriptor.capabilities.closeSession).toBe(true);
    expect(CLAUDE_CODE_SOURCE.descriptor.declines.closeSession).toBeUndefined();
    expect(typeof CLAUDE_CODE_SOURCE.closeSession).toBe('function');
  });
});
