/**
 * Stopping a background Claude Code session.
 *
 * The spawn itself is never exercised -- running `claude stop` in a test
 * would kill one of the operator's real sessions. Argv, classification and
 * the interactive refusal are pure, and they are what this asserts, exactly
 * as `deliver.test.ts`'s subject is split.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { registerSourceIpc } from '../../../src/main/ipc/handlers.js';
import { projectIdOf } from '../../../src/main/sources/claude-code/project-id.js';
import { CLAUDE_CODE_SOURCE } from '../../../src/main/sources/claude-code/source.js';
import {
  classifyStopFailure,
  killPidViaSignal,
  pidHasClaudeSessionFile,
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

  it('SPAWNS NOTHING for an interactive row when no tmux runner was offered, and says WHY', async () => {
    const stop = vi.fn(async () => null);
    const error = await stopSession([interactive], 'sess-2#77', stop);
    expect(stop).not.toHaveBeenCalled();
    expect(error?.kind).toBe('refused');
    // NOT `interactive-session` -- that sentence asserts this IS a terminal
    // the operator is sitting in, which is one specific cause among several.
    // Absent a runner, vam has not even asked; it does not know that yet.
    expect(error?.code).toBe('tmux-unavailable');
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

/**
 * A background row the source ALREADY REPORTS as ended (`agents.ts`:
 * `done`/`failed` are the two statuses only a background row can honestly
 * carry) is never handed to `claude stop` at all -- there is no job left for
 * the CLI to find, so asking it is not a stop that failed, it is a stop that
 * was never on offer. This is the trigger the operator actually hit: the row
 * stays offering Close for up to `BACKGROUND_WINDOW_MS`, and every attempt
 * repeats the same refusal, in vam's own words rather than the CLI's.
 */
