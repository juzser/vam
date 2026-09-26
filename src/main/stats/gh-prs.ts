/**
 * "PRs created" — a single `gh search prs --author @me` call, counted, on
 * `sources/claude-code/pull-requests.ts`'s own pattern: argv, parsing and
 * failure classification are pure and separately testable here; the spawn
 * itself is not, because running it would reach GitHub with whatever token
 * this machine holds.
 *
 * UNLIKE `pull-requests.ts`, this is a `gh search`, not a `gh pr list` — it
 * asks across EVERY repository the operator's account can see, not one
 * branch of one checkout, and it needs no `cwd` inside a repository at all
 * (the operator's own example: `gh search prs --author @me --created
 * >=<tracking-since>`).
 *
 * NEVER `gh auth` ANYTHING. This module has exactly one command it can ever
 * build (`ghSearchPrsArgv`) and it is a read; nothing here logs in, logs out,
 * or refreshes a token. If `gh` is not authenticated, that is itself the
 * `'unavailable'` outcome — the operator connects GitHub from Settings, this
 * screen never tries to do it on their behalf.
 *
 * ONE HINT FOR EVERY FAILURE, on the operator's own instruction: "otherwise
 * show '—' with the hint 'connect GitHub in Settings → Integrations'". A
 * finer taxonomy (`pull-requests.ts`'s `unavailable` DOES distinguish
 * `repo-missing`/`gh-failed`/etc, because that pane names a directory the
 * operator can fix) would only be exact ABOUT A SITUATION THIS CARD OFFERS
 * NO CONTROL FOR — there is no per-repository setting here, only "GitHub is
 * connected or it is not".
 */

import { execFile } from 'node:child_process';
import type { PrsCreated } from '../../shared/stats.js';

const CONNECT_HINT = 'connect GitHub in Settings → Integrations';

const unavailable = (): PrsCreated => ({ kind: 'unavailable', hint: CONNECT_HINT });

/**
 * The exact argv. `sinceIso` is the snapshot's own `trackingSinceIso` —
 * `null` for a machine with no usage data at all yet, in which case
 * `--created` is omitted rather than sent as a malformed date. Only the
 * DATE half of the ISO instant is sent: `gh search`'s `--created` filter
 * takes a date or a date-time, and a date is what "since tracking began" means
 * to an operator reading this card — nobody is asking whether a pull request
 * landed before or after the exact millisecond of the earliest transcript
 * line this scan happened to read.
 */
export function ghSearchPrsArgv(sinceIso: string | null): readonly string[] {
  const base = ['search', 'prs', '--author', '@me'];
  const since = sinceIso === null ? [] : ['--created', `>=${sinceIso.slice(0, 10)}`];
  return [...base, ...since, '--json', 'number', '--limit', '1000'];
}

/**
 * `gh`'s own JSON array, counted. An empty array is a REAL "none" — `{kind:
 * 'ok', count: 0}` — never folded into `'unavailable'`; only output that is
 * not a JSON array at all (a shape this parser did not anticipate) is
 * unavailable.
 */
export function parseGhPrsCount(stdout: string): PrsCreated {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return unavailable();
  }
  return Array.isArray(value) ? { kind: 'ok', count: value.length } : unavailable();
}

/** What a failed `execFile` hands back — the slice `classifyGhPrsFailure`
 *  needs, mirroring `pull-requests.ts`'s own `SpawnFailure`. */
export type GhPrsSpawnFailure = {
  readonly code?: string | number | undefined;
};

/**
 * Every failure becomes the SAME outcome — see the module header for why a
 * finer taxonomy is not the point here. `stderr` is read only so a future
 * reader can see it was considered, not to branch on it.
 */
export function classifyGhPrsFailure(_failure: GhPrsSpawnFailure, _stderr: string): PrsCreated {
  return unavailable();
}

/** How long `gh search` gets — the same budget `pull-requests.ts`'s own
 *  `PR_TIMEOUT_MS` uses, for the same reason: one API query, not a model
 *  call, and a timeout here becomes a visible `unavailable` reading rather
 *  than a hang blocking the Stats screen's own scan. */
const GH_PRS_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Runs `gh search prs --author @me`, resolving to a `PrsCreated` that NEVER
 * rejects — this is the `fetchPrsCreated` dependency `scan.ts` calls once
 * per scan. Injectable `binary` for the same testing reason
 * `readPullRequestsViaCli` takes one, though this module's own tests never
 * spawn anything real (see the header).
 */
export function readGhPrsCreated(binary = 'gh'): (sinceIso: string | null) => Promise<PrsCreated> {
  return (sinceIso) =>
    new Promise((resolve) => {
      execFile(
        binary,
        ghSearchPrsArgv(sinceIso),
        { timeout: GH_PRS_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (failure, stdout, stderr) => {
          resolve(
            failure
              ? classifyGhPrsFailure({ code: failure.code }, String(stderr))
              : parseGhPrsCount(String(stdout)),
          );
        },
      );
    });
}
