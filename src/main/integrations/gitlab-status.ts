/**
 * Whether `glab` is installed, and which GitLab account(s) it is signed in
 * as -- for Settings -> Integrations -> GitLab.
 *
 * `github-status.ts`'s own rule, restated: `glab` missing, not logged in,
 * and logged in are three different facts and each gets its own answer.
 *
 * ONE WAY IN, TEXT ONLY. `gh` has a `--json hosts` form; `glab` does not
 * (measured: `glab auth status --help`, glab 1.119.0, lists no `--json`
 * flag), so there is exactly one parser here, not two.
 *
 * MEASURED AGAINST A REAL `glab auth status` (1.119.0, installed via `brew
 * install glab` for this work, never logged in): everything it prints goes
 * to STDERR, with exit code 1 for "not logged in" -- see
 * `gitlab-status.test.ts`'s own header for the full provenance of every
 * fixture, including the one block that could not be measured (glab was
 * never signed in) and is built from `glab`'s own source instead.
 *
 * As in `github-status.ts`: argv construction, failure classification and
 * parsing are pure and separately testable; the spawn itself is not, for the
 * same reason -- a test that ran it would read the operator's own auth
 * state.
 */

import { execFile } from 'node:child_process';
import type { GitlabAccount, GitlabAuthStatus } from '../../shared/gitlab.js';

export type { GitlabAccount, GitlabAuthStatus };

/** `glab`'s only form -- there is no `--json` flag to ask for first. */
export function glabAuthStatusArgv(): readonly string[] {
  return ['auth', 'status'];
}

/** What a failed `execFile` hands back -- `github-status.ts`'s own shape. */
export type SpawnFailure = {
  readonly message?: string;
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
};

/**
 * Which of the one known reason a spawn failed, or `other`. `cli-missing`
 * has a documented recovery (the CLI-missing guide, `GitlabPanel.tsx`);
 * `other` carries `glab`'s own stderr forward, parsed tolerantly below.
 */
export function classifyGlabAuthFailure(failure: SpawnFailure): 'cli-missing' | 'other' {
  return failure.code === 'ENOENT' ? 'cli-missing' : 'other';
}

/**
 * `glab`'s own line, MEASURED: `  ✓ Logged in to gitlab.com as octocat
 * (keyring)` -- a leading icon (never matched here; `glab` has no other line
 * shaped "Logged in to X as Y" to confuse it with), "Logged in to", a host,
 * "as", a login, then whatever glab put in parens (a token source this
 * module never reads: `GitlabAccount` has no field for it, so there is
 * nothing here that could leak one by being printed).
 */
const LOGGED_IN_LINE = /logged in to (\S+) as (\S+)/i;

/** `glab`'s own words, MEASURED, for a token that was simply never set. */
const NO_TOKEN = /no token found/i;
/** `glab`'s own source text for `cfg.Hosts()` answering empty -- a path a
 *  real spawn does not take (see this file's header) but is parsed the same
 *  way regardless. */
const NEVER_AUTHENTICATED = /no gitlab instances have been authenticated with glab/i;

/**
 * The plain-text form every `glab auth status` prints.
 *
 * TOLERANT BY DESIGN, `github-status.ts`'s own rule: a line this has never
 * seen is simply not matched, never a reason to fail the whole read. Only a
 * wholly unrecognised transcript (nothing matched, and the process reported
 * it failed) is `unknown`.
 */
export function parseGlabAuthStatusText(
  stdout: string,
  stderr: string,
  failed: boolean,
): GitlabAuthStatus {
  const text = `${stdout}\n${stderr}`;
  const accounts: GitlabAccount[] = [];
  for (const line of text.split('\n')) {
    const match = LOGGED_IN_LINE.exec(line);
    if (match !== null) {
      accounts.push({ host: match[1] ?? '', login: match[2] ?? '' });
    }
  }
  if (accounts.length > 0) return { kind: 'logged-in', accounts };
  if (NO_TOKEN.test(text) || NEVER_AUTHENTICATED.test(text)) return { kind: 'logged-out' };
  return failed
    ? { kind: 'unknown', message: stderr.trim() !== '' ? stderr.trim() : stdout.trim() }
    : {
        kind: 'unknown',
        message: 'glab answered something vam does not recognise as a login state',
      };
}

/** How long the Re-check button waits before it gives up -- `github-status
 *  .ts`'s own figure: a local read, not a poll, so this is generous rather
 *  than tight. */
const STATUS_TIMEOUT_MS = 10_000;

const MAX_OUTPUT_BYTES = 1024 * 1024;

const CLI_MISSING_MESSAGE =
  'the `glab` command was not found on PATH -- install it from https://gitlab.com/gitlab-org/cli and relaunch vam.';

/** What actually runs `glab` -- injected so the orchestration below is
 *  testable without a spawn, `github-status.ts`'s own seam. */
export type GlabAuthRun = (argv: readonly string[]) => Promise<{
  readonly failure: SpawnFailure | null;
  readonly stdout: string;
  readonly stderr: string;
}>;

/**
 * Ask `glab` who is signed in. Resolves to a `GitlabAuthStatus` and never
 * rejects, `github-status.ts`'s own reason: a thrown error would reach the
 * renderer as a shapeless failure and take the reason with it.
 *
 * NOT CACHED, asked once on mount and once per "Re-check" press -- an
 * operator's own click, never a poll.
 */
export function readGitlabAuthStatus(run: GlabAuthRun): () => Promise<GitlabAuthStatus> {
  return async () => {
    const result = await run(glabAuthStatusArgv());
    if (result.failure !== null && classifyGlabAuthFailure(result.failure) === 'cli-missing') {
      return { kind: 'cli-missing', message: CLI_MISSING_MESSAGE };
    }
    return parseGlabAuthStatusText(result.stdout, result.stderr, result.failure !== null);
  };
}

/** The real runner, `execFile`-backed like every other reader in this tree. */
export function createGlabAuthRun(binary = 'glab'): GlabAuthRun {
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
