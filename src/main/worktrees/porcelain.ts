/**
 * `git worktree list --porcelain -z` (and the plain, non-`-z` porcelain a
 * pre-2.36 git answers with instead) turned into structured records.
 *
 * BOTH SHAPES ARE ONE ALGORITHM. Git's own porcelain format is a sequence of
 * `key[ value]` lines, one worktree per block, blocks separated by an EMPTY
 * line -- in `-z` mode "line" means "NUL-terminated field" and the block
 * separator is an extra, empty NUL-terminated field; in plain mode it is an
 * ordinary blank text line. Splitting on the caller-given separator and
 * treating an empty token as "end of record" reads both identically, so
 * there is exactly one parser and exactly one thing to keep correct as git's
 * own format grows new attributes -- `worktrees.ts` decides which separator
 * ran, this module does not care.
 *
 * AN UNRECOGNISED ATTRIBUTE IS IGNORED, NOT FATAL. Git has added fields to
 * this format before and will again; a parser that threw on the first
 * unknown key would take vam's whole worktrees feature down the next time
 * git does. Every field this module does not name is simply skipped, and the
 * record it belongs to still parses.
 */

export type WorktreeListEntry = {
  readonly path: string;
  /** The `HEAD` commit's sha, or `null` for a bare repository's own entry,
   *  which carries none. */
  readonly headSha: string | null;
  /** `refs/heads/<name>`, verbatim -- `null` for a bare entry or a detached
   *  `HEAD`, neither of which names a branch. */
  readonly branchRef: string | null;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly lockedReason: string | null;
  readonly prunable: boolean;
  readonly prunableReason: string | null;
};

function emptyEntry(): {
  path: string;
  headSha: string | null;
  branchRef: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockedReason: string | null;
  prunable: boolean;
  prunableReason: string | null;
} {
  return {
    path: '',
    headSha: null,
    branchRef: null,
    bare: false,
    detached: false,
    locked: false,
    lockedReason: null,
    prunable: false,
    prunableReason: null,
  };
}

/** One record's worth of `key[ value]` lines, already split from the
 *  enclosing block by `parseWorktreeListPorcelain`. */
function parseRecord(lines: readonly string[]): WorktreeListEntry {
  const entry = emptyEntry();
  for (const line of lines) {
    const spaceAt = line.indexOf(' ');
    const key = spaceAt === -1 ? line : line.slice(0, spaceAt);
    const value = spaceAt === -1 ? '' : line.slice(spaceAt + 1);
    switch (key) {
      case 'worktree':
        entry.path = value;
        break;
      case 'HEAD':
        entry.headSha = value;
        break;
      case 'branch':
        entry.branchRef = value;
        break;
      case 'bare':
        entry.bare = true;
        break;
      case 'detached':
        entry.detached = true;
        break;
      case 'locked':
        entry.locked = true;
        entry.lockedReason = value === '' ? null : value;
        break;
      case 'prunable':
        entry.prunable = true;
        entry.prunableReason = value === '' ? null : value;
        break;
      default:
        // Forward-compatible: a field git adds tomorrow is silently kept
        // out of the record rather than failing the whole parse.
        break;
    }
  }
  return entry;
}

/**
 * `separator` is `'\0'` for `git worktree list --porcelain -z` (the normal
 * case -- NUL-safe against a path containing a newline) and `'\n'` for the
 * plain `--porcelain` fallback `worktrees.ts` uses only when `-z` itself is
 * refused as an unknown flag by a git older than 2.36.
 *
 * A RECORD WITH NO `worktree` LINE AT ALL (malformed input, or a git version
 * whose block shape does not match what is assumed here) is dropped rather
 * than returned with an empty `path` -- an empty path joined onto anything
 * downstream is not "no worktree", it is every worktree at once.
 */
export function parseWorktreeListPorcelain(
  output: string,
  separator: '\0' | '\n',
): readonly WorktreeListEntry[] {
  const tokens = output.split(separator);
  const entries: WorktreeListEntry[] = [];
  let current: string[] = [];
  for (const token of tokens) {
    if (token === '') {
      if (current.length > 0) {
        entries.push(parseRecord(current));
        current = [];
      }
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) {
    entries.push(parseRecord(current));
  }
  return entries.filter((entry) => entry.path !== '');
}
