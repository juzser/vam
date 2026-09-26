/**
 * The PR count's own TTL, stored in the SAME userData cache file
 * `incremental-cache.ts` already owns (`CacheStore.prs`, optional) — never a
 * second file. Ten minutes on the operator's own instruction: a warm scan
 * inside that window answers `PrsCreated` with NO network call at all, and
 * the explicit Refresh button is the one caller that bypasses it (see
 * `worker.ts`'s own header).
 */

import type { PrsCreated } from '../../shared/stats.js';

export const PRS_TTL_MS = 10 * 60_000;

/** Persisted alongside `CacheStore.files` — `sinceDate` is the EXACT
 *  `YYYY-MM-DD` (or `null`) the cached `result` was fetched for, so a since
 *  date that moved (a newer scan found an even earlier transcript) never
 *  serves a stale answer scoped to the wrong window. `result` is never
 *  `{kind: 'loading'}` — that variant exists for the in-flight moment
 *  before any fetch has settled, and this cache only ever stores a
 *  SETTLED one. */
export type PrsCacheEntry = {
  readonly sinceDate: string | null;
  readonly fetchedAtMs: number;
  readonly result: PrsCreated;
};

/**
 * Whether a cached PR count is still good enough to answer WITHOUT calling
 * `gh` again: it must exist, be scoped to the SAME since-date this scan is
 * about to ask for, and be younger than `PRS_TTL_MS`. `nowMs` arrives as an
 * argument (never `Date.now()` read here) so this stays a pure decision a
 * test can drive at any instant.
 */
export function isPrsCacheFresh(
  entry: PrsCacheEntry | undefined,
  sinceDate: string | null,
  nowMs: number,
): boolean {
  if (entry === undefined) return false;
  if (entry.sinceDate !== sinceDate) return false;
  return nowMs - entry.fetchedAtMs < PRS_TTL_MS;
}

/**
 * Safely reads `CacheStore.prs` (typed `unknown` there on purpose — see
 * that field's own header) back into a `PrsCacheEntry`, or `undefined` for
 * anything that is not exactly one: the field absent (a cache written
 * before this feature existed), or shaped wrong (a hand-edited or
 * corrupted cache file). NEVER throws, on `incremental-cache.ts`'s own
 * "losing the cache is a slower next scan, never a crash" rule.
 */
export function readPrsCacheEntry(value: unknown): PrsCacheEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const sinceDateOk = v['sinceDate'] === null || typeof v['sinceDate'] === 'string';
  const fetchedAtMsOk = typeof v['fetchedAtMs'] === 'number';
  const resultOk = typeof v['result'] === 'object' && v['result'] !== null;
  if (!sinceDateOk || !fetchedAtMsOk || !resultOk) return undefined;
  return value as PrsCacheEntry;
}
