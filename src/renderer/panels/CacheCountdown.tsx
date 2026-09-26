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
import type { ReactElement } from 'react';
import { type CacheTimerPhase, cacheTimerFor, formatCountdown } from '../domain/cache-timer.js';
import type { Session } from '../domain/model.js';
import { useCacheTimerClockTick } from './cache-timer-clock.js';

type SessionCacheFields = Pick<Session, 'source' | 'status' | 'lastCacheActivityAt' | 'cacheTtlMs'>;

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
  // Subscribed unconditionally: `SessionList.tsx` only mounts this component
  // at all for a row that already has cache data to show (its own gate,
  // beside the call site), so every mounted instance genuinely needs the
  // tick -- there is no row here paying for a subscription it never uses.
  useCacheTimerClockTick();
  const state = cacheTimerFor(session, nowMs(), enabled);
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
