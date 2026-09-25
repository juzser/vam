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
   * THE THREE SHAPES S2 CLOSES -- a compromised renderer handing
   * `removeWorktree` an absolute `worktreeId` it does not own, in the three
   * ways that could have worked before rule 6 existed: a real worktree of a
   * REPO vam never heard of; a real, git-registered worktree of a KNOWN
   * repo that merely lives outside that repo's confined root; and a
   * directory whose crafted `.git` file claims a KNOWN repo's own commondir
   * while sitting outside that repo's root entirely. All three must be
   * refused, and none may touch the filesystem.
   *
   * FALSIFIED BY HAND: comment out the `authorize()` call in
   * `removeWorktree` (or its `if (!authorization.authorized)` guard) and
   * rerun this suite -- "outside the root" and "attacker .git" both start
   * passing a `--force` removal of a directory the confinement rule exists
   * to protect, proving these tests exercise that specific line rather than
   * some other, coincidental refusal.
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

    it('refuses a path outside `-worktrees/`, even when `git worktree list` legitimately lists it', async () => {
      const parent = tempParent();
      const repo = tempRepo(parent);
      const deps = depsFor(repo);
      const projectId = projectIdOf(repo);
      // A worktree of THIS repo, made the way an operator running `git`
      // directly (outside vam) could -- registered in `repo`'s own git
      // metadata, so `git worktree list` genuinely reports it, but never
      // inside `repo-worktrees/`.
      const manualPath = join(parent, 'manual-worktree');
      execFileSync('git', ['worktree', 'add', '--no-track', '-b', 'manual', manualPath], {
        cwd: repo,
      });
      expect(existsSync(manualPath)).toBe(true);

      const result = await removeWorktree({ projectId, worktreeId: manualPath }, deps);

      expect(result).toMatchObject({ kind: 'refused', code: 'path-confinement' });
      expect(existsSync(manualPath)).toBe(true);
    });

    it('refuses a directory OUTSIDE the root whose crafted `.git` file points at a KNOWN repo', async () => {
      const parent = tempParent();
      const repo = tempRepo(parent);
      const deps = depsFor(repo);
      const projectId = projectIdOf(repo);
      const legit = await createWorktree({ projectId, name: 'feat' }, deps);
      const legitWorktreeId = (legit as { worktreeId: string }).worktreeId;

      // Read the REAL worktree's own `.git` file to find `repo`'s real
      // admin gitdir for it, then point an attacker directory OUTSIDE
      // `repo-worktrees/` at that exact same gitdir -- a `.git` file whose
      // `gitdir:`/`commondir` chain resolves to a repo vam genuinely knows,
      // from a directory that repo never registered as a worktree at all.
      const legitGitFile = readFileSync(join(legitWorktreeId, '.git'), 'utf8');
      const attackerDir = join(parent, 'attacker-dir');
      mkdirSync(attackerDir, { recursive: true });
      writeFileSync(join(attackerDir, '.git'), legitGitFile);
      expect(existsSync(attackerDir)).toBe(true);

      const result = await removeWorktree({ projectId, worktreeId: attackerDir }, deps);

      expect(result).toMatchObject({ kind: 'refused', code: 'path-confinement' });
      expect(existsSync(attackerDir)).toBe(true);
      // The real worktree it impersonated is untouched too.
      expect(existsSync(legitWorktreeId)).toBe(true);
    });
  });
});
