/**
 * The one place this feature spawns `git`. `execFile`, an argv ARRAY, never
 * a shell string -- the same bargain `pr-actions.ts` makes for `gh`, and for
 * the identical reason: a branch name or a path built from operator input
 * that ever reached a shell would be a command injection, not merely a bad
 * argument.
 */

import { execFile } from 'node:child_process';

export type GitCommandResult = {
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Runs one git subcommand in `cwd`. RESOLVES on a zero exit, REJECTS
 * otherwise -- the rejection is the raw `execFile` error (ENOENT for a
 * missing `git`, a timeout's `killed: true`, or git's own non-zero exit)
 * with `stderr` attached, exactly the shape `worktrees.ts`'s own
 * classifiers already know how to read off `pr-actions.ts`'s `SpawnFailure`.
 */
export type GitRun = (argv: readonly string[], cwd: string) => Promise<GitCommandResult>;

/** Long enough for `worktree add` on a large repository; short enough that a
 *  hung git does not hang the request that asked for it. */
export const GIT_TIMEOUT_MS = 30_000;

const MAX_OUTPUT_BYTES = 1024 * 1024;

export const runGitViaCli =
  (binary = 'git'): GitRun =>
  (argv, cwd) =>
    new Promise((resolve, reject) => {
      execFile(
        binary,
        [...argv],
        { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            reject(Object.assign(error, { stderr: String(stderr) }));
            return;
          }
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
