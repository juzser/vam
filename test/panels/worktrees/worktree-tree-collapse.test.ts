/**
 * Per-project collapse state for the "external/locked worktrees" tree group
 * `WorktreesSection` draws once the operator turns "Show external worktrees"
 * on -- kept directly in `localStorage`, the same shape and the same reasons
 * `prefs/foreign-hidden-note.test.ts` already proves for its own one number:
 * a viewer who cannot persist this is asked again next launch, which is not a
 * broken tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isWorktreeTreeCollapsed,
  setWorktreeTreeCollapsed,
} from '../../../src/renderer/panels/worktrees/worktree-tree-collapse.js';

afterEach(() => {
  // `test/support/storage.ts` reinstalls a fresh `localStorage` before every
  // test; unstub FIRST, same order `foreign-hidden-note.test.ts` uses.
  vi.unstubAllGlobals();
});

describe('isWorktreeTreeCollapsed / setWorktreeTreeCollapsed', () => {
  it('is expanded (not collapsed) for a project never folded', () => {
    expect(isWorktreeTreeCollapsed('claude-code:repo-11111111')).toBe(false);
  });

  it('remembers a fold, per project, and a fresh read (a relaunch) still sees it', () => {
    setWorktreeTreeCollapsed('claude-code:repo-11111111', true);
    expect(isWorktreeTreeCollapsed('claude-code:repo-11111111')).toBe(true);
    expect(isWorktreeTreeCollapsed('claude-code:repo-11111111')).toBe(true);
  });

  it('one project’s own fold never touches a sibling project’s', () => {
    setWorktreeTreeCollapsed('claude-code:repo-11111111', true);
    expect(isWorktreeTreeCollapsed('claude-code:repo-22222222')).toBe(false);
  });

  it('un-folds, and the entry is removed rather than stored as `false`', () => {
    setWorktreeTreeCollapsed('claude-code:repo-11111111', true);
    setWorktreeTreeCollapsed('claude-code:repo-11111111', false);
    expect(isWorktreeTreeCollapsed('claude-code:repo-11111111')).toBe(false);
    const raw = localStorage.getItem('vam.worktrees.externalTreeCollapsed');
    expect(raw === null ? {} : JSON.parse(raw)).not.toHaveProperty('claude-code:repo-11111111');
  });

  it('treats a corrupt value already in storage as "nothing folded", rather than throwing', () => {
    localStorage.setItem('vam.worktrees.externalTreeCollapsed', 'not json{{{');
    expect(() => isWorktreeTreeCollapsed('p1')).not.toThrow();
    expect(isWorktreeTreeCollapsed('p1')).toBe(false);
  });

  /**
   * A BROWSER THAT REFUSES STORAGE MUST NOT TAKE THE TREE DOWN WITH IT --
   * the same failure `foreign-hidden-note.test.ts` and `remote-token.test.ts`
   * already falsify for their own values. Safari in private mode throws from
   * `setItem`/`getItem`.
   */
  it('survives a storage that throws, rather than taking the tree with it', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => setWorktreeTreeCollapsed('p1', true)).not.toThrow();
    expect(isWorktreeTreeCollapsed('p1')).toBe(false);
  });

  it('survives localStorage being entirely absent', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => setWorktreeTreeCollapsed('p1', true)).not.toThrow();
    expect(isWorktreeTreeCollapsed('p1')).toBe(false);
  });
});
