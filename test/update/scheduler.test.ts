import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createScheduler,
  DAY_MS,
  MIN_GAP_MS,
  nextCheckDelay,
} from '../../src/main/update/scheduler.js';

describe('nextCheckDelay', () => {
  it('is 0 when never checked', () => {
    expect(nextCheckDelay(1000, null)).toBe(0);
  });
  it('is the rest of the 24h window', () => {
    expect(nextCheckDelay(1000 + 3_600_000, 1000)).toBe(DAY_MS - 3_600_000);
  });
  it('is 0 when overdue', () => {
    expect(nextCheckDelay(1000 + 2 * DAY_MS, 1000)).toBe(0);
  });
  it('treats a lastCheckAt in the future (clock moved back) as due now', () => {
    expect(nextCheckDelay(1000, 9_999_999)).toBe(0);
  });
});

describe('createScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  type Over = { auto?: boolean; last?: number | null; touchLast?: boolean };
  function make(over: Over = {}) {
    const state = { auto: over.auto ?? true, last: over.last ?? null };
    const run = vi.fn(async () => {
      if (over.touchLast !== false) state.last = Date.now();
    });
    const scheduler = createScheduler({
      clock: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      run,
      getAutoCheck: () => state.auto,
      getLastCheckAt: () => state.last,
    });
    return { scheduler, run, state };
  }

  it('runs at once on start when never checked, then again 24h later', async () => {
    const { scheduler, run } = make();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DAY_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('waits out the remainder of the window when checked recently', async () => {
    const { scheduler, run } = make({ last: Date.now() - DAY_MS + 5000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(4999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('does not run while auto-check is off, and picks up soon after it is turned on', async () => {
    const { scheduler, run, state } = make({ auto: false });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2 * DAY_MS);
    expect(run).not.toHaveBeenCalled();
    state.auto = true;
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('never spins when run leaves lastCheckAt untouched', async () => {
    const { scheduler, run } = make({ touchLast: false });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS * 3);
    expect(run.mock.calls.length).toBeLessThanOrEqual(4);
    scheduler.stop();
  });

  it('onResume runs when due, and respects the 1h minimum gap', async () => {
    const { scheduler, run, state } = make({ last: Date.now() });
    scheduler.start();
    // Not due yet: resume does nothing.
    scheduler.onResume();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    // Slept through the window: the timer never fired, the clock jumped.
    vi.setSystemTime(Date.now() + DAY_MS + 10);
    scheduler.onResume();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    // A second resume right after is inside the gap, even if due again.
    state.last = 0;
    scheduler.onResume();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('onResume does nothing when auto-check is off', async () => {
    const { scheduler, run } = make({ auto: false, last: 0 });
    scheduler.start();
    scheduler.onResume();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('stop cancels the pending timer and ignores resume', async () => {
    const { scheduler, run } = make({ last: Date.now() });
    scheduler.start();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(2 * DAY_MS);
    scheduler.onResume();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('survives a run that rejects and keeps scheduling', async () => {
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    const scheduler = createScheduler({
      clock: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      run,
      getAutoCheck: () => true,
      getLastCheckAt: () => null,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS + 1);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
    scheduler.stop();
  });
});
