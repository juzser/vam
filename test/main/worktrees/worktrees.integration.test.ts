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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

  /**
   * S3 -- `baseRef` used to reach `git worktree add`'s own argv as a bare
   * trailing element, where git's flag parser reads `-f` as `--force`
   * before it ever considers "is this a revision" (verified against a real
   * git binary while building the fix: `git worktree add -b x path -f`
   * silently force-creates the worktree, no base-ref error at all). Each
   * of these three is a real git flag shaped like a plausible base ref a
   * confused or malicious caller might send.
   *
   * FALSIFIED BY HAND: revert the `--` before `baseRef` in `createWorktree`
   * (keep `validateBaseRef`) and rerun -- these three still refuse at
   * `validateBaseRef` (which runs first), so to see the injection itself
   * you have to ALSO loosen `validateBaseRef` to accept anything; with both
   * reverted, `-f` stops being refused and instead force-creates the
   * worktree even though `name` collides with nothing -- the exact bug the
   * review reproduced.
   */
  describe('baseRef injection (S3)', () => {
    it.each(['-f', '--detach', '--upload-pack=x'])(
      'refuses a baseRef that looks like a git flag: %s',
      async (flagLikeRef) => {
        const parent = tempParent();
        const repo = tempRepo(parent);
        const deps = depsFor(repo);

        const result = await createWorktree(
          { projectId: projectIdOf(repo), name: 'feat', baseRef: flagLikeRef },
          deps,
        );

        expect(result).toMatchObject({ kind: 'refused', code: 'invalid-base-ref' });
        expect(existsSync(join(parent, 'repo-worktrees', 'feat'))).toBe(false);
        // No branch named after the target was created either -- refused
        // before `git worktree add` ever ran, not after.
        const branches = execFileSync('git', ['branch', '--list', 'feat'], {
          cwd: repo,
          encoding: 'utf8',
        });
        expect(branches.trim()).toBe('');
      },
    );
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
    const worktrees = result as readonly {
      path: string;
      branch: string | null;
      detached: boolean;
      prunable: boolean;
      prunableReason: string | null;
    }[];
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]?.path).toBe(join(parent, 'repo-worktrees', 'feat'));
    expect(worktrees[0]?.branch).toBe('feat');
    expect(worktrees[0]?.detached).toBe(false);
    expect(worktrees[0]?.prunable).toBe(false);
    expect(worktrees[0]?.prunableReason).toBeNull();
    expect(worktrees.some((w) => w.path === repo)).toBe(false);
  });

  it('marks a DETACHED HEAD worktree, branch reads as its short sha', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string; branch: string }).worktreeId;
    execFileSync('git', ['checkout', '--quiet', '--detach', 'HEAD'], { cwd: worktreeId });

    const result = await listWorktrees(projectIdOf(repo), deps);

    const worktrees = result as readonly {
      path: string;
      branch: string | null;
      detached: boolean;
    }[];
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]?.detached).toBe(true);
    expect(worktrees[0]?.branch).not.toBeNull();
    expect(worktrees[0]?.branch).toHaveLength(7);
  });

  it('marks a PRUNABLE worktree (its directory removed by hand) and carries the reason git gives', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const created = await createWorktree({ projectId: projectIdOf(repo), name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    rmSync(worktreeId, { recursive: true, force: true });

    const result = await listWorktrees(projectIdOf(repo), deps);

    const worktrees = result as readonly { prunable: boolean; prunableReason: string | null }[];
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]?.prunable).toBe(true);
    expect(worktrees[0]?.prunableReason).not.toBeNull();
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

  /**
   * DETECTION NEEDS NO NEW CODE -- this test is here to PROVE that, not to
   * exercise anything new: `listRaw` already runs an unconditional
   * `git worktree list --porcelain`, so a worktree a CLI, Orca, or
   * `claude --worktree` made OUTSIDE `<repoRoot>-worktrees/` was already in
   * this answer before phase 2a touched a single line here. What phase 2a
   * actually changes is `removeWorktree`'s own confinement, below -- listing
   * one and being able to safely delete it are two different questions.
   */
  it('lists a worktree made directly with `git worktree add`, entirely outside vam’s own root', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const manualPath = join(parent, 'manual-worktree');
    execFileSync('git', ['worktree', 'add', '--no-track', '-b', 'manual', manualPath], {
      cwd: repo,
    });

    const result = await listWorktrees(projectIdOf(repo), deps);

    const worktrees = result as readonly { path: string; branch: string | null }[];
    expect(worktrees.some((w) => w.path === manualPath && w.branch === 'manual')).toBe(true);
  });
});

