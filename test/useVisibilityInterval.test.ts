// @vitest-environment happy-dom

/**
 * `useVisibilityInterval` in isolation -- the shape its own header promises,
 * pinned one behaviour per test: gated on `enabled` exactly like every
 * poller already was before this hook existed; one immediate call on mount
 * while visible, then one every `intervalMs`; `hidden: 'pause'` stops the
 * timer outright the moment the window is hidden; `hidden: { slowBy }` keeps
 * it running instead, at `intervalMs * slowBy`; coming back to visible fires
 * one immediate call and resumes at the base cadence; and unmounting (or
 * `enabled` flipping to `false`) while hidden tears down both the timer and
 * the `visibilitychange` listener, whichever hidden mode was in force.
 *
 * The pattern -- `vi.spyOn(document, 'visibilityState', 'get')` plus
 * `fireEvent(document, new Event('visibilitychange'))` -- is
 * `TerminalTab.test.tsx`'s own, mirrored here because this hook exists to
 * generalise exactly what that file's refresh effect does inline.
 * `useSourceModel.test.tsx` and `useAgentWork.test.tsx` hold the composed
 * behaviour once each caller wires this hook in with its own `intervalMs`
 * and `hidden` mode; this file is the one place each of the seven cases is
 * pinned on its own, independent of any caller.
 */

import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type HiddenBehavior,
  useVisibilityInterval,
} from '../src/renderer/useVisibilityInterval.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Starts the document VISIBLE; returns the spy so a test can flip it. */
const spyVisibility = () => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

const changeVisibility = () => {
  act(() => {
    fireEvent(document, new Event('visibilitychange'));
  });
};

type Props = {
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly hidden: HiddenBehavior;
};

function mount(initial: Props, callback: () => void) {
  return renderHook(
    (props: Props) =>
      useVisibilityInterval(props.enabled, props.intervalMs, props.hidden, callback),
    { initialProps: initial },
  );
}

describe('useVisibilityInterval', () => {
  it('runs no timer at all while disabled', () => {
    vi.useFakeTimers();
    spyVisibility();
    const callback = vi.fn();
    mount({ enabled: false, intervalMs: 1000, hidden: 'pause' }, callback);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('fires once immediately while visible, then on every interval', () => {
    vi.useFakeTimers();
    spyVisibility();
    const callback = vi.fn();
    mount({ enabled: true, intervalMs: 1000, hidden: 'pause' }, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it('stops the timer outright once hidden, with hidden: "pause"', () => {
    vi.useFakeTimers();
    const visibility = spyVisibility();
    const callback = vi.fn();
    mount({ enabled: true, intervalMs: 1000, hidden: 'pause' }, callback);
    expect(callback).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('hidden');
    changeVisibility();
    const before = callback.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(callback).toHaveBeenCalledTimes(before);
  });

  it('keeps the timer running at intervalMs * slowBy once hidden, with hidden: { slowBy }', () => {
    vi.useFakeTimers();
    const visibility = spyVisibility();
    const callback = vi.fn();
    mount({ enabled: true, intervalMs: 1000, hidden: { slowBy: 4 } }, callback);
    expect(callback).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('hidden');
    changeVisibility();
    const before = callback.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(callback).toHaveBeenCalledTimes(before);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(callback).toHaveBeenCalledTimes(before + 1);
  });

  it('fires one immediate call and resumes at the base cadence once visible returns', () => {
    vi.useFakeTimers();
    const visibility = spyVisibility();
    const callback = vi.fn();
    mount({ enabled: true, intervalMs: 1000, hidden: { slowBy: 4 } }, callback);

    visibility.mockReturnValue('hidden');
    changeVisibility();
    const beforeReturn = callback.mock.calls.length;

    visibility.mockReturnValue('visible');
    changeVisibility();
    expect(callback).toHaveBeenCalledTimes(beforeReturn + 1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(beforeReturn + 2);
  });

  it('tears down the timer and the visibilitychange listener on unmount, hidden-and-slowed', () => {
    vi.useFakeTimers();
    const visibility = spyVisibility();
    const callback = vi.fn();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const view = mount({ enabled: true, intervalMs: 1000, hidden: { slowBy: 4 } }, callback);

    visibility.mockReturnValue('hidden');
    changeVisibility();
    view.unmount();

    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    const before = callback.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(callback).toHaveBeenCalledTimes(before);
  });

  it('tells a periodic tick apart from a real return-from-hidden -- a caller that treats them differently needs to know which fired it', () => {
    // useSourceModel.ts (S2) conflated the two by ignoring this argument: it
    // marked EVERY call through this hook a "return signal", including the
    // ordinary interval tick, which meant a routine poll already in flight
    // could eat a genuine focus/visibilitychange pair that landed a moment
    // later. The contract this pins: `false` for the initial mount call and
    // every plain interval tick, `true` only for the hidden -> visible
    // transition's own immediate call.
    vi.useFakeTimers();
    const visibility = spyVisibility();
    const callback = vi.fn();
    mount({ enabled: true, intervalMs: 1000, hidden: { slowBy: 4 } }, callback);
    expect(callback).toHaveBeenLastCalledWith(false); // mount

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenLastCalledWith(false); // an ordinary tick

    visibility.mockReturnValue('hidden');
    changeVisibility();
    visibility.mockReturnValue('visible');
    changeVisibility();
    expect(callback).toHaveBeenLastCalledWith(true); // the real return

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenLastCalledWith(false); // back to an ordinary tick
  });

  it('tears down the same way, hidden-and-paused, when `enabled` flips to false mid-run', () => {
    vi.useFakeTimers();
    const visibility = spyVisibility();
    const callback = vi.fn();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const view = mount({ enabled: true, intervalMs: 1000, hidden: 'pause' }, callback);

    visibility.mockReturnValue('hidden');
    changeVisibility();
    view.rerender({ enabled: false, intervalMs: 1000, hidden: 'pause' });

    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    const before = callback.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(callback).toHaveBeenCalledTimes(before);
  });
});
