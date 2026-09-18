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
 * Only `gh pr list` is ever run IN THIS FILE: a read. That is still true, and
 * it is now a statement about this module rather than about vam.
 *
 * THIS FILE USED TO SAY that opening a pull request in a browser "is a second
 * outbound capability and is deliberately not here". THE OPERATOR ASKED FOR IT
 * ON 2026-09-18, reviewing this tab: clicking a pull request should open it,
 * and there should be actions -- merge, delete branch. Both exist now, by
 * request, and both live NEXT DOOR rather than here, because the distinction
 * the old sentence was protecting is real and worth keeping visible:
 *
 *  - `../../pr/ipc.ts` opens one, through `shell.openExternal`, and what pays
 *    for that capability is `src/shared/pr-link.ts` -- https, on github.com,
 *    no credentials -- enforced in MAIN. This file runs the same check while
 *    parsing, so a row whose address vam would refuse carries `url: null` and
 *    draws no link at all rather than one that refuses under a finger.
 *  - `./pr-actions.ts` merges and deletes, never with `--admin` and never with
 *    `--auto`, one at a time, each behind a confirm that names the pull
 *    request.
 *
 * The date is recorded rather than the sentence deleted: a rule that was right
 * for as long as it held is worth being able to read afterwards, and "who
 * decided this, and when" is the question a future reader of a security bound
 * actually has.
 *
 * As in `deliver.ts`, argv construction, failure classification and parsing
 * are pure and separately testable, because the one thing that cannot be
 * tested is the spawn itself -- a test that ran it would reach GitHub from a
 * test run with whatever token the machine holds.
 */

import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import type {
  PullRequest,
  PullRequestChecks,
  PullRequestList,
} from '../../../renderer/domain/model.js';
import { checkPrLink } from '../../../shared/pr-link.js';
import { cliMissingMessage } from '../../env/cli-missing.js';

/**
 * How long `gh` gets. This is a single API query, not a model call, so it is
 * a fraction of `deliver.ts`'s budget -- and a timeout here is cheap, because
 * it becomes a visible `timed-out` state rather than a hang.
 */
const PR_TIMEOUT_MS = 10_000;

const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Injected in `readPullRequestsViaCli` so the directory check is testable
 *  without a filesystem. `statSync` rather than `existsSync`: a path that
 *  exists and is a FILE is not somewhere `gh` can be run either. */
const defaultExists = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Enough of what `gh` said to act on. */
const MAX_CLI_MESSAGE = 400;

/**
 * How many pull requests one branch may contribute. A branch usually has one;
 * a long-lived branch reused across several merges has a handful. The cap is
 * what stops a pathological branch from filling a narrow pane.
 */
const PR_LIMIT = 10;

/**
 * The fields the pane draws, and no others.
 *
 * EVERY NAME HERE WAS CHECKED AGAINST `gh pr list --help`'s own JSON FIELDS
 * list before it was written down, and that is not fussiness: an invented
 * field name is not ignored, it makes gh exit non-zero, so a single typo here
 * turns the whole pane into `gh-failed` for every session at once.
 *
 * THE LIST GREW ON THE OPERATOR'S REPORT (2026-09-18): "it does not show line
 * changes (+/-)" and "it needs more information". What was added, and what
 * each one is FOR -- a field nobody draws is a field nobody should be paying
 * an API for:
 *
 *  - `additions`/`deletions`/`changedFiles` -- the size of the thing, which is
 *    the first question anyone asks of a pull request they did not write.
 *  - `headRefName`/`baseRefName` -- WHERE it goes. A row reading `411 open`
 *    does not say whether it targets `main` or an integration branch, and on
 *    a stacked branch that is the difference between merged and merged into
 *    something that is itself unmerged.
 *  - `author` -- whose it is. An object; the login is inside it.
 *  - `reviewDecision` -- whether a human has said yes. The EMPTY STRING when
 *    nobody has; see `reviewOf`.
 *  - `labels` -- the repository's own vocabulary for this row.
 *  - `updatedAt` -- whether this is live or abandoned.
 *  - `url` -- so the row can be opened. See this file's header.
 *  - `mergeable` -- whether it would go in. `UNKNOWN` far more often than not.
 *
 * The cost is one GraphQL query with more fields in it, at the same rate:
 * `MIN_PR_READ_INTERVAL_MS` is untouched and is what governs the spend.
 */
