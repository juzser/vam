/**
 * WHEN CLAUDE CODE'S OWN PROMPT CACHE WAS LAST TOUCHED, AND HOW LONG THAT
 * TOUCH LIVES -- what the sidebar's cache-timer countdown counts down from.
 *
 * ── WHERE THIS COMES FROM ─────────────────────────────────────────────────
 * The operator asked for a countdown: Claude Code caches your conversation to
 * cut cost, and when the cache expires the next message resends the whole
 * context at the uncached price. Anthropic's own docs
 * (https://platform.claude.com/docs/en/build-with-claude/prompt-caching):
 * "By default, the cache has a 5-minute lifetime", extendable per breakpoint
 * to a 1-hour one (`cache_control: {type:'ephemeral', ttl:'1h'}`), and "the
 * cache is refreshed for no additional cost each time the cached content is
 * used" -- a READ resets the clock exactly like a WRITE does.
 *
 * VERIFIED AGAINST REAL TRANSCRIPTS, not only the docs
 * (`~/.claude/projects/**\/*.jsonl`, read-only): every assistant `message`
 * that touched the cache carries top-level `cache_creation_input_tokens` /
 * `cache_read_input_tokens` -- nonzero exactly when this message read or
 * wrote an entry -- and, on a WRITE, a nested `cache_creation` object
 * breaking that write down by bucket: `ephemeral_1h_input_tokens` and
 * `ephemeral_5m_input_tokens`. Every write measured on this machine had the
 * 1-hour bucket nonzero and the 5-minute one at zero, never the reverse and
 * never both at once -- which is one CLI's own default choice, not a rule
 * this reader assumes; the 5-minute and mixed branches below exist for
 * whatever wrote them, an older CLI, a different tool, or the API used
 * directly.
 *
 * ── WHY A READ NEEDS A WRITE'S MEMORY ─────────────────────────────────────
 * A read reports ONLY that it hit the cache (`cache_read_input_tokens > 0`);
 * it carries no bucket of its own, because only a write chooses a TTL. So
 * this walks the window OLDEST FIRST (the order `transcript.ts` already
 * hands `summarizeLines`, and the order `readLiveTail` builds by unshifting
 * older steps onto the front) and remembers the newest WRITE's bucket, so a
 * session that goes quiet for four minutes and then only reads the same
 * entry keeps reporting the countdown that entry actually has, not "unknown".
 *
 * ── NEVER GUESS, ACROSS POLLS TOO ─────────────────────────────────────────
 * A read whose write is not IN THIS WINDOW is not a read whose write never
 * happened -- `tail.ts`'s own window is a bounded suffix, and a session that
 * goes quiet for longer than the window's step can lose the write that set
 * its TTL from view entirely while the entry it created is still very much
 * alive. This used to read such a read as Anthropic's documented 5-minute
 * default, which is wrong in exactly the direction that hurts: every write
 * ever measured on this machine used the 1-hour bucket, so guessing 5
 * minutes could mark a session "expired" up to 55 minutes early. Reporting
 * `NO_CACHE_ACTIVITY` instead is at least honest, but `REMEMBERED_WRITE_TTL`
 * -- keyed by `sessionKey`, the same identity `summarizeLines` mints
 * decision ids from, and kept for the life of this process the same way
 * `source.ts`'s own `FIRST_LINE_TIMESTAMP_CACHE` already is -- means the
 * common case (a write this same session showed on an EARLIER poll) does
 * not have to fall back to that at all.
 */

import type { Line } from './transcript.js';

/**
 * The newest WRITTEN bucket a session (`sessionKey`) has ever shown this
 * process, across polls -- see "NEVER GUESS, ACROSS POLLS TOO" above. A
 * poll whose own window holds no write at all still has this to fall back
 * to before giving up and reporting no timer.
 */
const REMEMBERED_WRITE_TTL = new Map<string, number>();

/** Anthropic's shorter bucket -- the documented default for a breakpoint
 *  nobody set a `ttl` on. */
export const CACHE_TTL_5M_MS = 5 * 60 * 1000;

/** The longer, opt-in bucket (`cache_control: {ttl: '1h'}`), costing more per
 *  write and lasting twelve times as long. */
