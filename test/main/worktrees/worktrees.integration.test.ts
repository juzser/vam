/**
 * `worktrees.ts` against REAL git repositories under the OS temp directory --
 * no mocked git, no mocked filesystem, so a refusal proved here is a refusal
 * that holds against the real `git worktree` state machine, not against this
 * module's own idea of what git would say.
 *
 * Every REFUSAL case also asserts the thing it refuses did NOT happen --
 * no directory created, no worktree registered, nothing removed -- matching
 * `repo-directory.test.ts`'s own rule: a refusal that happens after the
 * side effect is not a refusal.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { projectIdOf } from '../../../src/main/sources/claude-code/project-id.js';
import { runGitViaCli } from '../../../src/main/worktrees/git-run.js';
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  type WorktreesDeps,
  worktreesRootFor,
} from '../../../src/main/worktrees/worktrees.js';

const made: string[] = [];

function tempParent(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'vam-wt-')));
  made.push(dir);
  return dir;
}

/** A real git repository, one commit deep, default branch `main`. */
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

describe('worktreesRootFor', () => {
  it('is a sibling of the repository, named `<repoName>-worktrees`', () => {
    expect(worktreesRootFor('/srv/work/vam')).toBe('/srv/work/vam-worktrees');
  });
});

describe('createWorktree', () => {
  it('creates a worktree beside the repo, on a new branch named after the sanitised input', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);

    const result = await createWorktree(
      { projectId: projectIdOf(repo), name: 'My Feature!' },
      deps,
    );

    expect('kind' in result).toBe(false);
    const worktree = result as Exclude<typeof result, { kind: string }>;
    expect(worktree.path).toBe(join(parent, 'repo-worktrees', 'My-Feature'));
    expect(worktree.branch).toBe('My-Feature');
    expect(existsSync(join(worktree.path, 'README.md'))).toBe(true);
    // The branch actually checked out is the sanitised name, read back from git.
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: worktree.path,
      encoding: 'utf8',
    }).trim();
    expect(branch).toBe('My-Feature');
  });

  it('refuses an unknown project and creates nothing', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);

    const result = await createWorktree(
      { projectId: 'claude-code:nope-00000000', name: 'x' },
      deps,
    );

    expect(result).toMatchObject({ kind: 'refused', code: 'unknown-project' });
    expect(existsSync(join(parent, 'repo-worktrees'))).toBe(false);
  });

  it('refuses a non-git directory and creates nothing', async () => {
    const parent = tempParent();
    const plain = join(parent, 'plain');
    mkdirSync(plain, { recursive: true });
    const projectId = projectIdOf(plain);
    const deps: WorktreesDeps = {
      run: runGitViaCli(),
      realpathFn: (p: string) => realpath(p),
      resolveProjectDirectory: async () => plain,
      knownProjectIds: async () => [projectId],
    };

    const result = await createWorktree({ projectId, name: 'x' }, deps);

    expect(result).toMatchObject({ kind: 'refused', code: 'not-a-repository' });
    expect(existsSync(join(parent, 'plain-worktrees'))).toBe(false);
  });

  it('refuses a BARE repository and creates nothing', async () => {
    const parent = tempParent();
    const bare = join(parent, 'bare.git');
    execFileSync('git', ['init', '--quiet', '--bare', bare]);
    const projectId = projectIdOf(bare);
    const deps: WorktreesDeps = {
      run: runGitViaCli(),
      realpathFn: (p: string) => realpath(p),
      resolveProjectDirectory: async () => bare,
      knownProjectIds: async () => [projectId],
    };

    const result = await createWorktree({ projectId, name: 'x' }, deps);

    expect(result).toMatchObject({ kind: 'refused', code: 'not-a-repository' });
    expect(existsSync(join(parent, 'bare.git-worktrees'))).toBe(false);
  });

  it('refuses a name that sanitises to nothing, before anything runs', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);

    const result = await createWorktree({ projectId: projectIdOf(repo), name: '...' }, deps);

    expect(result).toMatchObject({ kind: 'refused', code: 'invalid-name' });
    expect(existsSync(join(parent, 'repo-worktrees'))).toBe(false);
  });

  it('refuses a target path that already exists', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const preexisting = join(parent, 'repo-worktrees', 'taken');
    mkdirSync(preexisting, { recursive: true });
    writeFileSync(join(preexisting, 'sentinel.txt'), 'do not touch');

    const result = await createWorktree({ projectId: projectIdOf(repo), name: 'taken' }, deps);

    expect(result).toMatchObject({ kind: 'refused', code: 'already-exists' });
    // Untouched -- not replaced, not merged into.
    expect(existsSync(join(preexisting, 'sentinel.txt'))).toBe(true);
  });

  it("refuses a branch that is already checked out (the repo's own current branch)", async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);

    const result = await createWorktree({ projectId: projectIdOf(repo), name: 'main' }, deps);

    expect(result).toMatchObject({ kind: 'refused', code: 'branch-exists' });
    expect(existsSync(join(parent, 'repo-worktrees', 'main'))).toBe(false);
  });

  it('accepts an explicit baseRef and branches from it, not from HEAD', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    execFileSync('git', ['checkout', '--quiet', '-b', 'other'], { cwd: repo });
    writeFileSync(join(repo, 'other-only.txt'), 'x');
    execFileSync('git', ['add', 'other-only.txt'], { cwd: repo });
    execFileSync('git', ['commit', '--quiet', '-m', 'other branch commit'], { cwd: repo });
    execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: repo });

    const result = await createWorktree(
      { projectId: projectIdOf(repo), name: 'from-other', baseRef: 'other' },
      deps,
    );

    expect('kind' in result).toBe(false);
    const worktree = result as Exclude<typeof result, { kind: string }>;
    expect(existsSync(join(worktree.path, 'other-only.txt'))).toBe(true);
  });
});

