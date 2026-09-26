/**
 * "Time agents worked" — the sum of active spans per session, where a gap
 * longer than 5 minutes between consecutive timestamps ends a span. See the
 * operator's own definition in the task brief; this is its literal reading.
 */
import { describe, expect, it } from 'vitest';
import { activeMsOf, extendActiveMs, GAP_THRESHOLD_MS } from '../../src/shared/active-spans.js';

const iso = (s: string) => `2026-01-01T${s}.000Z`;

describe('activeMsOf', () => {
  it('is zero for no timestamps or exactly one', () => {
    expect(activeMsOf([])).toBe(0);
    expect(activeMsOf([iso('00:00:00')])).toBe(0);
  });

  it('sums consecutive gaps under the threshold as one continuous span', () => {
    const at = [iso('00:00:00'), iso('00:01:00'), iso('00:03:00')];
    expect(activeMsOf(at)).toBe(3 * 60_000);
  });

  it('ends a span at a gap strictly longer than 5 minutes and does not count the gap itself', () => {
    const at = [iso('00:00:00'), iso('00:04:00'), iso('00:20:00'), iso('00:21:00')];
    // First span: 0:00 -> 0:04 = 4m. The 16m jump to 0:20 is a NEW span (gap
    // > 5m), contributing nothing itself. Second span: 0:20 -> 0:21 = 1m.
    expect(activeMsOf(at)).toBe(5 * 60_000);
  });

  it('treats a gap of EXACTLY 5 minutes as still one span, not a break', () => {
    const at = [iso('00:00:00'), iso('00:05:00')];
    expect(activeMsOf(at)).toBe(GAP_THRESHOLD_MS);
    expect(GAP_THRESHOLD_MS).toBe(5 * 60_000);
  });

  it('sorts out-of-order timestamps before measuring gaps', () => {
    const at = [iso('00:03:00'), iso('00:00:00'), iso('00:01:00')];
    expect(activeMsOf(at)).toBe(3 * 60_000);
  });

  it('skips unparsable timestamps rather than throwing', () => {
    const at = [iso('00:00:00'), 'not-a-date', iso('00:01:00')];
    expect(activeMsOf(at)).toBe(60_000);
  });
});

describe('extendActiveMs', () => {
  it('starts a fresh span with no prior timestamp', () => {
    const result = extendActiveMs(null, [Date.parse(iso('00:00:00')), Date.parse(iso('00:02:00'))]);
    expect(result).toEqual({ addedMs: 2 * 60_000, lastAtMs: Date.parse(iso('00:02:00')) });
  });

  it('continues a span across a cache boundary when the gap to the prior timestamp is within the threshold', () => {
    const prevLastAtMs = Date.parse(iso('00:03:00'));
    const result = extendActiveMs(prevLastAtMs, [Date.parse(iso('00:04:00'))]);
    expect(result).toEqual({ addedMs: 60_000, lastAtMs: Date.parse(iso('00:04:00')) });
  });

  it('starts a NEW span across a cache boundary when the gap exceeds the threshold', () => {
    const prevLastAtMs = Date.parse(iso('00:00:00'));
    const result = extendActiveMs(prevLastAtMs, [Date.parse(iso('00:20:00'))]);
    expect(result).toEqual({ addedMs: 0, lastAtMs: Date.parse(iso('00:20:00')) });
  });

  it('gives the same total whether a session is measured in one pass or resumed across two, per file append semantics', () => {
    const all = [
      Date.parse(iso('00:00:00')),
      Date.parse(iso('00:02:00')),
      Date.parse(iso('00:04:00')),
      Date.parse(iso('00:21:00')),
      Date.parse(iso('00:22:00')),
    ];
    const whole = activeMsOf(all.map((ms) => new Date(ms).toISOString()));

    const first = extendActiveMs(null, all.slice(0, 3));
    const second = extendActiveMs(first.lastAtMs, all.slice(3));
    expect(first.addedMs + second.addedMs).toBe(whole);
  });
});
