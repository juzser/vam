/**
 * "PRs created" — one `gh api graphql` call that returns a single count.
 * Argv/parsing/classification are pure and testable here, on
 * `sources/claude-code/pull-requests.ts`'s own pattern; the spawn itself is
 * not, because running it would reach GitHub with whatever token this
 * machine holds.
 *
 * WHY GRAPHQL, NOT `gh search prs --author @me`. That command paginates and
 * — measured standalone on this machine's own account, whose PR history is
 * long — takes many SECONDS for `--limit 1000`, occasionally exceeding this
 * module's own 10s timeout outright. Worse, `scan.ts` used to `await` it
 * AFTER the whole file fold, so it dominated every "warm" refresh's latency
 * regardless of how fast the incremental cache made the rest of the scan.
 * `search(query: $q, type: ISSUE) { issueCount }` asks GitHub for the COUNT
 * alone: no page of results to walk, no `--limit` guess to get wrong, and
 * `worker.ts` now runs it CONCURRENTLY with the fold rather than after it.
 *
 * THE DATE NEVER TOUCHES THE QUERY TEXT. `toDateOnly` is the one place an
 * ISO instant becomes the strict `YYYY-MM-DD` this module will ever accept,
 * and `ghSearchPrsCountArgv` re-validates it anyway before use — but even a
 * malformed date could never inject anything: it travels as a GraphQL
 * VARIABLE (`-f q=...`), substituted by `gh` itself into the query, never
 * concatenated into the `-f query=...` document this module hands it.
 *
 * NEVER `gh auth` ANYTHING. This module has exactly two commands it can
 * ever build (the graphql call above) and both are reads; nothing here logs
 * in, logs out, or refreshes a token. If `gh` is not authenticated, that is
 * itself the `'unavailable'` outcome (reason `'not-logged-in'`) — the
 * operator connects GitHub from Settings, this screen never tries to do it
 * on their behalf.
 */

import { execFile } from 'node:child_process';
import type { PrsCreated, PrsUnavailableReason } from '../../shared/stats.js';

const CONNECT_HINT = 'connect GitHub in Settings → Integrations';

const unavailable = (reason: PrsUnavailableReason): PrsCreated => ({
  kind: 'unavailable',
  hint: CONNECT_HINT,
  reason,
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The strict `YYYY-MM-DD` prefix of a real ISO instant (`scan.ts`'s own
 * `trackingSinceIso`, always built by `new Date(...).toISOString()`, never
 * free text) — or `null` when there is no date at all, or when whatever
 * string arrived does not match that shape. Defensive rather than trusting:
 * this is the one function standing between "the earliest timestamp this
 * scan found" and a value that reaches a real network call.
 */
export function toDateOnly(iso: string | null): string | null {
  if (iso === null) return null;
  const candidate = iso.slice(0, 10);
  return DATE_ONLY.test(candidate) ? candidate : null;
}

const QUERY = 'query($q:String!){search(query:$q,type:ISSUE){issueCount}}';

/**
 * The exact argv for the count-only graphql call. `sinceDate` is
 * RE-VALIDATED here (never just trusted from the caller) — an invalid value
 * falls back to omitting the `created:` filter entirely, the same safe
 * default `null` gets, rather than ever reaching `-f q=...` unchecked.
 */
export function ghSearchPrsCountArgv(sinceDate: string | null): readonly string[] {
  const valid = sinceDate !== null && DATE_ONLY.test(sinceDate) ? sinceDate : null;
  const search = valid === null ? 'is:pr author:@me' : `is:pr author:@me created:>=${valid}`;
  return ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=${search}`];
}

/**
 * `gh api graphql`'s own JSON envelope, read for `data.search.issueCount`
 * alone. A real `0` is a real "none" — `{kind: 'ok', count: 0}` — never
 * folded into `'unavailable'`; only a shape this parser did not anticipate
 * (unparsable JSON, a GraphQL `errors` array, a missing/non-numeric
 * `issueCount`) is `'unavailable'` (reason `'error'`).
 */
export function parseGhPrsGraphqlCount(stdout: string): PrsCreated {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return unavailable('error');
  }
  if (typeof value !== 'object' || value === null) return unavailable('error');
  const data = (value as Record<string, unknown>)['data'];
  const search =
    typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['search'] : null;
  const issueCount =
    typeof search === 'object' && search !== null
      ? (search as Record<string, unknown>)['issueCount']
      : null;
  return typeof issueCount === 'number' && Number.isFinite(issueCount) && issueCount >= 0
    ? { kind: 'ok', count: issueCount }
    : unavailable('error');
}

/** What a failed `execFile` hands back — the slice `classifyGhPrsFailure`
 *  needs, mirroring `pull-requests.ts`'s own `SpawnFailure`. `killed` is
 *  `true` when THIS module's own `GH_PRS_TIMEOUT_MS` fired (Node sets it on
 *  the error it hands `execFile`'s callback) — the one signal that
 *  distinguishes "we gave up waiting" from every other failure shape. */
export type GhPrsSpawnFailure = {
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
};

/**
 * Every failure becomes `'unavailable'`, tagged with WHY: a missing `gh`
 * binary (`'no-gh'`), this module's own timeout firing (`'timeout'`), `gh`
 * reachable but not authenticated (`'not-logged-in'`, read from `gh`'s own
 * stderr sentence), or anything else (`'error'`) — a `hint` alone left an
 * operator unable to tell "you are not logged in" from "your network is
 * slow today" apart, and the Stats screen's own tooltip now can.
 */
export function classifyGhPrsFailure(failure: GhPrsSpawnFailure, stderr: string): PrsCreated {
  if (failure.code === 'ENOENT') return unavailable('no-gh');
  if (failure.killed === true) return unavailable('timeout');
  if (/gh auth login|not logged into|authentication/i.test(stderr)) {
    return unavailable('not-logged-in');
  }
  return unavailable('error');
}

/** How long `gh` gets before this module gives up and reports `'timeout'` —
 *  one graphql query, not a model call, and a hang here must never block
 *  the Stats screen's own PR card past a bound the operator can see named
 *  in its tooltip. */
const GH_PRS_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Runs the count-only graphql call, resolving to a `PrsCreated` that NEVER
 * rejects — the `fetchPrsCreated` dependency `worker.ts` calls, concurrently
 * with the file fold, once per scan (subject to `pr-count-cache.ts`'s own
 * TTL). `sinceDate` is expected ALREADY validated (`toDateOnly`'s own
 * output) — this function re-validates anyway (`ghSearchPrsCountArgv`
 * does), never trusting a caller blindly. Injectable `binary` for the same
 * testing reason `readPullRequestsViaCli` takes one, though this module's
 * own tests never spawn anything real (see the header).
 */
export function readGhPrsCreated(binary = 'gh'): (sinceDate: string | null) => Promise<PrsCreated> {
  return (sinceDate) =>
    new Promise((resolve) => {
      execFile(
        binary,
        ghSearchPrsCountArgv(sinceDate),
        { timeout: GH_PRS_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (failure, stdout, stderr) => {
          resolve(
            failure
              ? classifyGhPrsFailure({ code: failure.code, killed: failure.killed }, String(stderr))
              : parseGhPrsGraphqlCount(String(stdout)),
          );
        },
      );
    });
}
