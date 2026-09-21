/**
 * READING CODEX'S SESSION STORE, `~/.codex/state_5.sqlite`, AND NOTHING ELSE.
 *
 * Every statement this module can issue is a `SELECT`. vam's one write to
 * Codex is `codex queue` (`./queue.ts`), and it goes through the CLI rather
 * than through this file.
 *
 * ── THE TRAP THAT WILL PRODUCE A CONFIDENT WRONG ANSWER ───────────────────
 *
 * `file:<path>?mode=ro` FAILS with `unable to open database file (14)` on this
 * database whenever the `-shm` segment is gone, because a read-only connection
 * is not allowed to create one and WAL mode wants it. Measured here, on a
 * COPY of the real store so the operator's own file was never involved:
 *
 *     $ cp ~/.codex/state_5.sqlite /tmp/probe.sqlite      # no -shm, no -wal
 *     $ sqlite3 "file:/tmp/probe.sqlite?mode=ro" 'select count(*) from threads;'
 *     Error: in prepare, unable to open database file (14)
 *     $ sqlite3 "/tmp/probe.sqlite"           'select count(*) from threads;'
 *     789
 *
 * So `mode=ro` breaks exactly when NO CODEX IS RUNNING, which is the common
 * case, and a reader that stopped there would tell an operator whose Codex is
 * perfectly fine that vam cannot see it.
 *
 * ── WHY THE FALLBACK IS `immutable=1` AND WHY IT IS CONDITIONAL ───────────
 *
 * The obvious fallback -- open the file read-WRITE, which is what the second
 * command above does -- is the one this module refuses. It creates `-shm` and
 * `-wal` inside `~/.codex`, and a read-write open is allowed to run WAL
 * RECOVERY, which writes to the operator's own store. vam does not write to
 * Codex's database, and "only when it has to" is not the same promise.
 *
 * `immutable=1` opens with no locking and no sidecar files at all -- and it is
 * DANGEROUS IN EXACTLY ONE SITUATION, which is why it is not simply used
 * first. It ignores the WAL. Measured, with a writer holding an uncheckpointed
 * WAL open:
 *
 *     wal= 12392  shm= 32768
 *     immutable=1 : Error: in prepare, no such table: t
 *     mode=ro     : 3
 *
 * The table itself was invisible. Read like that against a live Codex, vam
 * would not report "fewer threads" -- it would report a database with no
 * `threads` table, i.e. the version decline, while Codex was running fine.
 *
 * The two are exact complements, so the rule is:
 *
 *   1. `mode=ro` first. A writer is around -> `-shm` exists -> this works and
 *      sees the WAL.
 *   2. If that fails to OPEN, and only if the `-wal` sidecar is absent or
 *      empty -- the checkpointed-away case, which is the only case where the
 *      main file is the whole truth -- retry with `immutable=1`.
 *   3. A non-empty `-wal` with no `-shm` is a crashed writer whose recovery
 *      only a read-write connection may perform. vam declines, in words,
 *      rather than opening the operator's store for writing.
 *
 * ── THE SCHEMA IS PRIVATE AND VERSION-SUFFIXED ────────────────────────────
 *
 * `state_5`, `queue_1`, `thread_history_1`. A Codex update may rename any of
 * them, and when it does the honest answer is "this Codex keeps its sessions
 * somewhere vam does not know" -- never a crash, and never an empty list,
 * because an empty list reads as "you have no sessions", which is the one lie
 * this source must not tell. That is `pull-requests.ts`'s first rule and it
 * applies here word for word.
 *
 * As in `pull-requests.ts` and `pr-actions.ts`, argv construction, failure
 * classification and parsing are pure and separately testable; the spawn is
 * the one thing a test cannot run against the operator's real store.
 */

import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where Codex keeps its own state. `CODEX_HOME` is Codex's own override. */
export function codexHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env['CODEX_HOME'];
  return override !== undefined && override !== '' ? override : join(home, '.codex');
}

/**
 * THE FILE NAME CARRIES A SCHEMA VERSION, and that is why it is a named
 * constant with a comment rather than a string in a path join: when a Codex
 * release ships `state_6.sqlite`, this is the line that has to change, and
 * everything else in this directory already answers the intervening state
 * ("vam does not know where this Codex keeps its sessions") correctly.
 */
export const STATE_DB = 'state_5.sqlite';

export const stateDbPath = (home = codexHome()): string => join(home, STATE_DB);

/** How long `sqlite3` gets. A local indexed SELECT, not a network call. */
export const STORE_TIMEOUT_MS = 5_000;

