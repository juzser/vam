/**
 * The LIVE Claude Code session list, from `claude agents --json`.
 *
 * This is the backbone of the source, and it replaced a derivation. The
 * transcript directory holds every session that ever existed -- 30 of them
 * inside a two-week window on this machine, against 5 processes actually
 * alive -- and a status guessed from file mtime was, at best, a good guess
 * about which of those 30 was still running. The CLI simply knows. A fact
 * beats a derivation, so the derivation is gone rather than kept as a
 * fallback that would quietly disagree with it.
 *
 * The type-only import of the renderer's model is required: main may name the
 * renderer's types, never load its code.
 */

import { execFile } from 'node:child_process';
import type { SessionStatus } from '../../../renderer/domain/model.js';

/** One live process, normalised. Not one session -- see `key`. */
export type LiveAgent = {
  /**
   * The row identity, and deliberately NOT the session id.
   *
   * Two processes can resume the SAME session: measured, on this machine,
   * `413e764a...` was listed twice with different pids and different names
   * (`agent-scatola-80` and `hans`). They are two things the operator is
   * running and two things they may want to look at, so they get two rows;
   * keying by session id would have collapsed one of them silently, which is
   * the failure mode a Map makes invisible. They share one transcript, so
   * both rows show the same turns -- which is true, and is the point.
   */
  readonly key: string;
  /** Which transcript file to read. Not unique across rows. */
  readonly sessionId: string;
  /** The operator's own name for the session; the CLI's, not a generated one. */
  readonly name: string | null;
  readonly cwd: string;
  readonly status: SessionStatus;
  /** Epoch ms the process started. Not last activity. */
  readonly startedAt: number | null;
};

/** How long the CLI gets before `load()` gives up on it. */
const CLI_TIMEOUT_MS = 5_000;

/** Guards against a runaway list; the observed live set is single digits. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * How far back a FINISHED background session may have started and still be
 * worth a row. Interactive rows are never filtered by this: a live process is
 * news however long it has been up, and on this machine the longest-running
 * one is also the one being worked in.
 *
 * Background rows are different. `--all` is what makes `done` and `failed`
 * reachable at all, and it also returns every background session ever run --
 * measured, two `failed` rows from 61 and 57 days ago. Those are the exact
 * "sessions I don't care about" the operator complained of, so they are cut
 * here rather than shown for the sake of a status.
 */
const BACKGROUND_WINDOW_MS = 14 * 86_400_000;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * The status mapping, and what it loses.
 *
 * An INTERACTIVE row carries `status: 'busy' | 'idle'` -- two states against
 * vam's four. `busy` is `running` and `idle` is `waiting`, which is exactly
 * the model's definition of waiting: the session finished its turn and the
 * ball is with the operator. `done` and `failed` are NOT derivable here and
 * are not invented: a session the operator finished and one they abandoned
 * are both `idle`, and an interactive session that crashed is not listed at
 * all rather than listed as failed.
 *
 * A BACKGROUND row carries `state` instead, and `state` does express the
 * other two (`done`, `failed` both observed). So those two statuses reach the
 * canvas for exactly the sessions that can honestly report them, and for no
 * others.
 */
function statusOf(row: Record<string, unknown>): SessionStatus {
  const state = str(row['state']);
  if (state === 'done' || state === 'failed' || state === 'running') return state;
  return str(row['status']) === 'busy' ? 'running' : 'waiting';
}

/** Rows out of the CLI's stdout. Anything unexpected yields no rows, never a throw. */
export function parseAgentRows(stdout: string, nowMs: number = Date.now()): readonly LiveAgent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const rows: LiveAgent[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const sessionId = str(row['sessionId']);
    const cwd = str(row['cwd']);
    // Without either of these there is no transcript to find and no project
    // to file the row under. Dropping it beats inventing a home for it.
    if (sessionId === null || cwd === null) continue;
    const startedAt = typeof row['startedAt'] === 'number' ? row['startedAt'] : null;
    // See BACKGROUND_WINDOW_MS: stale finished background work is noise.
    if (
      str(row['kind']) === 'background' &&
      startedAt !== null &&
      nowMs - startedAt > BACKGROUND_WINDOW_MS
    ) {
      continue;
    }
    const pid = typeof row['pid'] === 'number' ? row['pid'] : null;
    rows.push({
      key: `${sessionId}#${pid ?? str(row['id']) ?? rows.length}`,
      sessionId,
      name: str(row['name']),
      cwd,
      status: statusOf(row),
      startedAt,
    });
  }
  return rows;
}

/**
 * Ask the CLI. Never throws: a missing binary, a non-zero exit, a timeout and
 * unparseable output all mean the same thing to the canvas -- vam cannot see
 * any live sessions right now -- and none of them is worth taking the window
 * down for. `execFile` with an argument array, never a shell string, so
 * nothing here can be shell-interpreted.
 *
 * `--all` is passed so that completed BACKGROUND sessions are included: they
 * are the only rows that carry `done`/`failed`, and dropping them would mean
 * two of vam's four statuses were unreachable by construction.
 */
export function listLiveAgents(binary = 'claude'): Promise<readonly LiveAgent[]> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ['agents', '--json', '--all'],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout) => {
        resolve(error ? [] : parseAgentRows(stdout));
      },
    );
  });
}
