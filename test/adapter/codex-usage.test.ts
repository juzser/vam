/**
 * `src/shared/codex-usage.ts` is pure -- no `node:fs`, no rollout path, no
 * electron -- so `src/main/usage/codex-reader.ts` is the only thing that ever
 * has to touch a real `~/.codex/sessions` file; everything this module does
 * is exercised here as data. `test/electron/electron-trees-constraints.test.ts`
 * separately guards it never reaches for `electron` or a `node:` builtin.
 */

import { describe, expect, it } from 'vitest';
import {
  type CodexUsageSnapshot,
  codexWindowLabel,
  describeCodexUsage,
  parseCodexRateLimits,
} from '../../src/shared/codex-usage.js';

/** The exact shape quoted in the task brief, observed live on this machine. */
const REAL_RATE_LIMITS = {
  limit_id: 'codex',
  primary: { used_percent: 11.0, window_minutes: 300, resets_at: 1_790_000_000 },
  secondary: { used_percent: 2.0, window_minutes: 10080, resets_at: 1_790_500_000 },
  credits: { balance: 100 },
};

describe('parseCodexRateLimits', () => {
  it('reads both windows off the real shape, converting resets_at from unix seconds to ISO', () => {
    const result = parseCodexRateLimits(REAL_RATE_LIMITS);
    expect(result.primary).toEqual({
      kind: 'known',
      percent: 11,
      windowMinutes: 300,
      resetsAt: new Date(1_790_000_000 * 1000).toISOString(),
    });
    expect(result.secondary).toEqual({
      kind: 'known',
      percent: 2,
      windowMinutes: 10080,
      resetsAt: new Date(1_790_500_000 * 1000).toISOString(),
    });
  });

  it('treats a missing secondary as unknown, while primary survives', () => {
    const result = parseCodexRateLimits({ primary: REAL_RATE_LIMITS.primary });
    expect(result.primary.kind).toBe('known');
    expect(result.secondary).toEqual({ kind: 'unknown' });
  });

  it('never throws on a non-object, null, or malformed body', () => {
    for (const raw of [null, undefined, 'nope', 42, [], {}, { primary: 'nope' }]) {
      expect(() => parseCodexRateLimits(raw)).not.toThrow();
    }
    expect(parseCodexRateLimits({})).toEqual({
      primary: { kind: 'unknown' },
      secondary: { kind: 'unknown' },
    });
  });

  it('rejects a non-finite used_percent or window_minutes rather than inventing one', () => {
    const result = parseCodexRateLimits({
      primary: { used_percent: Number.NaN, window_minutes: 300, resets_at: 1_790_000_000 },
    });
    expect(result.primary).toEqual({ kind: 'unknown' });
  });
});

describe('codexWindowLabel', () => {
  it('labels 300 minutes as 5-hour, matching the real primary window', () => {
    expect(codexWindowLabel(300)).toBe('5-hour');
  });

  it('labels 10080 minutes (7 days) as Weekly, matching the real secondary window', () => {
    expect(codexWindowLabel(10080)).toBe('Weekly');
  });

  it('falls back to an hour count for a window this table has no name for', () => {
    expect(codexWindowLabel(120)).toBe('2-hour');
  });
});

describe('describeCodexUsage', () => {
  const now = new Date('2026-09-24T10:00:00.000Z');

  it('renders a known window as a percent, a countdown and the local reset clock', () => {
    const snapshot: CodexUsageSnapshot = {
      kind: 'ok',
      limits: {
        primary: {
          kind: 'known',
          percent: 11,
          windowMinutes: 300,
          resetsAt: '2026-09-24T11:15:00.000Z',
        },
        secondary: { kind: 'unknown' },
      },
      observedAt: now.toISOString(),
    };
    const result = describeCodexUsage(snapshot, now);
    expect(result.primary).toEqual({
      state: 'known',
      label: '5-hour',
      percent: 11,
      countdown: '1h 15m',
      resetsAt: '2026-09-24T11:15:00.000Z',
    });
    expect(result.secondary).toEqual({ state: 'unknown', label: 'Weekly' });
  });

  it('reports a window as RESET, not as 0% used, once its resets_at is in the past', () => {
    // Reading is old (or the window rolled over between polls) -- the last
    // KNOWN number must not be shown as still current, and 0%/unknown would
    // both be inventing an answer nothing measured.
    const snapshot: CodexUsageSnapshot = {
      kind: 'ok',
      limits: {
        primary: {
          kind: 'known',
          percent: 87,
          windowMinutes: 300,
          resetsAt: '2026-09-24T09:00:00.000Z', // an hour before `now`
        },
        secondary: { kind: 'unknown' },
      },
      observedAt: '2026-09-24T08:30:00.000Z',
    };
    const result = describeCodexUsage(snapshot, now);
    expect(result.primary).toEqual({ state: 'reset', label: '5-hour' });
    expect(JSON.stringify(result.primary)).not.toContain('87');
  });

  it('gives a distinguishable reason for no Codex session yet vs. an unreadable read', () => {
    const noSession = describeCodexUsage({ kind: 'unknown', reason: 'no-session' }, now);
    const unavailable = describeCodexUsage({ kind: 'unknown', reason: 'unavailable' }, now);
    expect(noSession.reason).toMatch(/no codex session/i);
    expect(unavailable.reason).not.toBe(noSession.reason);
    expect(noSession.primary).toEqual({ state: 'unknown', label: '5-hour' });
  });

  it('formats "as of HH:MM" in local wall-clock time, built from the local constructor', () => {
    const observed = new Date(2026, 8, 24, 17, 14); // local 17:14, whatever the machine's TZ is
    const snapshot: CodexUsageSnapshot = {
      kind: 'ok',
      limits: { primary: { kind: 'unknown' }, secondary: { kind: 'unknown' } },
      observedAt: observed.toISOString(),
    };
    const result = describeCodexUsage(snapshot, new Date(observed.getTime() + 5000));
    expect(result.observedText).toBe('as of 17:14 from the last Codex session');
  });
});
