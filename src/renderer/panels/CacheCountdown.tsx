/**
 * ONE ROW'S CACHE-TIMER BADGE: a quiet stopwatch and an mm:ss, or nothing.
 *
 * `domain/cache-timer.ts` decides whether to draw at all and what phase this
 * is; `cache-timer-clock.ts` is what makes fifty of these tick off ONE shared
 * `setInterval` rather than fifty of their own -- this component subscribes,
 * it never drives (`SessionList.tsx` mounts the one driver).
 *
 * FIXED WIDTH, TABULAR NUMERALS, so the row never reflows as the seconds
 * count down -- the operator asked for a countdown "small and quiet", and a
 * badge that jiggles the row beside it every second would be neither.
 */

import { Timer } from 'lucide-react';
import { type ReactElement, useRef } from 'react';
import { type CacheTimerPhase, cacheTimerFor, formatCountdown } from '../domain/cache-timer.js';
import type { Session } from '../domain/model.js';
import { useCacheTimerClockTick } from './cache-timer-clock.js';

type SessionCacheFields = Pick<
  Session,
  'source' | 'status' | 'lastCacheActivityAt' | 'cacheTtlMs' | 'cacheSourceNowMs'
>;

/**
 * The phase's own ink. `normal` and `expired` share the row's own quiet tone
 * (`text-ink-faint`, the same dimming `data-row-meta-line` already wears) --
 * an expired mark is information, not an alarm, so it does not escalate past
 * what the row already reads at. `warning`, the last minute, is the one
 * moment worth a colour that is not neutral: `text-waiting`, the SAME amber
 * token `data-row-needs-you` already wears for "needs a person" one line
 * away, chosen over inventing a new one because a cache about to force a
 * resend is exactly that kind of small, timely thing to notice.
 */
const PHASE_INK: Readonly<Record<CacheTimerPhase, string>> = {
  normal: 'text-ink-faint',
  warning: 'text-waiting',
  expired: 'text-ink-faint',
};

/** `5 minutes` / `1 hour` -- the tooltip's own words for the TTL, never a raw
 *  millisecond count. */
function ttlWords(ttlMs: number): string {
  if (ttlMs >= 60 * 60 * 1000) {
    const hours = Math.round(ttlMs / (60 * 60 * 1000));
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  const minutes = Math.round(ttlMs / 60_000);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function tooltipFor(ttlMs: number, phase: CacheTimerPhase): string {
  const ttl = ttlWords(ttlMs);
  if (phase === 'expired') {
    return `Claude's prompt cache for this session (a ${ttl} entry) has expired; the next message resends the full context.`;
  }
  return `Claude caches this session's context for ${ttl} after it was last used; the next message after it expires resends the full context.`;
}

export function CacheCountdown({
  session,
  enabled,
  /** Injected so every test controls the clock -- production hands
   *  `Date.now`. */
  nowMs = Date.now,
}: {
  readonly session: SessionCacheFields;
  readonly enabled: boolean;
  readonly nowMs?: () => number;
}): ReactElement | null {
  // CLOCK SKEW: `lastCacheActivityAt` / `cacheSourceNowMs` are both stamped
  // on the SOURCE's own clock (`model.ts`'s own header on `cacheSourceNowMs`
  // explains why this cannot just be a pre-rendered string the way
  // `Session.age` is). This device's `nowMs()` is a DIFFERENT clock, and the
  // two can disagree by minutes on a paired phone. The fix: the moment a
  // FRESH `cacheSourceNowMs` reading arrives, capture the OFFSET between
  // this device's clock and it, once -- then apply that fixed offset to
  // every later LIVE tick rather than re-deriving it (which would just
  // cancel the correction back out, since both clocks keep moving together
  // at the same rate once skew, not drift, is the only difference between
  // them).
  const offsetRef = useRef<{ readonly sourceNowMs: number; readonly offsetMs: number } | null>(
    null,
  );
  const sourceNowMs = session.cacheSourceNowMs;
  if (sourceNowMs != null && offsetRef.current?.sourceNowMs !== sourceNowMs) {
    offsetRef.current = { sourceNowMs, offsetMs: nowMs() - sourceNowMs };
  }
  const correctedNowMs =
    offsetRef.current === null ? nowMs() : nowMs() - offsetRef.current.offsetMs;

  const state = cacheTimerFor(session, correctedNowMs, enabled);
  // A row that has already expired never changes its own paint again --
  // `formatCountdown` is never drawn past zero -- so the instant THIS
  // render finds that phase, this instance drops off the shared clock's
  // listener set entirely rather than paying for a tick that would only
  // repaint the exact same quiet mark (`cache-timer-clock.ts`'s own
  // `active` parameter). `SessionList.tsx` only mounts this component for a
  // row that already has cache data to show, so every OTHER phase here
  // genuinely needs the tick.
  useCacheTimerClockTick(state !== null && state.phase !== 'expired');
  if (state === null) return null;
  const ttlMs = session.cacheTtlMs;
  // `cacheTimerFor` already proved this is non-null for a non-null state.
  if (ttlMs === null || ttlMs === undefined) return null;

  return (
    <span
      data-testid="cache-timer"
      data-cache-timer
      data-cache-timer-phase={state.phase}
      title={tooltipFor(ttlMs, state.phase)}
      className={`flex flex-none items-center gap-0.5 tabular-nums ${PHASE_INK[state.phase]}`}
    >
      <Timer size={10} strokeWidth={1.6} className="flex-none" />
      {state.phase === 'expired' ? (
        <span className="sr-only">cache expired</span>
      ) : (
        <span
          // Fixed to the widest this ever draws (`formatCountdown`'s own
          // header: `m:ss`, never more than one digit of minutes in
          // practice) so the digits changing never nudges anything beside
          // them.
          className="inline-block w-[2.4ch] text-right"
        >
          {formatCountdown(state.remainingMs)}
        </span>
      )}
    </span>
  );
}
