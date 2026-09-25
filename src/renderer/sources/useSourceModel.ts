/**
 * The desktop's model, kept current.
 *
 * `DesktopCanvas` used to call `load()` once on mount and again only after a
 * write. Nothing polled, and the Claude Code source declares
 * `liveUpdates: false`, so the session list froze at launch: a session going
 * busy -> idle went on reading as running, a new session never appeared, a
 * failing one never showed as failed, and every `age` stopped moving. For an
 * app whose stated purpose is making the `waiting` state impossible to miss,
 * a frozen list loses the purpose.
 *
 * This is the same shape as the usage cell's poll, and it repeats none of the
 * mistakes that one was fixed for: only the most recently ISSUED load may
 * write, a load in flight is never JOINED by a second one (never two at
 * once), a failure keeps the last good model rather than blanking a list
 * somebody is reading, and nothing sets state after unmount.
 *
 * A CALL THAT ARRIVES WHILE ONE IS IN FLIGHT IS QUEUED, NOT DROPPED --
 * `reloadQueued` below. `reload` (this hook's return value) IS `load`: every
 * write handler in `Canvas.tsx` calls `source.onWrote()`, which is `reload`,
 * the instant its own write resolves (`createSession`'s "the wait becomes
 * visible here", `closeSession`'s `source.onWrote()`). If a background poll
 * happened to already be in flight at that exact moment -- reading a tmux
 * listing from BEFORE the write, since nothing here cancels an in-flight
 * request -- the old code's early return dropped the reload on the floor,
 * and the in-flight poll's stale answer landed a moment later with nothing
 * left to correct it before the NEXT scheduled tick, up to 40s away while
 * hidden. Measured on a real close: `killOwnPane` kills the pane, the write
 * resolves, `onWrote` fires -- and a periodic poll that started its own
 * `claude agents --json --all` a few hundred milliseconds earlier can still
 * be running, so the row the operator just closed could reappear until the
 * next tick. Queuing costs nothing the "never two at once" rule did not
 * already spend: still exactly one in flight, ever; the difference is that a
 * request which arrived while busy now runs the MOMENT the busy one clears,
 * rather than being silently forgotten.
 *
 * It is a hook in its own module rather than an effect inside `App.tsx`
 * because `DesktopCanvas` is not exported and none of the above is testable
 * through it -- the same reason `csp.ts` and `origin.ts` are their own files.
 *
 * VISIBILITY GATING, AND WHY THIS ONE MAY NEVER GO FULLY SILENT. Phase 1's
 * measurement named this the single biggest fixed background cost in the
 * app -- the only poller with zero visibility gating and a process-spawn
 * payload (`claude agents --json --all`) -- but it is also the one poller
 * `notify/waiting.ts` depends on: that file's own header says plainly that
 * `useSourceModel` is the ONLY loop in the application, so a *transition*
 * into `waiting` is computable in exactly one place. Pausing this poller
 * while vam is backgrounded would mean a session going `waiting` behind the
 * operator's back never notifies them -- so `useVisibilityInterval` is wired
 * with `{ slowBy: 4 }`, never `'pause'`: 10s becomes 40s hidden, not 0.
 *
 * THE UNCHANGED-STREAK BACKOFF, VISIBLE ONLY. Three consecutive loads that
 * read back byte-identical (`JSON.stringify`-equal on the resolved
 * `projects` array -- cheap enough at this size and this cadence, and the
 * simplest correct comparison) double the visible interval once, 10s to
 * 20s, capped there: a quiet session list does not need four spawns a
 * minute forever, but doubling more than once would let a long-idle window
 * drift far enough that a fresh `waiting` took uncomfortably long to
 * surface. Any load that differs from the one before it resets to 10s
 * immediately -- `streakRef` below is reassigned to 1, not decremented, so
 * one differing load undoes the whole backoff in a single tick.
 *
 * PRECEDENCE: HIDDEN NEVER STACKS WITH THE BACKOFF. `intervalMs` passed to
 * the hook is the caller-computed number `useVisibilityInterval` multiplies
 * BY `slowBy` while hidden (its own header spells out why the hook itself
 * cannot see "unchanged") -- so if this file handed over the BACKED-OFF 20s
 * while hidden, a hidden window would poll at 80s, not the intended 40s.
 * `documentHidden` (read through `useSyncExternalStore`, the same pattern
 * `DetailPanel.tsx` already uses for other externally-mutable globals) is
 * what keeps that from happening: while hidden, this always hands over the
 * BASE 10s regardless of the backoff state, and the hook's own multiplier
 * is the only thing that ever turns that into 40s. The backoff resumes
 * exactly where it left off the moment the window is visible again --
 * `streakRef` is never reset by hiding, only by a load that actually reads
 * differently.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CanvasModel } from '../domain/model.js';
import { noteFailure } from '../errors/log.js';
import { useVisibilityInterval } from '../useVisibilityInterval.js';
import type { SessionSource } from './port.js';

/**
 * How often to re-read the source WHILE VISIBLE AND CHANGING.
 *
 * Measured on this machine: `claude agents --json --all` returns in
 * 0.20-0.41 s, and a transcript is read as a 128 KiB tail however large the
 * file is (the largest here is 157 MB), so a whole `load()` is well under half
 * a second for a single-digit session count. Ten seconds is roughly a 4 % duty
 * cycle -- close enough that a session finishing its turn surfaces while the
 * operator is still looking at the screen, and far enough apart that vam is
 * not spawning a subprocess every tick.
 *
 * The window-focus reload is what covers the gap this interval leaves: coming
 * back to vam is both when its numbers matter most and when they are stalest.
 */