describe('stopSession short-circuits a background row the source already reported as ended', () => {
  it('refuses a `done` row without calling the CLI', async () => {
    const finished: StoppableAgent = { ...background, status: 'done' };
    const stop = vi.fn(async () => null);
    const error = await stopSession([finished], 'sess-1#4242', stop);
    expect(stop).not.toHaveBeenCalled();
    expect(error?.kind).toBe('refused');
    expect(error?.code).toBe('already-finished');
    expect(error?.message).toContain('nightly sweep');
  });

  it('refuses a `failed` row without calling the CLI', async () => {
    const finished: StoppableAgent = { ...background, status: 'failed' };
    const stop = vi.fn(async () => null);
    const error = await stopSession([finished], 'sess-1#4242', stop);
    expect(stop).not.toHaveBeenCalled();
    expect(error?.kind).toBe('refused');
    expect(error?.code).toBe('already-finished');
  });

  it('still calls the CLI for a background row reported `running`', async () => {
    const running: StoppableAgent = { ...background, status: 'running' };
    const stop = vi.fn(async () => null);
    await expect(stopSession([running], 'sess-1#4242', stop)).resolves.toBeNull();
    expect(stop).toHaveBeenCalledWith('sess-1');
  });

  it('still calls the CLI for a background row with no status reported at all', async () => {
    // `background` itself carries no `status` -- the shape most existing
    // tests use, and a caller that genuinely has none to give.
    const stop = vi.fn(async () => null);
    await expect(stopSession([background], 'sess-1#4242', stop)).resolves.toBeNull();
    expect(stop).toHaveBeenCalledWith('sess-1');
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

  /**
   * The exact string measured against the real CLI: `claude stop <id>` on a
   * session id no background job matches answers
   * "No job matching '<id>'. Run 'claude agents' to list running sessions."
   * on stderr, exit 1. That is CLI-speak, aimed at a terminal user with a
   * `claude` binary on their PATH -- vam's own operator may be looking at a
   * GUI with neither, and republishing it verbatim (the previous behaviour,
   * via the `cli-failed` catch-all below) is the exact bug report this pins.
   */
  it('classifies a "No job matching" answer as a session already gone, not a generic CLI failure', () => {
    const error = classifyStopFailure({
      failure: {
        message: 'Command failed: claude stop 00000000-0000-4000-8000-000000000000',
        code: 1,
      },
      stderr:
        "No job matching '00000000-0000-4000-8000-000000000000'. Run 'claude agents' to list running sessions.",
      sessionId: '00000000-0000-4000-8000-000000000000',
    });
    expect(error.kind).toBe('refused');
    expect(error.code).toBe('session-gone');
    // The one sentence this exists to stop reaching a GUI operator.
    expect(error.message).not.toMatch(/run 'claude agents'/i);
    expect(error.message).not.toMatch(/no job matching/i);
    expect(error.message).toMatch(/already|no longer|not.*running/i);
    // `claude stop --help`: the conversation survives a stop. It survives
    // just as much not being stopped, and the operator should hear that.
    expect(error.message).toMatch(/nothing (was )?(lost|stopped)|conversation.*kept/i);
  });

  it('leaves an unrelated stderr on the generic `cli-failed` path, not the new one', () => {
    const error = classifyStopFailure({
      failure: { message: 'exit 1', code: 1 },
      stderr: 'permission denied',
      sessionId: 's',
    });
    expect(error.code).toBe('cli-failed');
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

  it('SPAWNS NOTHING for an interactive session vam did not start, and cannot resolve a pane for it', async () => {
    // No tmux session carries this row's project, so no pairing exists.
    const { calls, run } = runner(ok, listing(`${projectIdOf('/w/elsewhere')}\t${OWNED}`));
    const stop = vi.fn(async () => null);
    const error = await stopSession([interactive], 'sess-2#77', stop, run);
    expect(error?.code).toBe('pane-unresolved');
    expect(error?.message).toContain('Close the terminal yourself');
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
    expect(error?.code).toBe('pane-unresolved');
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
      ['sess-alpha#12', 'vam-alpha-aa11bb'],
      ['sess-beta#13', 'vam-alpha-cc22dd'],
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

  /**
   * THE EXACT SHAPE `agents.ts` MEASURED: two PROCESSES resuming ONE session
   * id, each with its own pid, kind, name and published pane. Closing the row
   * for one pid must kill that pid's own pane, never the other pid's -- and a
   * map keyed by session id alone cannot tell the two rows apart at all.
   */
  it('kills the row named by its own pid, not the other process resuming the same session', async () => {
    const { calls, run } = runner();
    const pidOneHundred: StoppableAgent = {
      ...alpha,
      key: 'sess-shared#100',
      sessionId: 'sess-shared',
    };
    const pidTwoHundred: StoppableAgent = {
      ...alpha,
      key: 'sess-shared#200',
      sessionId: 'sess-shared',
    };
    const panes = new Map([
      ['sess-shared#100', 'vam-alpha-aa11bb'],
      ['sess-shared#200', 'vam-alpha-cc22dd'],
    ]);
    await expect(
      stopSession(
        [pidOneHundred, pidTwoHundred],
        'sess-shared#100',
        vi.fn(async () => null),
        run,
        panes,
      ),
    ).resolves.toBeNull();
    expect(calls).toContainEqual(['kill-session', '-t', '=vam-alpha-aa11bb']);
    expect(calls).not.toContainEqual(['kill-session', '-t', '=vam-alpha-cc22dd']);
  });

  /**
   * THE WORST CONSEQUENCE, PINNED DIRECTLY. When a row's pane cannot be proved
   * -- here, neither pid published anything and the project tags two vam
   * sessions, so the tag path is ambiguous too -- the answer is the refusal
   * `stopSession` already gives an interactive row, and NOTHING is killed. A
   * row that cannot be resolved must never fall through to killing the wrong
   * tmux session and reporting success.
   */
  it('kills nothing and refuses when the row cannot be uniquely resolved', async () => {
    const { calls, run } = runner();
    const pidOneHundred: StoppableAgent = {
      ...alpha,
      key: 'sess-shared#100',
      sessionId: 'sess-shared',
    };
    const pidTwoHundred: StoppableAgent = {
      ...alpha,
      key: 'sess-shared#200',
      sessionId: 'sess-shared',
    };
    const error = await stopSession(
      [pidOneHundred, pidTwoHundred],
      'sess-shared#100',
      vi.fn(async () => null),
      run,
      new Map(),
    );
    expect(error?.code).toBe('pane-unresolved');
    expect(calls.filter((argv) => argv[0] === 'kill-session')).toEqual([]);
  });
});

/**
 * A row whose PUBLISHED pane names a REAL vam session tagged for a DIFFERENT
 * project. This is the one case vam does not merely lack a proof for -- it
 * has evidence against it -- so it is refused unconditionally, `force` or
 * not. Distinct from every other refusal above: those say "vam could not
 * tell", this says "vam can tell, and it is not yours".
 */
describe('a row whose published pane belongs to another project', () => {
  const row: StoppableAgent = {
    key: 'sess-x#1',
    sessionId: 'sess-x',
    kind: 'interactive',
    name: 'crossed',
    cwd: '/w/mine',
    pid: 555,
  };
  const listed: TmuxRunResult = {
    failure: null,
    // Tagged for '/w/other', never '/w/mine' -- a real vam session, just not
    // this row's project.
    stdout: `${projectIdOf('/w/other')}\tvam-other-ee55ff\n`,
    stderr: '',
  };
  const run: TmuxRun = async (argv) =>
    argv[0] === 'list-sessions' ? listed : { failure: null, stdout: '', stderr: '' };
  const panes = new Map([['sess-x#1', 'vam-other-ee55ff']]);

  it('refuses without confirmation, naming what it found', async () => {
    const error = await stopSession(
      [row],
      'sess-x#1',
      vi.fn(async () => null),
      run,
      panes,
    );
    expect(error?.code).toBe('wrong-project-pane');
    expect(error?.message).toContain('different project');
  });

  it('STILL refuses when confirmed -- force never overrides a positive identification', async () => {
    const killPid = vi.fn(async () => null);
    const error = await stopSession(
      [row],
      'sess-x#1',
      vi.fn(async () => null),
      run,
      panes,
      true,
      killPid,
    );
    expect(error?.code).toBe('wrong-project-pane');
    expect(killPid).not.toHaveBeenCalled();
  });
});

/**
 * The confirmed kill-anyway route: only reachable through `force: true`, only
 * ever a raw signal to the pid, and only when vam genuinely could not tell.
 */
describe('force-closing a row vam could not verify by tmux', () => {
  const row: StoppableAgent = {
    key: 'sess-y#2',
    sessionId: 'sess-y',
    kind: 'interactive',
    name: 'unverifiable',
    cwd: '/w/solo',
    pid: 999,
  };

  it('the close key alone never kills: force defaults to false', async () => {
    const killPid = vi.fn(async () => null);
    const error = await stopSession(
      [row],
      'sess-y#2',
      vi.fn(async () => null),
      undefined,
      undefined,
      // `force` omitted entirely, exactly as every ordinary caller does.
    );
    expect(killPid).not.toHaveBeenCalled();
    expect(error?.code).toBe('tmux-unavailable');
    expect(error?.forcible).toBe(false);
  });

  it('says a force is on offer only once a pid is actually available to use', async () => {
    const error = await stopSession(
      [row],
      'sess-y#2',
      vi.fn(async () => null),
      undefined,
      undefined,
      false,
      killPidViaSignal,
    );
    expect(error?.forcible).toBe(true);
  });

  it('confirmed, kills the pid directly rather than guessing a tmux pane', async () => {
    const killPid = vi.fn(async () => null);
    const error = await stopSession(
      [row],
      'sess-y#2',
      vi.fn(async () => null),
      undefined,
      undefined,
      true,
      killPid,
    );
    expect(error).toBeNull();
    expect(killPid).toHaveBeenCalledWith(999);
  });

  it('refuses the confirmed kill too when there is no pid to act on', async () => {
    const noPid: StoppableAgent = { ...row, key: 'sess-z#3', sessionId: 'sess-z', pid: null };
    const error = await stopSession(
      [noPid],
      'sess-z#3',
      vi.fn(async () => null),
      undefined,
      undefined,
      true,
      vi.fn(async () => null),
    );
    expect(error?.code).toBe('force-unavailable');
  });

  it('propagates a failing tmux listing as its own error, not the generic interactive refusal', async () => {
    const run: TmuxRun = async () => ({
      failure: { message: 'boom', code: 'ENOENT' },
      stdout: '',
      stderr: '',
    });
    const error = await stopSession(
      [row],
      'sess-y#2',
      vi.fn(async () => null),
      run,
    );
    expect(error?.code).toBe('tmux-missing');
    expect(error?.kind).toBe('unreachable');
    expect(error?.message).toContain('unverifiable');
  });
});

describe('killPidViaSignal', () => {
  it('treats an already-gone process as success, not a failure to retry', async () => {
    const original = process.kill;
    // biome-ignore lint/suspicious/noExplicitAny: stubbing a node global for one assertion
    (process as any).kill = () => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    };
    try {
      await expect(killPidViaSignal(123456)).resolves.toBeNull();
    } finally {
      process.kill = original;
    }
  });
});

/**
 * The window `killPidViaSignal` alone cannot close: `row.pid` is stale by
 * the time a confirmation resolves, and the OS is free to have recycled it
 * onto an unrelated process by then. `stopSession` re-checks with a
 * `PidStillAlive` immediately before signalling, and this pins that it
 * actually refuses rather than trusting the poll.
 */
describe('re-verifying the pid at the moment of a confirmed kill', () => {
  const row: StoppableAgent = {
    key: 'sess-v#7',
    sessionId: 'sess-v',
    kind: 'interactive',
    name: 'stale-pid',
    cwd: '/w/stale',
    pid: 424242,
  };

  it('refuses distinctly from `kill-failed` when the session file is gone, and signals nothing', async () => {
    const killPid = vi.fn(async () => null);
    const verifyPid = vi.fn(async () => false);
    const error = await stopSession(
      [row],
      'sess-v#7',
      vi.fn(async () => null),
      undefined,
      undefined,
      true,
      killPid,
      verifyPid,
    );
    expect(verifyPid).toHaveBeenCalledWith(424242);
    expect(killPid).not.toHaveBeenCalled();
    expect(error?.code).toBe('pid-unverifiable');
    expect(error?.code).not.toBe('kill-failed');
    expect(error?.message).toMatch(/may have exited/i);
  });

  it('signals only once the pid is re-confirmed alive', async () => {
    const killPid = vi.fn(async () => null);
    const verifyPid = vi.fn(async () => true);
    const error = await stopSession(
      [row],
      'sess-v#7',
      vi.fn(async () => null),
      undefined,
      undefined,
      true,
      killPid,
      verifyPid,
    );
    expect(verifyPid).toHaveBeenCalledWith(424242);
    expect(killPid).toHaveBeenCalledWith(424242);
    expect(error).toBeNull();
  });

  it('a caller with no verifier keeps the old, unchecked route rather than refusing for an unasked reason', async () => {
    const killPid = vi.fn(async () => null);
    const error = await stopSession(
      [row],
      'sess-v#7',
      vi.fn(async () => null),
      undefined,
      undefined,
      true,
      killPid,
      // `verifyPid` omitted entirely.
    );
    expect(killPid).toHaveBeenCalledWith(424242);
    expect(error).toBeNull();
  });
});

describe('pidHasClaudeSessionFile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-cc-force-close-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('answers true when the pid file exists', async () => {
    writeFileSync(join(root, '424242.json'), '{"sessionId":"whatever","tmux":null}');
    await expect(pidHasClaudeSessionFile(root)(424242)).resolves.toBe(true);
  });

  it('answers false when it does not, without throwing', async () => {
    await expect(pidHasClaudeSessionFile(root)(999999)).resolves.toBe(false);
  });

  it('never reads the file -- deleting its contents mid-flight changes nothing', async () => {
    // A file that exists but whose contents are garbage (or a `.key` file's
    // binary secret material) must still answer `true`: existence is the
    // whole check, and nothing here parses what is inside.
    writeFileSync(join(root, '424242.json'), '{not json at all');
    await expect(pidHasClaudeSessionFile(root)(424242)).resolves.toBe(true);
  });
});
