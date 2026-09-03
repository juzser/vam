/**
 * Delivering a prompt into an existing Claude Code session.
 *
 * Argv construction and failure mapping are pure functions and are tested as
 * such. NO TEST SPAWNS `claude`, and no test writes into a real session: the
 * one thing this module does is append to the operator's own working
 * sessions, and a test suite that did that would be a bug with a green tick.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { registerSourceIpc } from '../../src/main/ipc/handlers.js';
import {
  classifyDeliverFailure,
  deliverArgv,
  deliverToSession,
  readDeliverResult,
  sessionIdOf,
} from '../../src/main/sources/claude-code/deliver.js';
import type { MainSource } from '../../src/main/sources/source.js';

const SESSION = '077b4475-75ae-498b-9c27-58f559d29294';

describe('deliverArgv', () => {
  it('resumes the named session and passes the prompt as one argv element', () => {
    const argv = deliverArgv(SESSION, 'ship it');
    expect(argv).toEqual(['--resume', SESSION, '-p', 'ship it', '--output-format', 'json']);
  });

  it('keeps a prompt full of shell metacharacters as a single unmangled element', () => {
    const nasty = '"; rm -rf / #$(whoami) `id` \\ && echo';
    expect(deliverArgv(SESSION, nasty)).toContain(nasty);
    expect(deliverArgv(SESSION, nasty)).toHaveLength(6);
  });

  it('never forks the session, which would answer into a copy', () => {
    expect(deliverArgv(SESSION, 'anything')).not.toContain('--fork-session');
  });
});

describe('sessionIdOf', () => {
  it('recovers the bare session id from a row key that carries the process id', () => {
    expect(sessionIdOf(`${SESSION}#4399`)).toBe(SESSION);
  });

  it('leaves a bare session id alone', () => {
    expect(sessionIdOf(SESSION)).toBe(SESSION);
  });
});

describe('classifyDeliverFailure', () => {
  const refusal =
    "Error: Session 077b4475 is running as a background session (abc123). Run 'claude attach abc123' to open it, or 'claude stop abc123' first to resume it here. Add --fork-session to branch off a copy instead.";

  it('maps a busy session onto a refusal that names the session and says it is running', () => {
    const error = classifyDeliverFailure({
      failure: new Error('exit 1'),
      stderr: refusal,
      sessionId: SESSION,
    });
    expect(error.kind).toBe('refused');
    expect(error.code).toBe('session-running');
    expect(error.message).toContain(SESSION);
    expect(error.message.toLowerCase()).toContain('running');
  });

  it("keeps the CLI's own remedy in the message rather than inventing one", () => {
    const error = classifyDeliverFailure({
      failure: new Error('exit 1'),
      stderr: refusal,
      sessionId: SESSION,
    });
    expect(error.message).toContain('claude stop');
  });

  it('maps a missing CLI onto unreachable, not onto a refusal', () => {
    const failure = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const error = classifyDeliverFailure({ failure, stderr: '', sessionId: SESSION });
    expect(error.kind).toBe('unreachable');
    expect(error.code).toBe('cli-missing');
  });

  it('maps a timeout onto unreachable', () => {
    const failure = Object.assign(new Error('timeout'), { killed: true });
    const error = classifyDeliverFailure({ failure, stderr: '', sessionId: SESSION });
    expect(error.kind).toBe('unreachable');
    expect(error.code).toBe('timed-out');
  });

  it('falls back to the CLI stderr for an exit it does not recognise', () => {
    const error = classifyDeliverFailure({
      failure: new Error('exit 2'),
      stderr: 'Error: something else entirely',
      sessionId: SESSION,
    });
    expect(error.code).toBe('cli-failed');
    expect(error.message).toContain('something else entirely');
    expect(error.message).toContain(SESSION);
  });

  it('still names the session when the CLI said nothing at all', () => {
    const error = classifyDeliverFailure({
      failure: new Error('exit 2'),
      stderr: '',
      sessionId: SESSION,
    });
    expect(error.message).toContain(SESSION);
    expect(error.message.length).toBeGreaterThan(SESSION.length);
  });
});

describe('readDeliverResult', () => {
  const ok = JSON.stringify({
    session_id: SESSION,
    result: 'done',
    num_turns: 2,
    is_error: false,
  });

  it('accepts a successful delivery to the session that was addressed', () => {
    expect(readDeliverResult(ok, SESSION)).toBeNull();
  });

  it('reports is_error from the CLI as a refusal carrying its result text', () => {
    const body = JSON.stringify({ session_id: SESSION, result: 'model refused', is_error: true });
    const error = readDeliverResult(body, SESSION);
    expect(error?.kind).toBe('refused');
    expect(error?.message).toContain('model refused');
  });

  it('refuses a reply that came back for a DIFFERENT session, which would mean a fork', () => {
    const body = JSON.stringify({ session_id: 'some-other-id', result: 'done', is_error: false });
    const error = readDeliverResult(body, SESSION);
    expect(error).not.toBeNull();
    expect(error?.code).toBe('wrong-session');
  });

  it('maps unparseable output onto unreachable rather than throwing', () => {
    expect(readDeliverResult('not json at all', SESSION)?.kind).toBe('unreachable');
    expect(readDeliverResult('', SESSION)?.code).toBe('bad-response');
  });
});

describe('deliverToSession', () => {
  const agents = [
    {
      key: `${SESSION}#1`,
      sessionId: SESSION,
      name: 'a',
      cwd: '/w/alpha',
      status: 'waiting' as const,
      startedAt: 1,
    },
    {
      key: `${SESSION}#2`,
      sessionId: SESSION,
      name: 'b',
      cwd: '/w/alpha',
      status: 'running' as const,
      startedAt: 2,
    },
  ];

  it('runs the delivery in the working directory the session belongs to', async () => {
    const seen: { sessionId: string; prompt: string; cwd: string }[] = [];
    const error = await deliverToSession(agents, `${SESSION}#1`, 'ship it', async (input) => {
      seen.push(input);
      return null;
    });
    expect(error).toBeNull();
    expect(seen).toEqual([{ sessionId: SESSION, prompt: 'ship it', cwd: '/w/alpha' }]);
  });

  it('addresses a bare session id too, not only a row key', async () => {
    const seen: string[] = [];
    await deliverToSession(agents, SESSION, 'x', async ({ cwd }) => {
      seen.push(cwd);
      return null;
    });
    expect(seen).toEqual(['/w/alpha']);
  });

  it('refuses a session the CLI does not list, rather than guessing a directory', async () => {
    let called = false;
    const error = await deliverToSession(agents, 'not-a-session#9', 'x', async () => {
      called = true;
      return null;
    });
    expect(called).toBe(false);
    expect(error?.kind).toBe('refused');
    expect(error?.code).toBe('unknown-session');
    expect(error?.message).toContain('not-a-session');
  });

  it('passes the delivery failure straight through, losing neither code nor message', async () => {
    const refusal = {
      kind: 'refused' as const,
      code: 'session-running',
      message: 'busy, try stop',
    };
    const error = await deliverToSession(agents, `${SESSION}#2`, 'x', async () => refusal);
    expect(error).toEqual(refusal);
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
    const refusal = { kind: 'refused' as const, code: 'session-running', message: 'busy' };
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
