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
    failure?: { message: string; code?: string | number; killed?: boolean };
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
      at({ message: 'killed', killed: true }),
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
    await expect(listVamSessions(run)).resolves.toEqual({ kind: 'ok', names: [] });
  });

  it('is unavailable -- NOT empty -- when tmux is not installed', async () => {
    const run = fakeTmux(() => ({ failure: { message: 'ENOENT', code: 'ENOENT' } }));
    const result = await listVamSessions(run);
    expect(result.kind).toBe('unavailable');
    expect(result.kind === 'unavailable' && result.error.code).toBe('tmux-missing');
  });

  it("filters to vam's own sessions and leaves the operator's alone", async () => {
    const run = fakeTmux(() => ({ stdout: 'notes\nvam-demo-a1b2c3\n0\nvam-api-d4e5f6\nirc\n' }));
    await expect(listVamSessions(run)).resolves.toEqual({
      kind: 'ok',
      names: ['vam-demo-a1b2c3', 'vam-api-d4e5f6'],
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
    });
    expect(created).toBeNull();
    expect(run.calls).toEqual([
      ['new-session', '-d', '-s', 'vam-demo-a1b2c3', '-c', '/w/demo', 'claude'],
    ]);
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
    expect(run.calls).toEqual([['capture-pane', '-p', '-t', '=vam-demo-a1b2c3']]);
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
