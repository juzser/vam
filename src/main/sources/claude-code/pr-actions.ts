/**
 * THE TWO THINGS VAM WILL DO *TO* A PULL REQUEST, as opposed to learn about
 * one.
 *
 * `pull-requests.ts` next door is a READ, and its header says so twice: only
 * `gh pr list` is ever run. This file is the other half the operator asked for
 * on 2026-09-18 -- "there are no actions yet (merge, delete branch, ...)" --
 * and it is a different kind of thing in every way that matters. A read that
 * goes wrong shows the wrong list for sixty seconds. A write that goes wrong
 * merges somebody's branch into main, or deletes a ref, with the operator's
 * own credentials, and nothing in vam can put it back.
 *
 * So the whole file is bounds, and they are worth naming:
 *
 * 1. NOTHING IS FORCED, EVER. `--admin` is the operator's own branch
 *    protection being overridden by a button in a side panel, and it is never
 *    passed. Neither is `--auto`, which is worse in a quieter way: it reports
 *    success now and merges later, unattended. `prMergeArgv` is asserted
 *    against both by name.
 * 2. EVERY ARGUMENT IS VALIDATED IN MAIN, BEFORE A PROCESS EXISTS. The
 *    renderer chooses the number and the branch, and the renderer is the least
 *    trusted process in this app (`src/shared/link.ts`'s rule). A branch name
 *    is not a label here -- it goes into an API PATH -- and `..` inside one
 *    addresses a ref in a DIFFERENT REPOSITORY. See `checkBranchName`.
 * 3. THE CWD DECIDES WHICH REPOSITORY IS ACTED ON. No `--repo`, exactly as the
 *    reader refuses one: a name composed on this side would let a pane act on
 *    a repository the session is not in.
 * 4. ONE AT A TIME, AND THE SECOND CLICK IS REFUSED ALOUD. See
 *    `createPrActionRunner`. This is the reader's throttle discipline turned
 *    into the shape a one-shot needs: not an interval -- an operator may
 *    legitimately merge two pull requests a second apart -- but a hard bar on
 *    a second write while one is in flight.
 * 5. A FAILURE SPEAKS GH'S OWN WORDS. "Pull request is not mergeable: the base
 *    branch policy prohibits the merge" is actionable; "the merge failed" is
 *    not. `classifyPrActionFailure` quotes stderr and only falls back to a
 *    house sentence when gh said nothing at all.
 *
 * As in `pull-requests.ts` and `deliver.ts`: argv construction, validation and
 * failure classification are pure and separately testable, because the one
 * thing that cannot be tested is the spawn -- a test that ran it would merge a
 * real pull request from a test run.
 */

import { execFile } from 'node:child_process';
import {
  MERGE_METHODS,
  type MergeMethod,
  type PrAction,
  type PrActionOutcome,
} from '../../../shared/pr-action.js';
import { cliMissingMessage } from '../../env/cli-missing.js';

/**
 * How long a write gets. Longer than the reader's ten seconds: a merge is a
 * mutation GitHub may queue behind checks, and a timeout here is not free the
 * way a timeout on a poll is -- the merge may well have HAPPENED. The message
 * for a kill says exactly that rather than claiming it did not.
 */
const PR_ACTION_TIMEOUT_MS = 30_000;

const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Enough of what `gh` said to act on -- the reader's number, for its reason. */
const MAX_CLI_MESSAGE = 400;

/**
 * THE VOCABULARY IS SHARED, THE MACHINERY IS NOT. `MERGE_METHODS`, `PrAction`
 * and `PrActionOutcome` live in `src/shared/pr-action.ts` because the renderer
 * has to name an action and draw its outcome, and two copies of that
 * vocabulary is a pair that can drift. Everything in THIS file -- the argv,
 * the validation, the spawn, the in-flight guard -- stays on main's side,
 * because the renderer is this app's least trusted process and a check it
 * could reach is a check it could skip.
 *
 * Re-exported so a caller that already knows this module does not have to
 * learn a second import path for the same three names.
 */
export {
  MERGE_METHODS,
  type MergeMethod,
  type PrAction,
  type PrActionOutcome,
} from '../../../shared/pr-action.js';

/** What a validation answers: the value to use, or the sentence to draw. */
export type Checked<T> = { readonly ok: true } & T;
export type Refused = { readonly ok: false; readonly reason: string };

/**
 * A pull request NUMBER, validated on main's side of the boundary.
 *
 * It is stringified into argv, so a float would become `"1.5"` and a huge one
 * `"1e+21"` -- both of which gh would answer about some pull request or other.
 * Only a positive safe integer is a pull request number.
 */
export function checkPrNumber(raw: unknown): Checked<{ number: number }> | Refused {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    return { ok: false, reason: 'that is not a pull request number vam can act on.' };
  }
  return { ok: true, number: raw };
}

/**
 * The longest ref name vam will act on. Git itself has no hard limit but the
 * filesystem does; 300 is far past every real branch and far below anything
 * that could be used to push a path somewhere interesting.
 */
const MAX_BRANCH_LENGTH = 300;

