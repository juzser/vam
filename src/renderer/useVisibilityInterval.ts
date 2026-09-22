/**
 * A polling interval that a hidden window either stops or slows, and that
 * resumes at full pace -- with one immediate call -- the moment the window
 * is visible again.
 *
 * WHY THIS EXISTS: `TerminalTab.tsx`'s own refresh effect already does this
 * shape correctly (stop outright on `visibilitychange`, one immediate tick
 * plus resume on return), but it is written inline, once, for a poller that
 * is allowed to go fully silent while hidden. `useSourceModel`'s session-list
 * poll feeds `notify/waiting.ts`'s ONLY transition-detection path, so pausing
 * it while the window is hidden would mean a session going `waiting` in the
 * background never notifies anyone. This hook generalises the shape and adds
 * the second mode that poller needs: `{ slowBy }`, which keeps the timer
 * running, just less often, instead of stopping it.
 *
 * WHAT THIS HOOK DOES NOT DO: decide "the content hasn't changed, so slow
 * down". That is `useSourceModel`'s own unchanged-streak backoff, computed
 * per load and threaded back in as a bigger `intervalMs` on a later render.
 * This hook has no memory of past answers -- it only ever asks "is the
 * document hidden right now" and multiplies or stops accordingly. See
 * `intervalMs`'s own doc below for how the two compose without stacking.
 */

import { useEffect, useRef } from 'react';

/** `'pause'` stops the timer outright while hidden; `{ slowBy: n }` keeps it
 *  running at `intervalMs * n`. `useAgentWork`/`DetailPanel`'s two polls use
 *  `'pause'` (nothing downstream depends on them while nobody is looking);
 *  `useSourceModel` uses `{ slowBy: 4 }` because it must not go fully silent. */
export type HiddenBehavior = 'pause' | { readonly slowBy: number };

/**
 * @param enabled Composes with, never replaces, the caller's own gate (an
 *   `agentId !== null`, a `readable` flag, …) -- `false` here means no timer
 *   at all, exactly like every poller in this repo behaved before visibility
 *   gating existed.
 * @param intervalMs The period to poll at WHILE VISIBLE, recomputed by the
 *   CALLER on every render (a constant for most callers; `useSourceModel`
 *   raises it after three unchanged loads). This hook reads the LATEST value
 *   whenever it is about to (re)schedule a timer, but never fires an extra
 *   call just because the number changed -- a caller backing off from 10s to
 *   20s must not get a bonus poll at the moment it decides to. NOT STACKED
 *   WITH `hidden`: while the document is hidden, `hidden`'s own multiplier
 *   is applied to THIS value directly, so a caller that wants "always 40s
 *   while hidden, never 80s" must itself keep passing the unbacked-off base
 *   while hidden and only apply its own backoff to what it passes while
 *   visible -- see `useSourceModel.ts`'s own header for the worked case.
 * @param hidden How to behave while `document.visibilityState === 'hidden'`.
 * @param callback Fire-and-forget, like every `setInterval` callback in this
 *   codebase already is (`TerminalTab`, `useSourceModel`, `useAgentWork`):
 *   this hook never awaits it and never delays the next tick for it. A
 *   caller that must not overlap two loads keeps its own in-flight guard.
 */
export function useVisibilityInterval(
  enabled: boolean,
  intervalMs: number,
  hidden: HiddenBehavior,
  callback: () => void,
): void {
  // Read through refs, updated every render with no dependency array of
  // their own -- `TerminalTab`'s own `readNow` ref makes the same argument:
  // the timer below must see the LATEST callback/period/mode without the
  // scheduling effects churning their dependency arrays on every render.
  const callbackRef = useRef(callback);
  const intervalMsRef = useRef(intervalMs);
  const hiddenRef = useRef(hidden);
  useEffect(() => {
    callbackRef.current = callback;
    intervalMsRef.current = intervalMs;
    hiddenRef.current = hidden;
  });

  /**
   * ONE CONTROLLER OBJECT, BUILT ONCE, so the two effects below (mount and
   * lifecycle in one, a bare reschedule on a period change in the other)
   * share the same `timer` variable without either recreating the other's
   * closure. `useRef(() => …).current` rather than `useMemo`: this is
   * mutable machinery, not a memoised value, and `useMemo` carries no
   * promise that React will not discard and rebuild it.
   */
  const controllerRef = useRef<{ stop: () => void; restart: () => void } | null>(null);
  if (controllerRef.current === null) {
    let timer: number | undefined;
    const periodNow = () => {
      const mode = hiddenRef.current;
      return document.visibilityState === 'hidden' && mode !== 'pause'
        ? intervalMsRef.current * mode.slowBy
        : intervalMsRef.current;
    };
    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    const restart = () => {
      stop();
      // Hidden AND paused is the one state with no timer at all -- every
      // other combination (visible, or hidden-and-slowed) gets one.
      if (document.visibilityState === 'hidden' && hiddenRef.current === 'pause') return;
      timer = window.setInterval(() => callbackRef.current(), periodNow());
    };
    controllerRef.current = { stop, restart };
  }
  const { stop, restart } = controllerRef.current;

  // MOUNT, UNMOUNT, AND VISIBILITY TRANSITIONS -- the only things this
  // effect depends on. It does NOT depend on `intervalMs`: a caller raising
  // it (the unchanged-backoff) must not re-run this whole effect, because
  // this is also the effect that fires the ONE immediate call on mount and
  // on the hidden -> visible edge, and a dependency-array re-run would fire
  // a second one for free every time the caller's number changed.
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (hiddenRef.current === 'pause') {
          stop();
        } else {
          // Keep running, now at the slowed period -- `restart` discards
          // whatever fraction of the old (faster) period had already
          // elapsed, the same trade `TerminalTab`'s own stop/start makes.
          restart();
        }
        return;
      }
      // BECOMING VISIBLE: one immediate call, matching every poller's own
      // "call once on mount, then poll" shape -- coming back to a hidden
      // window is exactly when its numbers are stalest.
      callbackRef.current();
      restart();
    };
    if (document.visibilityState !== 'hidden') callbackRef.current();
    restart();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, restart, stop]);

  // A PERIOD CHANGE, ALONE, WITH NO LEADING CALL. This is what lets a caller
  // raise or lower `intervalMs` "per tick" (the doc above) without waiting
  // for the next `visibilitychange`: `restart` tears down whatever timer is
  // running and puts up a new one at the fresh period, counting from now.
  // Firing on mount too (every effect does) is harmless -- `restart` never
  // calls the callback, so the effect above's own immediate call is still
  // the only one -- and `restart` itself is the one thing that keeps this
  // from ever waking a `hidden: 'pause'` poller that the effect above just
  // put to sleep.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `intervalMs` is the re-schedule signal, not a value read here -- `restart` reads the current number back out of `intervalMsRef`, never off this closure directly
  useEffect(() => {
    if (!enabled) return;
    restart();
  }, [intervalMs, enabled, restart]);
}
