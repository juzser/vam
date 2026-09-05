/**
 * Is the directory the operator just chose a REPOSITORY? Pure filesystem, no
 * `git` process, and no opinion about anything else.
 *
 * WHY THIS EXISTS. "New project" opens Electron's `showOpenDialog` with
 * `openDirectory`, and that dialog cannot express "only repositories" -- it
 * offers directories, all of them, and hands back whichever one was clicked.
 * So the narrowing the operator asked for can only be a check on the path
 * afterwards, in main, where the answer is trustworthy.
 *
 * WHAT WAS CHOSEN, AND WHY, because the next reader will want the alternative
 * named. Two narrowings were possible: VALIDATE the chosen directory, or LIST
 * the repositories vam already knows. Validation is what this implements, and
 * listing is deliberately not built: vam stores no projects -- a project is a
 * grouping of LIVE sessions on their cwd (`Canvas.tsx`) -- so the only list vam
 * could offer is the directories it already has sessions in, which is exactly
 * the set for which "new project" is the wrong control. A list would therefore
 * be either empty or a slower way to reach a project that already exists,
 * while the operator's actual case -- a repository vam has never seen -- is
 * only reachable through the picker. One narrowing, applied where the truth is.
 *
 * A DIRECTORY INSIDE A WORK TREE COUNTS. Choosing `repo/packages/app` is a
 * thing operators do on purpose -- an agent scoped to one package -- and it is
 * still "in a repo" by any reading. So the search walks UP, and the session
 * starts in the directory that was actually chosen rather than in a root
 * nobody picked. Only a path with no `.git` anywhere above it is refused.
 *
 * `.git` MAY BE A FILE. A linked worktree (`git worktree add`) carries a
 * `.git` FILE holding a `gitdir:` line, not a directory, and refusing those
 * would refuse precisely the layout an agent-per-branch operator works in. So
 * this asks whether the entry EXISTS, not what kind it is -- and it does not
 * read it: parsing a `gitdir:` pointer to prove the target is real would be a
 * second failure mode for no gain, since a broken worktree fails at spawn with
 * git's own words rather than vam's guess.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SourceError } from '../ipc/channels.js';

/**
 * The work tree root the directory belongs to, or `null` for a path with no
 * repository above it. The chosen directory itself is the first candidate.
 */
export function repoRootOf(directory: string): string | null {
  let current = resolve(directory);
  // Terminates at the filesystem root, where `dirname` is a fixed point -- the
  // one loop condition that holds on every platform without a path count.
  for (;;) {
    if (existsSync(resolve(current, '.git'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * The refusal, in words, or `null` when there is nothing to refuse.
 *
 * IT NAMES THE PATH AND THE MISSING THING. This message is what the operator
 * reads on the canvas -- the renderer prints a `SourceError` as
 * `code: message` (`describeFailure`) -- so it has to answer "why did nothing
 * happen" on its own, without the operator retracing which directory they
 * clicked. A refusal that says only "invalid" costs more than no refusal.
 */
export function whyNotARepository(directory: string): SourceError | null {
  if (repoRootOf(directory) !== null) {
    return null;
  }
  return {
    kind: 'refused',
    code: 'not-a-repository',
    message: `${directory} is not a git repository — vam starts a new project in one, and found no .git there or in any directory above it. Choose the repository, or run git init in that directory first.`,
  };
}