describe('listWorktrees', () => {
  it('lists a linked worktree but never the main worktree itself', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);

    const result = await listWorktrees(projectIdOf(repo), deps);

    expect(Array.isArray(result)).toBe(true);
    const worktrees = result as readonly { path: string; branch: string | null }[];
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]?.path).toBe(join(parent, 'repo-worktrees', 'feat'));
    expect(worktrees[0]?.branch).toBe('feat');
    expect(worktrees.some((w) => w.path === repo)).toBe(false);
  });

  it('answers an empty list for a repo with no linked worktrees', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);

    const result = await listWorktrees(projectIdOf(repo), deps);

    expect(result).toEqual([]);
  });

  it('refuses an unknown project', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);

    const result = await listWorktrees('claude-code:nope-00000000', deps);

    expect(result).toMatchObject({ kind: 'refused', code: 'unknown-project' });
  });
});

describe('removeWorktree', () => {
  it('removes a CLEAN worktree and deletes its (merged) branch', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;

    const result = await removeWorktree({ worktreeId }, deps);

    expect(result).toEqual({ preservedBranch: false });
    expect(existsSync(worktreeId)).toBe(false);
    const branches = execFileSync('git', ['branch', '--list', 'feat'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(branches.trim()).toBe('');
  });

  it('PRESERVES an unmerged branch rather than discarding it', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    writeFileSync(join(worktreeId, 'new-file.txt'), 'unmerged work');
    execFileSync('git', ['add', 'new-file.txt'], { cwd: worktreeId });
    execFileSync('git', ['commit', '--quiet', '-m', 'unmerged commit'], { cwd: worktreeId });

    const result = await removeWorktree({ worktreeId }, deps);

    expect(result).toEqual({ preservedBranch: true });
    expect(existsSync(worktreeId)).toBe(false);
    const branches = execFileSync('git', ['branch', '--list', 'feat'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(branches.trim()).not.toBe('');
  });

  it('refuses a DIRTY worktree without confirmation, and removes nothing', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    writeFileSync(join(worktreeId, 'untracked.txt'), 'oops');

    const result = await removeWorktree({ worktreeId }, deps);

    expect(result).toMatchObject({ kind: 'refused', code: 'dirty' });
    expect(existsSync(worktreeId)).toBe(true);
  });

  it('refuses force without the retyped name matching, and removes nothing', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    writeFileSync(join(worktreeId, 'untracked.txt'), 'oops');

    const result = await removeWorktree(
      { worktreeId, force: true, confirmName: 'not-the-name' },
      deps,
    );

    expect(result).toMatchObject({ kind: 'refused', code: 'confirm-name-mismatch' });
    expect(existsSync(worktreeId)).toBe(true);
  });

  it('removes a DIRTY worktree once forced with the correctly retyped name', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    writeFileSync(join(worktreeId, 'untracked.txt'), 'oops');

    const result = await removeWorktree({ worktreeId, force: true, confirmName: 'feat' }, deps);

    expect(result).toEqual({ preservedBranch: false });
    expect(existsSync(worktreeId)).toBe(false);
  });

  it('never removes a LOCKED worktree, force or not', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    execFileSync('git', ['worktree', 'lock', worktreeId], { cwd: repo });

    const plain = await removeWorktree({ worktreeId }, deps);
    expect(plain).toMatchObject({ kind: 'refused', code: 'locked' });
    expect(existsSync(worktreeId)).toBe(true);

    const forced = await removeWorktree({ worktreeId, force: true, confirmName: 'feat' }, deps);
    expect(forced).toMatchObject({ kind: 'refused', code: 'locked' });
    expect(existsSync(worktreeId)).toBe(true);
  });

  it('refuses a path that is not a worktree vam manages', async () => {
    const parent = tempParent();
    const notAWorktree = join(parent, 'random-dir');
    mkdirSync(notAWorktree, { recursive: true });
    const deps: WorktreesDeps = {
      run: runGitViaCli(),
      realpathFn: (p: string) => realpath(p),
      resolveProjectDirectory: async () => null,
      knownProjectIds: async () => [],
    };

    const result = await removeWorktree({ worktreeId: notAWorktree }, deps);

    expect(result).toMatchObject({ kind: 'refused', code: 'not-a-worktree' });
    expect(existsSync(notAWorktree)).toBe(true);
  });
});
