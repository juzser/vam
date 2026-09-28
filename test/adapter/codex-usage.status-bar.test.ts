/**
 * The status bar's Codex cell -- new with this PR, so its own text
 * formatter, mirroring `shared/usage.ts`'s `describeUsage` shape
 * (`text`/`reason`/`highUsage`) but built over `CodexUsageDisplay`, which
 * `describeCodexUsage` already produces per window rather than as one line.
 */

import { describe, expect, it } from 'vitest';
import { type CodexUsageSnapshot, describeCodexStatusUsage } from '../../src/shared/codex-usage.js';

const now = new Date('2026-09-27T10:00:00.000Z');

describe('describeCodexStatusUsage', () => {
  it('renders both windows, used by default', () => {
    const snapshot: CodexUsageSnapshot = {
      kind: 'ok',
      limits: {
        primary: {
          kind: 'known',
          percent: 11,
          windowMinutes: 300,
          resetsAt: '2026-09-27T14:49:00.000Z',
        },
        secondary: {
          kind: 'known',
          percent: 2,
          windowMinutes: 10_080,
          resetsAt: '2026-10-04T09:00:00.000Z',
        },
      },
      observedAt: now.toISOString(),
    };
    const result = describeCodexStatusUsage(snapshot, now);
    expect(result.text).toBe('11% used · 4h 49m · 2% used · 6d 23h');
    expect(result.reason).toBeNull();
    expect(result.highUsage).toBe(false);
  });

  it('flips to remaining on request, countdown unchanged', () => {
    const snapshot: CodexUsageSnapshot = {
      kind: 'ok',
      limits: {
        primary: {
          kind: 'known',
          percent: 11,
          windowMinutes: 300,
          resetsAt: '2026-09-27T14:49:00.000Z',
        },
        secondary: { kind: 'unknown' },
      },
      observedAt: now.toISOString(),
    };
    const result = describeCodexStatusUsage(snapshot, now, 'remaining');
    expect(result.text).toBe('89% left · 4h 49m · —');
  });

  it('flags high usage at 90% or more, either window', () => {
    const snapshot: CodexUsageSnapshot = {
      kind: 'ok',
      limits: {
        primary: { kind: 'unknown' },
        secondary: {
          kind: 'known',
          percent: 91,
          windowMinutes: 10_080,
          resetsAt: '2026-10-04T09:00:00.000Z',
        },
      },
      observedAt: now.toISOString(),
    };
    expect(describeCodexStatusUsage(snapshot, now).highUsage).toBe(true);
  });

  it('renders the em-dash and a reason when there is no session yet', () => {
    const result = describeCodexStatusUsage({ kind: 'unknown', reason: 'no-session' }, now);
    expect(result.text).toBe('—');
    expect(result.reason).toMatch(/no codex session/i);
    expect(result.highUsage).toBe(false);
  });

  /**
   * The operator's own bug: `kind: 'ok'` (main DID read a rollout) but
   * BOTH windows come back `unknown` -- previously rendered as a silent,
   * unexplained `— · —`, indistinguishable from a healthy reading with two
   * blank windows. The cell must carry a reason so the tooltip
   * (`Canvas.tsx`'s `Note` wrapper) has something to say, the same as the
   * `kind: 'unknown'` case already does.
   */
  it('gives a reason when both windows are unknown, so the dash is never unexplained', () => {
    const snapshot: CodexUsageSnapshot = {
      kind: 'ok',
      limits: {
        primary: { kind: 'unknown' },
        secondary: { kind: 'unknown' },
      },
      observedAt: now.toISOString(),
    };
    const result = describeCodexStatusUsage(snapshot, now);
    expect(result.text).toBe('—');
    expect(result.reason).toMatch(/no codex usage/i);
    expect(result.highUsage).toBe(false);
  });

  it('reads a window that has rolled over as reset, never as a stale percentage', () => {
    const snapshot: CodexUsageSnapshot = {
      kind: 'ok',
      limits: {
        primary: {
          kind: 'known',
          percent: 99,
          windowMinutes: 300,
          resetsAt: '2026-09-27T09:00:00.000Z',
        },
        secondary: { kind: 'unknown' },
      },
      observedAt: now.toISOString(),
    };
    const result = describeCodexStatusUsage(snapshot, now);
    expect(result.text).toBe('— · —');
    expect(result.highUsage).toBe(false);
  });
});
