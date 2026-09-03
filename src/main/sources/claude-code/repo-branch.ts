/**
 * What branch a session's `cwd` is on, read straight off `.git/HEAD` rather
 * than by spawning `git`. `load()` is already 213-419 ms for five sessions;
 * a subprocess per session would make this the most expensive step in it.
 *
 * Three real shapes of `.git`, all handled:
 *
 *  - a DIRECTORY, the ordinary case -- `HEAD` lives right inside it.
 *  - a FILE containing `gitdir: <path>` -- how a git WORKTREE lays out a
 *    checkout (vam itself is developed this way). `HEAD` lives at that path.
 *  - absent at `cwd` itself -- `cwd` may be a subdirectory of the repo, so
 *    the walk climbs toward the filesystem root, bounded so it cannot loop.
 *
 * `HEAD` itself is either `ref: refs/heads/<name>` (an ordinary branch --
 * the name may contain slashes, so it is never split, only the prefix is
 * stripped) or a raw sha (a DETACHED HEAD), rendered as a 7-char short sha
 * rather than shown as nothing.
 *
 * Never throws: an unreadable or malformed anything means "cannot say",
 * `null`, not a crash that would take the whole session list down with it.
 *
 * The filesystem is injected (`BranchFs`) so tests never touch a real
 * directory on the machine running them.
 */

import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

/** Bounds the upward walk so a filesystem loop (real or fabricated) cannot hang it. */
const MAX_WALK_DEPTH = 64;

export type BranchFs = {
  /** `null` when nothing exists at `path`; never throws. */
  readonly statType: (path: string) => Promise<'dir' | 'file' | null>;
  readonly readFile: (path: string) => Promise<string>;
};

/** The real filesystem, `node:fs/promises` wearing the injectable shape above. */
const nodeBranchFs: BranchFs = {
  statType: async (path) => {
    try {
      const info = await stat(path);
      return info.isDirectory() ? 'dir' : 'file';
    } catch {
      return null;
    }
  },
  readFile: (path) => readFile(path, 'utf8'),
};

const REF_PREFIX = 'ref: refs/heads/';
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const SHORT_SHA_LENGTH = 7;

/** `HEAD`'s content, either form, into what the sidebar shows. `null` if neither parses. */
function parseHead(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.startsWith(REF_PREFIX)) {
    const name = trimmed.slice(REF_PREFIX.length).trim();
    return name === '' ? null : name;
  }
  return SHA_PATTERN.test(trimmed) ? trimmed.slice(0, SHORT_SHA_LENGTH) : null;
}

/** The `<path>` half of a `gitdir: <path>` line, resolved against the `.git` file's directory. */
function gitdirOf(content: string, gitFileDir: string): string | null {
  const line = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('gitdir:'));
  if (line === undefined) return null;
  const target = line.slice('gitdir:'.length).trim();
  return target === '' ? null : isAbsolute(target) ? target : join(gitFileDir, target);
}

/** Walk from `startDir` up to the filesystem root, returning the path to the right `HEAD`. */
async function findHeadPath(startDir: string, fs: BranchFs): Promise<string | null> {
  let dir = startDir;
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const gitPath = join(dir, '.git');
    const type = await fs.statType(gitPath);
    if (type === 'dir') return join(gitPath, 'HEAD');
    if (type === 'file') {
      let content: string;
      try {
        content = await fs.readFile(gitPath);
      } catch {
        return null;
      }
      const gitdir = gitdirOf(content, dir);
      return gitdir === null ? null : join(gitdir, 'HEAD');
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // reached the filesystem root
    dir = parent;
  }
  return null;
}

async function resolveBranch(cwd: string, fs: BranchFs): Promise<string | null> {
  const headPath = await findHeadPath(cwd, fs);
  if (headPath === null) return null;
  try {
    return parseHead(await fs.readFile(headPath));
  } catch {
    return null;
  }
}

/**
 * A lookup function, cached for the lifetime of the object it returns -- one
 * `load()` worth of sessions, per the module's contract. Five sessions here
 * share three directories, so the second and later calls for the same `cwd`
 * cost nothing.
 */
export function createBranchLookup(
  fs: BranchFs = nodeBranchFs,
): (cwd: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  return (cwd: string) => {
    let result = cache.get(cwd);
    if (result === undefined) {
      result = resolveBranch(cwd, fs).catch(() => null);
      cache.set(cwd, result);
    }
    return result;
  };
}
