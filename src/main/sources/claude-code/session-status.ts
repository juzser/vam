/**
 * The per-PROCESS status file, `~/.claude/sessions/<pid>.json`.
 *
 * WHY THIS EXISTS. A row is a process, not a session: two processes can resume
 * the same session and they share ONE transcript, so the transcript's mtime --
 * the source's other, older answer for "how long ago" -- is identical for both
 * of them. Measured on a real machine, two such rows' true status-change times
 * were about 18 hours apart, which means one of the two ages on screen was
 * necessarily wrong. `statusUpdatedAt` in this file is written per pid and
 * tells them apart.
 *
 * Split the way `transcript.ts` is split, and for the same reason: the parsing
 * is a pure function over text, so it can be tested against fixtures instead
 * of against whatever the operator's home directory happens to contain, and
 * the reader is a thin wrapper that adds only the I/O.
 *
 * The directory also holds `<pid>.<hash>.key` files. Nothing here enumerates
 * it -- the filename is built from the pid -- so a key file is never opened,
 * let alone parsed as JSON.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where Claude Code keeps them. Derived, never a literal home path. */
export const defaultSessionsRoot = (): string => join(homedir(), '.claude', 'sessions');

/**
 * The status-change time out of one file's text, or `null` for anything the
 * caller cannot use: unparseable JSON, a document that is not an object, an
 * absent `statusUpdatedAt`, or one that is not a finite number. `null` is not
 * an error -- it means "this surface has no answer", and the caller has a
 * fallback chain for exactly that.
 */
export function parseStatusUpdatedAt(text: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const value = (parsed as Record<string, unknown>)['statusUpdatedAt'];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * One pid's status time. Never throws: a missing file, a missing directory and
 * an unreadable one all mean the same thing to the canvas -- this process
 * recorded nothing vam can use -- and none of them is worth a row's age, let
 * alone the load.
 */
export async function readStatusUpdatedAt(
  sessionsRoot: string,
  pid: number,
): Promise<number | null> {
  try {
    return parseStatusUpdatedAt(await readFile(join(sessionsRoot, `${pid}.json`), 'utf8'));
  } catch {
    return null;
  }
}
