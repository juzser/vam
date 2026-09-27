/**
 * The Stats screen's shared pure helpers: percentage shares, guarded against
 * the zero-denominator case a fresh install (or a provider with no data at
 * all) always produces.
 */
import { describe, expect, it } from 'vitest';
import { percentShare } from '../../src/shared/stats.js';

describe('percentShare', () => {
  it('is the ordinary percentage', () => {
    expect(percentShare(25, 100)).toBe(25);
    expect(percentShare(1, 3)).toBeCloseTo(33.333, 2);
  });

  it('is zero when the whole is zero, never NaN or Infinity', () => {
    expect(percentShare(0, 0)).toBe(0);
    expect(percentShare(5, 0)).toBe(0);
  });
});