const PR_FIELDS = [
  'number',
  'title',
  'state',
  'isDraft',
  'statusCheckRollup',
  'author',
  'additions',
  'deletions',
  'changedFiles',
  'headRefName',
  'baseRefName',
  'updatedAt',
  'url',
  'reviewDecision',
  'labels',
  'mergeable',
] as const;

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
  /** The directory `gh` was run in. Named in a message only when it is not
   *  the session's own -- see `overridden`. */
  cwd: string;
  /**
   * Did the operator point this project somewhere other than the session's
   * own directory?
   *
   * IT CHANGES THE SENTENCE, NOT THE CODE. "this session's working directory
   * is not a git repository" is true and short while vam stands where the
   * agent stands; the moment it stands somewhere the operator chose, that
   * sentence names the WRONG DIRECTORY and sends them to fix a repository
   * that was never the problem. And the inverse matters as much: quoting a
   * path at an operator who never chose one is noise in a sentence that was
   * already true.
   */
  overridden: boolean;
}): PullRequestList {
  const { failure, stderr, branch, cwd, overridden } = input;
  const said = clip(stderr);
  /** " in /path" when the operator chose the path, and nothing otherwise. */
  const where = overridden ? ` in ${cwd}` : '';

  if (failure.code === 'ENOENT') {
    return unavailable(
      'cli-missing',
      cliMissingMessage('gh', 'vam cannot ask GitHub about this branch'),
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
      overridden
        ? `${cwd} is not a git repository, so it has no pull requests — this project is pointed there rather than at the session's own directory`
        : "this session's working directory is not a git repository, so it has no pull requests",
    );
  }
  if (NO_REMOTE.test(stderr)) {
    return unavailable(
      'no-github-remote',
      overridden
        ? `the repository${where} has no GitHub remote vam can ask about — this project is pointed there rather than at the session's own directory`
        : 'this repository has no GitHub remote vam can ask about',
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

/**
 * THE TOLERANT HALF OF THE PARSER, and the reason it is a separate set of
 * functions from the strict half below.
 *
 * `parsePrList` fails the WHOLE list when a row has no number, title or known
 * state: those are the row's identity, and a silently shortened list is
 * indistinguishable from a true one. Nothing added for the operator's "it
 * needs more information" works that way. A pull request with no reviewer, no
 * labels and an unknown mergeability is an ORDINARY pull request, and
 * rejecting the answer because one adornment was missing would turn this
 * file's own rule -- not knowing is a state -- against the person reading it.
 *
 * So each of these answers `null` for every shape it does not positively
 * recognise, and `null` reaches the pane as "gh did not say" rather than as a
 * zero, a blank or a guess. The shapes they are written against were MEASURED
 * off `gh pr list --json` on a real repository, not reasoned about; the
 * measurements are recorded in `pull-requests-detail.test.ts`.
 */

/**
 * A count of lines or files: a finite, non-negative WHOLE number, or nothing.
 *
 * `0` is a real answer and must survive -- a pull request that only deletes
 * has `additions: 0` -- so this cannot be written as a truthiness test, which
 * is exactly how a zero would become "unknown".
 */
const countOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** A non-empty string, or nothing. An empty branch name is not a branch name. */
const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * The author's LOGIN, out of the object gh nests it in.
 *
 * MEASURED: `author` is `{ id, is_bot, login, name }`. `name` is the display
 * name and is not what anything is attributed to, so the login is what is
 * taken. A deleted account, a payload from an older gh, or an empty object all
 * arrive here and all answer `null`.
 */
const authorOf = (value: unknown): string | null =>
  typeof value === 'object' && value !== null
    ? textOf((value as Record<string, unknown>)['login'])
    : null;

/**
 * Label NAMES, in gh's own order.
 *
 * MEASURED: `labels` is a list of `{ id, name, description, color }`. An entry
 * with no usable name is dropped rather than drawn as a blank pill; a `labels`
 * that is not a list at all yields the empty list, because the caller must
 * never have to ask whether it may iterate.
 */
const labelsOf = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    const name =
      typeof entry === 'object' && entry !== null
        ? textOf((entry as Record<string, unknown>)['name'])
        : null;
    if (name !== null) names.push(name);
  }
  return names;
};

/**
 * gh's `reviewDecision`, in the three words `PullRequestReview` has.
 *
 * THE EMPTY STRING IS THE MEASUREMENT THAT MATTERS. On a repository with no
 * review rules gh answers `""` -- not `null`, not an absent key -- for every
 * row. It means "GitHub has no decision to report", and folding it onto
 * `review-required` would stamp "review required" across every pull request
 * the operator owns, which is a sentence about their repository that is not
 * true. Anything unrecognised answers `null` for the same reason
 * `summarizeChecks` reports an unknown conclusion as pending: a word this
 * function has never seen is not evidence of approval.
 */
const REVIEWS: Record<string, NonNullable<PullRequest['review']>> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  REVIEW_REQUIRED: 'review-required',
};
const reviewOf = (value: unknown): PullRequest['review'] =>
  (typeof value === 'string' ? REVIEWS[value] : undefined) ?? null;

