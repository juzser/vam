// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorktreesApi } from '../../../src/preload/api.js';
import { useWorktrees } from '../../../src/renderer/panels/worktrees/useWorktrees.js';
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
  return {
    list,
    create: vi.fn(),
    remove: vi.fn(),
    status: vi.fn().mockResolvedValue([]),
  };
}

describe('useWorktrees', () => {
  it('answers unavailable with no request when there is no api', async () => {
    const { result } = renderHook(() => useWorktrees({ projectId: 'p1', api: undefined }));
    expect(result.current.state).toEqual({ kind: 'unavailable' });
  });

  it('answers unavailable when projectId is null, even with an api', async () => {
    const list = vi.fn();
    const { result } = renderHook(() => useWorktrees({ projectId: null, api: fakeApi(list) }));
    expect(result.current.state).toEqual({ kind: 'unavailable' });
    expect(list).not.toHaveBeenCalled();
  });

  it('loads then answers ok with what the api returned', async () => {
    const list = vi.fn().mockResolvedValue([worktree()]);
    const { result } = renderHook(() => useWorktrees({ projectId: 'p1', api: fakeApi(list) }));
    expect(result.current.state).toEqual({ kind: 'loading' });
    await waitFor(() => expect(result.current.state.kind).toBe('ok'));
    expect(result.current.state).toEqual({ kind: 'ok', worktrees: [worktree()] });
    expect(list).toHaveBeenCalledWith('p1');
  });

  it('answers error with the rejection message on failure', async () => {
    const list = vi.fn().mockRejectedValue(new Error('git-failed: nope'));
    const { result } = renderHook(() => useWorktrees({ projectId: 'p1', api: fakeApi(list) }));
    await waitFor(() => expect(result.current.state.kind).toBe('error'));
    expect(result.current.state).toEqual({ kind: 'error', message: 'git-failed: nope' });
  });

  it('reload() asks again', async () => {
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([worktree()]);
    const { result } = renderHook(() => useWorktrees({ projectId: 'p1', api: fakeApi(list) }));
    await waitFor(() => expect(result.current.state).toEqual({ kind: 'ok', worktrees: [] }));

    act(() => {
      result.current.reload();
    });

    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: 'ok', worktrees: [worktree()] }),
    );
    expect(list).toHaveBeenCalledTimes(2);
  });
});
