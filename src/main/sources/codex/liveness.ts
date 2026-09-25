/**
 * IS A CODEX WRITING THIS THREAD RIGHT NOW?
 *
 * `docs/design/a-second-source.md` lists this as the second of two experiments
 * that had to run before the source could grow past Stage 1, and records the
 * state of knowledge at the time: "`threads` has no `status` and no pid
 * column. `~/.codex/thread-writer-locks/<uuid>.lock` files exist but were
 * stale for threads long finished. Whether an `flock` probe answers ... is
 * UNMEASURED."
 *
 * It has now been measured. codex-cli 0.153.2, macOS 25.6.0, Node 22.23.1:
 *
 *   - a live Codex holds an EXCLUSIVE `flock` on its thread's lock file. A
 *     non-blocking open that asks for a lock fails with errno 35,
 *     `EWOULDBLOCK` (Node spells it `EAGAIN`).
 *   - measured for BOTH holders: the ChatGPT desktop app's `codex app-server`,
 *     and a `codex` CLI TUI started by hand on a private `-L` tmux socket in a
 *     throwaway directory. They lock identically, so one probe answers for
 *     both and vam does not have to know which kind of Codex an operator runs.
 *   - a clean `/quit` deletes the lock file.
 *   - `kill -9` LEAVES IT BEHIND, and it then probes free.
 *
 * ── SO THE FILE'S EXISTENCE IS NOT THE SIGNAL, THE HELD LOCK IS ───────────
 *
 * That is the whole reason this module exists rather than a `existsSync` at
 * the call site, and it is exactly the observation the design doc recorded as
 * "stale for threads long finished". A reader that trusted the file would call
 * a thread killed weeks ago live forever. Both roads -- no file, and a file
 * nobody holds -- arrive at `ended`.
 *
 * ── THE TRAP: `fs.constants.O_SHLOCK` IS `undefined` ──────────────────────
 *
 * On Node 22 / darwin, `fs.constants.O_EXLOCK` and `fs.constants.O_SHLOCK` do
 * not exist. `O_RDONLY | O_NONBLOCK | constants.O_SHLOCK` evaluates to
 * `0 | 4 | undefined === 4` -- a plain non-blocking read that ALWAYS SUCCEEDS.
 * A probe written that way reports "nothing is live" on a machine with a live
 * Codex on it, and reports it confidently. It was written that way here first,
 * and only a controlled `flock` holder falsified it. The literals below are
 * darwin's own, from `<sys/fcntl.h>`, and `codex-liveness.test.ts` pins them.
 *
 * ── WHY A *SHARED* LOCK IS ASKED FOR, NOT AN EXCLUSIVE ONE ────────────────
 *
 * Both answer errno 35 against a live Codex -- measured. `O_SHLOCK` is chosen
 * because it fails if and only if somebody holds an EXCLUSIVE lock, which is
 * what Codex holds; an exclusive probe would additionally fail against another
 * *reader*, so two vam windows probing at once could each report the other's
 * microsecond as a live Codex. The shared ask cannot produce that false
 * positive.
 *
 * vam does hold the shared lock for the few microseconds between `open` and
 * `close`. That is disclosed rather than hidden: a Codex starting in exactly
 * that window and asking for its exclusive lock non-blockingly would be
 * refused. The alternative is no liveness at all, and `lsof` is not one --
 * measured, macOS lsof reports the lock file as merely OPEN (`22u`) with no
 * lock character, for a held lock and an unheld one alike, so it cannot tell
 * the two apart.
 *
 * ── NOTHING HERE WRITES ───────────────────────────────────────────────────
 *
 * `O_RDONLY`, and no `O_CREAT`: asking about a thread must never bring a lock
 * file into existence in the operator's `~/.codex`. There is a test for that
 * exact thing, because it is the kind of promise that decays into a comment.
 */

import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { codexHome } from './store.js';

