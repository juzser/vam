/**
 * ONE `setInterval` FOR EVERY ROW'S CACHE-TIMER COUNTDOWN, never one per row.
 *
 * The countdown is the first thing in this renderer that ticks live off the
 * system clock rather than off a poll -- `Session.age` is a string Claude
 * Code's own reader already computed once, per load, and painted; this is
 * seconds counting down between loads. Fifty idle rows each wanting to
 * repaint once a second is fifty timers if each row owns one, so this is a
 * store instead: `useCacheTimerClockDriver` is mounted ONCE, by
 * `SessionList.tsx` itself, and every row's countdown leaf
 * (`CacheCountdown.tsx`) only ever SUBSCRIBES -- the same split
 * `terminal-font.ts` already makes between "the one thing that sets it" and
 * "the many things that read it", `useSyncExternalStore`'s own shape.
 *
 * `useVisibilityInterval` (already built, already tested in isolation) is
 * what makes the driver cost nothing while `enabled` is false and pauses the
 * one real timer outright the moment the window is hidden -- this module adds
 * only the fan-out on top of its single callback.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { useVisibilityInterval } from '../useVisibilityInterval.js';

let version = 0;
const listeners = new Set<() => void>();

function tick(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** The snapshot `useSyncExternalStore` compares by identity: a number bumped
 *  once per tick, so a subscriber re-renders once a second while mounted and
 *  not once in between. */
export function cacheTimerClockVersion(): number {
  return version;
}

/** Subscribe; the returned function unsubscribes -- `useSyncExternalStore`'s
 *  contract, the same shape `subscribeTerminalFontSize` already has. */
export function subscribeCacheTimerClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * How many rows are currently subscribed -- EXPORTED FOR TESTS ONLY
 * (`CacheCountdown.test.tsx`), so a row that drops off the shared clock the
 * moment it has nothing left to redraw can be proven from outside without
 * reaching into this module's own closure. Production code never reads
 * this: the driver (`useCacheTimerClockDriver`) does not gate on it -- see
 * that hook's own header for why `SessionList.tsx` is instead the one that
 * decides whether ANY row currently needs the driver running at all.
 */
export function cacheTimerClockListenerCount(): number {
  return listeners.size;
}

/**
 * Drives the shared clock. `SessionList.tsx` calls this EXACTLY ONCE, never
 * per row -- that single call site is the whole guarantee; a leaf that called
 * it too would be back to one timer per row. `enabled` IS "does any row on
 * screen need one", composed with the setting, ALREADY -- `SessionList.tsx`
 * folds "is the setting on" and "does at least one visible row currently
 * hold a live (not yet expired) countdown" into the one boolean it passes
 * here, recomputed each time its own poll data changes, so a poll that finds
 * every row expired stops this outright rather than ticking a clock nothing
 * is listening to. While `false` this costs no timer at all, the same as
 * every other `useVisibilityInterval` caller in this renderer.
 */
export function useCacheTimerClockDriver(enabled: boolean): void {
  useVisibilityInterval(enabled, 1000, 'pause', () => tick());
}

/**
 * Re-renders the caller once a second while `active` and the driver is
 * running.
 *
 * `active` is the CALLER's own verdict on whether it still has anything left
 * to redraw -- `CacheCountdown.tsx` passes `false` the instant its own state
 * resolves to `expired`, an outcome that repaints the exact same quiet mark
 * on every future tick forever. Passing `false` here drops the caller from
 * the shared listener set entirely (the `subscribe` callback below registers
 * nothing at all), rather than merely ignoring ticks it still paid to
 * receive -- which is what makes `cacheTimerClockListenerCount()` a true
 * count of rows with something left to show, and what lets an all-expired
 * pane's `SessionList.tsx` legitimately turn the driver off outright.
 *
 * The countdown text itself is computed fresh from `Date.now()` at render
 * time (`cacheTimerFor`'s own `nowMs` parameter) -- this hook only supplies
 * the "render now" signal, never a cached clock reading of its own.
 */
export function useCacheTimerClockTick(active: boolean): void {
  const subscribe = useCallback(
    (listener: () => void) => (active ? subscribeCacheTimerClock(listener) : () => {}),
    [active],
  );
  useSyncExternalStore(subscribe, cacheTimerClockVersion, cacheTimerClockVersion);
}
