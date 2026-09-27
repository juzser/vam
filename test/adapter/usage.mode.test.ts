/**
 * The status bar's `used`/`remaining` toggle (`prefs/status-bar-usage.ts`),
 * applied to `describeUsage`'s own text. The countdown never flips -- only
 * the percentage's own direction does -- and the default third argument
 * keeps every existing two-argument call in this tree reading `used`,
 * unchanged.
 */

import { describe, expect, it } from 'vitest';
import { describeUsage, type UsageSnapshot } from '../../src/shared/usage.js';

const now = new Date('2026-09-03T10:00:00.000Z');

const SNAPSHOT: UsageSnapshot = {
  kind: 'ok',
  windows: {
    fiveHour: { kind: 'known', percent: 40, resetsAt: '2026-09-03T11:15:00.000Z' },
    sevenDay: { kind: 'known', percent: 30, resetsAt: '2026-09-08T06:00:00.000Z' },
  },
  observedAt: now.toISOString(),
};

describe('describeUsage’s mode argument', () => {
  it('defaults to used -- every existing two-argument call is unchanged', () => {
    expect(describeUsage(SNAPSHOT, now).text).toBe('40% used · 1h 15m · 30% used · 4d 20h');
  });

  it('used is explicit and identical to the default', () => {
    expect(describeUsage(SNAPSHOT, now, 'used').text).toBe(describeUsage(SNAPSHOT, now).text);
  });

  it('remaining reads 100 minus the percentage, same countdown', () => {
    expect(describeUsage(SNAPSHOT, now, 'remaining').text).toBe(
      '60% left · 1h 15m · 70% left · 4d 20h',
    );
  });

  it('remaining still reads the em-dash and the same reason when unknown', () => {
    const unknown = describeUsage({ kind: 'unknown', reason: 'no-token' }, now, 'remaining');
    expect(unknown.text).toBe('—');
    expect(unknown.reason).toMatch(/keychain|token/i);
  });

  it('remaining rounds the same way used does', () => {
    const snapshot: UsageSnapshot = {
      kind: 'ok',
      windows: {
        fiveHour: { kind: 'known', percent: 33.4, resetsAt: '2026-09-03T11:15:00.000Z' },
        sevenDay: { kind: 'unknown' },
      },
      observedAt: now.toISOString(),
    };
    // 100 - 33.4 = 66.6, rounds to 67.
    expect(describeUsage(snapshot, now, 'remaining').text).toBe('67% left · 1h 15m · —');
  });
});
