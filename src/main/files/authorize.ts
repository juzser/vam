/**
 * Path authorisation for the file-editor tab's main-process half: is the
 * operator-chosen path one vam will open at all.
 *
 * THIS GENERALISES `dialog/attach-image.ts`'S CONTAINMENT SEAM RATHER THAN
 * REINVENTING IT. That module measured, against a real symlink on a real
 * disk, that a prefix/`path.relative` check alone cannot catch a link INSIDE
 * a directory that points OUTSIDE it -- the check has to run on what
 * `fs.realpath` resolves to, not on the string the caller supplied. `authorize`
 * below reuses its `isInsideDirectory` and `RealpathFn` rather than
 * duplicating that reasoning, and keeps its ordering: canonicalise, THEN
 * compare -- never the other way.
 *
 * WHAT IS NEW HERE, because the image picker never had to face it: the file
 * tab must accept a path that does not exist YET -- the operator creating a
 * `.env` file that was never there -- and `fs.realpath` throws ENOENT on a
 * missing leaf, root and all. Refusing every path that does not yet exist
 * would make "create a new file" impossible; silently trusting an unresolved
 * path would let `session/../../../etc/passwd` (or a not-yet-existing name
 * behind an already-resolved symlinked directory) in without ever touching
 * the real filesystem. So a missing leaf is walked upward, one path segment
 * at a time, until an ancestor DOES exist; that ancestor alone is resolved
 * through `realpathFn`, and the missing tail is rejoined onto the result
 * before containment is checked. Everything below the found ancestor is, by
 * definition, not on disk yet, so none of it can itself be a symlink -- the
 * walk cannot be tricked by a link two segments below one that resolves
 * cleanly, because a path segment that does not exist has nothing to resolve.
 * If no ancestor at all resolves (a bogus root, a permission wall, the
 * filesystem root itself), authorisation is refused rather than guessed at.
 *
 * ROOTS ARE RESOLVED FRESH, THE SAME REQUEST, THE SAME AS THE CANDIDATE. A
 * session's cwd is asked for right before it is used (`ResolveRoots` mirrors
 * `attach-image.ts`'s `ResolveSessionCwd`) and is itself passed through
 * `realpathFn` here -- never cached, never trusted as already-canonical --
 * because a stale or symlinked root is exactly as dangerous as a stale or
 * symlinked candidate. A root that no longer resolves (the session closed,
 * the directory was removed) authorises nothing; it is skipped rather than
 * treated as a reason to refuse every OTHER root too.
 *
 * THE REFUSAL IS UNIFORM AND CARRIES NO DETAIL, on purpose. Unlike the image
 * picker -- which only ever sees paths the operator clicked in a native
 * dialog already scoped to the session's own directory -- this module's
 * caller is a channel the renderer can invoke with ANY string. A renderer is
 * this app's least trusted process throughout `src/main/**`, so a caller that
 * cannot prove a path is inside a live session's directory must not be able
 * to learn anything else about it: not whether it exists, not whether it is a
 * permissions wall, not whether it is a symlink, not why the walk above gave
 * up. All of those collapse into one `{authorized: false}`, so a probe for
 * `/Users/<name>/.ssh/id_rsa` gets back the identical answer whether that
 * file exists or not. Distinguishing "not found" from "is a directory" from
 * "too large" is only ever done ONE step later, in `ipc.ts`, and only after
 * this function has already said the path is inside a directory the operator
 * legitimately has standing to browse.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT EXPOSE: a rename or delete of a
 * symlink. Canonicalising a symlink's path before acting on it means acting
 * on whatever it points AT -- so "delete this symlink" would realpath its way
 * to deleting (or renaming) the real file somewhere else on disk, possibly
 * outside every root, which is the opposite of what the operator asked for.
 * `ipc.ts` exposes read and write of a resolved path's own CONTENT only; it
 * has no rename or delete channel, and this module has no primitive for one.
 * If that capability is ever wanted, it needs a check this module does not
 * perform -- `lstat`, never `realpath`, on the immediate target -- and it
 * should be added deliberately, not by generalising this file further.
 */

import { basename, dirname, isAbsolute, join } from 'node:path';
import { isInsideDirectory, type RealpathFn } from '../dialog/attach-image.js';

export type { RealpathFn };

/**
 * The root set: every LIVE session's own working directory, asked fresh per
 * request -- never a snapshot drawn when a canvas was last painted. A closed
 * session's directory stops authorising the moment it drops off this list.
 */
export type ResolveRoots = () => Promise<readonly string[]>;

export type Authorization =
  | {
      readonly authorized: true;
      /** The canonical, `realpath`-resolved form of the request -- what a
       *  later `open`/`stat` on this path would actually touch. */
      readonly realPath: string;
      /** Whether the leaf itself was found on disk during canonicalisation.
       *  `false` means every ancestor up to some existing directory had to be
       *  walked -- see the header -- and the caller is free to treat this as
       *  "create a new file here". */
      readonly existed: boolean;
    }
  | { readonly authorized: false };

const NUL = '\0';

/**
 * Resolves `path` through the real filesystem, tolerating a leaf (and only a
 * leaf) that does not exist yet.
 *
 * Tries the exact path first. On ANY failure -- not just ENOENT; a dangling
 * symlink or a permission wall fails the same way and gets the same
 * treatment -- walks up one segment at a time, collecting what was stripped,
 * until `realpathFn` succeeds on some ancestor or the filesystem root is
 * reached with nothing resolved. Returns `null` in the second case: nothing
 * here could be proven to exist at all, so there is nothing to reconstruct.
 */
async function canonicalize(
  path: string,
  realpathFn: RealpathFn,
): Promise<{ readonly realPath: string; readonly existed: boolean } | null> {
  try {
    return { realPath: await realpathFn(path), existed: true };
  } catch {
    // Falls through to the ancestor walk below.
  }
  const missing: string[] = [];
  let current = path;
  for (;;) {
    const parent = dirname(current);
    if (parent === current) {
      // Reached `/` (or a drive root) without anything resolving.
      return null;
    }
    missing.unshift(basename(current));
    try {
      const realParent = await realpathFn(parent);
      const realPath = missing.reduce((soFar, segment) => join(soFar, segment), realParent);
      return { realPath, existed: false };
    } catch {
      current = parent;
    }
  }
}

/**
 * Is `path` inside one of the live roots -- canonicalising BOTH sides through
 * `realpathFn` first, exactly as `attach-image.ts`'s own header explains a
 * prefix check alone cannot be trusted to do. See this file's header for the
 * missing-leaf and uniform-refusal reasoning; neither is duplicated here.
 */
export async function authorize(
  path: string,
  roots: readonly string[],
  realpathFn: RealpathFn,
): Promise<Authorization> {
  if (!isAbsolute(path) || path.includes(NUL)) {
    return { authorized: false };
  }
  const canonical = await canonicalize(path, realpathFn);
  if (canonical === null) {
    return { authorized: false };
  }
  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = await realpathFn(root);
    } catch {
      // A root that no longer resolves authorises nothing; it is not a
      // reason to abandon the OTHER roots still worth checking.
      continue;
    }
    if (isInsideDirectory(realRoot, canonical.realPath)) {
      return { authorized: true, realPath: canonical.realPath, existed: canonical.existed };
    }
  }
  return { authorized: false };
}
