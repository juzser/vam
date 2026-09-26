/**
 * THE SIDEBAR'S CACHE-TIMER COUNTDOWN -- whether to draw one, and what phase
 * it is in, entirely from numbers already on a `Session`.
 *
 * WHAT IT ANSWERS, and only this. `main/sources/claude-code/cache-activity.ts`
 * decided WHAT happened (`lastCacheActivityAt`, `cacheTtlMs`); this decides
 * whether the operator should see it right now. Pure, and clockless on
 * purpose -- `nowMs` is a parameter, never `Date.now()`, so a caller (a
 * ticking countdown, or a test asserting an exact boundary) supplies the one
 * moment this reads.
 *
 * WHY IT IS HIDDEN FOR A `running` SESSION. The operator asked for the
 * countdown "after a Claude agent becomes idle" -- a running turn is already
 * spending tokens and reading or writing the cache on its own schedule, so a
 * countdown drawn over it would be stale the instant it painted. `waiting`
 * counts as idle here: Claude Code's own word for "finished its turn, ball is
 * with you" (`model.ts`'s own header on `SessionStatus`), which is exactly
 * when the operator is deciding whether to answer now or let the cache lapse.
 */

import type { Session } from './model.js';

export type CacheTimerPhase = 'normal' | 'warning' | 'expired';

export type CacheTimerState = {
  /** May be negative once the entry has expired -- the CALLER clamps for
   *  display (`formatCountdown`); this reports the real arithmetic so a
   *  caller that wants to know HOW expired still can. */
  readonly remainingMs: number;
  readonly phase: CacheTimerPhase;
};

/**
 * The last minute of the countdown reads in the theme's warning tint --
 * Claude Code's own five-minute default divided into quarters would be too
 * fussy a read for a number this small; one minute is the width the operator
 * actually has to act in before the badge goes quiet.
 */
const WARNING_WINDOW_MS = 60_000;

const SHOWN_STATUSES: ReadonlySet<Session['status']> = new Set(['idle', 'waiting']);

/**
 * `undefined` fields included on purpose: they are exactly what a session
 * this feature has not been threaded through (`paneRow`, `terminalRow`, every
 * other source) looks like, and they must be hidden the same as a `null`
 * reading -- see `lastCacheActivityAt`'s own doc on `Session`.
 */
export function cacheTimerFor(
  session: Pick<Session, 'source' | 'status' | 'lastCacheActivityAt' | 'cacheTtlMs'>,
  nowMs: number,
  enabled: boolean,
): CacheTimerState | null {
  if (!enabled) return null;
  if (session.source !== 'claude-code') return null;
  if (!SHOWN_STATUSES.has(session.status)) return null;
  const lastActivityAt = session.lastCacheActivityAt;
  const ttlMs = session.cacheTtlMs;
  if (lastActivityAt == null || ttlMs == null) return null;
  const startedAt = Date.parse(lastActivityAt);
  if (!Number.isFinite(startedAt)) return null;

  const remainingMs = startedAt + ttlMs - nowMs;
  const phase: CacheTimerPhase =
    remainingMs <= 0 ? 'expired' : remainingMs <= WARNING_WINDOW_MS ? 'warning' : 'normal';
  return { remainingMs, phase };
}

/**
 * `m:ss` -- minutes never padded (Claude Code's longer TTL is one hour, and
 * `formatCountdown` is never asked to draw one: `cacheTimerFor` is only
 * called for the last few minutes of a five-minute or one-hour cache, and the
 * row this feeds is a QUIET corner, not a stopwatch -- `9:59` is already the
 * widest this ever draws in practice, and the format does not break past it).
 * Never negative on screen: an expired entry clamps to `0:00` here, which is
 * why `CacheTimerPhase` exists as a SEPARATE field -- the caller reads that
 * to know the entry is gone, not a string that stopped counting.
 */
export function formatCountdown(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
