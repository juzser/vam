/**
 * "New project" means picking a REPOSITORY, not any directory at all.
 *
 * The directory arrives from Electron's own picker, which cannot express
 * "only repositories" -- `showOpenDialog` offers `openDirectory` and nothing
 * narrower. So the narrowing is a check main makes on the path it is handed,
 * and the interesting half of it is the REFUSAL: an operator who picks their
 * Downloads folder and gets silence is the failure this exists to stop.
 *
 * Everything here works on real directories under the OS temp dir, created
 * and removed by the test. No tmux is run: the runner is a recorder, and the
 * negative cases assert it stayed EMPTY rather than merely that a message came
 * back -- a check that refuses after spawning has not refused.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionInDirectory } from '../../src/main/sources/claude-code/create-session.js';
import { repoRootOf, whyNotARepository } from '../../src/main/sources/repo.js';
import { newSessionArgv } from '../../src/main/sources/tmux/argv.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';
import { DEFAULT_PROVIDER_ID, resolveProvider } from '../../src/shared/providers.js';

const made: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vam-repo-'));
  made.push(dir);
  return dir;
}

/** A directory that really is a repository work tree, as far as vam can tell. */
function tempRepo(): string {
  const dir = tempDir();
  mkdirSync(join(dir, '.git'));
  return dir;
}

afterEach(() => {
  while (made.length > 0) {
    rmSync(made.pop() as string, { recursive: true, force: true });
  }
});

function recordingTmux(): TmuxRun & { calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run = (async (argv: readonly string[]) => {
    calls.push(argv);
    return { failure: null, stdout: '', stderr: '' };
  }) as TmuxRun & { calls: (readonly string[])[] };
  run.calls = calls;
  return run;
}

describe('which chosen directories count as a repository', () => {
  it('accepts the repository root itself', () => {
    const repo = tempRepo();
    expect(repoRootOf(repo)).toBe(repo);
    expect(whyNotARepository(repo)).toBeNull();
  });

  it('accepts a directory INSIDE the work tree, and names the root it belongs to', () => {
    const repo = tempRepo();
    const nested = join(repo, 'packages', 'app');
    mkdirSync(nested, { recursive: true });
    expect(repoRootOf(nested)).toBe(repo);
    expect(whyNotARepository(nested)).toBeNull();
  });

  it('accepts a linked worktree, whose `.git` is a FILE and not a directory', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.git'), 'gitdir: /elsewhere/.git/worktrees/one\n');
    expect(repoRootOf(dir)).toBe(dir);
  });

  it('refuses a directory with no repository above it, in words naming the path', () => {
    const plain = tempDir();
    expect(repoRootOf(plain)).toBeNull();
    const refusal = whyNotARepository(plain);
    expect(refusal?.kind).toBe('refused');
    expect(refusal?.code).toBe('not-a-repository');
    expect(refusal?.message).toContain(plain);
    expect(refusal?.message).toContain('.git');
  });
});

describe('starting a session in a directory the operator chose', () => {
  it('starts it when the directory is a repository, running the STORED provider’s command', async () => {
    const repo = tempRepo();
    const run = recordingTmux();

    const failure = await createSessionInDirectory({
      cwd: repo,
      title: 'orchard',
      run,
      name: 'vam-orchard-a1b2c3',
      provider: DEFAULT_PROVIDER_ID,
    });

    expect(failure).toBeNull();
    // Asserted BY VALUE, not by re-deriving it from the same call the code
    // makes: a hardcoded command would pass an identity assertion.
    expect(resolveProvider(DEFAULT_PROVIDER_ID).command).toEqual(['claude']);
    expect(run.calls[0]).toEqual([
      'new-session',
      '-d',
      '-s',
      'vam-orchard-a1b2c3',
      '-c',
      repo,
      'claude',
    ]);
  });

  it('refuses a directory that is not a repository, and SPAWNS NOTHING', async () => {
    const plain = tempDir();
    const run = recordingTmux();

    const failure = await createSessionInDirectory({
      cwd: plain,
      title: 'downloads',
      run,
      name: 'vam-downloads-a1b2c3',
    });

    expect(failure?.code).toBe('not-a-repository');
    expect(failure?.message).toContain(plain);
    // The refusal came FIRST. A message after a spawn is not a refusal.
    expect(run.calls).toEqual([]);
  });
});

/**
 * The argv guard is not a thing this narrowing may soften. It refuses a first
 * word tmux would read as an option and an empty command, and those two stay
 * refused -- a repository under the cwd changes nothing about what tmux does
 * with the words after it.
 */
describe('the argv guard, unchanged', () => {
  it('still refuses an empty command', () => {
    expect(() => newSessionArgv({ name: 'vam-x', cwd: '/srv/work/repo', command: [] })).toThrow(
      /login shell/,
    );
  });

  it('still refuses a first word tmux would read as an option', () => {
    expect(() =>
      newSessionArgv({ name: 'vam-x', cwd: '/srv/work/repo', command: ['-d', 'claude'] }),
    ).toThrow(/as an option/);
  });
});
