/**
 * Stopping a Claude Code session -- and refusing to, when stopping it is not
 * something a command can do.
 *
 * `claude stop <sessionId>` is real: "Stop a background session. Its
 * conversation is kept; resume it later with `claude attach <id>`." That last
 * clause is why this is not a delete. Nothing is discarded, and the wording
 * every caller renders says so.
 *
 * IT STOPS BACKGROUND SESSIONS ONLY, plus an interactive pane it can prove is
 * its own (`stopSession`'s tmux route). An INTERACTIVE row it cannot prove is
 * refused, in words naming WHY it could not confirm ownership -- not the one
 * borrowed sentence about a terminal a person is sitting in front of, which is
 * true of only one of the reasons a proof can fail. The operator can still
 * ask vam to kill the underlying process anyway, once, explicitly confirmed
 * (`force`): the nearest thing to it is closing their own window out from
 * under them, so it is never the default and never overrides the one case
 * vam can positively place in someone else's project.
 * Doing nothing quietly, or reporting a success vam did not perform, are the
 * two failures this file exists to not commit.
 *
 * Argv and classification are pure and separately tested; the spawn is not,
 * for the reason `deliver.ts` gives for its own -- a test that ran it would
 * stop one of the operator's real sessions.
 */

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { cliMissingMessage } from '../../env/cli-missing.js';
import type { SourceError } from '../../ipc/channels.js';
import { killSessionArgv } from '../tmux/argv.js';
import {
  classifyTmuxFailure,
  listVamSessions,
  type TmuxRun,
  type TmuxSession,
} from '../tmux/spawn.js';
import { sessionIdOf } from './deliver.js';
import { projectIdOf } from './project-id.js';
import { paneForRow } from './reply.js';

/** Stopping is a signal, not a model call, so this is far shorter than delivery's. */
const STOP_TIMEOUT_MS = 15_000;

const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Enough of the CLI's message to act on, without pasting a whole stack. */
const MAX_CLI_MESSAGE = 600;

const clip = (text: string): string =>
  text.trim().length > MAX_CLI_MESSAGE
    ? `${text.trim().slice(0, MAX_CLI_MESSAGE)}...`
    : text.trim();

/**
 * The exact argv. The session id is ONE element and is never interpolated
 * into a string: `execFile` uses no shell, so there is nothing to quote.
 */
export function stopArgv(sessionId: string): readonly string[] {
  return ['stop', sessionId];
}

/** What a failed `execFile` hands back -- the same shape `deliver.ts` documents. */
/**
 * The fallback when stderr was empty. Never `failure.message`: node builds
 * that as `Command failed: <file> <args joined>`, which republishes the argv
 * unbounded into the error log and a prefilled PUBLIC issue body (see
 * `deliver.ts`, where the argv held the operator's prompt).
 */
const NO_WORDS = 'the command exited without saying why';

export type SpawnFailure = {
  readonly message: string;
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
};

export function classifyStopFailure(input: {
  failure: SpawnFailure;
  stderr: string;
  sessionId: string;
}): SourceError {
  const { failure, stderr, sessionId } = input;
  const said = clip(stderr);

  if (failure.code === 'ENOENT') {
    return {
      kind: 'unreachable',
      code: 'cli-missing',
      message: cliMissingMessage('claude', `vam cannot stop session ${sessionId}`),
    };
  }
  if (failure.killed === true) {
    return {
      kind: 'unreachable',
      code: 'timed-out',
      message: `stopping session ${sessionId} did not finish within ${Math.round(STOP_TIMEOUT_MS / 1000)}s; it may still be running`,
    };
  }
  return {
    kind: 'refused',
    code: 'cli-failed',
    message: `stopping session ${sessionId} failed: ${said === '' ? NO_WORDS : said}`,
  };
}