/** Generous for the capped row count below; a tripwire, not a working size. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * HOW MANY THREADS VAM READS BEFORE IT KNOWS WHICH OF THEM ARE LIVE.
 *
 * 789 rows on the machine this was written for, 787 of them "visible" by
 * Codex's own rule (`archived = 0 AND preview <> ''`, which is what its
 * `idx_threads_visible_*` indexes are built on), going back months.
 *
 * This is the SCAN and not the draw. `source.ts` probes each scanned row's
 * writer lock and then keeps the live ones -- all of them -- plus a small,
 * disclosed number of ended ones.
 *
 * ── WHY THERE IS NO RECENCY WINDOW HERE ANY MORE ──────────────────────────
 *
 * There used to be one, of seven days, and it was never really a window: it
 * was a stand-in for liveness, chosen when liveness was believed unreadable.
 * It is readable now (`./liveness.ts`), and the stand-in was a poor one --
 * measured on the operator's own store it drew 11 finished conversations in
 * order to surface the 1 live thread among them.
 *
 * ── WHAT THE SCAN LIMIT COSTS, NAMED RATHER THAN PAPERED OVER ─────────────
 *
 * The scan is one indexed SELECT returning small rows; what is expensive per
 * row is the ROLLOUT TAIL read, and only a row that will be drawn is read. So
 * 200 is generous for the query and costs nothing in tail reads.
 *
 * The gap it leaves: a live thread outside the 200 most recently touched would
 * not be found. Measured on this store, 200 rows reach back to 2026-08-27 --
 * 25 days -- and a thread whose Codex is holding its writer lock does not sit
 * 25 days without touching `recency_at_ms`.
 */
export const STORE_SCAN_LIMIT = 200;

/** One row of `threads`, narrowed to what vam actually draws. */
export type ThreadRow = {
  readonly id: string;
  readonly rolloutPath: string;
  readonly cwd: string;
  /** Codex's own short preview of the first prompt. Never the whole thing. */
  readonly preview: string;
  /** The operator's name for the thread, when they gave it one. */
  readonly name: string | null;
  readonly model: string | null;
  readonly branch: string | null;
  readonly recencyAtMs: number | null;
};

export type StoreRead =
  | { readonly kind: 'threads'; readonly threads: readonly ThreadRow[] }
  | { readonly kind: 'unavailable'; readonly code: string; readonly message: string };

/** What a caller knows about the WAL sidecars, so the rule above is pure. */
export type Sidecars = {
  /** Does `<db>-shm` exist? Present means a writer has the database open. */
  readonly shm: boolean;
  /** `<db>-wal`'s size, or `null` when there is no such file. */
  readonly walBytes: number | null;
};

export type Attempt = { readonly uri: string; readonly note: string };

/**
 * The connections to try, in order, and vam's reason for each. See the header:
 * this is the whole of the `mode=ro` trap, in one pure function.
 */
export function connectionPlan(path: string, sidecars: Sidecars): readonly Attempt[] {
  const base = pathToFileURL(path).href;
  const plan: Attempt[] = [
    {
      uri: `${base}?mode=ro`,
      note: 'read-only, which is what vam wants and what works while Codex is running',
    },
  ];
  // The checkpointed-away case, and ONLY it: with a non-empty WAL, an
  // immutable read cannot see what is in it -- measured, it could not even see
  // the table.
  if (sidecars.walBytes === null || sidecars.walBytes === 0) {
    plan.push({
      uri: `${base}?immutable=1`,
      note: 'the write-ahead log is empty, so the file itself is the whole truth and vam can read it without creating anything',
    });
  }
  return plan;
}

/**
 * A failure from `sqlite3`, turned into vam's own words.
 *
 * THE VERSION DECLINE IS THE POINT. "No such table" and a missing file are
 * the same fact about a Codex vam does not recognise, and both must arrive as
 * an `unavailable` that says so -- never as zero threads.
 */
export function classifyStoreFailure(input: {
  readonly code?: string;
  readonly stderr?: string;
  readonly timedOut?: boolean;
  readonly path: string;
}): Extract<StoreRead, { kind: 'unavailable' }> {
  const stderr = (input.stderr ?? '').trim();
  const lower = stderr.toLowerCase();
  if (input.code === 'ENOENT') {
    return {
      kind: 'unavailable',
      code: 'sqlite3-missing',
      message:
        'the `sqlite3` command was not found on PATH, so vam cannot read Codex’s session store; macOS ships one at /usr/bin/sqlite3',
    };
  }
  if (input.timedOut === true) {
    return {
      kind: 'unavailable',
      code: 'timed-out',
      message: `reading Codex’s session store took longer than ${STORE_TIMEOUT_MS} ms and was given up on`,
    };
  }
  if (lower.includes('no such table') || lower.includes('no such column')) {
    return {
      kind: 'unavailable',
      code: 'unknown-schema',
      message: `this Codex keeps its sessions somewhere vam does not know: ${input.path} exists but does not have the \`threads\` shape vam reads (${stderr})`,
    };
  }
  if (lower.includes('unable to open database file')) {
    return {
      kind: 'unavailable',
      code: 'needs-recovery',
      message: `Codex’s session store could not be opened for reading and its write-ahead log is not empty, which only Codex itself may recover; vam will not open ${input.path} for writing`,
    };
  }
  return {
    kind: 'unavailable',
    code: 'read-failed',
    message: `vam could not read Codex’s session store at ${input.path}: ${stderr === '' ? 'the reader failed with no message' : stderr}`,
  };
}

