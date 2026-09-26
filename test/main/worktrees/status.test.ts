/**
 * `getWorktreeStatuses` against REAL git repositories, same discipline as
 * `worktrees.integration.test.ts`: no mocked git, so a `dirty`/`ahead`/
 * `behind` answer proved here is one the real `git` binary actually gave,
 * not this module's own idea of what it would say.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { projectIdOf } from '../../../src/main/sources/claude-code/project-id.js';
import { runGitViaCli } from '../../../src/main/worktrees/git-run.js';
import { getWorktreeStatuses } from '../../../src/main/worktrees/status.js';
import { createWorktree, type WorktreesDeps } from '../../../src/main/worktrees/worktrees.js';

const made: string[] = [];

function tempParent(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'vam-wt-status-')));
  made.push(dir);
  return dir;
}

function tempRepo(parent: string, name = 'repo'): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  const git = (args: readonly string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git(['init', '--quiet', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'vam test']);
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  git(['add', 'README.md']);
  git(['commit', '--quiet', '-m', 'initial']);
  return dir;
}

afterEach(() => {
  while (made.length > 0) {
    rmSync(made.pop() as string, { recursive: true, force: true });
  }
});

function depsFor(repoRoot: string): WorktreesDeps {
  const projectId = projectIdOf(repoRoot);
  return {
    run: runGitViaCli(),
    realpathFn: (p: string) => realpath(p),
    resolveProjectDirectory: async (id: string) => (id === projectId ? repoRoot : null),
    knownProjectIds: async () => [projectId],
  };
}

describe('getWorktreeStatuses', () => {
  it('reports a CLEAN worktree with no upstream as dirty:false, ahead/behind:null', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;

    const result = await getWorktreeStatuses(
      { projectId: projectIdOf(repo), worktreeIds: [worktreeId] },
      deps,
    );

    expect(Array.isArray(result)).toBe(true);
    const statuses = result as readonly {
      worktreeId: string;
      dirty: boolean;
      ahead: number | null;
      behind: number | null;
    }[];
    expect(statuses).toEqual([{ worktreeId, dirty: false, ahead: null, behind: null }]);
  });

  it('reports dirty:true for an untracked file, and again for a modified tracked one', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    writeFileSync(join(worktreeId, 'untracked.txt'), 'oops');

    const untrackedResult = await getWorktreeStatuses(
      { projectId: projectIdOf(repo), worktreeIds: [worktreeId] },
      deps,
    );
    expect((untrackedResult as readonly { dirty: boolean }[])[0]?.dirty).toBe(true);

    rmSync(join(worktreeId, 'untracked.txt'));
    writeFileSync(join(worktreeId, 'README.md'), 'changed\n');
    const modifiedResult = await getWorktreeStatuses(
      { projectId: projectIdOf(repo), worktreeIds: [worktreeId] },
      deps,
    );
    expect((modifiedResult as readonly { dirty: boolean }[])[0]?.dirty).toBe(true);
  });

  it('reports ahead/behind against a configured upstream', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    const git = (args: readonly string[], cwd: string) =>
      execFileSync('git', args, { cwd, stdio: 'pipe' });
    // Upstream = the repo's own `main`, set explicitly (no remote needed for
    // `@{u}` to resolve -- a local tracking branch is enough).
    git(['branch', '--set-upstream-to=main', 'feat'], worktreeId);
    // One commit ahead, made only in the worktree.
    writeFileSync(join(worktreeId, 'ahead.txt'), 'x');
    git(['add', 'ahead.txt'], worktreeId);
    git(['commit', '--quiet', '-m', 'ahead commit'], worktreeId);
    // Two commits behind, made only on `main`.
    writeFileSync(join(repo, 'behind-1.txt'), 'x');
    git(['add', 'behind-1.txt'], repo);
    git(['commit', '--quiet', '-m', 'behind 1'], repo);
    writeFileSync(join(repo, 'behind-2.txt'), 'x');
    git(['add', 'behind-2.txt'], repo);
    git(['commit', '--quiet', '-m', 'behind 2'], repo);

    const result = await getWorktreeStatuses(
      { projectId: projectIdOf(repo), worktreeIds: [worktreeId] },
      deps,
    );

    const statuses = result as readonly { ahead: number | null; behind: number | null }[];
    expect(statuses[0]?.ahead).toBe(1);
    expect(statuses[0]?.behind).toBe(2);
  });

  it('answers null ahead/behind for a DETACHED HEAD, which cannot have an upstream', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    execFileSync('git', ['checkout', '--quiet', '--detach', 'HEAD'], { cwd: worktreeId });

    const result = await getWorktreeStatuses(
      { projectId: projectIdOf(repo), worktreeIds: [worktreeId] },
      deps,
    );

    const statuses = result as readonly { ahead: number | null; behind: number | null }[];
    expect(statuses[0]?.ahead).toBeNull();
    expect(statuses[0]?.behind).toBeNull();
  });

  it('refuses an unknown project outright', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);

    const result = await getWorktreeStatuses(
      { projectId: 'claude-code:nope-00000000', worktreeIds: [] },
      deps,
    );

    expect(result).toMatchObject({ kind: 'refused', code: 'unknown-project' });
  });

  it('silently drops a worktreeId of a repo vam never heard of, never spawning git in it', async () => {
    const parent = tempParent();
    const known = tempRepo(parent, 'known');
    const knownDeps = depsFor(known);
    const stranger = tempRepo(parent, 'stranger');
    const strangerDeps = depsFor(stranger);
    const strangerWorktree = await createWorktree(
      { projectId: projectIdOf(stranger), name: 'feat' },
      strangerDeps,
    );
    const strangerWorktreeId = (strangerWorktree as { worktreeId: string }).worktreeId;

    const result = await getWorktreeStatuses(
      { projectId: projectIdOf(known), worktreeIds: [strangerWorktreeId] },
      knownDeps,
    );

    expect(result).toEqual([]);
  });

  it('silently drops a directory that is not a real worktree at all, never spawning git in it', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const notAWorktree = join(parent, 'random-dir');
    mkdirSync(notAWorktree, { recursive: true });

    const result = await getWorktreeStatuses(
      { projectId: projectIdOf(repo), worktreeIds: [notAWorktree] },
      deps,
    );

    expect(result).toEqual([]);
  });

  /**
   * A `not-a-worktree` directory that DOES pass the commondir check --
   * unlike the plain `random-dir` test above, which never even reaches
   * `findMatchingEntry` (its missing `.git` file already fails the earlier
   * commondir proof). This one isolates the SECOND, independent guard:
   * `findMatchingEntry` against git's own live `worktree list`.
   *
   * FALSIFIED BY HAND: replace `matched === undefined || matched.bare` with
   * `false` in `status.ts` and rerun -- this test starts computing (and
   * returning) a status for a directory `git worktree add` never created,
   * proving THIS is the line that catches it, not the commondir check
   * above (which this attacker directory's crafted `.git` file already
   * satisfies).
   */
  it('silently drops a directory whose crafted `.git` file points at a KNOWN repo but that repo never registered as a worktree', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const legit = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const legitWorktreeId = (legit as { worktreeId: string }).worktreeId;
    const legitGitFile = readFileSync(join(legitWorktreeId, '.git'), 'utf8');
    const attackerDir = join(parent, 'attacker-dir');
    mkdirSync(attackerDir, { recursive: true });
    writeFileSync(join(attackerDir, '.git'), legitGitFile);

    const result = await getWorktreeStatuses(
      { projectId: projectIdOf(repo), worktreeIds: [attackerDir] },
      deps,
    );

    expect(result).toEqual([]);
  });

  it('computes status for a worktree registered OUTSIDE `-worktrees/` too -- adoption parity', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const manualPath = join(parent, 'manual-worktree');
    execFileSync('git', ['worktree', 'add', '--no-track', '-b', 'manual', manualPath], {
      cwd: repo,
    });
    writeFileSync(join(manualPath, 'untracked.txt'), 'oops');

    const result = await getWorktreeStatuses(
      { projectId: projectIdOf(repo), worktreeIds: [manualPath] },
      deps,
    );

    const statuses = result as readonly { worktreeId: string; dirty: boolean }[];
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.dirty).toBe(true);
  });
});
