/**
 * Whether `gh` is installed, and which GitHub account it is signed in as --
 * for Settings -> Integrations -> GitHub.
 *
 * "NOT KNOWING IS A STATE, AND IT IS NEVER AN EMPTY LIST" -- `pull-requests.ts`'s
 * own rule. `gh` missing, not logged in, and logged in are three different
 * facts and each gets its own answer; a logged-in account with a token gh
 * cannot introspect scopes for is not "no scopes", it is "vam does not know",
 * and `missingScopes` stays empty rather than warning about something it was
 * never told.
 *
 * TWO WAYS IN, ONE ANSWER. `--json hosts` is asked for first (gh 2.90+); an
 * older gh answers "unknown flag: --json" and this falls back to the plain
 * text `gh auth status` prints since before JSON support existed, parsed
 * tolerantly by `parseGhAuthStatusText`. Both paths produce the identical
 * `GithubAuthStatus` shape, so nothing downstream has to know which one ran.
 *
 * As in `pull-requests.ts`: argv construction, failure classification and
 * parsing are pure and separately testable; the spawn itself is not, for the
 * same reason -- a test that ran it would read the operator's own auth state.
 */

import { execFile } from 'node:child_process';
import { type GithubAccount, type GithubAuthStatus, REQUIRED_SCOPES } from '../../shared/github.js';

export type { GithubAccount, GithubAuthStatus };
export { REQUIRED_SCOPES };

/** `gh`'s JSON form, asked for first. */
export function ghAuthStatusArgv(): readonly string[] {
  return ['auth', 'status', '--json', 'hosts'];
}

/** The fallback for a `gh` old enough not to know `--json` at all. */
export function ghAuthStatusTextArgv(): readonly string[] {
  return ['auth', 'status'];
}

/** What a failed `execFile` hands back -- the shape every reader in this tree shares. */
export type SpawnFailure = {
  readonly message?: string;
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
};

const OLD_GH = /unknown flag|unknown shorthand flag/i;

/**
 * Which of the two known reasons a spawn failed, or `other`. `cli-missing`
 * and `old-gh` both have a documented recovery (this module retries `old-gh`
 * with the text argv; `github-pane.tsx` links to installing gh for
 * `cli-missing`); `other` carries gh's own stderr forward unclassified.
 */
export function classifyGhAuthFailure(
  failure: SpawnFailure,
  stderr: string,
): 'cli-missing' | 'old-gh' | 'other' {
  if (failure.code === 'ENOENT') return 'cli-missing';
  if (OLD_GH.test(stderr)) return 'old-gh';
  return 'other';
}

/** A comma list, `gh`'s own scopes shape: `"gist, read:org, repo"`, or absent
 *  entirely for a token source gh cannot introspect. Never an empty ARRAY
 *  standing in for "gh did not say" -- see the field's own note. */
function scopesOf(raw: unknown): readonly string[] | null {
  if (typeof raw !== 'string') return null;
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return names.length === 0 ? null : names;
}

function missingScopesOf(scopes: readonly string[] | null): readonly string[] {
  if (scopes === null) return [];
  const have = new Set(scopes);
  return REQUIRED_SCOPES.filter((scope) => !have.has(scope));
}

/**
 * `gh auth status --json hosts`'s body. `null` for anything that is not this
 * shape, so the caller can fall back to the text parser rather than reporting
 * a shape this function does not recognise as "logged out".
 *
 * MEASURED against a real `gh auth status --json hosts` (2.95.0): the JSON
 * body is `{"hosts": {<host>: [<account>, ...]}}`, an empty `hosts` object for
 * "not logged in anywhere" (with a plain-text sentence on STDERR that this
 * function never reads -- the JSON body alone says enough), and each account
 * repeats its own `host` field, which this function ignores in favour of the
 * OUTER key: the two always agreed in measurement, and the outer key is the
 * one gh groups by.
 */
export function parseGhAuthStatusJson(stdout: string): GithubAuthStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const hosts = (parsed as Record<string, unknown>)['hosts'];
  if (typeof hosts !== 'object' || hosts === null || Array.isArray(hosts)) return null;
  const accounts: GithubAccount[] = [];
  for (const [host, entryList] of Object.entries(hosts as Record<string, unknown>)) {
    if (!Array.isArray(entryList)) continue;
    for (const entry of entryList) {
      const row = (entry ?? {}) as Record<string, unknown>;
      const login = row['login'];
      if (typeof login !== 'string' || login === '') continue;
      const scopes = scopesOf(row['scopes']);
      accounts.push({
        host,
        login,
        active: row['active'] === true,
        tokenSource: typeof row.tokenSource === 'string' ? row.tokenSource : null,
        scopes,
        missingScopes: missingScopesOf(scopes),
      });
    }
  }
  // An empty `hosts` object is gh's own "not logged in anywhere" -- MEASURED,
  // not assumed (see the header). A host present but with no USABLE account
  // (every entry missing a login) still answers `logged-in` with an empty
  // list: gh reported something, and the empty list says gh reported nothing
  // vam could read, which is a different fact from nobody having logged in.
  if (Object.keys(hosts as Record<string, unknown>).length === 0) {
    return { kind: 'logged-out' };
  }
  return { kind: 'logged-in', accounts };
}

