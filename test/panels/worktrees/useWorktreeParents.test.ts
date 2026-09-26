// @vitest-environment happy-dom

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorktreesApi } from '../../../src/preload/api.js';
import { useWorktreeParents } from '../../../src/renderer/panels/worktrees/useWorktreeParents.js';
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

function fakeApi(list: (projectId: string) => Promise<readonly WorktreeInfo[]>): WorktreesApi {
  return { list, create: vi.fn(), remove: vi.fn(), status: vi.fn().mockResolvedValue([]) };
}

describe('useWorktreeParents', () => {
  it('answers an empty map with no request when there is no api', () => {
    const { result } = renderHook(() => useWorktreeParents(['p1'], undefined));
    expect(result.current).toEqual(new Map());
  });

  it('answers an empty map with no request when there are no project ids', () => {
    const list = vi.fn();
    const { result } = renderHook(() => useWorktreeParents([], fakeApi(list)));
    expect(result.current).toEqual(new Map());
    expect(list).not.toHaveBeenCalled();
  });

  it('maps each worktree.projectId to the parent id that listed it', async () => {
    const list = vi.fn(async (parentId: string) =>
      parentId === 'parent-a' ? [worktree({ projectId: 'child-a' })] : [],
    );
    const { result } = renderHook(() =>
      useWorktreeParents(['parent-a', 'parent-b'], fakeApi(list)),
    );
    await waitFor(() => expect(result.current.get('child-a')).toBe('parent-a'));
    expect(result.current).toEqual(new Map([['child-a', 'parent-a']]));
    expect(list).toHaveBeenCalledWith('parent-a');
    expect(list).toHaveBeenCalledWith('parent-b');
  });

  it('a project that refuses (not a repo, unknown) contributes nothing, quietly', async () => {
    const list = vi.fn(async (parentId: string) => {
      if (parentId === 'git-repo') return [worktree({ projectId: 'child-a' })];
      throw new Error('refused: not-a-repository');
    });
    const { result } = renderHook(() =>
      useWorktreeParents(['git-repo', 'pane-only'], fakeApi(list)),
    );
    await waitFor(() => expect(result.current.get('child-a')).toBe('git-repo'));
    expect(result.current.size).toBe(1);
  });

  /**
   * SECOND GUARD, defensive: even after the main-process fix
   * (`listWorktrees` never reports the main worktree as anyone's child), a
   * cycle in this hook's own `parents` map must never hide every project on
   * it. Two projects whose OWN `list()` answers each name the OTHER as a
   * child (the exact shape the cross-provider review reproduced against
   * real git before the main-process fix) must not leave a mutual
   * parent-assignment in the map -- either one being "hidden under" the
   * other forms a cycle with no unsuppressed ancestor to stop at, which
   * would hide BOTH projects' sidebar sections at once
   * (`SessionList.tsx`'s `isSuppressedWorktreeChild`). The safe fallback is
   * to drop the cyclic edges entirely, so both projects read as
   * `parentId: undefined` and draw at the top level.
   */
  it('breaks a CYCLE in the parent map rather than assigning either side a parent', async () => {
    const list = vi.fn(async (parentId: string) => {
      if (parentId === 'm') return [worktree({ projectId: 'l' })];
      if (parentId === 'l') return [worktree({ projectId: 'm' })];
      return [];
    });
    const { result } = renderHook(() => useWorktreeParents(['m', 'l'], fakeApi(list)));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.has('m')).toBe(false));
    expect(result.current.has('l')).toBe(false);
  });

  it('re-fetches when the id SET changes, not on every render with the same set', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const { rerender } = renderHook(({ ids }) => useWorktreeParents(ids, fakeApi(list)), {
      initialProps: { ids: ['a', 'b'] },
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    // Same SET, fresh array reference -- as a real caller deriving ids from
    // `allEntries.map(...)` would hand in every render.
    rerender({ ids: ['a', 'b'] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(list).toHaveBeenCalledTimes(2);

    rerender({ ids: ['a', 'b', 'c'] });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(5));
  });
});
