/**
 * The pull requests on a session's branch, via the `gh` CLI.
 *
 * THIS IS THE FIRST TIME VAM REACHES THE NETWORK ON THE OPERATOR'S BEHALF,
 * with the operator's own credentials -- until now its only outbound call was
 * a read-only first-party usage endpoint. Two decisions follow from that and
 * they are the substance of this file, not its polish.
 *
 * 1. NOT KNOWING IS A STATE, AND IT IS NEVER AN EMPTY LIST. `gh` missing,
 *    `gh` unauthenticated, a directory that is not a repository, a repository
 *    with no GitHub remote, a timeout, output that is not JSON: each becomes
 *    its own `unavailable` code with its own sentence. Exactly one situation
 *    produces an empty list, and it is the one where GitHub answered "none".
 *    "No PRs" and "vam could not ask" must never look the same.
 * 2. EVERY READ IS THROTTLED, INCLUDING A FAILING ONE. `useSourceModel` polls
 *    every ten seconds; a broken setup that spawned a process per poll would
 *    be this feature's real cost. See `createPullRequestReader`.
 *
 * Only `gh pr list` is ever run: a read. Opening a pull request in a browser
 * is a second outbound capability and is deliberately not here.
 *
 * As in `deliver.ts`, argv construction, failure classification and parsing
 * are pure and separately testable, because the one thing that cannot be
 * tested is the spawn itself -- a test that ran it would reach GitHub from a
 * test run with whatever token the machine holds.
 */

import { execFile } from 'node:child_process';
import type {
  PullRequest,
  PullRequestChecks,
  PullRequestList,
} from '../../../renderer/domain/model.js';

/**
 * How long `gh` gets. This is a single API query, not a model call, so it is
 * a fraction of `deliver.ts`'s budget -- and a timeout here is cheap, because
 * it becomes a visible `timed-out` state rather than a hang.
 */
const PR_TIMEOUT_MS = 10_000;

const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Enough of what `gh` said to act on. */
const MAX_CLI_MESSAGE = 400;

/**
 * How many pull requests one branch may contribute. A branch usually has one;
 * a long-lived branch reused across several merges has a handful. The cap is
 * what stops a pathological branch from filling a narrow pane.
 */
const PR_LIMIT = 10;

/** The fields the pane draws, and no others. */
const PR_FIELDS = ['number', 'title', 'state', 'isDraft', 'statusCheckRollup'] as const;

/**
 * The exact argv. The branch is ONE element and is never interpolated:
 * `execFile` runs no shell, so a branch name containing a space, a quote or a
 * semicolon has no meaning beyond being a branch name.
 *
 * No `--repo`: which repository is asked about is decided by the working
 * directory vam runs this in, which is the session's own `cwd`. Naming a
 * repository here would let a session's pane describe a repository the
 * session is not in.
 *
 * `--state all` because a merged or closed pull request for this branch is
 * exactly as worth seeing as an open one -- "it already merged" is an answer.
 */
export function prListArgv(branch: string): readonly string[] {
  return [
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'all',
    '--limit',
    String(PR_LIMIT),
    '--json',
    PR_FIELDS.join(','),
  ];
}

const clip = (text: string): string =>
  text.trim().length > MAX_CLI_MESSAGE
    ? `${text.trim().slice(0, MAX_CLI_MESSAGE)}...`
    : text.trim();

/** What a failed `execFile` hands back. Written out for `deliver.ts`'s reason. */
/**
 * The fallback when stderr was empty. Never `failure.message`: node builds
 * that as `Command failed: <file> <args joined>`, which republishes the argv
 * unbounded into the error log and a prefilled PUBLIC issue body (see
 * `deliver.ts`, where the argv held the operator's prompt).
 */
const NO_WORDS = 'the command exited without saying why';

export type SpawnFailure = {
  readonly message: string;
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
};

const unavailable = (code: string, message: string): PullRequestList => ({
  kind: 'unavailable',
  code,
  message,
});

/** `gh`'s own words for each situation, matched loosely enough to survive rewording. */
const NOT_AUTHENTICATED =
  /gh auth login|not logged in|authentication token|requires authentication/i;
