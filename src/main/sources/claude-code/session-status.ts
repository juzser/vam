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
 * What one process's file says about it, for the two callers that care.
 *
 * ONE READ, TWO FACTS, and they are read together rather than by two functions
 * because they come out of the same few hundred bytes and the caller opens the
 * file once per row per load.
 */
export type ProcessFacts = {
  /**
   * The status-change time, or `null` for anything the caller cannot use:
   * unparseable JSON, a document that is not an object, an absent
   * `statusUpdatedAt`, or one that is not a finite number. `null` is not an
   * error -- it means "this surface has no answer", and the caller has a
   * fallback chain for exactly that.
   */
  readonly statusUpdatedAt: number | null;
  /**
   * What this process is BLOCKED ON, and the three states are not
   * interchangeable.
   *
   * ABSENT means the file does not report a waiting state -- the process is
   * idle or running, or vam could not read the file at all. PRESENT AND NULL
   * means it is waiting and named no cause. A STRING is the cause in the CLI's
   * own words, passed through verbatim.
   *
   * VERBATIM IS THE POINT. Two values were observed on one machine at one
   * moment (`permission prompt`, `input needed`); nothing says those are the
   * set, and plan approval -- which has no transcript representation at all --
   * is unmeasured rather than impossible. A parser that mapped this onto an
   * enum would turn every value it had not been told about into silence, which
   * is the failure this whole surface exists to end.
   */
  readonly waitingFor?: string | null;
};

/** Nothing usable: an unreadable file, and no claim that anything is waiting. */
const NOTHING: ProcessFacts = { statusUpdatedAt: null };

export function parseProcessFacts(text: string): ProcessFacts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NOTHING;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return NOTHING;
  const record = parsed as Record<string, unknown>;
  const at = record['statusUpdatedAt'];
  const statusUpdatedAt = typeof at === 'number' && Number.isFinite(at) ? at : null;
  if (record['status'] !== 'waiting') return { statusUpdatedAt };
  const reason = record['waitingFor'];
  // `-` is what a process with nothing to report writes there, so it is the
  // absence of a cause rather than one, and it must not be drawn as a reason
  // the operator is being asked to read.
  const named = typeof reason === 'string' ? reason.trim() : '';
  return { statusUpdatedAt, waitingFor: named === '' || named === '-' ? null : named };
}

/**
 * One pid's facts. Never throws: a missing file, a missing directory and an
 * unreadable one all mean the same thing to the canvas -- this process
 * recorded nothing vam can use -- and none of them is worth a row's age, let
 * alone the load.
 */
export async function readProcessFacts(sessionsRoot: string, pid: number): Promise<ProcessFacts> {
  try {
    return parseProcessFacts(await readFile(join(sessionsRoot, `${pid}.json`), 'utf8'));
  } catch {
    return NOTHING;
  }
}