/** The missing-file decline, which is the same claim as an unknown schema. */
export const missingStore = (path: string): Extract<StoreRead, { kind: 'unavailable' }> => ({
  kind: 'unavailable',
  code: 'no-store',
  message: `this Codex keeps its sessions somewhere vam does not know: there is no ${path}`,
});

/**
 * The one statement this module issues.
 *
 * NO OPERATOR TEXT IS INTERPOLATED HERE, and nothing may ever be: the two
 * values that vary are a timestamp and a row cap, both numbers vam computed.
 * A thread id never reaches SQL at all -- `queue.ts` addresses a thread by
 * argv, and the filter below is by time.
 */
export function threadsSql(limit: number): string {
  const cap = Math.max(1, Math.floor(limit));
  return (
    'SELECT id, rollout_path, cwd, preview, name, model, git_branch, recency_at_ms ' +
    'FROM threads ' +
    "WHERE archived = 0 AND preview <> '' " +
    `ORDER BY recency_at_ms DESC LIMIT ${cap};`
  );
}

export function sqliteArgv(uri: string, sql: string): readonly string[] {
  return [uri, '-json', sql];
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * `sqlite3 -json`'s output, turned into rows.
 *
 * A ROW THAT CANNOT BE USED IS DROPPED, NOT INVENTED. `id`, `rollout_path` and
 * `cwd` are `NOT NULL` in the schema, but this file's whole subject is a
 * schema vam does not own; a row missing one of them is one vam cannot key,
 * cannot read and cannot place in a project, and quietly skipping it is better
 * than minting a row with an empty id that a later delivery could address.
 */
export function parseThreadRows(stdout: string): readonly ThreadRow[] {
  const trimmed = stdout.trim();
  // `sqlite3 -json` prints NOTHING AT ALL for an empty result set, which is
  // not valid JSON and is not an error either.
  if (trimmed === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: ThreadRow[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const id = text(row['id']);
    const rolloutPath = text(row['rollout_path']);
    const cwd = text(row['cwd']);
    if (id === null || rolloutPath === null || cwd === null) continue;
    const recency = row['recency_at_ms'];
    rows.push({
      id,
      rolloutPath,
      cwd,
      preview: text(row['preview']) ?? '',
      name: text(row['name']),
      model: text(row['model']),
      branch: text(row['git_branch']),
      recencyAtMs: typeof recency === 'number' && Number.isFinite(recency) ? recency : null,
    });
  }
  return rows;
}

/** What a run of `sqlite3` answered. Injected so the rule above is testable. */
export type SqliteResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code?: string;
  readonly timedOut?: boolean;
  readonly failed: boolean;
};
export type RunSqlite = (argv: readonly string[]) => Promise<SqliteResult>;

/** Reads `<db>-shm` and `<db>-wal`, which is all the rule above needs. */
export function readSidecars(path: string): Sidecars {
  const size = (suffix: string): number | null => {
    try {
      return statSync(`${path}${suffix}`).size;
    } catch {
      return null;
    }
  };
  return { shm: size('-shm') !== null, walBytes: size('-wal') };
}

/**
 * The threads vam draws, or vam's reason for having none.
 *
 * `exists` and `sidecars` are injected for the reason every filesystem read in
 * this tree is: a test must never be pointed at the operator's own store.
 */
export async function readThreads(input: {
  readonly path: string;
  readonly exists: (path: string) => boolean;
  readonly sidecars: (path: string) => Sidecars;
  readonly run: RunSqlite;
  readonly limit?: number;
}): Promise<StoreRead> {
  if (!input.exists(input.path)) return missingStore(input.path);
  const sql = threadsSql(input.limit ?? STORE_SCAN_LIMIT);
  const plan = connectionPlan(input.path, input.sidecars(input.path));
  let last: SqliteResult | null = null;
  for (const attempt of plan) {
    const result = await input.run(sqliteArgv(attempt.uri, sql));
    if (!result.failed) {
      return { kind: 'threads', threads: parseThreadRows(result.stdout) };
    }
    last = result;
    // Only the OPEN failure earns the next attempt. A schema that is not there
    // will not be there under a different connection either, and retrying
    // would turn one honest decline into two reads.
    if (!result.stderr.toLowerCase().includes('unable to open database file')) break;
  }
  return classifyStoreFailure({
    code: last?.code,
    stderr: last?.stderr,
    timedOut: last?.timedOut,
    path: input.path,
  });
}

/** The real reader. Never called by a test; see the header. */
export const runSqliteViaCli = (): RunSqlite => {
  return (argv) =>
    new Promise((resolve) => {
      execFile(
        'sqlite3',
        [...argv],
        { timeout: STORE_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout, stderr, failed: false });
            return;
          }
          const withCode = error as NodeJS.ErrnoException & { killed?: boolean };
          resolve({
            stdout,
            stderr: stderr === '' ? error.message : stderr,
            code: withCode.code,
            timedOut: withCode.killed === true,
            failed: true,
          });
        },
      );
    });
};
