/**
 * A project's OWN git remotes, read as the Integrations repo picker's first
 * suggestions -- "include the project's own git remotes as the first
 * suggestions."
 *
 * READ-ONLY AND NOT A SECURITY BOUNDARY THE WAY `github-validate.ts` IS: this
 * runs `git remote -v` in a directory vam already resolved for a live
 * project (the same `resolveProjectDirectoryFrom` every other per-project
 * reader in this tree uses), and every value that comes back is only ever
 * DISPLAYED -- github.com only, matching `pr-link.ts`'s own https/github.com
 * rule, so a self-hosted remote is dropped rather than shown as if vam could
 * act on it.
 */

import { execFile } from 'node:child_process';

const TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** `git remote -v`'s own argv -- machine-parseable (one line per remote per
 *  direction) without needing `--get-regexp` and a second command shape. */
export function gitRemotesArgv(): readonly string[] {
  return ['remote', '-v'];
}

const OWNER_NAME = '([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)/([A-Za-z0-9._-]+?)';
const SSH_SCP = new RegExp(`^git@github\\.com:${OWNER_NAME}(?:\\.git)?/?$`);
const SSH_URL = new RegExp(`^ssh://(?:[^@/]+@)?github\\.com(?::\\d+)?/${OWNER_NAME}(?:\\.git)?/?$`);
const HTTPS_URL = new RegExp(`^https://(?:[^@/]+@)?github\\.com/${OWNER_NAME}(?:\\.git)?/?$`);

/**
 * A remote's URL, turned into `owner/name`, or `null` for anything that is
 * not a `github.com` remote -- a non-GitHub host, a self-hosted GitHub
 * Enterprise host, or a shape this has never seen. Credentials embedded in an
 * https URL (`https://x-access-token:TOKEN@github.com/...`) are matched and
 * discarded, never carried into the returned string.
 */
export function remoteUrlToRepo(url: string): string | null {
  const match = SSH_SCP.exec(url) ?? SSH_URL.exec(url) ?? HTTPS_URL.exec(url);
  if (match === null) return null;
  const owner = match[1];
  const name = match[2];
  return owner === undefined || name === undefined ? null : `${owner}/${name}`;
}

export type GitRemote = { readonly name: string; readonly repo: string };

const LINE = /^(\S+)\t(\S+)\s+\((fetch|push)\)$/;

/**
 * `git remote -v`'s stdout, into one entry per remote NAME (fetch and push
 * lines collapse into the one entry, since they are the identical remote to
 * the operator). `origin` sorts first when present -- the common default
 * remote, and the one the old directory-based picker always resolved from --
 * with every other remote kept in the order git printed them.
 *
 * A remote that is not `github.com` is dropped rather than shown: this picker
 * only ever offers a repository vam could actually read pull requests from.
 */
export function parseGitRemotes(stdout: string): readonly GitRemote[] {
  const seen = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match === null) continue;
    const name = match[1];
    const url = match[2];
    if (name === undefined || url === undefined || seen.has(name)) continue;
    const repo = remoteUrlToRepo(url);
    if (repo !== null) seen.set(name, repo);
  }
  const entries = [...seen.entries()].map(([name, repo]) => ({ name, repo }));
  entries.sort((a, b) => (a.name === 'origin' ? -1 : b.name === 'origin' ? 1 : 0));
  return entries;
}

/** Injected so the parser above is testable without a spawn. */
export type GitRemotesRun = (
  cwd: string,
) => Promise<{ readonly failure: unknown; readonly stdout: string }>;

/** Read one directory's own GitHub remotes. Never rejects: a directory that
 *  is not a repository, or has none, answers the empty list -- the same
 *  "not knowing is never drawn as a hard failure" the rest of this picker
 *  follows for a purely informational, non-acting read. */
export function readProjectRemotes(binary = 'git') {
  return (cwd: string): Promise<readonly GitRemote[]> =>
    new Promise((resolve) => {
      execFile(
        binary,
        [...gitRemotesArgv()],
        { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (failure, stdout) => {
          resolve(failure !== null ? [] : parseGitRemotes(String(stdout)));
        },
      );
    });
}