/**
 * What a branch name may contain. A deliberately SMALL allowlist rather than a
 * list of forbidden characters, because the interesting inputs are the ones
 * nobody thought of.
 */
const BRANCH_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * A BRANCH NAME, validated on main's side -- and this is the security check in
 * this file, not a tidiness one.
 *
 * `prDeleteBranchArgv` puts this string into `repos/{owner}/{repo}/git/refs/
 * heads/<branch>`, which is an HTTP PATH. `..` inside it is resolved by the
 * HTTP client, not by gh, so a branch called
 * `../../../../repos/someone/else/git/refs/heads/main` deletes a ref in a
 * DIFFERENT REPOSITORY, under the operator's credentials, from a button that
 * said "delete this branch". `execFile` protects against a SHELL; it protects
 * against nothing whatsoever about a callee that treats its argument as a
 * path. That distinction has cost this project a finding before.
 *
 * The rules, and each one is a real shape:
 *  - must START with a letter or digit, so nothing can be read as a flag
 *    (`-d`, `--method`) if it ever reaches a position where gh parses options;
 *  - no `..` anywhere, which git forbids in a ref anyway;
 *  - no whitespace, no control characters, no `%` (an encoded slash is still a
 *    slash by the time the server sees it);
 *  - no leading or trailing `/`.
 */
export function checkBranchName(raw: unknown): Checked<{ branch: string }> | Refused {
  if (typeof raw !== 'string' || raw === '') {
    return { ok: false, reason: 'vam was given no branch name to delete.' };
  }
  if (raw.length > MAX_BRANCH_LENGTH) {
    return {
      ok: false,
      reason: `that branch name is ${raw.length} characters; vam acts on names up to ${MAX_BRANCH_LENGTH}.`,
    };
  }
  if (!BRANCH_SHAPE.test(raw) || raw.includes('..') || raw.endsWith('/')) {
    return {
      ok: false,
      reason: `"${raw.slice(0, 60)}" is not a branch name vam will act on.`,
    };
  }
  return { ok: true, branch: raw };
}

/**
 * The exact argv for a merge.
 *
 * The number is ONE element and is stringified, never interpolated into a
 * sentence: `execFile` runs no shell, so it has no meaning beyond being an
 * argument. EXACTLY ONE strategy flag is always present -- see `MERGE_METHODS`
 * for why the absence of one is a hang and not a default.
 *
 * What is deliberately absent: `--admin` (overrides branch protection),
 * `--auto` (succeeds now, merges later, unattended), `--delete-branch` (the
 * operator's separate, separately confirmed decision) and `--repo` (the
 * working directory decides which repository, as it does for every read).
 */
export function prMergeArgv(number: number, method: MergeMethod): readonly string[] {
  return ['pr', 'merge', String(number), `--${method}`];
}

/**
 * The exact argv for deleting the head branch.
 *
 * MEASURED, against `gh pr --help` on this machine (gh 2.95.0): THERE IS NO
 * `gh pr delete-branch`. The only delete-branch gh has is a FLAG on
 * `gh pr merge`, which is precisely the thing this action is not -- the
 * operator asked for two actions, and folding one into the other would mean a
 * branch could only be deleted by merging.
 *
 * So the ref is deleted through the REST API, and `{owner}`/`{repo}` are gh's
 * own placeholders (documented in `gh api --help`): gh fills them from the
 * repository of the working directory. That is not a convenience -- it is what
 * keeps the reader's rule intact here, that the cwd decides which repository
 * is acted on and vam never composes a repository name of its own.
 *
 * The branch must have passed `checkBranchName` before it reaches this
 * function. It is not re-checked here because a pure argv builder that
 * silently produced a different path for a bad input would be the harder
 * failure to see; the caller refuses, and the refusal is a sentence.
 */
