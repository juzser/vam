/**
 * `formatCompactNumber` and `formatDuration` — the Stats screen's own number
 * formatting, tested against the two shapes the operator's mockup actually
 * shows: a grouped integer under a million ("115,117") and a compact suffix
 * at scale ("18.2B").
 */
import { describe, expect, it } from 'vitest';
import { formatCompactNumber, formatDuration } from '../../src/shared/format-number.js';

describe('formatCompactNumber', () => {
  it('groups small numbers with commas rather than compacting them', () => {
    expect(formatCompactNumber(115_117)).toBe('115,117');
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(999)).toBe('999');
  });

  it('compacts millions and billions to one decimal with a suffix', () => {
    expect(formatCompactNumber(18_200_000_000)).toBe('18.2B');
    expect(formatCompactNumber(1_234_567)).toBe('1.2M');
    expect(formatCompactNumber(2_000_000)).toBe('2M');
  });

  it('drops a trailing .0 rather than printing it', () => {
    expect(formatCompactNumber(3_000_000)).toBe('3M');
    expect(formatCompactNumber(5_000_000_000)).toBe('5B');
  });

  it('keeps the sign and rounds by magnitude, not truncating', () => {
    expect(formatCompactNumber(-1_500_000)).toBe('-1.5M');
    expect(formatCompactNumber(999_950_000)).toBe('1B');
  });
});

describe('formatDuration', () => {
  it('renders days and hours the way the mockup does — "49d 12h"', () => {
    const ms = (49 * 24 + 12) * 60 * 60 * 1000;
    expect(formatDuration(ms)).toBe('49d 12h');
  });

  it('drops the day part under 24 hours', () => {
    expect(formatDuration(5 * 60 * 60 * 1000 + 30 * 60 * 1000)).toBe('5h 30m');
  });

  it('drops the hour part under one hour', () => {
    expect(formatDuration(42 * 60 * 1000)).toBe('42m');
  });

  it('floors to zero for a negative or zero duration', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-100)).toBe('0m');
  });
});