const NOT_A_REPO = /not a git repository/i;
const NO_REMOTE =
  /git remotes|no such remote|could not determine (?:the )?base repository|none of the git remotes/i;

/**
 * Turn a failed spawn into a distinct, honest reason.
 *
 * Order matters: `ENOENT` and a kill are facts about the process and beat
 * anything in stderr, and the repository questions are checked before the
 * catch-all so that the two most common setup mistakes -- never authenticated,
 * and asking in a directory that is not a checkout -- keep their own words.
 */
export function classifyGhFailure(input: {
  failure: SpawnFailure;
  stderr: string;
  branch: string;
}): PullRequestList {
  const { failure, stderr, branch } = input;
  const said = clip(stderr);

  if (failure.code === 'ENOENT') {
    return unavailable(
      'cli-missing',
      'the `gh` command was not found, so vam cannot ask GitHub about this branch',
    );
  }
  if (failure.killed === true) {
    return unavailable(
      'timed-out',
      `GitHub did not answer about ${branch} within ${Math.round(PR_TIMEOUT_MS / 1000)}s`,
    );
  }
  if (NOT_AUTHENTICATED.test(stderr)) {
    return unavailable(
      'not-authenticated',
      `\`gh\` is installed but not authenticated, so vam cannot ask about ${branch}. ${said}`,
    );
  }
  if (NOT_A_REPO.test(stderr)) {
    return unavailable(
      'not-a-repo',
      "this session's working directory is not a git repository, so it has no pull requests",
    );
  }
  if (NO_REMOTE.test(stderr)) {
    return unavailable(
      'no-github-remote',
      'this repository has no GitHub remote vam can ask about',
    );
  }
  return unavailable(
    'gh-failed',
    `asking GitHub about ${branch} failed: ${said === '' ? NO_WORDS : said}`,
  );
}

/** Conclusions that count as finished and acceptable. */
const GOOD = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
/** Conclusions and states that count as finished and bad. */
const BAD = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
]);

/**
 * Flatten a `statusCheckRollup` into one word.
 *
 * A rollup mixes two shapes -- `CheckRun` (`status` + `conclusion`) and
 * `StatusContext` (`state`) -- so both are read, and anything this function
 * does not recognise is reported as `pending` rather than assumed good. An
 * unknown conclusion silently counted as success is how a red branch would
 * come to look green.
 */
export function summarizeChecks(rollup: unknown): PullRequestChecks {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'none';
  let pending = false;
  for (const entry of rollup) {
    const check = (entry ?? {}) as Record<string, unknown>;
    const status = typeof check['status'] === 'string' ? check['status'] : null;
    const verdict =
      typeof check['conclusion'] === 'string'
        ? check['conclusion']
        : typeof check['state'] === 'string'
          ? check['state']
          : null;
    if (status !== null && status !== 'COMPLETED') {
      pending = true;
      continue;
    }
    if (verdict !== null && BAD.has(verdict)) return 'failing';
    if (verdict === null || !GOOD.has(verdict)) pending = true;
  }
  return pending ? 'pending' : 'passing';
}

const STATES: Record<string, PullRequest['state']> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
};

/**
 * Read `gh`'s `--json` body.
 *
 * STRICT ON PURPOSE. A row missing a number or a title, or carrying a state
 * this function has never heard of, fails the whole read as `bad-response`
 * rather than being dropped or given a made-up state: a silently shortened
 * list is indistinguishable from a true one, and this file's whole job is
 * that no failure is allowed to look like an answer.
 */
export function parsePrList(stdout: string): PullRequestList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return unavailable('bad-response', 'gh answered with something that was not JSON');
  }
  if (!Array.isArray(parsed)) {
    return unavailable(
      'bad-response',
      'gh answered with something that was not a list of pull requests',
    );
  }
  const prs: PullRequest[] = [];
  for (const row of parsed) {
    const pr = (row ?? {}) as Record<string, unknown>;
    const number = pr['number'];
    const title = pr['title'];
    const rawState = pr['state'];
    const state = typeof rawState === 'string' ? STATES[rawState] : undefined;
    if (typeof number !== 'number' || typeof title !== 'string' || state === undefined) {
      return unavailable(
        'bad-response',
        'gh listed a pull request in a shape vam does not understand, so the whole list is reported as unknown rather than shortened',
      );
    }
    prs.push({
      number,
      title,
      state: state === 'open' && pr['isDraft'] === true ? 'draft' : state,
      checks: summarizeChecks(pr['statusCheckRollup']),
    });
  }
  return { kind: 'ok', prs };
}

