/**
 * THE SKILL ROW'S STAR COUNT -- one anonymous GitHub REST read, cached.
 *
 * `GET https://api.github.com/repos/<ADHD_SKILL_SOURCE_REPO>`, on the same
 * unauthenticated path `main/update/check.ts` uses for the release check
 * (`User-Agent: vam`, a ten second timeout). Unauthenticated REST allows 60
 * requests an hour per IP, so the reader keeps its answer in memory: a
 * success for six hours, a failure for fifteen minutes (answered `null`, never
 * thrown, never retried in a loop), and at most one request is ever in flight.
 * Nothing is written to disk.
 *
 * THE URL IS BUILT FROM `ADHD_SKILL_SOURCE_REPO` ALONE. The reader takes no
 * argument, so nothing a renderer sends can reach the request.
 */

import { ADHD_SKILL_SOURCE_REPO } from '../../shared/adhd-skill.js';
import { UPDATE_CHECK_TIMEOUT_MS, type UpdateFetcher } from '../update/check.js';

export type RepoStats = { readonly stars: number };

export type RepoStatsFetcher = UpdateFetcher;

export type RepoStatsDeps = {
  readonly fetch: RepoStatsFetcher;
  readonly now: () => number;
  /** Overridable only for tests; production always gets `UPDATE_CHECK_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
};

export const REPO_STATS_SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
export const REPO_STATS_FAILURE_TTL_MS = 15 * 60 * 1000;

const REPO_URL = `https://api.github.com/repos/${ADHD_SKILL_SOURCE_REPO}`;

export const DEFAULT_REPO_STATS_DEPS: RepoStatsDeps = {
  fetch: (url, init) => globalThis.fetch(url, init),
  now: () => Date.now(),
};

async function fetchStars(deps: RepoStatsDeps): Promise<RepoStats | null> {
  try {
    const response = await deps.fetch(REPO_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vam' },
      signal: AbortSignal.timeout(deps.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { stargazers_count?: unknown } | null;
    const count = body?.stargazers_count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;
    return { stars: count };
  } catch {
    return null;
  }
}

/** One reader per process; `main/skills/ipc.ts` holds it. */
export function createRepoStatsReader(
  deps: RepoStatsDeps = DEFAULT_REPO_STATS_DEPS,
): () => Promise<RepoStats | null> {
  let cached: { readonly value: RepoStats | null; readonly until: number } | undefined;
  let inFlight: Promise<RepoStats | null> | undefined;

  return () => {
    if (cached !== undefined && deps.now() < cached.until) return Promise.resolve(cached.value);
    if (inFlight !== undefined) return inFlight;
    inFlight = fetchStars(deps)
      .then((value) => {
        const ttl = value === null ? REPO_STATS_FAILURE_TTL_MS : REPO_STATS_SUCCESS_TTL_MS;
        cached = { value, until: deps.now() + ttl };
        return value;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}
