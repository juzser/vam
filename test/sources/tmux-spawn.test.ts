/**
 * The tmux spawn layer: every outcome distinct, and "no sessions" never
 * wearing the same face as "vam could not ask".
 *
 * No test here runs tmux. The runner is injected, exactly as `pull-requests`
 * separates classification from the spawn -- a test that really ran these
 * would create, and kill, sessions on the operator's own tmux server.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyTmuxFailure,
  createVamSession,
  listVamSessions,
  readPane,
  type TmuxRun,
} from '../../src/main/sources/tmux/spawn.js';

/** A runner that records what it was asked and answers with a canned result. */
function fakeTmux(
  answer: (argv: readonly string[]) => {
    failure?: { message: string; code?: string | number; killed?: boolean; signal?: string };
    stdout?: string;
    stderr?: string;
  },
): TmuxRun & { calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run = (async (argv: readonly string[]) => {
    calls.push(argv);
    const a = answer(argv);
    return {
      failure: a.failure ?? null,
      stdout: a.stdout ?? '',
      stderr: a.stderr ?? '',
    };
  }) as TmuxRun & { calls: (readonly string[])[] };
  run.calls = calls;
  return run;
}

const ok = () => ({});

describe('classifyTmuxFailure', () => {
  const at = (failure: Parameters<typeof classifyTmuxFailure>[0]['failure'], stderr = '') =>
    classifyTmuxFailure({ failure, stderr, action: 'creating a session' });

  it('gives each failure its own kind+code, pairwise distinct', () => {
    const outcomes = [
      at({ message: 'spawn tmux ENOENT', code: 'ENOENT' }),
      at({ message: 'killed', killed: true, signal: 'SIGTERM' }),
      at({ message: 'exit 1' }, 'no server running on /tmp/tmux-501/default'),
      at({ message: 'exit 1' }, "can't find session: vam-nope"),
      at({ message: 'exit 1' }, 'duplicate session: vam-taken'),
      at({ message: 'exit 1' }, 'something tmux has never said before'),
    ];
    const seen = outcomes.map((o) => `${o.kind}/${o.code}`);
    expect(new Set(seen).size).toBe(outcomes.length);
    expect(seen).toEqual([
      'unreachable/tmux-missing',
      'unreachable/timed-out',
      'unreachable/no-server',
      'refused/no-such-session',
      'refused/session-exists',
      'refused/tmux-failed',
    ]);
  });

  it('does not call a SIGKILL from outside a timeout', () => {
    // node's own timeout kills with SIGTERM. A SIGKILL means something else
    // killed tmux -- the OOM killer, most plainly -- and reporting that as
    // "tmux did not answer within 10s" sends the operator after a hang that
    // never happened. A wrong cause is worse than an unknown one.
    const timedOut = at({ message: 'killed', killed: true, signal: 'SIGTERM' });
    const oomKilled = at({ message: 'killed', killed: true, signal: 'SIGKILL' });
    expect(timedOut.code).toBe('timed-out');
    expect(oomKilled.code).toBe('killed');
    expect(oomKilled.message).toContain('SIGKILL');
    expect(oomKilled.message).not.toMatch(/did not answer|timed out/i);
  });

  it('reports a kill with no signal as a kill, not as a timeout', () => {
    const killed = at({ message: 'killed', killed: true });
    expect(killed.code).toBe('killed');
  });

  it("carries tmux's own words for a failure it does not recognise", () => {
    const error = at({ message: 'exit 1' }, 'something tmux has never said before');
    expect(error.message).toContain('something tmux has never said before');
    expect(error.message).toContain('creating a session');
  });
});

