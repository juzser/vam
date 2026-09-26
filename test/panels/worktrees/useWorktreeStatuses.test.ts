// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useWorktreeStatuses,
  WORKTREE_STATUS_POLL_MS,
} from '../../../src/renderer/panels/worktrees/useWorktreeStatuses.js';
import type { WorktreeStatus } from '../../../src/shared/worktree.js';

afterEach(() => {
  vi.useRealTimers();
});

function statusFor(worktreeId: string, over: Partial<WorktreeStatus> = {}): WorktreeStatus {
  return { worktreeId, dirty: false, ahead: null, behind: null, ...over };
}

describe('useWorktreeStatuses', () => {
  it('asks nobody at all when there is no api', () => {
    const { result } = renderHook(() =>
      useWorktreeStatuses({
        projectId: 'p1',
        worktreeIds: ['/repo-worktrees/feat'],
        statusFn: undefined,
        enabled: true,
      }),
    );
    expect(result.current).toEqual(new Map());
  });

  it('asks nobody at all when there are no worktree ids -- nothing to badge', () => {
    const status = vi.fn();
    renderHook(() =>
      useWorktreeStatuses({ projectId: 'p1', worktreeIds: [], statusFn: status, enabled: true }),
    );
    expect(status).not.toHaveBeenCalled();
  });

  it('asks nobody at all while disabled, even with ids and an api present', () => {
    const status = vi.fn().mockResolvedValue([]);
    renderHook(() =>
      useWorktreeStatuses({
        projectId: 'p1',
        worktreeIds: ['/repo-worktrees/feat'],
        statusFn: status,
        enabled: false,
      }),
    );
    expect(status).not.toHaveBeenCalled();
  });

  it('fetches once on mount, keyed by worktreeId', async () => {
    const status = vi.fn().mockResolvedValue([statusFor('/repo-worktrees/feat', { dirty: true })]);
    const { result } = renderHook(() =>
      useWorktreeStatuses({
        projectId: 'p1',
        worktreeIds: ['/repo-worktrees/feat'],
        statusFn: status,
        enabled: true,
      }),
    );
    await waitFor(() => expect(result.current.get('/repo-worktrees/feat')?.dirty).toBe(true));
    expect(status).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeIds: ['/repo-worktrees/feat'],
    });
  });

  it('polls again after the cadence elapses, and stops on unmount', async () => {
    vi.useFakeTimers();
    const status = vi.fn().mockResolvedValue([statusFor('/w/feat')]);
    const { unmount } = renderHook(() =>
      useWorktreeStatuses({
        projectId: 'p1',
        worktreeIds: ['/w/feat'],
        statusFn: status,
        enabled: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(status.mock.calls.length).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(WORKTREE_STATUS_POLL_MS + 10);
    expect(status.mock.calls.length).toBeGreaterThanOrEqual(2);

    const before = status.mock.calls.length;
    unmount();
    await vi.advanceTimersByTimeAsync(WORKTREE_STATUS_POLL_MS * 3);
    expect(status.mock.calls.length).toBe(before);
  });

  it('a failed fetch keeps the last known statuses rather than clearing them', async () => {
    vi.useFakeTimers();
    const status = vi
      .fn()
      .mockResolvedValueOnce([statusFor('/w/feat', { dirty: true })])
      .mockRejectedValueOnce(new Error('git-failed'));
    const { result } = renderHook(() =>
      useWorktreeStatuses({
        projectId: 'p1',
        worktreeIds: ['/w/feat'],
        statusFn: status,
        enabled: true,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.get('/w/feat')?.dirty).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORKTREE_STATUS_POLL_MS + 10);
    });
    // The second call rejected -- the map still holds the first answer.
    expect(result.current.get('/w/feat')?.dirty).toBe(true);
  });

  it('re-fetches when the worktree id SET changes, not on every render with the same set', async () => {
    const status = vi.fn().mockResolvedValue([]);
    const { rerender } = renderHook(
      ({ ids }: { ids: readonly string[] }) =>
        useWorktreeStatuses({ projectId: 'p1', worktreeIds: ids, statusFn: status, enabled: true }),
      { initialProps: { ids: ['/w/a', '/w/b'] } },
    );
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));

    rerender({ ids: ['/w/a', '/w/b'] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(status).toHaveBeenCalledTimes(1);

    rerender({ ids: ['/w/a', '/w/b', '/w/c'] });
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
  });
});
