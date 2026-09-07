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

import { type ExecFileException, execFile } from 'node:child_process';
import type { SessionStatus } from '../../../renderer/domain/model.js';
import { cliMissingMessage } from '../../env/cli-missing.js';

/** One live process, normalised. Not one session -- see `key`. */
export type LiveAgent = {
  /**
   * The row identity, and deliberately NOT the session id.
   *
   * Two processes can resume the SAME session: measured, one session id was
   * listed twice with two different pids and two different names. They are
   * two things the operator is running and two things they may want to look
   * at, so they get two rows;
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
  /**
   * Which list the row came from. Kept because it is the ONLY thing that
   * distinguishes a terminal a person is sitting in front of from work
   * running unattended, and `source.ts` needs that to avoid claiming a
   * background session was started by a human when nothing says so.
   */
  readonly kind: 'interactive' | 'background';
  /** Epoch ms the process started. Not last activity. */
  readonly startedAt: number | null;
  /**
   * The process id, kept rather than left inside `key`. It is what
   * `~/.claude/sessions/<pid>.json` is named for, and that file is the only
   * per-PROCESS timestamp there is -- re-splitting `key` at the point of use
   * would make a row's identity string load-bearing for a file lookup.
   * `null` when the CLI reported no pid, in which case there is no file.
   */
  readonly pid: number | null;
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
 * Background rows are different. `--all` is what makes a FINISHED background
 * row (`done`, `failed`, or the CLI's own `stopped` -- see `statusOf`) reach
 * this list at all, and it also returns every background session ever run --
 * measured, two `failed` rows from 61 and 57 days ago. Those are the exact
 * "sessions I don't care about" the operator complained of, so they are cut
 * here rather than shown for the sake of a status.
 */
const BACKGROUND_WINDOW_MS = 14 * 86_400_000;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * The status mapping, and what it loses.
 *
 * An INTERACTIVE row carries `status: 'busy' | 'idle' | 'waiting'` against
 * vam's four statuses. `busy` is `running`; `idle` and the CLI's own literal
 * `waiting` both land on `waiting`, which is exactly the model's definition:
 * the session finished its turn and the ball is with the operator. `done` and
 * `failed` are NOT derivable here and are not invented: a session the
 * operator finished and one they abandoned are both reported the same way by
 * the CLI, and an interactive session that crashed is not listed at all
 * rather than listed as failed.
 *
 * A BACKGROUND row carries `state` instead of `status` -- IT NEVER CARRIES
 * `status` AT ALL, which is why the fallback below must not be reached by a
 * background row: reading an absent field as "not busy" and calling that
 * `waiting` is sound only because an interactive row's absence of `status`
 * never happens. Measured against the real CLI (`claude agents --json
 * --all`), `state` takes exactly two values in practice: `failed`, and
 * `stopped` -- the CLI's own word for a background session that ended
 * without failing. `done` is handled below because a background row is the
 * only kind that could honestly report it, but it was NOT observed; the
 * earlier version of this comment claiming otherwise was never re-checked
 * against real output. `running` is also accepted for the same reason.
 *
 * Anything else -- a `state` word this mapping was not taught, background
 * only, since only background rows reach this branch at all -- reads as
 * `failed`, not `waiting` and not `done`. `waiting` is out because it is a
 * demand ("the ball is with you") that no background row can honestly make.
 * `done` is out for the same reason the file's own `AgentsResult` never folds
 * an unresolved question into "no sessions": a value this mapping does not
 * recognise is not a quiet success it can vouch for, so it reads as something
 * to go look at instead. `running` is out because it would send `stopSession`
 * straight to a CLI call the row may no longer back, which is the exact
 * failure this mapping exists to stop making. Whatever the CLI adds next,
 * this is the one answer that stays honest without having been taught the
 * new word first.
 */
function statusOf(row: Record<string, unknown>, kind: 'interactive' | 'background'): SessionStatus {
  const state = str(row['state']);
  if (state === 'done' || state === 'failed' || state === 'running') return state;
  if (state === 'stopped') return 'done';
  if (kind === 'background') return 'failed';
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
    // Anything that is not explicitly background is treated as interactive:
    // an unrecognised value should not silently become "unattended", which is
    // the reading that costs a row its origin claim.
    const kind = str(row['kind']) === 'background' ? 'background' : 'interactive';
    // See BACKGROUND_WINDOW_MS: stale finished background work is noise.
    if (kind === 'background' && startedAt !== null && nowMs - startedAt > BACKGROUND_WINDOW_MS) {
      continue;
    }
    const pid = typeof row['pid'] === 'number' ? row['pid'] : null;
    rows.push({
      key: `${sessionId}#${pid ?? str(row['id']) ?? rows.length}`,
      sessionId,
      name: str(row['name']),
      cwd,
      status: statusOf(row, kind),
      kind,
      startedAt,
      pid,
    });
  }
  return rows;
}

/**
 * What `listLiveAgents` hands back.
 *
 * `ok` means the CLI answered and `agents` is its genuine session list, which
 * may be empty -- an operator with nothing running is a real, reportable
 * state. `unavailable` means vam could not ask, or could not understand the
 * answer, and NEVER collapses into an empty list: a missing binary, a
 * non-zero exit, a timeout and unparseable output are four different
 * problems with four different remedies, so each gets its own `code` and its
 * own sentence, matching `pull-requests.ts`'s `PullRequestList`. Rendering
 * any of them as "no sessions" would tell the operator "nothing is running"
 * on the strength of never having found out, which is the one thing a status
 * indicator must never do.
 */
export type AgentsResult =
  | { readonly kind: 'ok'; readonly agents: readonly LiveAgent[] }
  | { readonly kind: 'unavailable'; readonly code: string; readonly message: string };

const unavailable = (code: string, message: string): AgentsResult => ({
  kind: 'unavailable',
  code,
  message,
});

const UNREADABLE_OUTPUT = 'the `claude` CLI answered, but vam could not parse what it said';

/** Turn a failed spawn into a distinct, honest reason. */
function classifyExecFailure(error: ExecFileException, stderr: string): AgentsResult {
  if (error.code === 'ENOENT') {
    return unavailable('cli-missing', cliMissingMessage('claude', 'vam cannot see live sessions'));
  }
  if (error.killed === true) {
    return unavailable(
      'timed-out',
      `the \`claude\` CLI did not answer within ${Math.round(CLI_TIMEOUT_MS / 1000)}s`,
    );
  }
  const said = stderr.trim();
  return unavailable(
    'cli-failed',
    `\`claude agents\` failed: ${said === '' ? 'the command exited without saying why' : said}`,
  );
}

/**
 * Ask the CLI. Never throws: every failure resolves to `AgentsResult`'s
 * `unavailable` arm instead, carrying its own code and message rather than
 * being flattened into "no sessions" -- see the type above for why that
 * distinction exists. `execFile` with an argument array, never a shell
 * string, so nothing here can be shell-interpreted.
 *
 * `--all` is passed so that completed BACKGROUND sessions are included: they
 * are the only rows that carry `done`/`failed`, and dropping them would mean
 * two of vam's four statuses were unreachable by construction.
 */
export function listLiveAgents(binary = 'claude'): Promise<AgentsResult> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ['agents', '--json', '--all'],
      { timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          resolve(classifyExecFailure(error, String(stderr)));
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          resolve(unavailable('unreadable-output', UNREADABLE_OUTPUT));
          return;
        }
        if (!Array.isArray(parsed)) {
          resolve(unavailable('unreadable-output', UNREADABLE_OUTPUT));
          return;
        }
        resolve({ kind: 'ok', agents: parseAgentRows(stdout) });
      },
    );
  });
}