describe('removeWorktree', () => {
  it('removes a CLEAN worktree and deletes its (merged) branch', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const projectId = projectIdOf(repo);
    const created = await createWorktree({ projectId, name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;

    const result = await removeWorktree({ projectId, worktreeId }, deps);

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
    const projectId = projectIdOf(repo);
    const created = await createWorktree({ projectId, name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    writeFileSync(join(worktreeId, 'new-file.txt'), 'unmerged work');
    execFileSync('git', ['add', 'new-file.txt'], { cwd: worktreeId });
    execFileSync('git', ['commit', '--quiet', '-m', 'unmerged commit'], { cwd: worktreeId });

    const result = await removeWorktree({ projectId, worktreeId }, deps);

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
    const projectId = projectIdOf(repo);
    const created = await createWorktree({ projectId, name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    writeFileSync(join(worktreeId, 'untracked.txt'), 'oops');

    const result = await removeWorktree({ projectId, worktreeId }, deps);

    expect(result).toMatchObject({ kind: 'refused', code: 'dirty' });
    expect(existsSync(worktreeId)).toBe(true);
  });

  it('refuses force without the retyped name matching, and removes nothing', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const projectId = projectIdOf(repo);
    const created = await createWorktree({ projectId, name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    writeFileSync(join(worktreeId, 'untracked.txt'), 'oops');

    const result = await removeWorktree(
      { projectId, worktreeId, force: true, confirmName: 'not-the-name' },
      deps,
    );

    expect(result).toMatchObject({ kind: 'refused', code: 'confirm-name-mismatch' });
    expect(existsSync(worktreeId)).toBe(true);
  });

  it('removes a DIRTY worktree once forced with the correctly retyped name', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const projectId = projectIdOf(repo);
    const created = await createWorktree({ projectId, name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    writeFileSync(join(worktreeId, 'untracked.txt'), 'oops');

    const result = await removeWorktree(
      { projectId, worktreeId, force: true, confirmName: 'feat' },
      deps,
    );

    expect(result).toEqual({ preservedBranch: false });
    expect(existsSync(worktreeId)).toBe(false);
  });

  it('never removes a LOCKED worktree, force or not', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const projectId = projectIdOf(repo);
    const created = await createWorktree({ projectId, name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;
    execFileSync('git', ['worktree', 'lock', worktreeId], { cwd: repo });

    const plain = await removeWorktree({ projectId, worktreeId }, deps);
    expect(plain).toMatchObject({ kind: 'refused', code: 'locked' });
    expect(existsSync(worktreeId)).toBe(true);

    const forced = await removeWorktree(
      { projectId, worktreeId, force: true, confirmName: 'feat' },
      deps,
    );
    expect(forced).toMatchObject({ kind: 'refused', code: 'locked' });
    expect(existsSync(worktreeId)).toBe(true);
  });

  it('refuses an unknown project outright, before touching the filesystem', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const projectId = projectIdOf(repo);
    const created = await createWorktree({ projectId, name: 'feat' }, deps);
    const worktreeId = (created as { worktreeId: string }).worktreeId;

    const result = await removeWorktree(
      { projectId: 'claude-code:nope-00000000', worktreeId },
      deps,
    );

    expect(result).toMatchObject({ kind: 'refused', code: 'unknown-project' });
    expect(existsSync(worktreeId)).toBe(true);
  });

  it('refuses a directory inside the confined root that git never registered as a worktree', async () => {
    const parent = tempParent();
    const repo = tempRepo(parent);
    const deps = depsFor(repo);
    const projectId = projectIdOf(repo);
    // Confinement-legal (lives inside `repo-worktrees/`) but never created
    // through `git worktree add` -- no `.git` file, so it cannot even claim
    // a repo root.
    const notAWorktree = join(worktreesRootFor(repo), 'random-dir');
    mkdirSync(notAWorktree, { recursive: true });

    const result = await removeWorktree({ projectId, worktreeId: notAWorktree }, deps);

    expect(result).toMatchObject({ kind: 'refused', code: 'not-a-worktree' });
    expect(existsSync(notAWorktree)).toBe(true);
  });

  /**
   * ADOPTION (phase 2a): a worktree made OUTSIDE vam -- by a CLI, by Orca,
   * by `claude --worktree` -- gets the SAME affordances as one vam made
   * itself, including safe delete. `listWorktrees` already surfaced these
   * (the test above proves it needed no change); this is the half that DID
   * change: `removeWorktree` no longer refuses a real, registered worktree
   * of a KNOWN repo merely because it lives outside `<repoRoot>-worktrees/`.
   *
   * FALSIFIED BY HAND: reintroduce the dropped `authorize()` call (confining
   * `realWorktreeId` to `worktreesRootFor(repoRoot)`) ahead of the commondir
   * check in `removeWorktree` and rerun this one test -- it goes red with
   * `path-confinement`, proving THIS is the line that used to stand between
   * listing a worktree and being able to remove it.
   */
  describe('adoption -- a worktree registered outside `<repoRoot>-worktrees/`', () => {
    it('removes a CLEAN worktree made directly with `git worktree add`, entirely outside vam’s own root', async () => {
      const parent = tempParent();
      const repo = tempRepo(parent);
      const deps = depsFor(repo);
      const projectId = projectIdOf(repo);
      const manualPath = join(parent, 'manual-worktree');
      execFileSync('git', ['worktree', 'add', '--no-track', '-b', 'manual', manualPath], {
        cwd: repo,
      });
      expect(existsSync(manualPath)).toBe(true);

      const result = await removeWorktree({ projectId, worktreeId: manualPath }, deps);

      expect(result).toEqual({ preservedBranch: false });
      expect(existsSync(manualPath)).toBe(false);
    });

    it('still refuses a DIRTY adopted worktree without confirmation, and removes nothing -- same rule as a vam-made one', async () => {
      const parent = tempParent();
      const repo = tempRepo(parent);
      const deps = depsFor(repo);
      const projectId = projectIdOf(repo);
      const manualPath = join(parent, 'manual-worktree');
      execFileSync('git', ['worktree', 'add', '--no-track', '-b', 'manual', manualPath], {
        cwd: repo,
      });
      writeFileSync(join(manualPath, 'untracked.txt'), 'oops');

      const result = await removeWorktree({ projectId, worktreeId: manualPath }, deps);

      expect(result).toMatchObject({ kind: 'refused', code: 'dirty' });
      expect(existsSync(manualPath)).toBe(true);
    });

    it('never removes a LOCKED adopted worktree, force or not -- same rule as a vam-made one', async () => {
      const parent = tempParent();
      const repo = tempRepo(parent);
      const deps = depsFor(repo);
      const projectId = projectIdOf(repo);
      const manualPath = join(parent, 'manual-worktree');
      execFileSync('git', ['worktree', 'add', '--no-track', '-b', 'manual', manualPath], {
        cwd: repo,
      });
      execFileSync('git', ['worktree', 'lock', manualPath], { cwd: repo });

      const result = await removeWorktree(
        { projectId, worktreeId: manualPath, force: true, confirmName: 'manual-worktree' },
        deps,
      );

      expect(result).toMatchObject({ kind: 'refused', code: 'locked' });
      expect(existsSync(manualPath)).toBe(true);
    });

    it('PRESERVES an unmerged branch on an adopted worktree rather than discarding it -- same rule as a vam-made one', async () => {
      const parent = tempParent();
      const repo = tempRepo(parent);
      const deps = depsFor(repo);
      const projectId = projectIdOf(repo);
      const manualPath = join(parent, 'manual-worktree');
      execFileSync('git', ['worktree', 'add', '--no-track', '-b', 'manual', manualPath], {
        cwd: repo,
      });
      writeFileSync(join(manualPath, 'new-file.txt'), 'unmerged work');
      execFileSync('git', ['add', 'new-file.txt'], { cwd: manualPath });
      execFileSync('git', ['commit', '--quiet', '-m', 'unmerged commit'], { cwd: manualPath });

      const result = await removeWorktree({ projectId, worktreeId: manualPath }, deps);

      expect(result).toEqual({ preservedBranch: true });
      expect(existsSync(manualPath)).toBe(false);
      const branches = execFileSync('git', ['branch', '--list', 'manual'], {
        cwd: repo,
        encoding: 'utf8',
      });
      expect(branches.trim()).not.toBe('');
    });
  });

  /**
   * THE TWO SHAPES THAT STILL MUST BE REFUSED even after adoption -- a
   * compromised renderer handing `removeWorktree` an absolute `worktreeId`
   * it does not own: a real worktree of a REPO vam never heard of, and a
   * directory whose crafted `.git` file claims a KNOWN repo's own commondir
   * without git itself ever having registered that directory as one of that
   * repo's worktrees. Both must be refused, and neither may touch the
   * filesystem -- location is no longer part of the proof (the suite
   * above), but "is this really a registered worktree of the repo it
   * claims" still is.
   *
   * FALSIFIED BY HAND, MEASURED (not merely argued): disabling the
   * `claimedRepoRoot !== realRepoRoot` guard (the commondir check) alone
   * leaves BOTH tests below passing -- `findMatchingEntry` independently
   * catches both shapes too, since neither the stranger's worktree nor the
   * attacker's directory is ever a path `known`'s own `git worktree list`
   * actually names. Disabling the `matched === undefined` guard instead
   * (with commondir intact) is what actually moves a needle: the first test
   * still passes (the commondir check alone already refuses it, before
   * `matched` is even computed), but the second CRASHES --
   * `TypeError: Cannot read properties of undefined (reading 'locked')` --
   * proving that guard is the one carrying shape 2 alone. The two checks
   * are genuine belt-and-suspenders for shape 1 (either refuses it) and the
   * ONLY guard for shape 2 is `findMatchingEntry`, not the commondir chain
   * this describe block's name might suggest.
   */
  describe('confinement (S2) -- a worktreeId the renderer does not own', () => {
    it('refuses a linked worktree of an UNKNOWN repo, even though it is a real worktree', async () => {
      const parent = tempParent();
      const known = tempRepo(parent, 'known');
      const knownDeps = depsFor(known);
      const knownProjectId = projectIdOf(known);

      const stranger = tempRepo(parent, 'stranger');
      const strangerDeps = depsFor(stranger);
      const strangerWorktree = await createWorktree(
        { projectId: projectIdOf(stranger), name: 'feat' },
        strangerDeps,
      );
      const strangerWorktreeId = (strangerWorktree as { worktreeId: string }).worktreeId;

      const result = await removeWorktree(
        { projectId: knownProjectId, worktreeId: strangerWorktreeId },
        knownDeps,
      );

      expect(result).toMatchObject({ kind: 'refused' });
      expect((result as { code: string }).code).not.toBe('git-failed');
      expect(existsSync(strangerWorktreeId)).toBe(true);
    });

    it('refuses a directory whose crafted `.git` file points at a KNOWN repo but that repo never registered as a worktree', async () => {
      const parent = tempParent();
      const repo = tempRepo(parent);
      const deps = depsFor(repo);
      const projectId = projectIdOf(repo);
      const legit = await createWorktree({ projectId, name: 'feat' }, deps);
      const legitWorktreeId = (legit as { worktreeId: string }).worktreeId;

      // Read the REAL worktree's own `.git` file to find `repo`'s real
      // admin gitdir for it, then point an attacker directory at that exact
      // same gitdir -- a `.git` file whose `gitdir:`/`commondir` chain
      // resolves to a repo vam genuinely knows, from a directory that repo
      // never registered as a worktree at all.
      const legitGitFile = readFileSync(join(legitWorktreeId, '.git'), 'utf8');
      const attackerDir = join(parent, 'attacker-dir');
      mkdirSync(attackerDir, { recursive: true });
      writeFileSync(join(attackerDir, '.git'), legitGitFile);
      expect(existsSync(attackerDir)).toBe(true);

      const result = await removeWorktree({ projectId, worktreeId: attackerDir }, deps);

      expect(result).toMatchObject({ kind: 'refused', code: 'not-a-worktree' });
      expect(existsSync(attackerDir)).toBe(true);
      // The real worktree it impersonated is untouched too.
      expect(existsSync(legitWorktreeId)).toBe(true);
    });
  });
});
