/**
 * `src/shared/usage.ts` is pure — no network, no keychain, no electron — so
 * every failure mode the real endpoint can hand back is exercised here as
 * data. `test/electron/electron-trees-constraints.test.ts` separately
 * guards that this file never reaches for `electron` or a `node:` builtin.
 */

import { describe, expect, it } from 'vitest';
import {
  describeUsage,
  formatCountdown,
  parseUsage,
  type UsageSnapshot,
} from '../../src/shared/usage.js';

/** The exact body quoted in the task brief, observed live against the real endpoint. */
const REAL_BODY = {
  five_hour: {
    utilization: 40.0,
    resets_at: '2026-09-03T11:40:00.429991+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
    locked_reason: null,
  },
  seven_day: {
    utilization: 30.0,
    resets_at: '2026-09-07T06:00:00.430008+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
    locked_reason: null,
  },
  seven_day_opus: null,
  extra_usage: { is_enabled: false, utilization: null, user_disabled: true },
  limits: [
    {
      kind: 'session',
      group: 'session',
      percent: 40,
      severity: 'normal',
      resets_at: '2026-09-03T11:40:00.429991+00:00',
      scope: null,
      is_active: true,
    },
  ],
  spend: {
    used: { amount_minor: 0, currency: 'USD', exponent: 2 },
    percent: 0,
    severity: 'normal',
    enabled: false,
  },
  member_dashboard_available: false,
};

describe('parseUsage', () => {
  it('reads both windows off the real response shape', () => {
    const result = parseUsage(REAL_BODY);
    expect(result.fiveHour).toEqual({
      kind: 'known',
      percent: 40,
      resetsAt: '2026-09-03T11:40:00.429991+00:00',
    });
    expect(result.sevenDay).toEqual({
      kind: 'known',
      percent: 30,
      resetsAt: '2026-09-07T06:00:00.430008+00:00',
    });
  });

  it('does not rescale utilization — it is already a percentage', () => {
    // A `* 100` bug would report 4000, not 40; this is the assertion that
    // catches it.
    const result = parseUsage(REAL_BODY);
    expect(result.fiveHour.kind === 'known' && result.fiveHour.percent).toBe(40);
  });

  it('treats a null window as unknown, never as 0, while the other window survives', () => {
    const result = parseUsage({ ...REAL_BODY, five_hour: null });
    expect(result.fiveHour).toEqual({ kind: 'unknown' });
    expect(result.sevenDay.kind).toBe('known');
  });

  it('treats an empty object as both windows unknown, without throwing', () => {
    expect(() => parseUsage({})).not.toThrow();
    const result = parseUsage({});
    expect(result.fiveHour).toEqual({ kind: 'unknown' });
    expect(result.sevenDay).toEqual({ kind: 'unknown' });
  });

  it.each([null, 'a string', 42, [], undefined])(
    'treats a non-object body (%j) as both windows unknown, without throwing',
    (body) => {
      expect(() => parseUsage(body)).not.toThrow();
      const result = parseUsage(body);
      expect(result.fiveHour).toEqual({ kind: 'unknown' });
      expect(result.sevenDay).toEqual({ kind: 'unknown' });
    },
  );

  it('ignores unknown sibling keys', () => {
    const result = parseUsage({ ...REAL_BODY, some_future_field: { nested: true } });
    expect(result.fiveHour.kind).toBe('known');
    expect(result.sevenDay.kind).toBe('known');
  });
});

describe('formatCountdown', () => {
  const now = new Date('2026-09-03T10:00:00.000Z');

  it('formats under a day as Hh Mm', () => {
    expect(formatCountdown('2026-09-03T11:15:00.000Z', now)).toBe('1h 15m');
  });

  it('formats just under the day boundary as Hh Mm', () => {
    expect(formatCountdown('2026-09-04T09:59:00.000Z', now)).toBe('23h 59m');
  });

  it('formats exactly one day out as Dd Hh', () => {
    expect(formatCountdown('2026-09-04T10:00:00.000Z', now)).toBe('1d 0h');
  });

  it('formats several days out as Dd Hh', () => {
    expect(formatCountdown('2026-09-08T06:00:00.000Z', now)).toBe('4d 20h');
  });

  it('clamps a reset time already in the past to 0h 0m, never negative', () => {
    expect(formatCountdown('2026-09-01T00:00:00.000Z', now)).toBe('0h 0m');
  });
});

describe('describeUsage', () => {
  const now = new Date('2026-09-03T10:00:00.000Z');

  it('renders the mockup line for a fresh, known snapshot', () => {
    const snapshot: UsageSnapshot = {
      kind: 'ok',
      windows: {
        fiveHour: { kind: 'known', percent: 40, resetsAt: '2026-09-03T11:15:00.000Z' },
        sevenDay: { kind: 'known', percent: 30, resetsAt: '2026-09-08T06:00:00.000Z' },
      },
      observedAt: now.toISOString(),
    };
    expect(describeUsage(snapshot, now)).toEqual({
      text: '40% used · 1h 15m · 30% used · 4d 20h',
      reason: null,
      highUsage: false,
    });
  });

  it('renders the em-dash placeholder, with a distinguishing reason, when there is no token', () => {
    const snapshot: UsageSnapshot = { kind: 'unknown', reason: 'no-token' };
    const result = describeUsage(snapshot, now);
    expect(result.text).toBe('—');
    expect(result.reason).toMatch(/keychain|token/i);
  });

  it('gives a DIFFERENT reason for a refused request than for a missing token', () => {
    const noToken = describeUsage({ kind: 'unknown', reason: 'no-token' }, now);
    const unauthorized = describeUsage({ kind: 'unknown', reason: 'unauthorized' }, now);
    expect(noToken.reason).not.toBe(unauthorized.reason);
  });

  it('falls back to the em-dash once the reading is older than the staleness window', () => {
    const snapshot: UsageSnapshot = {
      kind: 'ok',
      windows: {
        fiveHour: { kind: 'known', percent: 40, resetsAt: '2026-09-03T11:15:00.000Z' },
        sevenDay: { kind: 'known', percent: 30, resetsAt: '2026-09-08T06:00:00.000Z' },
      },
      // An hour old — far past any reasonable poll cadence.
      observedAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    };
    const result = describeUsage(snapshot, now);
    expect(result.text).toBe('—');
    expect(result.reason).toMatch(/stale/i);
  });
});