export const SOURCE_POLL_INTERVAL_MS = 10_000;

/** Three unchanged loads in a row, INCLUDING the current one, before the
 *  visible cadence backs off -- see this file's own header. */
const UNCHANGED_STREAK_FOR_BACKOFF = 3;

/** The one-time, capped doubling once the streak above is reached. */
const BACKED_OFF_INTERVAL_MS = SOURCE_POLL_INTERVAL_MS * 2;

/** Hidden is 4x slower, never paused -- see this file's own header for why
 *  this poller specifically may not use `useVisibilityInterval`'s `'pause'`. */
const HIDDEN_SLOWDOWN = 4;

/**
 * C10: `window`'s `focus` and `document`'s `visibilitychange` (`load`'s own
 * two effects, further down -- the latter through `useVisibilityInterval`'s
 * "BECOMING VISIBLE" immediate call) both mark their call to `load` a
 * RETURN SIGNAL, and both fire for the SAME real-world event, the operator
 * returning to vam, one DOM event apart. `load`'s in-flight guard QUEUES a
 * call that arrives while one is already running (`reloadQueued`'s own doc,
 * below) -- correct for a write's `reload` or a genuinely later poll, since
 * dropping THOSE outright was the bug this queue exists to fix -- but a
 * RETURN SIGNAL landing this soon after another one already started a read
 * is the same signal arriving twice, not a second reason to ask again, so
 * it is dropped instead of queued. Deliberately short: two real browser
 * events for one user action land single-digit milliseconds apart,
 * measured; this is slack, not a debounce the operator could feel, and it
 * never delays the FIRST read of a return -- only a redundant second one.
 */
export const COALESCE_WINDOW_MS = 200;

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function isDocumentHidden(): boolean {
  return document.visibilityState === 'hidden';
}

const EMPTY: CanvasModel = { projects: [] };