/** Resolves to `null` when the session stopped, and never throws -- see `deliver.ts`. */
export function stopSessionViaCli(input: {
  sessionId: string;
  cwd?: string | undefined;
  binary?: string;
}): Promise<SourceError | null> {
  const { sessionId, cwd, binary = 'claude' } = input;
  return new Promise((resolve) => {
    execFile(
      binary,
      stopArgv(sessionId),
      { cwd, timeout: STOP_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (failure, _stdout, stderr) => {
        resolve(
          failure ? classifyStopFailure({ failure, stderr: String(stderr), sessionId }) : null,
        );
      },
    );
  });
}

/** What `stopSession` needs of a live row. A subset of `LiveAgent`, so a test needs no fixture. */
export type StoppableAgent = {
  readonly key: string;
  readonly sessionId: string;
  readonly kind: 'interactive' | 'background';
  readonly name: string | null;
  /** What the tmux pairing is matched on -- see `stopSession`. */
  readonly cwd: string;
  /**
   * The OS process id, when the source could report one. Used ONLY by the
   * force route below: a tmux pane vam cannot identify still has a process
   * behind it, and this is what a confirmed kill signals. `undefined` for a
   * caller that never had one to give (most existing tests); `null` for a row
   * the CLI itself reported with no pid.
   */
  readonly pid?: number | null;
};

/** What actually performs the stop. Injectable so the join is testable without a spawn. */
export type StopFn = (sessionId: string) => Promise<SourceError | null>;

/**
 * Kills the raw process behind a row vam could not verify by tmux. Injectable
 * for the reason `stop` is: a test that ran it would end one of the
 * operator's real processes.
 */
export type ForceKillFn = (pid: number) => Promise<SourceError | null>;

/**
 * Re-checks a pid IMMEDIATELY BEFORE signalling it, answering whether it
 * still looks like a Claude Code session rather than whatever the OS has
 * recycled the number onto since `claude agents --json` was last polled.
 *
 * THE WINDOW THIS CLOSES. `row.pid` is up to ~10s stale by the time a
 * confirmation dialog resolves -- long enough for a session to exit and its
 * pid to be reassigned to an unrelated process. `process.kill` cannot tell
 * the difference; `ESRCH` only fires when NOTHING holds the pid, not when
 * something else does. So the check that actually matters here happens at
 * kill time, not at listing time, and is injectable for the reason
 * `ForceKillFn` is: a test that touched a real pid would be asserting
 * against whatever process the test runner happened to be.
 *
 * Resolves `true` when the pid still looks like one of vam's Claude Code
 * sessions, `false` when vam can no longer say so. A caller that passes none
 * keeps the old, unchecked behaviour -- see `stopSession`'s own doc for why
 * that is still an honest default rather than a silent hole.
 */
export type PidStillAlive = (pid: number) => Promise<boolean>;

const nameOf = (row: StoppableAgent): string => row.name ?? row.sessionId;

/**
 * A row whose PUBLISHED pane vam can positively place in another project --
 * the one case a confirmed force-close must still refuse, because vam is not
 * guessing here, it knows.
 *
 * Kept separate from `paneForRow`, which already makes this same check but
 * only to decide whether to answer `null` -- it cannot say WHY, and `null`
 * is also what an ordinary "nobody published anything" row returns. This
 * re-reads the one signal that turns "vam cannot tell" into "vam can tell,
 * and it is not this row's": a published pane name that names a REAL vam
 * session (so it is not noise) tagged for a DIFFERENT project than this row's
 * own `cwd` resolves to.
 */
function crossedProjectPane(
  sessions: readonly TmuxSession[],
  row: StoppableAgent,
  panes: ReadonlyMap<string, string> | undefined,
): TmuxSession | null {
  const published = panes?.get(row.key);
  if (published === undefined) return null;
  const candidate = sessions.find((session) => session.name === published);
  if (candidate === undefined) return null;
  return candidate.project === projectIdOf(row.cwd) ? null : candidate;
}

/**
 * The answer for every case vam simply COULD NOT TELL -- no tmux to ask, tmux
 * unreachable, or a pane it could not uniquely resolve. Never for the
 * `crossedProjectPane` case: that one is refused unconditionally by its own
 * caller, before this is ever reached.
 *
 * Unconfirmed, this returns the refusal with `forcible` set whenever a pid is
 * actually available to act on -- the renderer's only honest way to know
 * whether offering "kill anyway" would do anything. Confirmed (`force`), it
 * performs that kill instead of asking again.
 */
async function unresolvedInteractive(input: {
  code: string;
  kind: 'refused' | 'unreachable';
  reason: string;
  row: StoppableAgent;
  force: boolean;
  killPid: ForceKillFn | undefined;
  verifyPid: PidStillAlive | undefined;
}): Promise<SourceError | null> {
  const { code, kind, reason, row, force, killPid, verifyPid } = input;
  const pid = row.pid;
  const canForce = killPid !== undefined && pid !== null && pid !== undefined;
  if (force) {
    if (!canForce || pid === null || pid === undefined) {
      return {
        kind: 'refused',
        code: 'force-unavailable',
        message: `vam has no process id for "${nameOf(row)}", so it cannot force it closed.`,
      };
    }
    // RE-CHECKED HERE, NOT AT LISTING TIME. `pid` is up to one poll old, and
    // the operator's own confirmation click widens that window further -- the
    // OS is free to have recycled it onto an unrelated process in between,
    // and `ESRCH` would never fire for that: something DOES hold the pid, it
    // is simply not this session any more. `verifyPid` is optional only for
    // callers that genuinely have nothing to check with; the production wiring
    // in `source.ts` always supplies one, so this is never the silent hole it
    // would be if that were not true.
    const stillAlive = verifyPid === undefined ? true : await verifyPid(pid);
    if (!stillAlive) {
      return {
        kind: 'refused',
        code: 'pid-unverifiable',
        message: `vam can no longer confirm that process ${pid} is "${nameOf(row)}"; it may have exited. Nothing was signalled.`,
      };
    }
    return killPid(pid);
  }
  return {
    kind,
    code,
    message: `${reason} Close the terminal yourself, or confirm to force it closed.`,
    forcible: canForce,
  };
}

/**
 * Resolve a row id to a live session and stop it, if stopping it is a thing
 * that exists.
 *
 * FOUR ROUTES for an interactive row, and each ends in its own words rather
 * than one borrowed sentence. The gate used to ask one question -- "is this
 * vam's own pane?" -- and answer every "no" with the same line, "a terminal
 * you are sitting in", regardless of WHY it could not say yes: no tmux to
 * ask, tmux unreachable, no pane it could uniquely name, or (see below) a
 * pane it can actually place in someone else's project. Only the last of
 * those is true of a terminal the operator is sitting in; the other three are
 * "vam could not confirm", and reporting them as a refusal was the same
 * conflation `listLiveAgents` had (issue two-three-five): "could not confirm"
 * must not read as "refuses".
 *
 * THE PROOF IS `paneForRow`'S, NOT A NEW ONE. It is the same two conditions
 * `reply.ts` documents -- one tagged tmux session for this project, one live
 * row in it -- and it must be, because the failure it prevents is worse here:
 * a reply typed into the wrong pane is embarrassing, a session killed by
 * mistake is unrecoverable. Anything ambiguous falls through to the refusal
 * below rather than picking a candidate.
 *
 * `run` is optional so a caller with no tmux to offer keeps the CLI-only
 * behaviour; when it is absent nothing here can kill anything by tmux, and
 * `force` is the only remaining route.
 *
 * `force` is a SECOND, DELIBERATE CALL, never a default: it is true only when
 * a caller has already shown the operator what it will kill and they
 * confirmed it. It never overrides `crossedProjectPane` -- see there.
 */
export async function stopSession(
  agents: readonly StoppableAgent[],
  rowId: string,
  stop: StopFn,
  run?: TmuxRun,
  /** What the sessions published about themselves; see `paneForRow`. */
  panes?: ReadonlyMap<string, string>,
  force = false,
  killPid?: ForceKillFn,
  /** Re-checked at the moment of a confirmed kill -- see `PidStillAlive`. */
  verifyPid?: PidStillAlive,
): Promise<SourceError | null> {
  const sessionId = sessionIdOf(rowId);
  const row = agents.find((a) => a.key === rowId) ?? agents.find((a) => a.sessionId === sessionId);
  if (row === undefined) {
    return {
      kind: 'refused',
      code: 'unknown-session',
      message: `vam has no live session ${rowId}; it may have exited since the canvas was drawn`,
    };
  }
  if (row.kind !== 'interactive') {
    // A BACKGROUND row is never killed here even when a tmux session vam
    // started sits in the same project -- `claude stop` is the verb that
    // fits it, and it is the pane's neighbour, not the pane.
    return stop(row.sessionId);
  }

  if (run === undefined) {
    return unresolvedInteractive({
      code: 'tmux-unavailable',
      kind: 'refused',
      reason: `vam has no way to check whether "${nameOf(row)}" is one of its own tmux panes right now.`,
      row,
      force,
      killPid,
      verifyPid,
    });
  }

  const listed = await listVamSessions(run);
  if (listed.kind !== 'ok') {
    return unresolvedInteractive({
      code: listed.error.code,
      kind: listed.error.kind,
      reason: `vam could not list its own tmux sessions (${listed.error.message}), so it cannot confirm "${nameOf(row)}" is one it started.`,
      row,
      force,
      killPid,
      verifyPid,
    });
  }

  // A SECOND PROOF, and it is main's own rather than a repeat of the
  // renderer's: a published pane that names a REAL vam session tagged for a
  // DIFFERENT project than this row's own `cwd` is evidence vam ALREADY HAS,
  // not the absence of it, so this is refused before force ever gets a say.
  const crossed = crossedProjectPane(listed.sessions, row, panes);
  if (crossed !== null) {
    return {
      kind: 'refused',
      code: 'wrong-project-pane',
      message: `"${nameOf(row)}" is paired with tmux session "${crossed.name}", which is tagged for a different project. vam will not kill it, confirmed or not -- this is the one case it can prove is not this row's own.`,
    };
  }

  const pane = paneForRow(listed.sessions, agents, row, panes);
  if (pane !== null) {
    const { failure, stderr } = await run(killSessionArgv(pane));
    return failure === null
      ? null
      : classifyTmuxFailure({ failure, stderr, action: `closing session ${pane}` });
  }

  return unresolvedInteractive({
    code: 'pane-unresolved',
    kind: 'refused',
    reason: `vam could not uniquely identify which tmux pane "${nameOf(row)}" runs in -- more than one live session may share this project, or it has not published its pane yet.`,
    row,
    force,
    killPid,
    verifyPid,
  });
}

/**
 * The real force-kill: a signal to the process table, not a tmux verb. This
 * is what `force` reaches for when vam could not verify a pane at all -- so
 * unlike `killSessionArgv`, there is no pane name here to be exact about;
 * the pid IS the target. `SIGTERM` first, exactly once: this is a last
 * resort already behind an explicit confirmation, not a place to escalate to
 * `SIGKILL` on vam's own initiative.
 *
 * `ESRCH` (no such process) resolves to success: the goal -- this process not
 * running -- was already true, and reporting that as a failure would tell the
 * operator to keep confirming a kill that already happened.
 */
export function killPidViaSignal(pid: number): Promise<SourceError | null> {
  return Promise.resolve().then(() => {
    try {
      process.kill(pid, 'SIGTERM');
      return null;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return null;
      return {
        kind: 'refused',
        code: 'kill-failed',
        message: `vam could not stop process ${pid}: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  });
}

/**
 * The real `PidStillAlive`: does a Claude Code session file still exist for
 * this pid, checked at the moment force is about to signal it.
 *
 * `agents.ts` documents `~/.claude/sessions/<pid>.json` as the file a live
 * process owns, named for its own pid -- existence is decent, cheap evidence
 * that the number still names a Claude Code session rather than whatever the
 * OS has recycled it onto since the last poll. It is not proof the SAME
 * session is still behind it -- a session could exit and another start with
 * the identical pid inside one poll window, and its file would exist too --
 * but that residual is a Claude Code process at worst, never an arbitrary
 * stranger's, which is the actual failure mode this guards against.
 *
 * CONTENTS ARE NEVER READ. Existence is the whole check: `access` answers it
 * without opening the file, and `session-pane.ts` already documents sibling
 * `.key` files in this same directory as secret material nothing here may
 * touch. A `readFile` this function does not need is a `readFile` it must
 * not have.
 */
export function pidHasClaudeSessionFile(sessionsRoot: string): PidStillAlive {
  return async (pid) => {
    try {
      await access(join(sessionsRoot, `${pid}.json`));
      return true;
    } catch {
      return false;
    }
  };
}
