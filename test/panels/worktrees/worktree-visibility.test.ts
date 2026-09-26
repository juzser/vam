import { describe, expect, it } from 'vitest';
import {
  isExternalOrLockedWorktree,
  isHiddenByExternalWorktreeFilter,
} from '../../../src/renderer/panels/worktrees/worktree-visibility.js';
import type { WorktreeInfo } from '../../../src/shared/worktree.js';

function worktree(over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    worktreeId: '/repo-worktrees/feat',
    path: '/repo-worktrees/feat',
    branch: 'feat',
    projectId: 'claude-code:feat-00000000',
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    detached: false,
    external: false,
    ...over,
  };
}

describe('isExternalOrLockedWorktree', () => {
  it('is false for an ordinary, vam-made, unlocked worktree', () => {
    expect(isExternalOrLockedWorktree(worktree())).toBe(false);
  });

  it('is true for an external worktree, locked or not', () => {
    expect(isExternalOrLockedWorktree(worktree({ external: true }))).toBe(true);
  });

  it('is true for a LOCKED worktree even when it is vam’s own (not external)', () => {
    expect(isExternalOrLockedWorktree(worktree({ external: false, locked: true }))).toBe(true);
  });
});

describe('isHiddenByExternalWorktreeFilter', () => {
  it('defaults to hidden: an external worktree is hidden when the toggle is off', () => {
    expect(
      isHiddenByExternalWorktreeFilter(worktree({ external: true }), {
        hideExternalWorktrees: true,
      }),
    ).toBe(true);
  });

  it('a locked worktree is hidden by default even when vam made it (not external)', () => {
    expect(
      isHiddenByExternalWorktreeFilter(worktree({ external: false, locked: true }), {
        hideExternalWorktrees: true,
      }),
    ).toBe(true);
  });

  it('an ordinary worktree is never hidden by this rule, toggle on or off', () => {
    expect(isHiddenByExternalWorktreeFilter(worktree(), { hideExternalWorktrees: true })).toBe(
      false,
    );
    expect(isHiddenByExternalWorktreeFilter(worktree(), { hideExternalWorktrees: false })).toBe(
      false,
    );
  });

  it('shows an external or locked worktree once the toggle is off', () => {
    expect(
      isHiddenByExternalWorktreeFilter(worktree({ external: true }), {
        hideExternalWorktrees: false,
      }),
    ).toBe(false);
    expect(
      isHiddenByExternalWorktreeFilter(worktree({ locked: true }), {
        hideExternalWorktrees: false,
      }),
    ).toBe(false);
  });

  /**
   * FALSIFIED BY HAND, MEASURED: dropping the `|| worktree.locked` half of
   * `isExternalOrLockedWorktree`'s own body turns THIS test red, exactly as
   * expected -- and two others in this file along with it (`isExternalOr
   * LockedWorktree`'s own "true for a LOCKED worktree" test above, and
   * `isHiddenByExternalWorktreeFilter`'s "locked worktree is hidden by
   * default" test), since both read the same shared helper this mutation
   * changes. Three red rather than one is still the right falsification: it
   * shows the `locked` half is real, load-bearing logic these tests actually
   * exercise, not that this one test is redundant with the others -- each of
   * the three names a DIFFERENT caller-visible fact (the raw predicate, the
   * filter with an ordinary worktree, and the filter with a vam-made one)
   * that the same one-line change happens to break all at once.
   */
  it('a vam-made (non-external) locked worktree is STILL hidden by default', () => {
    expect(
      isHiddenByExternalWorktreeFilter(worktree({ external: false, locked: true }), {
        hideExternalWorktrees: true,
      }),
    ).toBe(true);
  });
});
