/**
 * The file-editor tab's directory walk, behind `CHANNELS.filesList`
 * (`./list-ipc.ts`) -- the piece the ORIGINAL main-process half of this
 * feature did not ship. `authorize.ts`, `content.ts` and `ipc.ts` answer "may
 * this ALREADY-KNOWN path be read or written"; nothing in that trio lets the
 * renderer DISCOVER a path in the first place, and `renderer/domain/model.ts`
 * carries no `cwd` field for it to construct one from (`attach-image.ts`'s own
 * header states the same rule). A file-editor tab that can only open a path
 * the operator already knows by heart is not "managing files" -- so this
 * walk exists to answer the one question the shipped pair could not: what is
 * actually in here.
 *
 * WHAT IS SKIPPED, and why it is exactly these two names. `node_modules` and
 * `.git` are walked OVER -- never descended into, never listed themselves --
 * because they are the two directories a real repository's own file count is
 * dominated by and neither is a place `.env`-and-a-few-other-files lives.
 * EVERY OTHER DOTFILE AND DOTDIRECTORY STAYS VISIBLE. orca's own quick-open
 * filter makes the same exception in a comment this module's header borrows
 * the reasoning from: hiding user-authored dotdirs (`.github/`, `.vscode/`)
 * would hide exactly the files people open, and `.env` -- the file the
 * operator named this whole feature for -- is a dotfile itself. A blanket
 * "hide dotfiles" policy would defeat the feature it was added for.
 *
 * SYMLINKS ARE NEITHER LISTED NOR FOLLOWED, and this is the safety property
 * that matters most here. `fs.readdir(path, {withFileTypes: true})` returns
 * `Dirent` objects built from the directory entry itself (an `lstat` view),
 * so a symlink reports `isDirectory() === false` AND `isFile() === false` --
 * neither branch below claims it, and it silently drops out of the walk.
 * That is deliberate and is the CHEAPEST correct answer: `authorize.ts`'s own
 * header explains at length why a symlink inside a session's directory that
 * points outside it must never be trusted on its syntactic location alone,
 * and the containment discipline that module spends a real `realpath` call
 * per candidate to buy is not needed here at all if a symlink is simply never
 * a candidate -- it cannot leak a name from outside the sandbox if this walk
 * never looks at what it points to and never lists it as an entry. (The path
 * this produces is still re-authorised, independently, the moment the
 * renderer hands it to `filesRead`/`filesWrite` -- this walk grants no
 * standing of its own; see `list-ipc.ts`.)
 *
 * THE CAP EXISTS FOR THE SAME REASON `content.ts`'s 50 MiB ceiling does:
 * bounding memory and event-loop time on a process shared with everything
 * else main does, not politeness. `LIST_LIMIT` stops the walk once that many
 * FILES have been collected -- not directories visited -- and `truncated`
 * says so plainly rather than silently handing back a partial list that
 * looks complete. An unreadable subdirectory (a permissions wall, a mount
 * that vanished mid-walk) is skipped, not fatal to the rest of the tree: one
 * bad branch must not blank the whole picture.
 */

import type { FileListResult } from './types.js';

export type { FileListResult };

/** The slice of Node's `Dirent` this walk reads. */
export type DirentLike = {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

/** `fs.promises.readdir(path, {withFileTypes: true})`, or a fake of it. */
export type ReadDir = (path: string) => Promise<readonly DirentLike[]>;

/** Directory NAMES walked over, never into and never listed. See header. */
const SKIP_DIR_NAMES = new Set(['node_modules', '.git']);

/**
 * How many files this walk collects before it stops. 5,000 is generous for
 * the population this feature was built for -- "`.env` and a few other
 * files" in one session's own working directory -- while keeping a
 * `Command.Item`-per-entry list (`cmdk`, the renderer's own choice) something
 * a browser can actually render without a second scrollback of its own.
 */
export const LIST_LIMIT = 5_000;

/**
 * Walks `root`, collecting every regular file's absolute path. Never throws:
 * a subdirectory `readDir` cannot read is skipped, and the walk it belongs to
 * simply contributes nothing further from that branch.
 */
export async function listFiles(
  root: string,
  readDir: ReadDir,
  limit: number = LIST_LIMIT,
): Promise<FileListResult> {
  const files: string[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    let entries: readonly DirentLike[];
    try {
      entries = await readDir(dir);
    } catch {
      return;
    }
    // Sorted before use, not as a courtesy: a stable order is what makes the
    // SAME repository produce the SAME list run to run, which `readdir`'s own
    // (filesystem- and platform-dependent) order does not promise.
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (truncated) return;
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        await walk(`${dir}/${entry.name}`);
      } else if (entry.isFile()) {
        files.push(`${dir}/${entry.name}`);
        if (files.length >= limit) {
          truncated = true;
          return;
        }
      }
      // Neither branch claims a symlink (`isDirectory()` and `isFile()` are
      // both false for one) -- see this file's header for why that is the
      // whole of the symlink handling this walk needs.
    }
  }

  await walk(root);
  return { root, files, truncated };
}