export function prDeleteBranchArgv(branch: string): readonly string[] {
  return ['api', '--method', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${branch}`];
}

const clip = (text: string): string =>
  text.trim().length > MAX_CLI_MESSAGE
    ? `${text.trim().slice(0, MAX_CLI_MESSAGE)}...`
    : text.trim();

/** What a failed `execFile` hands back. The reader's shape, for its reason. */
export type SpawnFailure = {
  readonly message: string;
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
};

/**
 * Turn a failed write into an honest sentence, keeping gh's own words.
 *
 * `failure.message` is NEVER used: node builds it as `Command failed: <file>
 * <args joined>`, which republishes the whole command line into a message the
 * operator may paste into a public issue. `deliver.ts` was filed about exactly
 * that, with a prompt in the argv.
 *
 * `what` is the act in the operator's terms -- "merge 411", "delete branch
 * feature/x" -- so a message is a sentence about the thing they pressed rather
 * than about a process. (Written without the number sign: the repo's 13.1
 * guard reads `#` followed by three hex digits as a literal colour.)
 */
export function classifyPrActionFailure(input: {
  failure: SpawnFailure;
  stderr: string;
  what: string;
}): PrActionOutcome {
  const { failure, stderr, what } = input;
  const said = clip(stderr);

  if (failure.code === 'ENOENT') {
    return {
      ok: false,
      code: 'cli-missing',
      message: cliMissingMessage('gh', `vam cannot ${what}`),
    };
  }
  if (failure.killed === true) {
    return {
      ok: false,
      code: 'timed-out',
      // NOT "it did not happen". A killed merge may well have merged: the
      // process was stopped, GitHub was not. Saying otherwise would be the
      // most expensive false statement this file could make.
      message: `${what} did not answer within ${Math.round(PR_ACTION_TIMEOUT_MS / 1000)}s — vam does not know whether it went through; check GitHub before trying again`,
    };
  }
  return {
    ok: false,
    code: 'gh-failed',
    message:
      said === '' ? `${what} failed, and gh said nothing about why` : `${what} failed: ${said}`,
  };
}

/** What actually runs gh. Injectable so the in-flight guard can be tested without a spawn. */
export type RunPrActionFn = (input: { cwd: string; action: PrAction }) => Promise<PrActionOutcome>;

/**
 * Run one action. Resolves to a `PrActionOutcome` and NEVER rejects, for the
 * reason the type carries.
 *
 * The validation happens HERE, not at the channel, so that every route into
 * this function -- including a future one -- passes it.
 */
export const runPrActionViaCli =
  (binary = 'gh'): RunPrActionFn =>
  ({ cwd, action }) => {
    let argv: readonly string[];
    let what: string;
    if (action.kind === 'merge') {
      const number = checkPrNumber(action.number);
      if (!number.ok) {
        return Promise.resolve({ ok: false, code: 'bad-request', message: number.reason });
      }
      if (!(MERGE_METHODS as readonly string[]).includes(action.method)) {
        return Promise.resolve({
          ok: false,
          code: 'bad-request',
          message: 'vam does not know that way of merging.',
        });
      }
      argv = prMergeArgv(number.number, action.method);
      what = `merge #${number.number}`;
    } else {
      const branch = checkBranchName(action.branch);
      if (!branch.ok) {
        return Promise.resolve({ ok: false, code: 'bad-request', message: branch.reason });
      }
      argv = prDeleteBranchArgv(branch.branch);
      what = `delete branch ${branch.branch}`;
    }
    return new Promise((resolve) => {
      execFile(
        binary,
        argv,
        { cwd, timeout: PR_ACTION_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (failure, stdout, stderr) => {
          if (failure) {
            resolve(classifyPrActionFailure({ failure, stderr: String(stderr), what }));
            return;
          }
          // GH'S OWN WORDS ON SUCCESS TOO, when it had any: `gh pr merge`
          // prints "Squashed and merged pull request 411", which names what
          // actually happened better than vam can. `gh api DELETE` prints
          // nothing at all, and then the house sentence is the whole answer.
          const said = clip(`${String(stdout)}\n${String(stderr)}`);
          resolve({ ok: true, message: said === '' ? `${what}: done.` : said });
        },
      );
    });
  };

/** A refusal shaped like an outcome, so one branch draws both. */
const refuse = (code: string, message: string): PrActionOutcome => ({ ok: false, code, message });

/**
 * ONE WRITE IN FLIGHT AT A TIME, AND THE SECOND ONE IS TOLD SO.
 *
 * This is the reader's throttle discipline in the shape a one-shot needs. The
 * reader's problem was a poll spawning a process every ten seconds forever; an
 * action has no poll, so an interval would be the wrong instrument -- an
 * operator may legitimately merge two pull requests a second apart, and a
 * minimum gap would refuse the second one for no reason anybody could see.
 *
 * What an action CAN do, and a poll cannot, is run twice. A button that is
 * slow -- and a merge is slow, it waits on GitHub -- gets clicked again, and
 * two `gh pr merge 411` processes racing means two answers, one of which is
 * "already merged" reported as a failure over a merge that worked. So the
 * guard is a bar, not a gap: while one write is running the next is REFUSED,
 * with a sentence, and nothing is spawned.
 *
 * ACROSS THE WHOLE APP, not per pull request or per repository. Two different
 * merges in flight at once is exactly the state in which an operator cannot
 * tell which of them an error belonged to.
 *
 * THE LOCK IS RELEASED ON EVERY PATH -- success, failure and throw. A guard
 * that only released on success would let one failed merge silently disable
 * every action for the rest of the session, which is a worse bug than the one
 * it was put in to prevent and a quieter one.
 */
export function createPrActionRunner(run: RunPrActionFn): RunPrActionFn {
  let inFlight = false;

  return async ({ cwd, action }) => {
    if (inFlight) {
      return refuse(
        'busy',
        'vam is already running a pull request action — wait for it to finish, then try again.',
      );
    }
    inFlight = true;
    try {
      return await run({ cwd, action });
    } catch (error) {
      // `runPrActionViaCli` turns every ordinary failure into a value, so a
      // throw here is something neither it nor this guard foresaw.
      return refuse(
        'gh-failed',
        `that action failed: ${error instanceof Error ? clip(error.message) : 'unknown error'}`,
      );
    } finally {
      inFlight = false;
    }
  };
}
