/**
 * THE SIDEBAR'S CACHE-TIMER COUNTDOWN, pure: given a session and a clock,
 * what does the row show.
 *
 * `main/sources/claude-code/cache-activity.ts` decides WHAT happened
 * (`lastCacheActivityAt`/`cacheTtlMs`, off the transcript); this decides
 * WHETHER to draw a timer at all and what phase it is in, entirely from
 * numbers already on the `Session` -- no clock of its own, so every test here
 * hands `nowMs` in rather than reading `Date.now()`.
 */

import { describe, expect, it } from 'vitest';
import { cacheTimerFor, formatCountdown } from '../../src/renderer/domain/cache-timer.js';
import type { Session } from '../../src/renderer/domain/model.js';

const BASE: Pick<Session, 'source' | 'status' | 'lastCacheActivityAt' | 'cacheTtlMs'> = {
  source: 'claude-code',
  status: 'idle',
  lastCacheActivityAt: '2026-09-26T01:00:00.000Z',
  cacheTtlMs: 5 * 60 * 1000,
};

const STARTED_MS = Date.parse(BASE.lastCacheActivityAt as string);

describe('countdown maths across the expiry boundary', () => {
  it('reports the full TTL the instant the cache was touched', () => {
    const state = cacheTimerFor(BASE, STARTED_MS, true);
    expect(state?.remainingMs).toBe(5 * 60 * 1000);
    expect(state?.phase).toBe('normal');
  });

  it('stays "normal" one millisecond above the last-minute boundary', () => {
    const state = cacheTimerFor(BASE, STARTED_MS + 5 * 60 * 1000 - 60_000 - 1, true);
    expect(state?.remainingMs).toBe(60_001);
    expect(state?.phase).toBe('normal');
  });

  it('turns "warning" exactly at the last-minute boundary', () => {
    const state = cacheTimerFor(BASE, STARTED_MS + 5 * 60 * 1000 - 60_000, true);
    expect(state?.remainingMs).toBe(60_000);
    expect(state?.phase).toBe('warning');
  });

  it('stays "warning" one millisecond before expiry', () => {
    const state = cacheTimerFor(BASE, STARTED_MS + 5 * 60 * 1000 - 1, true);
    expect(state?.remainingMs).toBe(1);
    expect(state?.phase).toBe('warning');
  });

  it('turns "expired" the instant the TTL elapses', () => {
    const state = cacheTimerFor(BASE, STARTED_MS + 5 * 60 * 1000, true);
    expect(state?.remainingMs).toBe(0);
    expect(state?.phase).toBe('expired');
  });

  it('stays "expired" for a clock read long after', () => {
    const state = cacheTimerFor(BASE, STARTED_MS + 60 * 60 * 1000, true);
    expect(state?.remainingMs).toBe(-55 * 60 * 1000);
    expect(state?.phase).toBe('expired');
  });
});

describe('hidden cases', () => {
  it('is hidden while the setting is off', () => {
    expect(cacheTimerFor(BASE, STARTED_MS, false)).toBeNull();
  });

  it('is hidden for a running session', () => {
    expect(cacheTimerFor({ ...BASE, status: 'running' }, STARTED_MS, true)).toBeNull();
  });

  it('is hidden for every status but idle and waiting', () => {
    for (const status of ['done', 'failed', 'unstarted', 'terminal'] as const) {
      expect(cacheTimerFor({ ...BASE, status }, STARTED_MS, true), status).toBeNull();
    }
  });

  it('is shown for waiting, not only idle', () => {
    expect(cacheTimerFor({ ...BASE, status: 'waiting' }, STARTED_MS, true)).not.toBeNull();
  });

  it('is hidden for a non-Claude-Code session', () => {
    expect(cacheTimerFor({ ...BASE, source: 'codex' }, STARTED_MS, true)).toBeNull();
  });

  it('is hidden for a row with no source at all', () => {
    expect(cacheTimerFor({ ...BASE, source: undefined }, STARTED_MS, true)).toBeNull();
  });

  it('is hidden when the source never reported cache activity', () => {
    expect(
      cacheTimerFor({ ...BASE, lastCacheActivityAt: null, cacheTtlMs: null }, STARTED_MS, true),
    ).toBeNull();
  });

  it('is hidden when the session never asked about a cache timer at all (absent fields)', () => {
    const { lastCacheActivityAt: _l, cacheTtlMs: _t, ...rest } = BASE;
    expect(cacheTimerFor(rest, STARTED_MS, true)).toBeNull();
  });

  it('is hidden when the timestamp cannot be parsed', () => {
    expect(
      cacheTimerFor({ ...BASE, lastCacheActivityAt: 'not-a-date' }, STARTED_MS, true),
    ).toBeNull();
  });
});

describe('formatCountdown', () => {
  it.each([
    [5 * 60 * 1000, '5:00'],
    [4 * 60 * 1000 + 59_000, '4:59'],
    [61_000, '1:01'],
    [1_000, '0:01'],
    [999, '0:00'],
    [0, '0:00'],
    // Never negative on screen, even though `remainingMs` itself may be.
    [-5_000, '0:00'],
  ])('renders %ims as %s', (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });
});