const NOT_LOGGED_IN = /not logged into any github hosts/i;
const LOGIN_LINE = /^\s*[✓x]\s*logged in to (\S+) account (\S+)(?:\s*\(([^)]+)\))?/i;
const ACTIVE_LINE = /^\s*-\s*active account:\s*(true|false)/i;
const SCOPES_LINE = /^\s*-\s*token scopes:\s*(.*)$/i;

/**
 * The plain-text form every `gh auth status` has printed since before
 * `--json` existed -- the fallback for an old gh, and for any JSON body this
 * file's own parser refused.
 *
 * TOLERANT BY DESIGN: a line this has never seen is simply not matched, never
 * a reason to fail the whole read. Only a wholly unrecognised transcript
 * (nothing matched, and the process reported it failed) is `unknown` --
 * `pull-requests.ts`'s rule that a failure must never be dressed up as an
 * empty answer.
 */
export function parseGhAuthStatusText(
  stdout: string,
  stderr: string,
  failed: boolean,
): GithubAuthStatus {
  if (NOT_LOGGED_IN.test(stderr) || NOT_LOGGED_IN.test(stdout)) {
    return { kind: 'logged-out' };
  }
  const lines = `${stdout}\n${stderr}`.split('\n');
  const accounts: GithubAccount[] = [];
  let current: { host: string; login: string; tokenSource: string | null } | null = null;
  let scopes: readonly string[] | null = null;
  let active = false;
  const flush = () => {
    if (current === null) return;
    accounts.push({
      host: current.host,
      login: current.login,
      active,
      tokenSource: current.tokenSource,
      scopes,
      missingScopes: missingScopesOf(scopes),
    });
    current = null;
    scopes = null;
    active = false;
  };
  for (const line of lines) {
    const login = LOGIN_LINE.exec(line);
    if (login !== null) {
      flush();
      current = { host: login[1] ?? '', login: login[2] ?? '', tokenSource: login[3] ?? null };
      continue;
    }
    const activeLine = ACTIVE_LINE.exec(line);
    if (activeLine !== null) {
      active = activeLine[1] === 'true';
      continue;
    }
    const scopesLine = SCOPES_LINE.exec(line);
    if (scopesLine !== null) {
      // gh quotes each scope: `'gist', 'read:org', 'repo'`.
      const names = (scopesLine[1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/^'|'$/g, ''))
        .filter((s) => s !== '');
      scopes = names.length === 0 ? null : names;
    }
  }
  flush();
  if (accounts.length > 0) return { kind: 'logged-in', accounts };
  return failed
    ? { kind: 'unknown', message: stderr.trim() !== '' ? stderr.trim() : stdout.trim() }
    : { kind: 'unknown', message: 'gh answered something vam does not recognise as a login state' };
}

/** How long the Re-check button waits before it gives up. A local read, not a
 *  poll, so this is generous rather than tight. */
const STATUS_TIMEOUT_MS = 10_000;

const MAX_OUTPUT_BYTES = 1024 * 1024;

const CLI_MISSING_MESSAGE =
  'the `gh` command was not found on PATH -- install it from https://cli.github.com and relaunch vam.';

/** What actually runs `gh`. Injected so the orchestration below is testable
 *  without a spawn -- the same seam `pull-requests.ts` leaves open. */
export type GhAuthRun = (argv: readonly string[]) => Promise<{
  readonly failure: SpawnFailure | null;
  readonly stdout: string;
  readonly stderr: string;
}>;

/**
 * Ask `gh` who is signed in. Resolves to a `GithubAuthStatus` and never
 * rejects, for the reason every reader in this tree shares: a thrown error
 * would reach the renderer as a shapeless failure and take the reason with it.
 *
 * NOT CACHED, UNLIKE THE PR READER. This is asked once on mount and once per
 * "Re-check" press -- an operator's own click -- never on a ten-second poll,
 * so the throttle `pull-requests.ts` needs for an unattended loop has nothing
 * to guard here.
 */
export function readGithubAuthStatus(run: GhAuthRun): () => Promise<GithubAuthStatus> {
  return async () => {
    const first = await run(ghAuthStatusArgv());
    if (first.failure !== null) {
      const reason = classifyGhAuthFailure(first.failure, first.stderr);
      if (reason === 'cli-missing') {
        return { kind: 'cli-missing', message: CLI_MISSING_MESSAGE };
      }
      if (reason === 'old-gh') {
        const fallback = await run(ghAuthStatusTextArgv());
        return parseGhAuthStatusText(fallback.stdout, fallback.stderr, fallback.failure !== null);
      }
      return parseGhAuthStatusText(first.stdout, first.stderr, true);
    }
    const parsed = parseGhAuthStatusJson(first.stdout);
    return parsed ?? parseGhAuthStatusText(first.stdout, first.stderr, false);
  };
}

/** The real runner, `execFile`-backed like every other reader in this tree. */
export function createGhAuthRun(binary = 'gh'): GhAuthRun {
  return (argv) =>
    new Promise((resolve) => {
      execFile(
        binary,
        [...argv],
        { timeout: STATUS_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (failure, stdout, stderr) => {
          resolve({ failure, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}
