/**
 * Which names in one directory git ignores: ONE `git check-ignore --stdin -z`
 * per listing, names on stdin only, no `--no-index` (a tracked file is never
 * ignored). Any failure yields an empty set and never fails the listing.
 */

import { execFile } from 'node:child_process';

/** Runs git with `args` in `cwd`, feeding `input` on stdin; resolves stdout, rejects on any failure. */
export type GitIgnoreRunner = (
  cwd: string,
  args: readonly string[],
  input: string,
) => Promise<string>;

const TIMEOUT_MS = 3_000;
const MAX_BUFFER = 1024 * 1024;

const defaultRunner: GitIgnoreRunner = (cwd, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [...args],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });

/** The subset of `names` git ignores in `cwd`; empty on any failure. */
export async function gitIgnoredNames(
  cwd: string,
  names: readonly string[],
  run: GitIgnoreRunner = defaultRunner,
): Promise<ReadonlySet<string>> {
  if (names.length === 0) return new Set();
  try {
    const out = await run(cwd, ['check-ignore', '--stdin', '-z'], `${names.join('\0')}\0`);
    return new Set(out.split('\0').filter((name) => name !== ''));
  } catch {
    return new Set();
  }
}