/** What actually asks GitHub. Injectable so the throttle can be tested without a spawn. */
export type ReadPrsFn = (input: { cwd: string; branch: string }) => Promise<PullRequestList>;

/**
 * Run `gh pr list`. Resolves to a `PullRequestList` and NEVER rejects: a
 * thrown error would reach the renderer as a generic load failure and take
 * the reason with it.
 */
export const readPullRequestsViaCli =
  (binary = 'gh'): ReadPrsFn =>
  ({ cwd, branch }) =>
    new Promise((resolve) => {
      execFile(
        binary,
        prListArgv(branch),
        { cwd, timeout: PR_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (failure, stdout, stderr) => {
          resolve(
            failure
              ? classifyGhFailure({ failure, stderr: String(stderr), branch })
              : parsePrList(String(stdout)),
          );
        },
      );
    });

/**
 * The floor between two real reads of one branch.
 *
 * `useSourceModel` polls every ten seconds, and every poll rebuilds every
 * session, so without this each session on screen would spawn a `gh` process
 * -- and an authenticated GitHub request -- six times a minute, forever. A
 * minute is far above that poll and far below the pace at which a pull
 * request's state or its checks actually change; the operator loses nothing
 * they would have noticed, and the request rate drops by a factor of six per
 * branch on screen.
 */
export const MIN_PR_READ_INTERVAL_MS = 60_000;

/**
 * Beyond this many remembered branches the cache is dropped whole. vam shows
 * single digits of sessions, so this is only ever reached by a long-running
 * app that has watched many branches come and go -- and forgetting them costs
 * one extra read each, never a wrong answer.
 */
const MAX_CACHED_BRANCHES = 64;

export type ReadPullRequests = (input: {
  cwd: string;
  branch: string | null;
}) => Promise<PullRequestList>;

/**
 * The read discipline, lifted from `src/main/usage/ipc.ts`: a minimum
 * interval, in-flight de-duplication, and -- the part that matters -- FAILURES
 * CACHED TOO. Caching only successes would leave a machine without `gh`, or
 * without a GitHub login, spawning a process per poll per session while
 * answering the same way every time. That is the hole this closes, not a
 * smaller version of it.
 *
 * Keyed by working directory AND branch, because two sessions in one checkout
 * on different branches are genuinely different questions.
 */
export function createPullRequestReader(
  read: ReadPrsFn,
  now: () => number = Date.now,
): ReadPullRequests {
  const cache = new Map<string, { at: number; list: PullRequestList }>();
  const inFlight = new Map<string, Promise<PullRequestList>>();

  return async ({ cwd, branch }) => {
    if (branch === null) {
      // vam has no branch for this session, so there is no question to ask.
      // Reported rather than left absent: this source HAS a pull-request
      // surface, it just cannot aim it here.
      return unavailable(
        'branch-unknown',
        'vam could not tell which branch this session is on, so it has nothing to ask GitHub about',
      );
    }
    const key = `${cwd} ${branch}`;
    const last = cache.get(key);
    if (last !== undefined && now() - last.at < MIN_PR_READ_INTERVAL_MS) {
      return last.list;
    }
    const running = inFlight.get(key);
    if (running !== undefined) return running;

    const pending = (async () => {
      let list: PullRequestList;
      try {
        list = await read({ cwd, branch });
      } catch (error) {
        // `readPullRequestsViaCli` turns every ordinary failure into a value,
        // so a throw here is something neither it nor this reader foresaw.
        list = unavailable(
          'gh-failed',
          `asking GitHub about ${branch} failed: ${error instanceof Error ? clip(error.message) : 'unknown error'}`,
        );
      }
      if (cache.size >= MAX_CACHED_BRANCHES) cache.clear();
      cache.set(key, { at: now(), list });
      inFlight.delete(key);
      return list;
    })();
    inFlight.set(key, pending);
    return pending;
  };
}