describe('listVamSessions', () => {
  it('reads "no server running" as NO SESSIONS, not as an error', async () => {
    const run = fakeTmux(() => ({
      failure: { message: 'exit 1' },
      stderr: 'no server running on /tmp/tmux-501/default',
    }));
    await expect(listVamSessions(run)).resolves.toEqual({ kind: 'ok', sessions: [] });
  });

  it('is unavailable -- NOT empty -- when tmux is not installed', async () => {
    const run = fakeTmux(() => ({ failure: { message: 'ENOENT', code: 'ENOENT' } }));
    const result = await listVamSessions(run);
    expect(result.kind).toBe('unavailable');
    expect(result.kind === 'unavailable' && result.error.code).toBe('tmux-missing');
  });

  it("filters to vam's own sessions and leaves the operator's alone", async () => {
    const run = fakeTmux(() => ({
      stdout: [
        '\tnotes',
        'claude-code:demo-11111111\tvam-demo-a1b2c3',
        '\t0',
        'claude-code:api-22222222\tvam-api-d4e5f6',
        '\tirc',
        '',
      ].join('\n'),
    }));
    await expect(listVamSessions(run)).resolves.toEqual({
      kind: 'ok',
      sessions: [
        { project: 'claude-code:demo-11111111', name: 'vam-demo-a1b2c3' },
        { project: 'claude-code:api-22222222', name: 'vam-api-d4e5f6' },
      ],
    });
  });

  it('reports an untagged vam session as tagged with nothing, not as tagged with its name', async () => {
    // A session started by an older vam, or one whose `set-option` failed. The
    // empty first field is what an unset user option formats as (measured), and
    // it must stay empty: the matcher refuses to pair on it.
    const run = fakeTmux(() => ({ stdout: '\tvam-old-a1b2c3\n' }));
    await expect(listVamSessions(run)).resolves.toEqual({
      kind: 'ok',
      sessions: [{ project: '', name: 'vam-old-a1b2c3' }],
    });
  });
});

describe('createVamSession', () => {
  it('runs new-session detached with the chosen cwd and command', async () => {
    const run = fakeTmux(ok);
    const created = await createVamSession(run, {
      name: 'vam-demo-a1b2c3',
      cwd: '/w/demo',
      command: ['claude'],
      projectId: 'claude-code:demo-11111111',
    });
    expect(created).toBeNull();
    expect(run.calls).toEqual([
      ['new-session', '-d', '-s', 'vam-demo-a1b2c3', '-c', '/w/demo', 'claude'],
      ['set-option', '-t', 'vam-demo-a1b2c3', '@vam-project', 'claude-code:demo-11111111'],
    ]);
  });

  it('records the pairing on the session, because nothing else can reconstruct it', async () => {
    // The whole of the fix to the Terminal tab is this second call. Deleting it
    // leaves a session that runs perfectly and that vam can never find again.
    const run = fakeTmux(() => ({}));
    await createVamSession(run, {
      name: 'vam-demo-a1b2c3',
      cwd: '/w/demo',
      command: ['claude'],
      projectId: 'claude-code:demo-11111111',
    });
    expect(run.calls.map((argv) => argv[0])).toEqual(['new-session', 'set-option']);
  });

  it('says the session started but is unpaired when only the recording failed', async () => {
    // Not "creating a session failed": the session IS running, and sending the
    // operator to look for one that never started would be the wrong repair.
    const run = fakeTmux((argv) =>
      argv[0] === 'set-option'
        ? { failure: { message: 'exit 1' }, stderr: 'unknown option: @vam-project' }
        : {},
    );
    const created = await createVamSession(run, {
      name: 'vam-demo-a1b2c3',
      cwd: '/w/demo',
      command: ['claude'],
      projectId: 'claude-code:demo-11111111',
    });
    expect(created?.code).toBe('session-untagged');
    expect(created?.message).toContain('the session started');
    expect(created?.message).toContain('Terminal tab');
  });

  it('resolves to the error rather than throwing', async () => {
    const run = fakeTmux(() => ({
      failure: { message: 'exit 1' },
      stderr: 'duplicate session: vam-demo-a1b2c3',
    }));
    const created = await createVamSession(run, {
      name: 'vam-demo-a1b2c3',
      cwd: '/w/demo',
      command: ['claude'],
      projectId: 'claude-code:demo-11111111',
    });
    expect(created?.code).toBe('session-exists');
  });
});

describe('readPane', () => {
  it('returns the rendered screen as plain text', async () => {
    const run = fakeTmux(() => ({ stdout: '> hello\nworking...\n' }));
    await expect(readPane(run, 'vam-demo-a1b2c3')).resolves.toEqual({
      kind: 'ok',
      text: '> hello\nworking...\n',
    });
    expect(run.calls).toEqual([['capture-pane', '-p', '-e', '-t', '=vam-demo-a1b2c3:']]);
  });

  it('distinguishes a session that is gone from a tmux that is gone', async () => {
    const gone = await readPane(
      fakeTmux(() => ({ failure: { message: 'exit 1' }, stderr: "can't find session: x" })),
      'vam-demo-a1b2c3',
    );
    const missing = await readPane(
      fakeTmux(() => ({ failure: { message: 'ENOENT', code: 'ENOENT' } })),
      'vam-demo-a1b2c3',
    );
    expect(gone.kind === 'unavailable' && gone.error.code).toBe('no-such-session');
    expect(missing.kind === 'unavailable' && missing.error.code).toBe('tmux-missing');
  });
});