/**
 * What vam knows about a thread's writer.
 *
 * `unknown` is a first-class answer and is NOT a synonym for `ended`. A
 * platform without the flag, a lock file vam is not allowed to open, a thread
 * id that is not a thread id -- each of those is a case where vam did not
 * look successfully, and the source draws those rows the way it drew every row
 * before liveness was readable, saying it cannot tell.
 */
export type Liveness = 'live' | 'ended' | 'unknown';

/** darwin `<sys/fcntl.h>`. Literals, because Node does not expose them. */
export const DARWIN_O_RDONLY = 0x0000;
export const DARWIN_O_NONBLOCK = 0x0004;
export const DARWIN_O_SHLOCK = 0x0010;

/** The directory Codex keeps one lock file per live thread in. */
export const LOCK_DIR = 'thread-writer-locks';

export const lockDirFor = (home = codexHome()): string => join(home, LOCK_DIR);

/**
 * A THREAD ID IS NOT A PATH SEGMENT UNTIL IT HAS BEEN LOOKED AT.
 *
 * Every id in `threads` is a uuid, on every row measured. But the row comes
 * out of a database vam does not own and never validates on write, and this
 * value is about to be joined onto a path in the operator's home directory.
 * Anything that is not a bare hex-and-dash token of uuid length is refused
 * with `null`, and a refusal means `unknown` upstream -- never a probe of some
 * other file.
 */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function lockPathFor(threadId: string, home = codexHome()): string | null {
  if (!UUID.test(threadId)) return null;
  return join(lockDirFor(home), `${threadId}.lock`);
}

/**
 * The decision, as a pure function of the platform and what `open` said.
 *
 * SEPARATED FROM THE SYSCALL ON PURPOSE. CI is `ubuntu-latest`, and a suite
 * that could only run on darwin would skip there and cover nothing --
 * including the Linux answer, which is the one most likely to be wrong,
 * because on Linux the same numeric flag is not a lock request and the open
 * would SUCCEED against a live Codex. `ended` would then be vam's answer for
 * every thread on the machine. So: not darwin, not known.
 */
export function classifyProbe(input: {
  readonly platform: string;
  /** `null` when the open succeeded; otherwise Node's `err.code`. */
  readonly code: string | null | undefined;
}): Liveness {
  if (input.platform !== 'darwin') return 'unknown';
  const code = input.code ?? null;
  if (code === null) return 'ended';
  // errno 35 under both of Node's spellings: a Codex holds it.
  if (code === 'EAGAIN' || code === 'EWOULDBLOCK') return 'live';
  // The clean exit removes the file; the absence is as good as the free lock.
  if (code === 'ENOENT') return 'ended';
  // Anything else is vam failing to look, which is not the thread being over.
  return 'unknown';
}

/** Answers for one lock file, by path. Injected wherever liveness is read. */
export type ProbeLock = (lockPath: string) => Liveness;

/**
 * The real probe. Opens, asks for a shared lock without blocking, and closes
 * immediately -- see the header for why shared, and for what the open is not
 * allowed to do.
 */
export function probeLockViaOpen(platform: string = process.platform): ProbeLock {
  return (lockPath) => {
    if (platform !== 'darwin') return 'unknown';
    let fd: number | null = null;
    try {
      fd = openSync(lockPath, DARWIN_O_RDONLY | DARWIN_O_NONBLOCK | DARWIN_O_SHLOCK);
      return classifyProbe({ platform, code: null });
    } catch (error) {
      return classifyProbe({ platform, code: (error as NodeJS.ErrnoException).code });
    } finally {
      if (fd !== null) closeSync(fd);
    }
  };
}

/** One thread's liveness, or `unknown` when its id was not one vam will join. */
export function livenessOf(threadId: string, probe: ProbeLock, home = codexHome()): Liveness {
  const path = lockPathFor(threadId, home);
  if (path === null) return 'unknown';
  return probe(path);
}