export const CACHE_TTL_1H_MS = 60 * 60 * 1000;

export type CacheActivity = {
  /** ISO-8601 timestamp of the newest assistant message that read OR wrote
   *  the cache, or `null` when no message in this window did either. */
  readonly lastCacheActivityAt: string | null;
  /** The TTL bucket in force as of that activity, in ms, or `null` alongside
   *  a null `lastCacheActivityAt` -- there being no timer to time. */
  readonly cacheTtlMs: number | null;
};

/** No line in the window touched the cache at all. */
export const NO_CACHE_ACTIVITY: CacheActivity = {
  lastCacheActivityAt: null,
  cacheTtlMs: null,
};

const positive = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

/**
 * The bucket ONE write's own `cache_creation` object chose, or `null` when
 * this usage carries no write at all (a plain read, or an object this reader
 * does not recognise).
 *
 * BOTH BUCKETS NONZERO is a real, documented shape -- two `cache_control`
 * breakpoints at different TTLs in the same request -- and this reader
 * resolves it to the SHORTER one on purpose: that is the entry that actually
 * governs when the NEXT message stops being a full cache hit, since the
 * shorter-lived one expires first and forces a partial rewrite regardless of
 * how much the longer one still has left.
 */
function writtenTtlMs(usage: Record<string, unknown>): number | null {
  const creation = usage['cache_creation'];
  if (typeof creation !== 'object' || creation === null) return null;
  const bucket = creation as Record<string, unknown>;
  const oneHour = positive(bucket['ephemeral_1h_input_tokens']);
  const fiveMin = positive(bucket['ephemeral_5m_input_tokens']);
  if (oneHour > 0 && fiveMin > 0) return Math.min(CACHE_TTL_1H_MS, CACHE_TTL_5M_MS);
  if (oneHour > 0) return CACHE_TTL_1H_MS;
  if (fiveMin > 0) return CACHE_TTL_5M_MS;
  return null;
}

/**
 * One window's cache activity, oldest first -- the same order and the same
 * parsed lines `summarizeLines` already holds, so this costs one more pass
 * over data already in memory and no read of its own.
 *
 * `sessionKey` is optional so every existing caller and fixture that has no
 * stable identity to offer keeps working exactly as before -- it simply
 * cannot benefit from `REMEMBERED_WRITE_TTL` and falls back to
 * `NO_CACHE_ACTIVITY` the moment a window holds no write of its own.
 */
export function detectCacheActivity(lines: readonly Line[], sessionKey?: string): CacheActivity {
  let lastActivityAt: string | null = null;
  let ttlAtLastActivity: number | null = null;
  let knownWriteTtl: number | null =
    sessionKey === undefined ? null : (REMEMBERED_WRITE_TTL.get(sessionKey) ?? null);

  for (const line of lines) {
    if (line['type'] !== 'assistant') continue;
    const message = line['message'];
    if (typeof message !== 'object' || message === null) continue;
    const usage = (message as Record<string, unknown>)['usage'];
    if (typeof usage !== 'object' || usage === null) continue;
    const usageRecord = usage as Record<string, unknown>;

    const written = writtenTtlMs(usageRecord);
    if (written !== null) {
      knownWriteTtl = written;
      if (sessionKey !== undefined) REMEMBERED_WRITE_TTL.set(sessionKey, written);
    }

    const wrote = positive(usageRecord['cache_creation_input_tokens']);
    const read = positive(usageRecord['cache_read_input_tokens']);
    if (wrote === 0 && read === 0) continue;

    const stamp = line['timestamp'];
    if (typeof stamp !== 'string' || stamp === '') continue;

    lastActivityAt = stamp;
    // NEVER GUESS: a read with no write ever seen -- neither in this window
    // nor remembered from an earlier poll of the same session -- has no
    // bucket this reader may report, so `ttlAtLastActivity` stays `null`
    // and the whole result folds to `NO_CACHE_ACTIVITY` below.
    ttlAtLastActivity = knownWriteTtl;
  }

  return lastActivityAt === null || ttlAtLastActivity === null
    ? NO_CACHE_ACTIVITY
    : { lastCacheActivityAt: lastActivityAt, cacheTtlMs: ttlAtLastActivity };
}