/**
 * gh's `mergeable`, with `UNKNOWN` kept as not knowing.
 *
 * MEASURED: `UNKNOWN` is what most rows carry, INCLUDING ones that have
 * already merged, because GitHub computes mergeability lazily and nobody had
 * asked. Drawing that as `conflicting` would put a red word on a healthy
 * branch; drawing it as `mergeable` would promise a merge vam cannot know
 * about. It is neither, so it is `null` and the pane draws nothing.
 */
const MERGEABLE: Record<string, NonNullable<PullRequest['mergeable']>> = {
  MERGEABLE: 'mergeable',
  CONFLICTING: 'conflicting',
};
const mergeableOf = (value: unknown): PullRequest['mergeable'] =>
  (typeof value === 'string' ? MERGEABLE[value] : undefined) ?? null;

/**
 * The pull request's address, and ONLY when it is one vam would open.
 *
 * Checked HERE, at the read, as well as at the channel that opens it, so a row
 * vam would refuse draws no link at all rather than a link that refuses under
 * the operator's finger -- absent, not dimmed, this file's neighbours' rule.
 * `src/main/pr/ipc.ts` runs the same check on its own side of the process
 * boundary and that one is the guarantee; this one is a courtesy to the eye.
 */
const urlOf = (value: unknown): string | null => {
  const outcome = checkPrLink(value);
  return outcome.ok ? outcome.url : null;
};

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
      // Everything below is TOLERANT: see the helpers above. A row that
      // carries only the five fields this reader originally asked for parses
      // here with nulls, which is what keeps an older gh, a cached answer or
      // a future field rename from taking the whole list down with it.
      additions: countOf(pr['additions']),
      deletions: countOf(pr['deletions']),
      changedFiles: countOf(pr['changedFiles']),
      headRefName: textOf(pr['headRefName']),
      baseRefName: textOf(pr['baseRefName']),
      author: authorOf(pr['author']),
      review: reviewOf(pr['reviewDecision']),
      updatedAt: textOf(pr['updatedAt']),
      labels: labelsOf(pr['labels']),
      url: urlOf(pr['url']),
      mergeable: mergeableOf(pr['mergeable']),
    });
  }
  return { kind: 'ok', prs };
}

/** What actually asks GitHub. Injectable so the throttle can be tested without a spawn. */
export type ReadPrsFn = (input: {
  cwd: string;
  branch: string;
  /** Optional so every existing caller and fake still compiles, and FALSE by
   *  default because "the session's own directory" is what vam did before
   *  anyone could choose otherwise. */
  overridden?: boolean;
}) => Promise<PullRequestList>;

/**
 * Run `gh pr list`. Resolves to a `PullRequestList` and NEVER rejects: a
 * thrown error would reach the renderer as a generic load failure and take
 * the reason with it.
 */
export const readPullRequestsViaCli =
  (binary = 'gh', directoryExists: (path: string) => boolean = defaultExists): ReadPrsFn =>
  ({ cwd, branch, overridden = false }) => {
    /**
     * THE DIRECTORY, BEFORE THE SPAWN, and this is a correction rather than a
     * precaution.
     *
     * `execFile` reports `ENOENT` for TWO different things -- the binary is
     * not on the PATH, and the `cwd` does not exist -- and the classifier
     * above attributed all of it to a missing `gh`. While vam only ever stood
     * in a session's own directory that was safe: an agent is running there,
     * so it exists by construction. An override is a path the operator chose
     * once, and a checkout can be deleted, moved or renamed -- at which point
     * vam would tell them to install a `gh` they already have.
     *
     * Asking first gives that state its own sentence AND leaves `ENOENT`
     * meaning the one thing it can then mean. It also costs nothing per poll:
     * a directory that cannot work spawns no process at all.
     */
    if (!directoryExists(cwd)) {
      return Promise.resolve(
        unavailable(
          'repo-missing',
          overridden
            ? `${cwd} is not there any more — this project is pointed at it for pull requests, so choose another directory in settings or clear the override`
            : `${cwd} is not there any more, so vam has nowhere to ask GitHub from`,
        ),
      );
    }
    return new Promise((resolve) => {
      execFile(
        binary,
        prListArgv(branch),
        { cwd, timeout: PR_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (failure, stdout, stderr) => {
          resolve(
            failure
              ? classifyGhFailure({ failure, stderr: String(stderr), branch, cwd, overridden })
              : parsePrList(String(stdout)),
          );
        },
      );
    });
  };

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
  /** Did the operator point this project at `cwd`, rather than it being the
   *  session's own? Carried so a failure can name the directory. Optional and
   *  false by default, so every existing caller and fake still compiles. */
  overridden?: boolean;
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

  return async ({ cwd, branch, overridden = false }) => {
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
        list = await read({ cwd, branch, overridden });
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
