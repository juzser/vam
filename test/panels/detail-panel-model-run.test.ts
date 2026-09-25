// @vitest-environment happy-dom
/**
 * The extracted MODEL-RUN status hook, asserted through its own return
 * value, in sequence: `running` starts `null`, an on-demand lookup that
 * answers `last-turn` sets `running` to that answer WITH its arm (not the
 * bare name), and the differential case -- a lookup that answers `unknown`
 * after a good answer has landed returns `running` to `null` rather than
 * latching the previous value.
 *
 * The cases below round out what the hook's own doc comments call out as
 * load-bearing but the happy-path test above does not exercise: the
 * `modelReadable` gate that skips reading (and polling) entirely, the
 * `issued` guard that keeps a stale in-flight read from overwriting a
 * later one, and the interval poll and its cleanup on unmount.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDetailPanelModelRun } from '../../src/renderer/panels/detail-panel-model-run.js';

describe('useDetailPanelModelRun', () => {
  it('starts null, then reflects an on-demand answer, then drops a failed one', async () => {
    const model = vi.fn().mockResolvedValue({ kind: 'last-turn', name: 'sonnet' });
    const { result } = renderHook(() =>
      useDetailPanelModelRun({ modelControl: 'picker', model, projectId: 'p1', rowId: 'r1' }),
    );

    expect(result.current.running).toBeNull();

    await waitFor(() =>
      expect(result.current.running).toEqual({ kind: 'last-turn', name: 'sonnet' }),
    );
    model.mockClear();

    await act(async () => {
      result.current.lookForModel.current?.();
      await Promise.resolve();
    });

    expect(model).toHaveBeenCalledWith('p1', 'r1');
    expect(result.current.running).toEqual({ kind: 'last-turn', name: 'sonnet' });

    model.mockResolvedValue({ kind: 'unknown' });
    await act(async () => {
      result.current.lookForModel.current?.();
      await Promise.resolve();
    });

    expect(result.current.running).toBeNull();
  });

  it('reads nothing and publishes no on-demand reader when the control is not a readable picker', async () => {
    const model = vi.fn().mockResolvedValue({ kind: 'model', name: 'Opus 5' });
    type Props = { readonly modelControl: 'request' | 'disabled' | 'picker' };
    const { result, rerender } = renderHook<ReturnType<typeof useDetailPanelModelRun>, Props>(
      (props) => useDetailPanelModelRun({ ...props, model, projectId: 'p1', rowId: 'r1' }),
      { initialProps: { modelControl: 'request' } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(model).not.toHaveBeenCalled();
    expect(result.current.running).toBeNull();
    expect(result.current.lookForModel.current).toBeNull();

    rerender({ modelControl: 'disabled' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(model).not.toHaveBeenCalled();
    expect(result.current.lookForModel.current).toBeNull();
  });

  it('reads nothing when no reader is given at all, even for a picker', async () => {
    const { result } = renderHook(() =>
      useDetailPanelModelRun({ modelControl: 'picker', projectId: 'p1', rowId: 'r1' }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.running).toBeNull();
    expect(result.current.lookForModel.current).toBeNull();
  });

  it('lets only the most recently issued read write, dropping a slower earlier one', async () => {
    let releaseFirst: ((view: { kind: 'model'; name: string }) => void) | null = null;
    const model = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ kind: 'model'; name: string }>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ kind: 'model', name: 'Haiku 4.5' });

    const { result } = renderHook(() =>
      useDetailPanelModelRun({ modelControl: 'picker', model, projectId: 'p1', rowId: 'r1' }),
    );

    // The mount's own read is now in flight, unresolved. Fire a second,
    // on-demand read before it lands -- the second is issued later and must
    // be the one whose answer sticks.
    await act(async () => {
      result.current.lookForModel.current?.();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(result.current.running).toEqual({ kind: 'model', name: 'Haiku 4.5' }),
    );

    // Now let the stale first read land; it must not overwrite the second's
    // answer, even though it resolves after.
    await act(async () => {
      releaseFirst?.({ kind: 'model', name: 'Opus 5' });
      await Promise.resolve();
    });
    expect(result.current.running).toEqual({ kind: 'model', name: 'Haiku 4.5' });
  });

  describe('the interval poll', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('reads again on its own every four seconds, and stops on unmount', async () => {
      const model = vi.fn().mockResolvedValue({ kind: 'model', name: 'Sonnet 5' });
      const { result, unmount } = renderHook(() =>
        useDetailPanelModelRun({ modelControl: 'picker', model, projectId: 'p1', rowId: 'r1' }),
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(model).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(4_000);
        await Promise.resolve();
      });
      expect(model).toHaveBeenCalledTimes(2);

      await act(async () => {
        vi.advanceTimersByTime(4_000);
        await Promise.resolve();
      });
      expect(model).toHaveBeenCalledTimes(3);

      unmount();
      expect(result.current.lookForModel.current).toBeNull();
      model.mockClear();

      await act(async () => {
        vi.advanceTimersByTime(8_000);
        await Promise.resolve();
      });
      expect(model).not.toHaveBeenCalled();
    });
  });
});
