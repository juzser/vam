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
import { loginShellCommand } from '../../src/main/sources/tmux/shell.js';
import type { TmuxRun, TmuxSession } from '../../src/main/sources/tmux/spawn.js';
import { PROVIDERS } from '../../src/shared/providers.js';

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
    [source],
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
  it('starts a detached tmux session running a SHELL in the project’s cwd', async () => {
    // Stage 2 of `docs/design/vam-owns-the-session.md`: the pane is a shell,
    // real from its first frame, and the provider is typed into it later
    // (`start-in-pane.ts`). The shell is injected so the assertion is by
    // value; `tmux-shell.test.ts` pins what the default resolves to.
    const run = recordingTmux();
    const failure = await createSessionInProject({
      agents: [agent('/w/demo')],
      projectId: projectIdOf('/w/demo'),
      title: 'new work',
      run,
      name: 'vam-new-work-a1b2c3',
      shell: ['/bin/zsh', '-l'],
    });

    expect(failure).toBeNull();
    expect(run.calls).toEqual([
      [
        'new-session',
        '-d',
        '-P',
        '-F',
        '#{pane_pid}',
        '-s',
        'vam-new-work-a1b2c3',
        '-c',
        '/w/demo',
        '/bin/zsh',
        '-l',
      ],
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
 * D2 -- `+`/`n` IS REFUSED IN A PROJECT THAT HAS ONLY PANE ROWS.
 *
 * THE DEFECT. `createSessionInProject` looked up the project's directory only
 * among LIVE AGENTS. A project right after Start -- a shell-first pane with no
 * agent typed into it yet (`create-session.ts`'s own header, Stage 2) -- has
 * no live agent at all, so the lookup answered `unknown-project` for a
 * project vam's own Terminal tab is drawing that very moment.
 *
 * THE FIX. A pane vam already knows about answers the same question a live
 * agent's `cwd` does, using the SAME project identity the sidebar groups by
 * (`source.ts`'s own grouping: the pane's `@vam-project` tag first, its live
 * `cwd` re-hashed only when the tag is unset) -- consulted ONLY as a fallback,
 * so a project with a live agent never changes behaviour.
 */
describe('o, in a project that has only pane rows', () => {
  const paneFor = (over: Partial<TmuxSession> = {}): TmuxSession => ({
    project: projectIdOf('/w/orchard'),
    name: 'vam-orchard-a1b2c3',
    command: 'zsh',
    cwd: '/w/orchard',
    ...over,
  });

  it('creates a session in the pane-only project’s directory', async () => {
    const run = recordingTmux();
    const failure = await createSessionInProject({
      agents: [],
      projectId: projectIdOf('/w/orchard'),
      title: 'new work',
      run,
      name: 'vam-new-work-a1b2c3',
      panes: [paneFor()],
    });

    expect(failure).toBeNull();
    expect(run.calls[0]?.slice(0, 8)).toEqual([
      'new-session',
      '-d',
      '-P',
      '-F',
      '#{pane_pid}',
      '-s',
      'vam-new-work-a1b2c3',
      '-c',
    ]);
    expect(run.calls[0]?.[8]).toBe('/w/orchard');
  });

  it('still refuses an unknown project when no pane answers it either', async () => {
    const run = recordingTmux();
    const failure = await createSessionInProject({
      agents: [],
      projectId: projectIdOf('/w/orchard'),
      title: 'new work',
      run,
      panes: [paneFor({ project: projectIdOf('/w/elsewhere'), cwd: '/w/elsewhere' })],
    });

    expect(failure?.code).toBe('unknown-project');
    expect(run.calls).toEqual([]);
  });

  it('refuses rather than guesses when two panes in the project disagree on directory', async () => {
    // The same project TAG on two panes whose live cwd has since drifted
    // apart -- one pane's shell `cd`'d elsewhere after creation. Nothing in
    // that shape says which directory is the project's, so this is refused
    // exactly like any other ambiguity in this file, never guessed.
    const run = recordingTmux();
    const failure = await createSessionInProject({
      agents: [],
      projectId: projectIdOf('/w/orchard'),
      title: 'new work',
      run,
      panes: [paneFor(), paneFor({ name: 'vam-orchard-d4e5f6', cwd: '/w/orchard/sub' })],
    });

    expect(failure?.code).toBe('unknown-project');
    expect(run.calls).toEqual([]);
  });

  it('prefers a live agent’s own cwd over any pane, unchanged from before', async () => {
    const run = recordingTmux();
    const failure = await createSessionInProject({
      agents: [agent('/w/demo')],
      projectId: projectIdOf('/w/demo'),
      title: 'new work',
      run,
      name: 'vam-new-work-a1b2c3',
      // A pane for the SAME project naming a different directory must never
      // be consulted while a live agent already answers it.
      panes: [paneFor({ project: projectIdOf('/w/demo'), cwd: '/w/demo/decoy' })],
    });

    expect(failure).toBeNull();
    expect(run.calls[0]?.[8]).toBe('/w/demo');
  });

  it('ignores a pane with no cwd to offer, and still refuses', async () => {
    const run = recordingTmux();
    const failure = await createSessionInProject({
      agents: [],
      projectId: projectIdOf('/w/orchard'),
      title: 'new work',
      run,
      panes: [{ project: projectIdOf('/w/orchard'), name: 'vam-orchard-a1b2c3' }],
    });

    expect(failure?.code).toBe('unknown-project');
    expect(run.calls).toEqual([]);
  });
});

/**
 * The "new project" half: a directory the operator picked in Electron's own
 * dialog, which no project id names yet.
 */
describe('a new session in a chosen directory', () => {
  it('starts a SHELL there and TYPES NOTHING -- Start session on the row is the only door', async () => {
    // Stage 2, now on this path too (issue: Ctrl+C in the terminal used to
    // shut the whole session down -- `create-session.ts`'s header carries the
    // measurement). This used to type the provider in immediately after the
    // spawn, on the theory that this path has no Start session button to
    // wait for -- but the row it just created is drawn `unstarted`
    // (`pane-row.ts` does not read the pane's foreground command) and the
    // Response view shows the SAME start screen a plain `unstarted` row
    // shows, so the operator saw a picker and a Start button over a pane
    // `claude` was already loading into. Fixed: this spawns the shell and
    // stops, exactly like `createSessionInProject` beside it.
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
      [
        'new-session',
        '-d',
        '-P',
        '-F',
        '#{pane_pid}',
        '-s',
        'vam-orchard-a1b2c3',
        '-c',
        orchard,
        ...loginShellCommand(),
      ],
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
  /**
   * NEITHER PATH SPENDS THE PROVIDER AT SPAWN, OR AFTER, ANY MORE. Both run a
   * shell (`tmux/shell.ts`) and stop -- the provider's command is typed into
   * that shell only by the Start button, or by the operator's own hands, on
   * whichever row the spawn just created (`claude-code-start-in-pane.test.ts`).
   * What is asserted here is that naming a provider, or an id nothing answers
   * to, changes NOTHING about what tmux is handed on EITHER creation path --
   * the argv is identical to the no-provider case, and none of it is the
   * provider's own command.
   */
  it('does not reach the chosen-directory path’s spawn: that pane runs the shell whatever was named', async () => {
    const orchard = tempRepo();
    const spawnWith = async (provider?: string) => {
      const run = recordingTmux();
      await createSessionInDirectory({
        cwd: orchard,
        title: 'orchard',
        run,
        name: 'vam-orchard-a1b2c3',
        provider,
      });
      return run.calls;
    };
    const named = await spawnWith('claude-code');
    const unnamed = await spawnWith();
    const unknown = await spawnWith('cursor-cli');
    expect(named).toEqual(unnamed);
    expect(unknown).toEqual(unnamed);
    expect(unnamed[0]?.slice(-2)).toEqual(loginShellCommand());
    expect(unnamed).toHaveLength(2); // spawn + @vam-project, never a type
    for (const provider of PROVIDERS) {
      expect(named.flat()).not.toContain(provider.command[0]);
    }
  });

  it('does not reach the project path’s spawn: that pane runs the shell whatever was named', async () => {
    const spawnWith = async (provider?: string) => {
      const run = recordingTmux();
      await createSessionInProject({
        agents: [agent('/w/demo')],
        projectId: projectIdOf('/w/demo'),
        title: 'new work',
        run,
        name: 'vam-new-work-a1b2c3',
        provider,
        shell: ['/bin/zsh', '-l'],
      });
      return run.calls;
    };
    const named = await spawnWith('codex');
    const unnamed = await spawnWith();
    const unknown = await spawnWith('cursor-cli');
    expect(named[0]).toEqual(unnamed[0]);
    expect(unknown[0]).toEqual(unnamed[0]);
    expect(unnamed[0]?.slice(-2)).toEqual(['/bin/zsh', '-l']);
    for (const provider of PROVIDERS) {
      expect(named.flat()).not.toContain(provider.command[0]);
    }
  });

  it('runs the login shell `tmux/shell.ts` resolves when none is injected', async () => {
    const run = recordingTmux();
    await createSessionInProject({
      agents: [agent('/w/demo')],
      projectId: projectIdOf('/w/demo'),
      title: 'new work',
      run,
      name: 'vam-new-work-a1b2c3',
    });
    expect(run.calls[0]?.slice(-2)).toEqual(loginShellCommand());
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
