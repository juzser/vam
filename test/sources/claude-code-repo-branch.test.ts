/**
 * The git branch reader: given a session's `cwd`, what branch is it on.
 *
 * Reads `.git/HEAD` directly rather than spawning `git` (see the module doc
 * in `repo-branch.ts` for why). The filesystem is injected throughout, so
 * none of this touches a real directory on the machine running the test.
 */

import { describe, expect, it } from 'vitest';
import {
  type BranchFs,
  createBranchLookup,
} from '../../src/main/sources/claude-code/repo-branch.js';

/** A tiny in-memory filesystem: paths to either a directory marker or file content. */
function fakeFs(entries: Record<string, string | 'dir'>): BranchFs & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    statType: async (path: string) => {
      calls.push(`stat:${path}`);
      const entry = entries[path];
      if (entry === undefined) return null;
      return entry === 'dir' ? 'dir' : 'file';
    },
    readFile: async (path: string) => {
      calls.push(`read:${path}`);
      const entry = entries[path];
      if (entry === undefined || entry === 'dir') throw new Error(`ENOENT: ${path}`);
      return entry;
    },
  };
}

describe('createBranchLookup', () => {
  it('reads a plain branch off ref: refs/heads/<name>', async () => {
    const fs = fakeFs({
      '/repo/.git': 'dir',
      '/repo/.git/HEAD': 'ref: refs/heads/main\n',
    });
    const branchOf = createBranchLookup(fs);
    await expect(branchOf('/repo')).resolves.toBe('main');
  });

  it('keeps the whole ref name when it contains slashes', async () => {
    const fs = fakeFs({
      '/repo/.git': 'dir',
      '/repo/.git/HEAD': 'ref: refs/heads/smith/specs/vam-seam-plan\n',
    });
    const branchOf = createBranchLookup(fs);
    await expect(branchOf('/repo')).resolves.toBe('smith/specs/vam-seam-plan');
  });

  it('returns a 7-char short sha for a detached HEAD', async () => {
    const fs = fakeFs({
      '/repo/.git': 'dir',
      '/repo/.git/HEAD': 'c981d0eaa1b2c3d4e5f60718293a4b5c6d7e8f90\n',
    });
    const branchOf = createBranchLookup(fs);
    await expect(branchOf('/repo')).resolves.toBe('c981d0e');
  });

  it('follows a .git FILE (worktree layout) to the real gitdir', async () => {
    const fs = fakeFs({
      '/repo/.git': 'gitdir: /main-checkout/.git/worktrees/repo\n',
      '/main-checkout/.git/worktrees/repo/HEAD': 'ref: refs/heads/feature-x\n',
    });
    const branchOf = createBranchLookup(fs);
    await expect(branchOf('/repo')).resolves.toBe('feature-x');
  });

  it('walks up from a subdirectory of the repo root to find .git', async () => {
    const fs = fakeFs({
      '/repo/.git': 'dir',
      '/repo/.git/HEAD': 'ref: refs/heads/main\n',
    });
    const branchOf = createBranchLookup(fs);
    await expect(branchOf('/repo/src/deep/nested')).resolves.toBe('main');
  });

  it('returns null, never throws, when there is no repository at all', async () => {
    const fs = fakeFs({});
    const branchOf = createBranchLookup(fs);
    await expect(branchOf('/nowhere')).resolves.toBeNull();
  });

  it('returns null when HEAD is unreadable', async () => {
    const fs: BranchFs = {
      statType: async () => 'dir',
      readFile: async () => {
        throw new Error('EACCES');
      },
    };
    const branchOf = createBranchLookup(fs);
    await expect(branchOf('/repo')).resolves.toBeNull();
  });

  it('returns null for malformed HEAD content', async () => {
    const fs = fakeFs({
      '/repo/.git': 'dir',
      '/repo/.git/HEAD': 'not a ref and not a sha\n',
    });
    const branchOf = createBranchLookup(fs);
    await expect(branchOf('/repo')).resolves.toBeNull();
  });

  it('reads the filesystem once per directory, caching the second lookup', async () => {
    const fs = fakeFs({
      '/repo/.git': 'dir',
      '/repo/.git/HEAD': 'ref: refs/heads/main\n',
    });
    const branchOf = createBranchLookup(fs);
    await branchOf('/repo');
    const callsAfterFirst = fs.calls.length;
    await branchOf('/repo');
    expect(fs.calls.length).toBe(callsAfterFirst);
  });
});
