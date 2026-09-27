/**
 * Candidate repositories for the Integrations picker: `gh repo list <owner>`,
 * for the viewer's own login and for each organisation `gh api user/orgs`
 * names.
 *
 * THE OWNER IS THE LEAST TRUSTED STRING THIS MODULE EVER SEES -- it is typed
 * into a search box -- so `reposListArgv` refuses to build argv for anything
 * `checkOwnerName` refuses, and what it DOES build puts `--` ahead of the
 * owner: MEASURED against a real gh 2.95.0, `gh repo list -- --evil` answers
 * `the owner handle "--evil" was not recognized...` rather than reading
 * `--evil` as a flag. `execFile` runs no shell either way, but `--` is what
 * stops `gh`'s OWN flag parser from doing the same misreading `execFile`
 * cannot prevent -- `pr-actions.ts`'s own rule about a callee, not a shell.
 *
 * As elsewhere in this tree: argv construction, failure classification and
 * parsing are pure and separately testable; the spawn is not.
 */

import { execFile } from 'node:child_process';
import { checkOwnerName } from './github-validate.js';

/** How many repositories one owner may contribute to the picker. Far more
 *  than a search box shows at once; the box itself narrows by substring. */
export const REPOS_PAGE_LIMIT = 50;

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_CLI_MESSAGE = 400;

const clip = (text: string): string =>
  text.trim().length > MAX_CLI_MESSAGE
    ? `${text.trim().slice(0, MAX_CLI_MESSAGE)}...`
    : text.trim();

/**
 * The exact argv for listing one owner's repositories, capped and asking for
 * exactly the one field the picker draws.
 *
 * THROWS for an owner `checkOwnerName` refuses. A pure argv builder that
 * silently built a different command for a bad input would be the harder
 * failure to see -- exactly `pr-actions.ts`'s own note on `prDeleteBranchArgv`
 * -- so every caller MUST check the owner first; `readGithubRepos` below does.
 */
export function reposListArgv(owner: string): readonly string[] {
  const checked = checkOwnerName(owner);
  if (!checked.ok) throw new Error(checked.reason);
  return [
    'repo',
    'list',
    '--json',
    'nameWithOwner',
    '--limit',
    String(REPOS_PAGE_LIMIT),
    '--',
    checked.owner,
  ];
}

/** The viewer's own organisations, one login per line. */
export function orgsListArgv(): readonly string[] {
  return ['api', 'user/orgs', '--jq', '.[].login'];
}

export type GithubReposList =
  | { readonly kind: 'ok'; readonly repos: readonly string[] }
  | { readonly kind: 'bad-response'; readonly message: string };

/**
 * `gh repo list --json nameWithOwner`'s body.
 *
 * STRICT ON PURPOSE, exactly `pull-requests.ts`'s `parsePrList` rule: a single
 * field was asked for and it IS the row's whole identity, so a row missing it
 * fails the WHOLE list as `bad-response` rather than being silently dropped --
 * a silently shortened candidate list is indistinguishable from a true one,
 * and this is a picker an operator is about to act on, not a report they can
 * shrug off.
 */
export function parseReposList(stdout: string): GithubReposList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: 'bad-response', message: 'gh answered with something that was not JSON' };
  }
  if (!Array.isArray(parsed)) {
    return {
      kind: 'bad-response',
      message: 'gh answered with something that was not a list of repositories',
    };
  }
  const repos: string[] = [];
  for (const row of parsed) {
    const name = (row as Record<string, unknown> | null)?.['nameWithOwner'];
    if (typeof name !== 'string' || name === '') {
      return {
        kind: 'bad-response',
        message: 'gh listed a repository in a shape vam does not understand',
      };
    }
    repos.push(name);
  }
  return { kind: 'ok', repos };
}

/** `gh api user/orgs --jq '.[].login'`'s body: one login per line, gh's own
 *  `--jq` output shape rather than a JSON array. */
export function parseOrgsList(stdout: string): readonly string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export type GithubReposError = { readonly code: string; readonly message: string };

const NOT_AUTHENTICATED =
  /gh auth login|not logged in|authentication token|requires authentication/i;
const OWNER_NOT_FOUND = /was not recognized as either a github user or an organization/i;

/** What a failed `execFile` hands back -- the shape every reader here shares. */
export type SpawnFailure = {
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
};

/**
 * Turn a failed `gh repo list`/`gh api user/orgs` into a distinct, honest
 * reason. `owner` is carried only so `owner-not-found` can name it -- it is
 * never placed back into a message that reaches argv anywhere else.
 */
export function classifyGithubReposFailure(
  failure: SpawnFailure,
  stderr: string,
  owner: string,
): GithubReposError {
  const said = clip(stderr);
  if (failure.code === 'ENOENT') {
    return { code: 'cli-missing', message: 'the `gh` command was not found on PATH.' };
  }
  if (OWNER_NOT_FOUND.test(stderr)) {
    return {
      code: 'owner-not-found',
      message: `"${owner}" is not a GitHub user or organisation vam can see.`,
    };
  }
  if (NOT_AUTHENTICATED.test(stderr)) {
    return { code: 'not-authenticated', message: '`gh` is installed but not authenticated.' };
  }
  return {
    code: 'gh-failed',
    message: said === '' ? 'gh failed and said nothing about why' : said,
  };
}

export type ReadReposFn = (
  owner: string,
) => Promise<GithubReposList | { kind: 'error'; error: GithubReposError }>;

/** Injected so the shape above is testable without a spawn. */
export type GithubReposRun = (argv: readonly string[]) => Promise<{
  readonly failure: SpawnFailure | null;
  readonly stdout: string;
  readonly stderr: string;
}>;

/** Read one owner's repositories. Never rejects. */
export function readGithubRepos(run: GithubReposRun): ReadReposFn {
  return async (owner) => {
    const checked = checkOwnerName(owner);
    if (!checked.ok) {
      return { kind: 'error', error: { code: 'bad-owner', message: checked.reason } };
    }
    const { failure, stdout, stderr } = await run(reposListArgv(checked.owner));
    if (failure !== null) {
      return { kind: 'error', error: classifyGithubReposFailure(failure, stderr, checked.owner) };
    }
    return parseReposList(stdout);
  };
}

export type GithubOrgsResult =
  | { readonly kind: 'ok'; readonly orgs: readonly string[] }
  | { readonly kind: 'error'; readonly error: GithubReposError };

/**
 * Read the viewer's own organisations. The viewer's own LOGIN is not read
 * here at all -- `readGithubAuthStatus`'s active account already carries it,
 * and a second `gh api user` spawn for the same fact would be a network round
 * trip this picker does not need.
 */
export function readGithubOrgs(run: GithubReposRun): () => Promise<GithubOrgsResult> {
  return async () => {
    const { failure, stdout, stderr } = await run(orgsListArgv());
    if (failure !== null) {
      return { kind: 'error', error: classifyGithubReposFailure(failure, stderr, '') };
    }
    return { kind: 'ok', orgs: parseOrgsList(stdout) };
  };
}

/** The real runner, `execFile`-backed like every other reader in this tree. */
export function createGithubReposRun(binary = 'gh'): GithubReposRun {
  return (argv) =>
    new Promise((resolve) => {
      execFile(
        binary,
        [...argv],
        { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (failure, stdout, stderr) => {
          resolve({ failure, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}
