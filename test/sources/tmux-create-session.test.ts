/**
 * `o` -- New session -- as a real creation, and as an honest refusal.
 *
 * The negative is asserted DIRECTLY: a source whose `createSession`
 * capability is false must not merely answer "no", it must never reach a
 * spawn. So the source under test carries a recording write surface, and the
 * test asserts the recorder stayed empty. A test that only checked the error
 * message would still pass if the handler ran the command and then refused.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { registerSourceIpc } from '../../src/main/ipc/handlers.js';
import {
  createSessionInDirectory,
  createSessionInProject,
} from '../../src/main/sources/claude-code/create-session.js';
import { projectIdOf } from '../../src/main/sources/claude-code/project-id.js';
import { FIXTURE_SOURCE } from '../../src/main/sources/fixture-source.js';
import type { MainSource } from '../../src/main/sources/source.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';
import { DEFAULT_PROVIDER_ID, resolveProvider } from '../../src/shared/providers.js';

function recordingTmux(stderr = ''): TmuxRun & { calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run = (async (argv: readonly string[]) => {
    calls.push(argv);
    return { failure: stderr === '' ? null : { message: 'exit 1' }, stdout: '', stderr };
  }) as TmuxRun & { calls: (readonly string[])[] };
  run.calls = calls;
  return run;
}

/**
 * A real directory that really is a repository work tree. The chosen-directory
 * path refuses anything else (`src/main/sources/repo.ts`), so a made-up string
 * is no longer a usable cwd for it -- and a check that only a made-up string
 * could pass would not be the check.
 */
const repos: string[] = [];
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vam-create-'));
  mkdirSync(join(dir, '.git'));
  repos.push(dir);
  return dir;
}

afterEach(() => {
  while (repos.length > 0) {
    rmSync(repos.pop() as string, { recursive: true, force: true });
  }
});

const agent = (cwd: string) => ({
  key: `s1#101`,
  sessionId: 's1',
  name: null,
  cwd,
  status: 'waiting' as const,
  kind: 'interactive' as const,
  pid: 101,
  startedAt: null,
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
      // The id the Terminal tab will ask by -- the SAME id `createSession` was
      // called with, not a slug re-derived from the title. The title reaches
      // the name and stops there.
      ['set-option', '-t', 'vam-new-work-a1b2c3', '@vam-project', projectIdOf('/w/demo')],
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

/**
 * The "new project" half: a directory the operator picked in Electron's own
 * dialog, which no project id names yet.
 */
describe('a new session in a chosen directory', () => {
  it('starts claude there, and records the id the next load() will report', async () => {
    const run = recordingTmux();
    const orchard = tempRepo();
    const failure = await createSessionInDirectory({
      cwd: orchard,
      title: 'orchard',
      run,
      name: 'vam-orchard-a1b2c3',
    });

    expect(failure).toBeNull();
    expect(run.calls).toEqual([
      ['new-session', '-d', '-s', 'vam-orchard-a1b2c3', '-c', orchard, 'claude'],
      // The SAME digest every other project id comes from. Anything else and
      // the Terminal tab would find nothing for a session vam itself started.
      ['set-option', '-t', 'vam-orchard-a1b2c3', '@vam-project', projectIdOf(orchard)],
    ]);
  });

  it('forwards tmux’s own failure rather than reporting a session it did not start', async () => {
    const run = recordingTmux("can't create session: gone: No such file or directory");
    // A repository whose directory tmux then fails on: the repo check is not
    // what answers here, the spawn is.
    const failure = await createSessionInDirectory({
      cwd: tempRepo(),
      title: 'gone',
      run,
      name: 'vam-gone-a1b2c3',
    });
    expect(failure?.kind).toBe('refused');
    expect(failure?.code).not.toBe('not-a-repository');
  });

  it('is gated by createSession, and SPAWNS NOTHING when that is false', async () => {
    const spawned: string[] = [];
    const cannot: MainSource = {
      descriptor: FIXTURE_SOURCE.descriptor,
      load: FIXTURE_SOURCE.load,
      createSessionInDirectory: async (cwd) => {
        spawned.push(cwd);
        return null;
      },
    };
    const invoke = await handlerFor(cannot);
    const result = await invoke(CHANNELS.createSessionIn, '/srv/work/orchard', 'orchard');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.code).toBe('unsupported:createSession');
    // The gate came first: the recorder is empty, not merely apologised to.
    expect(spawned).toEqual([]);
  });
});

/**
 * Which agent the new session runs, and what happens when the renderer names
 * one main has never heard of. The argv is asserted BY VALUE: "it passed the
 * provider along" is not the claim -- the claim is that the words tmux runs
 * are that provider's own command.
 */
describe('the provider the session is started with', () => {
  it('runs the chosen provider’s command, by value', async () => {
    const run = recordingTmux();
    const orchard = tempRepo();
    const failure = await createSessionInDirectory({
      cwd: orchard,
      title: 'orchard',
      run,
      name: 'vam-orchard-a1b2c3',
      provider: 'claude-code',
    });

    expect(failure).toBeNull();
    expect(run.calls[0]).toEqual([
      'new-session',
      '-d',
      '-s',
      'vam-orchard-a1b2c3',
      '-c',
      orchard,
      ...resolveProvider('claude-code').command,
    ]);
  });

  it('falls back to the default provider for an id nothing answers to', async () => {
    const run = recordingTmux();
    const failure = await createSessionInProject({
      agents: [agent('/w/demo')],
      projectId: projectIdOf('/w/demo'),
      title: 'new work',
      run,
      name: 'vam-new-work-a1b2c3',
      // A provider a later vam may add, stored by a browser that has been
      // through a downgrade -- or simply hand-edited. The session must still
      // start.
      provider: 'codex-cli',
    });

    expect(failure).toBeNull();
    expect(run.calls[0]).toEqual([
      'new-session',
      '-d',
      '-s',
      'vam-new-work-a1b2c3',
      '-c',
      '/w/demo',
      ...resolveProvider(DEFAULT_PROVIDER_ID).command,
    ]);
  });

  it('carries the renderer’s choice across the IPC boundary, and defaults without one', async () => {
    const seen: unknown[] = [];
    const source = {
      descriptor: {
        ...FIXTURE_SOURCE.descriptor,
        capabilities: { ...FIXTURE_SOURCE.descriptor.capabilities, createSession: true },
      },
      load: FIXTURE_SOURCE.load,
      createSession: async (_projectId: string, _title: string, provider?: string) => {
        seen.push(provider);
        return null;
      },
      createSessionInDirectory: async (_cwd: string, _title: string, provider?: string) => {
        seen.push(provider);
        return null;
      },
    } as unknown as MainSource;
    const invoke = handlerFor(source);

    expect((await invoke(CHANNELS.createSession, 'p1', 'a title', 'claude-code')).ok).toBe(true);
    expect((await invoke(CHANNELS.createSessionIn, '/srv/work/orchard', 'orchard')).ok).toBe(true);
    expect(seen).toEqual(['claude-code', undefined]);

    // A provider id is a string like every other argument on these channels;
    // a payload that is not one is refused before any spawn.
    const bad = await invoke(CHANNELS.createSession, 'p1', 'a title', 7);
    expect(bad.ok).toBe(false);
    expect(seen).toEqual(['claude-code', undefined]);
  });
});
