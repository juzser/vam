/**
 * Stopping a Claude Code session -- and refusing to, when stopping it is not
 * something a command can do.
 *
 * `claude stop <sessionId>` is real: "Stop a background session. Its
 * conversation is kept; resume it later with `claude attach <id>`." That last
 * clause is why this is not a delete. Nothing is discarded, and the wording
 * every caller renders says so.
 *
 * IT STOPS BACKGROUND SESSIONS ONLY, and that distinction is the substance of
 * this module rather than a detail of it. An INTERACTIVE session is a terminal
 * a person is sitting in front of; the CLI has no verb for it, and the nearest
 * thing vam could do -- killing the process -- would close the operator's
 * window out from under them. So an interactive row is refused, in words that
 * say why and name the remedy that is actually theirs: close the terminal.
 * Doing nothing quietly, or reporting a success vam did not perform, are the
 * two failures this file exists to not commit.
 *
 * Argv and classification are pure and separately tested; the spawn is not,
 * for the reason `deliver.ts` gives for its own -- a test that ran it would
 * stop one of the operator's real sessions.
 */

import { execFile } from 'node:child_process';
import type { SourceError } from '../../ipc/channels.js';
import { sessionIdOf } from './deliver.js';

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
      message: `the \`claude\` command was not found, so vam cannot stop session ${sessionId}`,
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
    message: `stopping session ${sessionId} failed: ${said === '' ? failure.message : said}`,
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
};

/** What actually performs the stop. Injectable so the join is testable without a spawn. */
export type StopFn = (sessionId: string) => Promise<SourceError | null>;

/**
 * Resolve a row id to a live session and stop it, if stopping it is a thing
 * that exists. The `kind` gate is checked BEFORE anything is called, so an
 * interactive row provably spawns nothing.
 */
export async function stopSession(
  agents: readonly StoppableAgent[],
  rowId: string,
  stop: StopFn,
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
  if (row.kind === 'interactive') {
    return {
      kind: 'refused',
      code: 'interactive-session',
      message: `"${row.name ?? row.sessionId}" is an interactive session — a terminal you are sitting in. Claude Code can only stop background sessions, and vam will not kill the process behind your window: close that terminal yourself.`,
    };
  }
  return stop(row.sessionId);
}
