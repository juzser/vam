/**
 * The bundled price table and its cost calculation.
 *
 * "NEVER GUESS A PRICE" is the operator's own rule: a model this table has no
 * row for must count its tokens and show cost as `null` ("n/a" is the
 * renderer's job, not this module's), never an estimate borrowed from a
 * similar-sounding model.
 */
import { describe, expect, it } from 'vitest';
import {
  costOfUsage,
  PRICE_TABLE_AS_OF,
  priceRowFor,
  type TokenUsage,
} from '../../src/shared/stats-pricing.js';

const usage = (over: Partial<TokenUsage>): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  ...over,
});

describe('priceRowFor', () => {
  it('finds a known model', () => {
    expect(priceRowFor('claude-3-5-sonnet-20241022')).not.toBeNull();
  });

  it('returns null for a model the table carries no row for', () => {
    expect(priceRowFor('claude-opus-5')).toBeNull();
    expect(priceRowFor('gpt-5.6-terra')).toBeNull();
    expect(priceRowFor('totally-invented-model-xyz')).toBeNull();
  });

  it('carries a stated as-of date, so every cost figure can be labelled', () => {
    expect(PRICE_TABLE_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('costOfUsage', () => {
  it('prices input, output, cache-write and cache-read tokens independently', () => {
    // claude-3-5-sonnet-20241022: $3/M input, $15/M output, $3.75/M cache
    // write, $0.30/M cache read (Anthropic's published rates as of the
    // table's own date).
    const cost = costOfUsage('claude-3-5-sonnet-20241022', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    expect(cost).not.toBeNull();
    expect(cost).toBeCloseTo(3 + 15 + 3.75 + 0.3, 6);
  });

  it('is null for an unknown model, never a guessed number', () => {
    expect(costOfUsage('claude-opus-5', usage({ inputTokens: 1_000_000 }))).toBeNull();
  });

  it('is zero for a known model with zero usage', () => {
    expect(costOfUsage('claude-3-5-sonnet-20241022', usage({}))).toBe(0);
  });

  it('prices input/output for a model whose row carries no cache rate, and never invents one for the cache tokens', () => {
    // claude-2.1 predates prompt caching entirely, so its row carries no
    // cache rate at all — cache tokens on such a row price at zero rather
    // than at a rate this table never published.
    const withoutCache = costOfUsage('claude-2.1', usage({ inputTokens: 1_000_000 }));
    expect(withoutCache).toBe(8);
    const cacheIgnored = costOfUsage(
      'claude-2.1',
      usage({ inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }),
    );
    expect(cacheIgnored).toBe(8);
  });
});
