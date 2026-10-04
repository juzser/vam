import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PR_FILTERS,
  type PrFilters,
  parsePrFilters,
  prFilterKey,
} from '../../src/shared/pr-filters.js';

const AUTHORS = ['mine', 'all'] as const;
const STATES = ['open', 'ready', 'draft', 'merged', 'closed', 'all'] as const;
const SORTS = ['updated', 'created'] as const;

describe('PrFilters', () => {
  it('defaults to Mine, Open, Updated', () => {
    expect(DEFAULT_PR_FILTERS).toEqual({ author: 'mine', state: 'open', sort: 'updated' });
  });

  it('parses a well-formed set unchanged', () => {
    const set: PrFilters = { author: 'all', state: 'closed', sort: 'created' };
    expect(parsePrFilters(set)).toEqual(set);
  });

  it('is total: non-objects fall back to the defaults', () => {
    for (const raw of [undefined, null, 7, 'mine', [], true]) {
      expect(parsePrFilters(raw)).toEqual(DEFAULT_PR_FILTERS);
    }
  });

  it('falls back per field, and drops extra keys', () => {
    const parsed = parsePrFilters({ author: 'all', state: 'bogus', sort: 3, extra: '--head' });
    expect(parsed).toEqual({ author: 'all', state: 'open', sort: 'updated' });
    expect(Object.keys(parsed).sort()).toEqual(['author', 'sort', 'state']);
  });

  it('keys equal sets equally, whatever the key order', () => {
    expect(prFilterKey({ sort: 'created', state: 'draft', author: 'all' })).toBe(
      prFilterKey({ author: 'all', state: 'draft', sort: 'created' }),
    );
  });

  it('keys every pair of distinct sets differently', () => {
    const keys = new Set<string>();
    let n = 0;
    for (const author of AUTHORS)
      for (const state of STATES)
        for (const sort of SORTS) {
          keys.add(prFilterKey({ author, state, sort }));
          n += 1;
        }
    expect(keys.size).toBe(n);
  });
});
