/**
 * `o` -- New session -- as a real creation, and as an honest refusal.
 *
 * The negative is asserted DIRECTLY: a source whose `createSession`
 * capability is false must not merely answer "no", it must never reach a
 * spawn. So the source under test carries a recording write surface, and the
 * test asserts the recorder stayed empty. A test that only checked the error
 * message would still pass if the handler ran the command and then refused.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { registerSourceIpc } from '../../src/main/ipc/handlers.js';
import { createSessionInProject } from '../../src/main/sources/claude-code/create-session.js';
import { projectIdOf } from '../../src/main/sources/claude-code/project-id.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';
import type { MainSource } from '../../src/main/sources/source.js';
import { FIXTURE_SOURCE } from '../../src/main/sources/fixture-source.js';

function recordingTmux(stderr = ''): TmuxRun & { calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run = (async (argv: readonly string[]) => {
    calls.push(argv);
    return { failure: stderr === '' ? null : { message: 'exit 1' }, stdout: '', stderr };
  }) as TmuxRun & { calls: (readonly string[])[] };
  run.calls = calls;
  return run;
}

const agent = (cwd: string) => ({
  key: `s1#101`,
  sessionId: 's1',
  name: null,
  cwd,
  status: 'idle' as const,
  kind: 'interactive' as const,
  pid: 101,
});

function handlerFor(source: MainSource) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  registerSourceIpc(
    {
      handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
        handlers.set(channel, listener);
      },
    },
    source,
  );
  return async (channel: string, ...args: unknown[]) =>
    (await handlers.get(channel)?.({}, ...args)) as
      | { ok: true; value: unknown }
      | { ok: false; error: { kind: string; code: string; message: string } };
}

describe('o, on a source that cannot create', () => {
  it('refuses in the source’s own words and SPAWNS NOTHING', async () => {
    const spawned: string[] = [];
    const cannot: MainSource = {
      descriptor: FIXTURE_SOURCE.descriptor,
      load: FIXTURE_SOURCE.load,
      createSession: async (projectId) => {
        spawned.push(projectId);
        return null;
      },
    };
    const invoke = await handlerFor(cannot);
    const result = await invoke(CHANNELS.createSession, 'project-1', 'a title');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe('unsupported:createSession');
    expect(result.ok === false && result.error.message).toBe(
      FIXTURE_SOURCE.descriptor.declines.createSession,
    );
    // The whole point: the gate came first.
    expect(spawned).toEqual([]);
  });
});

describe('o, on the Claude Code source', () => {
  it('starts a detached tmux session running claude in the project’s cwd', async () => {
    const run = recordingTmux();
    const failure = await createSessionInProject({
      agents: [agent('/w/demo')],
      projectId: projectIdOf('/w/demo'),
      title: 'new work',
      run,
      name: 'vam-new-work-a1b2c3',
    });

    expect(failure).toBeNull();
    expect(run.calls).toEqual([
      ['new-session', '-d', '-s', 'vam-new-work-a1b2c3', '-c', '/w/demo', 'claude'],
    ]);
  });

  it('refuses a project it cannot place, without guessing a directory', async () => {
    const run = recordingTmux();
    const failure = await createSessionInProject({
      agents: [agent('/w/demo')],
      projectId: 'claude-code:elsewhere-00000000',
      title: 'new work',
      run,
    });

    expect(failure?.kind).toBe('refused');
    expect(failure?.code).toBe('unknown-project');
    expect(run.calls).toEqual([]);
  });

  it('forwards tmux’s own failure instead of reporting a session it did not start', async () => {
    const run = recordingTmux('duplicate session: vam-new-work-a1b2c3');
    const failure = await createSessionInProject({
      agents: [agent('/w/demo')],
      projectId: projectIdOf('/w/demo'),
      title: 'new work',
      run,
      name: 'vam-new-work-a1b2c3',
    });
    expect(failure?.code).toBe('session-exists');
  });
});
