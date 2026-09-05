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
import { projectIdOf } from '../../../src/main/sources/claude-code/project-id.js';
import { CLAUDE_CODE_SOURCE } from '../../../src/main/sources/claude-code/source.js';
import {
  classifyStopFailure,
  type StoppableAgent,
  stopArgv,
  stopSession,
} from '../../../src/main/sources/claude-code/stop.js';
import type { MainSource } from '../../../src/main/sources/source.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';

const background: StoppableAgent = {
  key: 'sess-1#4242',
  sessionId: 'sess-1',
  kind: 'background',
  name: 'nightly sweep',
  cwd: '/w/alpha',
};
const interactive: StoppableAgent = {
  key: 'sess-2#77',
  sessionId: 'sess-2',
  kind: 'interactive',
  name: 'my terminal',
  cwd: '/w/beta',
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

  it("says so plainly when the CLI said nothing, without republishing node's argv", () => {
    // node's ExecException.message is `Command failed: <file> <args joined>`.
    // Repeating it here put the spawned argv into the error log and from
    // there into a prefilled PUBLIC issue body -- the same fallback in
    // `deliver.ts` carried the operator's whole prompt out that way.
    const error = classifyStopFailure({
      failure: { message: 'Command failed: claude stop 1234-abcd' },
      stderr: '   ',
      sessionId: 's',
    });
    expect(error.message).not.toContain('Command failed');
    expect(error.message).toContain('s');
    expect(error.message.length).toBeLessThan(200);
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

/**
 * A session vam started is INTERACTIVE -- it runs bare `claude` in a tmux pane
 * -- so the gate above used to refuse the one class of session vam is entitled
 * to end. These pin the route that fixes it, and the negatives that keep it
 * safe.
 */
describe('closing a session vam itself started', () => {
  const OWNED = 'vam-alpha-a1b2c3';
  const ok: TmuxRunResult = { failure: null, stdout: '', stderr: '' };
  /** The row vam started: interactive, and alone in its project. */
  const owned: StoppableAgent = {
    key: 'sess-9#12',
    sessionId: 'sess-9',
    kind: 'interactive',
    name: 'alpha',
    cwd: '/w/alpha',
  };
  const listing = (line: string): TmuxRunResult => ({
    failure: null,
    stdout: `${line}\n`,
    stderr: '',
  });
  const runner = (
    rest: TmuxRunResult = ok,
    listed = listing(`${projectIdOf('/w/alpha')}\t${OWNED}`),
  ) => {
    const calls: string[][] = [];
    const run: TmuxRun = async (argv) => {
      calls.push([...argv]);
      return argv[0] === 'list-sessions' ? listed : rest;
    };
    return { calls, run };
  };

  it('kills the EXACT tagged tmux session, never a prefix of it', async () => {
    const { calls, run } = runner();
    const stop = vi.fn(async () => null);
    await expect(stopSession([owned], 'sess-9#12', stop, run)).resolves.toBeNull();
    expect(calls).toContainEqual(['kill-session', '-t', `=${OWNED}`]);
    expect(stop).not.toHaveBeenCalled();
  });

  it('SPAWNS NOTHING for an interactive session vam did not start', async () => {
    // No tmux session carries this row's project, so no pairing exists.
    const { calls, run } = runner(ok, listing(`${projectIdOf('/w/elsewhere')}\t${OWNED}`));
    const stop = vi.fn(async () => null);
    const error = await stopSession([interactive], 'sess-2#77', stop, run);
    expect(error?.code).toBe('interactive-session');
    expect(error?.message).toContain('close that terminal yourself');
    expect(stop).not.toHaveBeenCalled();
    expect(calls.every((argv) => argv[0] === 'list-sessions')).toBe(true);
  });

  it('reports the kill failing rather than claiming the session went away', async () => {
    const { run } = runner({
      failure: { message: 'boom', code: 1 },
      stdout: '',
      stderr: "can't find session",
    });
    const error = await stopSession(
      [owned],
      'sess-9#12',
      vi.fn(async () => null),
      run,
    );
    expect(error?.code).toBe('no-such-session');
  });

  it('falls back to the honest refusal when the pairing is ambiguous', async () => {
    // Two live rows in one project: which pane is which cannot be proven, and
    // a guess would kill the wrong session.
    const twin: StoppableAgent = { ...owned, key: 'sess-8#13', sessionId: 'sess-8' };
    const { calls, run } = runner();
    const error = await stopSession(
      [owned, twin],
      'sess-9#12',
      vi.fn(async () => null),
      run,
    );
    expect(error?.code).toBe('interactive-session');
    expect(calls.some((argv) => argv[0] === 'kill-session')).toBe(false);
  });

  it('still stops a BACKGROUND session through the CLI', async () => {
    const { run } = runner();
    const stop = vi.fn(async () => null);
    await expect(stopSession([background], 'sess-1#4242', stop, run)).resolves.toBeNull();
    expect(stop).toHaveBeenCalledWith('sess-1');
  });
});

/**
 * Closing one of two sessions vam started in ONE project.
 *
 * The refusal above -- two live rows, no provable pairing -- is correct only
 * while the project tag is all vam has. When the sessions publish their own
 * panes each row is provable, and refusing to close it is the defect the
 * operator hit today. Nothing real is killed here: the runner is a fake.
 */
describe('stopSession with published panes', () => {
  const alpha: StoppableAgent = {
    key: 'sess-alpha#12',
    sessionId: 'sess-alpha',
    kind: 'interactive',
    name: 'alpha',
    cwd: '/w/alpha',
  };
  const beta: StoppableAgent = { ...alpha, key: 'sess-beta#13', sessionId: 'sess-beta' };
  const project = projectIdOf('/w/alpha');
  const listed: TmuxRunResult = {
    failure: null,
    stdout: `${project}\tvam-alpha-aa11bb\n${project}\tvam-alpha-cc22dd\n`,
    stderr: '',
  };

  const runner = () => {
    const calls: string[][] = [];
    const run: TmuxRun = async (argv) => {
      calls.push([...argv]);
      return argv[0] === 'list-sessions' ? listed : { failure: null, stdout: '', stderr: '' };
    };
    return { calls, run };
  };

  it('kills the pane the row itself published, not the other one', async () => {
    const { calls, run } = runner();
    const panes = new Map([
      ['sess-alpha', 'vam-alpha-aa11bb'],
      ['sess-beta', 'vam-alpha-cc22dd'],
    ]);
    await expect(
      stopSession(
        [alpha, beta],
        'sess-beta#13',
        vi.fn(async () => null),
        run,
        panes,
      ),
    ).resolves.toBeNull();
    expect(calls).toContainEqual(['kill-session', '-t', '=vam-alpha-cc22dd']);
    expect(calls).not.toContainEqual(['kill-session', '-t', '=vam-alpha-aa11bb']);
  });
});
