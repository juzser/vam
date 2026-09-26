/**
 * WHEN THE PROMPT CACHE WAS LAST TOUCHED, AND HOW LONG THAT TOUCH LIVES.
 *
 * The operator asked for a countdown in the sidebar: Claude Code's own prompt
 * cache expires 5 minutes after it was last read or written, unless the
 * request asked for the 1-hour bucket, in which case it is that instead
 * (https://platform.claude.com/docs/en/build-with-claude/prompt-caching --
 * "By default, the cache has a 5-minute lifetime", and a `cache_control` with
 * `"ttl": "1h"` gets the longer one). An assistant message's own `usage`
 * reports which happened, verified against real Claude Code transcripts
 * (`~/.claude/projects/**\/*.jsonl`, read-only): every message that touches
 * the cache carries a TOP-LEVEL `cache_creation_input_tokens` /
 * `cache_read_input_tokens` pair (nonzero exactly when this message read or
 * wrote a cache entry) and, when it WROTE one, a NESTED `cache_creation`
 * object breaking the write down by bucket -- `ephemeral_5m_input_tokens` /
 * `ephemeral_1h_input_tokens` -- of which every write measured on this
 * machine had 1h nonzero and 5m zero, never the reverse and never both.
 *
 * A READ CARRIES NO BUCKET OF ITS OWN -- only a write says which TTL applies,
 * because only a write chooses one. So a read that follows a write inherits
 * that write's own bucket, and it is what keeps a session that has gone quiet
 * for four minutes and then merely RE-READS the same cache (no new write)
 * reporting the same 1-hour countdown it always had, not "unknown".
 */

import { describe, expect, it } from 'vitest';
import {
  CACHE_TTL_1H_MS,
  CACHE_TTL_5M_MS,
  detectCacheActivity,
  NO_CACHE_ACTIVITY,
} from '../../src/main/sources/claude-code/cache-activity.js';
import type { Line } from '../../src/main/sources/claude-code/transcript.js';

type Json = Record<string, unknown>;

/** One assistant line carrying `usage`, the only shape this reader looks at. */
function turn(
  timestamp: string,
  usage: {
    readonly cacheCreation?: number;
    readonly cacheRead?: number;
    readonly oneHour?: number;
    readonly fiveMin?: number;
  } = {},
): Json {
  const { cacheCreation = 0, cacheRead = 0, oneHour = 0, fiveMin = 0 } = usage;
  return {
    type: 'assistant',
    timestamp,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: cacheRead,
        cache_creation: { ephemeral_1h_input_tokens: oneHour, ephemeral_5m_input_tokens: fiveMin },
      },
    },
  };
}

const lines = (...items: readonly Json[]): readonly Line[] => items as readonly Line[];

describe('no cache usage at all', () => {
  it('reports no timer for a session with no cache-bearing line', () => {
    const result = detectCacheActivity(
      lines(
        { type: 'assistant', timestamp: '2026-09-26T01:00:00.000Z', message: { content: [] } },
        { type: 'user', timestamp: '2026-09-26T01:00:01.000Z', message: { content: 'hi' } },
      ),
    );
    expect(result).toEqual(NO_CACHE_ACTIVITY);
  });

  it('reports no timer for an empty transcript', () => {
    expect(detectCacheActivity([])).toEqual(NO_CACHE_ACTIVITY);
  });

  it('ignores usage with every count at zero', () => {
    const result = detectCacheActivity(
      lines(turn('2026-09-26T01:00:00.000Z', { cacheCreation: 0, cacheRead: 0 })),
    );
    expect(result).toEqual(NO_CACHE_ACTIVITY);
  });
});

describe('the 5-minute bucket', () => {
  it('is read off ephemeral_5m_input_tokens on the write that made it', () => {
    const result = detectCacheActivity(
      lines(turn('2026-09-26T01:00:00.000Z', { cacheCreation: 500, fiveMin: 500 })),
    );
    expect(result).toEqual({
      lastCacheActivityAt: '2026-09-26T01:00:00.000Z',
      cacheTtlMs: CACHE_TTL_5M_MS,
    });
  });

  it('carries the 5-minute bucket forward across a later READ with no new write', () => {
    const result = detectCacheActivity(
      lines(
        turn('2026-09-26T01:00:00.000Z', { cacheCreation: 500, fiveMin: 500 }),
        turn('2026-09-26T01:02:00.000Z', { cacheRead: 500 }),
      ),
    );
    expect(result).toEqual({
      lastCacheActivityAt: '2026-09-26T01:02:00.000Z',
      cacheTtlMs: CACHE_TTL_5M_MS,
    });
  });
});