export function useSourceModel(source: SessionSource | null): {
  readonly model: CanvasModel;
  readonly error: string | null;
  /** True until the FIRST load answers — success or failure, either settles
   *  it, never again after. Empty `model.projects` and `loading: true` are
   *  two different sentences ("nothing here" vs. "still asking"). */
  readonly loading: boolean;
  readonly reload: () => void;
} {
  const [model, setModel] = useState<CanvasModel>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** The VISIBLE cadence only -- base or backed-off. See this file's header
   *  for why `documentHidden` below overrides this rather than composing
   *  with it. */
  const [visibleIntervalMs, setVisibleIntervalMs] = useState(SOURCE_POLL_INTERVAL_MS);

  // Refs, not state: these coordinate loads and must never cause a render.
  const cancelled = useRef(false);
  const inFlight = useRef(false);
  /** A call to `load` that arrived while `inFlight` was already true --
   *  consumed exactly once, in the `finally` below, the moment the in-flight
   *  one clears. See this file's header for why dropping it outright was the
   *  bug. */
  const reloadQueued = useRef(false);
  /** When the current in-flight load STARTED -- read only by the RETURN
   *  SIGNAL coalescing window above (C10), never by the generic queue. */
  const inFlightSince = useRef(0);
  /** Whether the CURRENT in-flight load was itself started by a return
   *  signal (S2, a review finding on C10 above). The coalescing window must
   *  only ever absorb the second half of a focus/visibilitychange PAIR --
   *  never a periodic tick's own read that a return signal happens to land
   *  inside. Without this a return signal arriving while an ordinary
   *  10s-cadence poll was in flight was silently dropped instead of queued,
   *  because the window only ever checked WHEN the in-flight load started,
   *  never WHY -- so a poll that began reading a few hundred milliseconds
   *  before the operator alt-tabbed back in ate the return signal, and the
   *  view the operator came back to see stayed stale until the next
   *  scheduled tick, up to 40s away while hidden. */
  const inFlightIsReturn = useRef(false);
  const issued = useRef(0);
  /** The previous successful load's `projects`, serialised -- `null` until
   *  the first one lands, so that answer alone can never look "unchanged". */
  const lastJson = useRef<string | null>(null);
  /** Consecutive equal loads, INCLUDING the current one. Reassigned to 1 on
   *  any difference -- never decremented -- so one differing load undoes the
   *  whole backoff in the same tick it is noticed. */
  const unchangedStreak = useRef(0);

  const load = useCallback(
    // `isReturnSignal`: true only from the `focus` listener and the
    // visibility poll below (C10) -- never from a periodic tick, mount, or
    // `reload` in this hook's own return value (a write's `source.onWrote`).
    function load(isReturnSignal = false) {
      if (source === null) {
        return;
      }
      if (inFlight.current) {
        if (
          isReturnSignal &&
          inFlightIsReturn.current &&
          performance.now() - inFlightSince.current < COALESCE_WINDOW_MS
        ) {
          // The other half of a focus/visibilitychange pair -- dropped, not
          // queued: see this file's header. Gated on `inFlightIsReturn` too
          // (S2): the in-flight load must ALSO have been a return signal, or
          // this is a return landing on top of an unrelated poll/write, and
          // must queue like any other overlap.
          return;
        }
        // Queued rather than dropped -- see this file's header. Still never
        // joined: this returns exactly as before, nothing is issued here.
        reloadQueued.current = true;
        return;
      }
      inFlight.current = true;
      inFlightSince.current = performance.now();
      inFlightIsReturn.current = isReturnSignal;
      issued.current += 1;
      const seq = issued.current;
      // Only the newest ISSUED load may write. Without this a slow load
      // answering after a newer one would put an older list back on screen.
      const mine = () => !cancelled.current && seq === issued.current;
      source
        .load()
        .then((projects) => {
          if (mine()) {
            setModel({ projects });
            setError(null);
            // THE UNCHANGED-STREAK BACKOFF -- see this file's header. Tracked
            // on every successful load regardless of visibility; only what it
            // is COMPOSED WITH (below, at the call site) is visibility-gated.
            const json = JSON.stringify(projects);
            if (json === lastJson.current) {
              unchangedStreak.current += 1;
            } else {
              lastJson.current = json;
              unchangedStreak.current = 1;
            }
            setVisibleIntervalMs(
              unchangedStreak.current >= UNCHANGED_STREAK_FOR_BACKOFF
                ? BACKED_OFF_INTERVAL_MS
                : SOURCE_POLL_INTERVAL_MS,
            );
          }
        })
        .catch((reason: unknown) => {
          // The model is deliberately left alone: a transient CLI failure must
          // not blank a list the operator is in the middle of reading. The
          // error says what happened beside it.
          if (mine()) {
            setError(noteFailure('load projects', reason));
          }
        })
        .finally(() => {
          if (seq === issued.current) {
            inFlight.current = false;
          }
          // Settled, win or lose -- once an answer has arrived, no later poll
          // puts "loading" back; that is `error`'s job.
          if (mine()) {
            setLoading(false);
          }
          // THE QUEUED RELOAD, CONSUMED HERE -- one request that arrived while
          // this one was in flight, run now that it has cleared. Still never
          // two in flight at once: `inFlight.current` is false by this line
          // (just above, when `seq === issued.current`), so this call issues a
          // fresh one rather than queuing again.
          if (reloadQueued.current) {
            reloadQueued.current = false;
            load();
          }
        });
    },
    [source],
  );

  // Bookkeeping that must restart clean for a NEW source -- unrelated to the
  // poll's own cadence, which `useVisibilityInterval` below owns entirely.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `source` is the RESET SIGNAL, not a value read here -- a new source needs its bookkeeping cleared even though nothing in this effect reads the object itself
  useEffect(() => {
    cancelled.current = false;
    inFlight.current = false;
    reloadQueued.current = false;
    lastJson.current = null;
    unchangedStreak.current = 0;
    setVisibleIntervalMs(SOURCE_POLL_INTERVAL_MS);
    return () => {
      cancelled.current = true;
    };
  }, [source]);

  // Coming back to vam is both when its numbers matter most and when they
  // are stalest -- unchanged since before visibility gating existed, and
  // orthogonal to it: a focus event is a discrete act, not a rate. Marked a
  // RETURN SIGNAL (C10): a `visibilitychange` landing beside it must not
  // queue a second read.
  const onFocus = useCallback(() => load(true), [load]);
  useEffect(() => {
    if (source === null) {
      return;
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [source, onFocus]);

  const documentHidden = useSyncExternalStore(
    subscribeVisibility,
    isDocumentHidden,
    isDocumentHidden,
  );
  // NOT STACKED WITH THE HOOK'S OWN `slowBy` -- see this file's header for
  // the worked argument. The backed-off visible value is handed over ONLY
  // while visible; hidden always gets the base, whatever the streak is.
  const intervalMs = documentHidden ? SOURCE_POLL_INTERVAL_MS : visibleIntervalMs;
  // A RETURN SIGNAL ONLY WHEN `useVisibilityInterval` SAYS SO (S2, a review
  // finding on C10): its own `resumedFromHidden` argument is `true` only for
  // the hidden -> visible transition's own immediate call, matching `focus`
  // above -- `false` for the initial mount call and every ordinary interval
  // tick. Forwarding it directly is what lets `load` tell a genuine return
  // apart from a routine poll that happens to still be in flight when one
  // lands -- previously this always passed `true`, so an in-flight periodic
  // tick could swallow a real return instead of queuing behind it.
  const onVisible = useCallback((resumedFromHidden: boolean) => load(resumedFromHidden), [load]);
  useVisibilityInterval(source !== null, intervalMs, { slowBy: HIDDEN_SLOWDOWN }, onVisible);

  return { model, error, loading, reload: load };
}
