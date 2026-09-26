/**
 * The PR count's own TTL — pure, so "is this cached answer still good
 * enough" is a decision this file can prove without spawning `gh` or faking
 * a clock inside a bigger integration test.
 */
import { describe, expect, it } from 'vitest';
import {
  isPrsCacheFresh,
  PRS_TTL_MS,
  readPrsCacheEntry,
} from '../../../src/main/stats/pr-count-cache.js';

const entry = (over: Partial<{ sinceDate: string | null; fetchedAtMs: number }> = {}) => ({
  sinceDate: '2026-01-01',
  fetchedAtMs: 1_000_000,
  result: { kind: 'ok' as const, count: 3 },
  ...over,
});

describe('isPrsCacheFresh', () => {
  it('is false when there is no prior entry at all', () => {
    expect(isPrsCacheFresh(undefined, '2026-01-01', 1_000_000)).toBe(false);
  });

  it('is true just under the TTL, for the SAME since-date', () => {
    const e = entry();
    expect(isPrsCacheFresh(e, '2026-01-01', e.fetchedAtMs + PRS_TTL_MS - 1)).toBe(true);
  });

  it('is false once the TTL has fully elapsed', () => {
    const e = entry();
    expect(isPrsCacheFresh(e, '2026-01-01', e.fetchedAtMs + PRS_TTL_MS)).toBe(false);
  });

  it('is false when the since-date moved — a NEWER earliest transcript timestamp appeared', () => {
    const e = entry({ sinceDate: '2026-01-01' });
    expect(isPrsCacheFresh(e, '2025-12-01', e.fetchedAtMs + 1)).toBe(false);
  });

  it('matches a null since-date to a null since-date, not to a string', () => {
    const e = entry({ sinceDate: null });
    expect(isPrsCacheFresh(e, null, e.fetchedAtMs + 1)).toBe(true);
    expect(isPrsCacheFresh(e, '2026-01-01', e.fetchedAtMs + 1)).toBe(false);
  });
});

describe('readPrsCacheEntry', () => {
  it('reads a well-formed entry back', () => {
    const e = entry();
    expect(readPrsCacheEntry(e)).toEqual(e);
  });

  it('is undefined for the field a cache written before this feature existed lacks', () => {
    expect(readPrsCacheEntry(undefined)).toBeUndefined();
  });

  it('is undefined for anything shaped wrong, rather than trusting a corrupt cache file', () => {
    expect(readPrsCacheEntry(null)).toBeUndefined();
    expect(readPrsCacheEntry('not an object')).toBeUndefined();
    expect(readPrsCacheEntry({ sinceDate: '2026-01-01' })).toBeUndefined(); // missing fetchedAtMs/result
    expect(
      readPrsCacheEntry({ sinceDate: 1, fetchedAtMs: 1, result: { kind: 'ok', count: 1 } }),
    ).toBeUndefined(); // sinceDate wrong type
  });
});