describe('the 1-hour bucket', () => {
  it('is read off ephemeral_1h_input_tokens on the write that made it', () => {
    const result = detectCacheActivity(
      lines(turn('2026-09-26T01:00:00.000Z', { cacheCreation: 18687, oneHour: 18687 })),
    );
    expect(result).toEqual({
      lastCacheActivityAt: '2026-09-26T01:00:00.000Z',
      cacheTtlMs: CACHE_TTL_1H_MS,
    });
  });

  it('carries the 1-hour bucket forward across a later read', () => {
    const result = detectCacheActivity(
      lines(
        turn('2026-09-26T01:00:00.000Z', { cacheCreation: 18687, oneHour: 18687 }),
        turn('2026-09-26T01:45:00.000Z', { cacheRead: 24641 }),
        turn('2026-09-26T01:50:00.000Z', { cacheRead: 24700 }),
      ),
    );
    expect(result).toEqual({
      lastCacheActivityAt: '2026-09-26T01:50:00.000Z',
      cacheTtlMs: CACHE_TTL_1H_MS,
    });
  });
});

describe('mixed', () => {
  it('takes the LATEST write’s own bucket, oldest first, over an earlier one', () => {
    const result = detectCacheActivity(
      lines(
        turn('2026-09-26T01:00:00.000Z', { cacheCreation: 500, fiveMin: 500 }),
        turn('2026-09-26T01:05:00.000Z', { cacheCreation: 18687, oneHour: 18687 }),
      ),
    );
    expect(result).toEqual({
      lastCacheActivityAt: '2026-09-26T01:05:00.000Z',
      cacheTtlMs: CACHE_TTL_1H_MS,
    });
  });

  /**
   * ONE WRITE, BOTH BUCKETS NONZERO -- a request with two `cache_control`
   * breakpoints at different TTLs, which the docs allow and this measured
   * corpus never happened to produce. NOT AMBIGUOUS BY ACCIDENT: the design
   * choice here is the SHORTER of the two, because that is the bucket that
   * actually governs when the NEXT message stops being a full cache hit --
   * the 5-minute entry expires and forces a partial rewrite regardless of
   * what the 1-hour entry still has left.
   */
  it('takes the SHORTER of two buckets written by the same message', () => {
    const result = detectCacheActivity(
      lines(turn('2026-09-26T01:00:00.000Z', { cacheCreation: 600, oneHour: 100, fiveMin: 500 })),
    );
    expect(result).toEqual({
      lastCacheActivityAt: '2026-09-26T01:00:00.000Z',
      cacheTtlMs: CACHE_TTL_5M_MS,
    });
  });
});

describe('a read with no write ever seen in the window', () => {
  /**
   * THE WINDOW IS A TAIL, NOT THE WHOLE FILE (`tail.ts`): the write that
   * created this cache entry can sit above where vam started reading. A read
   * still PROVES a cache exists (`cache_read_input_tokens > 0`), so this is
   * not `NO_CACHE_ACTIVITY` -- it reads as Anthropic's own documented
   * default for an ephemeral breakpoint nobody chose a `ttl` for: 5 minutes,
   * the same default `readNotifyWaiting` and its neighbours reach for when a
   * value cannot be read at all.
   */
  it('defaults to the documented 5-minute TTL', () => {
    const result = detectCacheActivity(lines(turn('2026-09-26T01:00:00.000Z', { cacheRead: 900 })));
    expect(result).toEqual({
      lastCacheActivityAt: '2026-09-26T01:00:00.000Z',
      cacheTtlMs: CACHE_TTL_5M_MS,
    });
  });
});

describe('what is not a cache-bearing line', () => {
  it('skips a user line even if it somehow carries a usage-shaped field', () => {
    const result = detectCacheActivity(
      lines({
        type: 'user',
        timestamp: '2026-09-26T01:00:00.000Z',
        message: { content: 'hi', usage: { cache_read_input_tokens: 900 } },
      }),
    );
    expect(result).toEqual(NO_CACHE_ACTIVITY);
  });

  it('skips an assistant line with no usage at all, without throwing', () => {
    const result = detectCacheActivity(
      lines({
        type: 'assistant',
        timestamp: '2026-09-26T01:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] },
      }),
    );
    expect(result).toEqual(NO_CACHE_ACTIVITY);
  });

  it('ignores a line whose timestamp is not a string', () => {
    const result = detectCacheActivity(
      lines({
        type: 'assistant',
        timestamp: 12345,
        message: {
          content: [],
          usage: { cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
        },
      }),
    );
    expect(result).toEqual(NO_CACHE_ACTIVITY);
  });
});
