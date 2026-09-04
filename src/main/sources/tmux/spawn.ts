/**
 * Running tmux, and turning every way it can fail into a distinct answer.
 *
 * The rule this module exists to keep is `pull-requests.ts`'s rule, and it
 * bites harder here: **"no sessions" and "vam could not ask" must never look
 * the same.** tmux exits non-zero with "no server running" when nothing has
 * ever been started -- which is not a fault, it is the empty list -- and it
 * also exits non-zero when it is not installed, when the session is gone, and
 * when the command was wrong. Collapsing those into one empty array would
 * tell the operator they have no sessions at the exact moment vam has lost
 * the ability to see them.
 *
 * Every entry point RESOLVES to its error and never throws, for the reason
 * `MainSource.recordPrompt` documents: a thrown error reaches the IPC
 * catch-all and comes back as a shapeless `unreachable/source-failed`.
 *
 * The spawn itself is the one part that is not tested, exactly as `deliver.ts`
 * says of its own: a test that ran these would create and kill sessions on the
 * operator's real tmux server. So the runner is a parameter.
 *
 * WHAT IS ACTUALLY CALLED IN PRODUCTION, TODAY. Only `createVamSession`, from
 * `claude-code/create-session.ts`. `listVamSessions` and `readPane` -- and the
 * `has-session`, `capture-pane` and `send-keys` argv builders behind them --
 * are the Terminal tab's IPC surface, written ahead of the tab and reachable
 * from nothing but vitest. They are kept because the Terminal tab is the next
 * thing to be built on them and their shape is the reviewed part; they are NOT
 * kept because anything calls them.
 *
 * That has one consequence worth stating outright, because it is the rule this
 * module exists to keep: the no-server-to-EMPTY-LIST mapping in
 * `listVamSessions` -- the care that stops "vam could not ask" being shown as
 * "you have no sessions" -- does not execute in production yet. It is asserted
 * by test only. Whoever wires the Terminal tab is the first person to run it,
 * and is the one who has to confirm it behaves on a real server.
 */

import { execFile } from 'node:child_process';
import type { SourceError } from '../../ipc/channels.js';
import { capturePaneArgv, isVamSession, listSessionsArgv, newSessionArgv } from './argv.js';

/** tmux answers in milliseconds; a slow one is a broken one. */
const TMUX_TIMEOUT_MS = 10_000;

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Enough of what tmux said to act on. */
const MAX_TMUX_MESSAGE = 400;

/** What a failed `execFile` hands back -- the shape `deliver.ts` documents. */
export type SpawnFailure = {
  readonly message: string;
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
};

export type TmuxRunResult = {
  readonly failure: SpawnFailure | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** How tmux is actually run. Injected so everything above it is testable. */
export type TmuxRun = (argv: readonly string[]) => Promise<TmuxRunResult>;

const clip = (text: string): string =>
  text.trim().length > MAX_TMUX_MESSAGE
    ? `${text.trim().slice(0, MAX_TMUX_MESSAGE)}...`
    : text.trim();

/**
 * tmux's own words, matched loosely enough to survive a rewording. NO_SERVER
 * is the one that must not be mistaken for a failure by a caller listing
 * sessions -- see `listVamSessions`.
 */
const NO_SERVER = /no server running|error connecting to .*\(no such file/i;
const NO_SESSION = /can't find (?:session|pane|window)|session not found/i;
const DUPLICATE = /duplicate session/i;

/**
 * Turn a failed tmux run into one honest reason. `action` is a phrase like
 * "creating a session", so the message says what vam was doing when it lost.
 *
 * Order matters: `ENOENT` and a kill are facts about the process and beat
 * anything stderr claims.
 */
export function classifyTmuxFailure(input: {
  failure: SpawnFailure;
  stderr: string;
  action: string;
}): SourceError {
  const { failure, stderr, action } = input;
  const said = clip(stderr);

  if (failure.code === 'ENOENT') {
    return {
      kind: 'unreachable',
      code: 'tmux-missing',
      message: `the \`tmux\` command was not found, so vam cannot manage sessions (${action})`,
    };
  }
  if (failure.killed === true) {
    return {
      kind: 'unreachable',
      code: 'timed-out',
      message: `tmux did not answer within ${Math.round(TMUX_TIMEOUT_MS / 1000)}s (${action})`,
    };
  }
  if (NO_SERVER.test(stderr)) {
    return {
      kind: 'unreachable',
      code: 'no-server',
      message: `no tmux server is running, so there is nothing to reach (${action})`,
    };
  }
  if (NO_SESSION.test(stderr)) {
    return {
      kind: 'refused',
      code: 'no-such-session',
      message: `that tmux session no longer exists (${action}): ${said}`,
    };
  }
  if (DUPLICATE.test(stderr)) {
    return {
      kind: 'refused',
      code: 'session-exists',
      message: `a tmux session by that name already exists (${action}): ${said}`,
    };
  }
  return {
    kind: 'refused',
    code: 'tmux-failed',
    message: `tmux failed while ${action}: ${said === '' ? failure.message : said}`,
  };
}

/** The real runner. Never rejects: a failed spawn is data, like everywhere else here. */
export function createTmuxRunner(binary = 'tmux'): TmuxRun {
  return (argv) =>
    new Promise((resolve) => {
      execFile(
        binary,
        [...argv],
        { timeout: TMUX_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (failure, stdout, stderr) => {
          resolve({ failure, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}

/** Either the thing, or why vam could not get it -- never one standing in for the other. */
export type TmuxNames =
  | { readonly kind: 'ok'; readonly names: readonly string[] }
  | { readonly kind: 'unavailable'; readonly error: SourceError };

export type TmuxText =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'unavailable'; readonly error: SourceError };

/**
 * vam's own sessions, and only those.
 *
 * TWO decisions, both load-bearing. First, "no server running" resolves to an
 * EMPTY LIST: no server means no sessions, which is an answer, not a failure.
 * Every other failure stays `unavailable` with its own code. Second, the names
 * are filtered by vam's prefix, so the operator's unrelated `notes` or `irc`
 * session is never presented as something vam started -- and never offered to
 * a caller that might kill it.
 */
export async function listVamSessions(run: TmuxRun): Promise<TmuxNames> {
  const { failure, stdout, stderr } = await run(listSessionsArgv());
  if (failure !== null) {
    const error = classifyTmuxFailure({ failure, stderr, action: 'listing sessions' });
    return error.code === 'no-server' ? { kind: 'ok', names: [] } : { kind: 'unavailable', error };
  }
  return {
    kind: 'ok',
    names: stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(isVamSession),
  };
}

/**
 * Start a detached session. Resolves to `null` when it started, and to the
 * `SourceError` otherwise.
 */
export async function createVamSession(
  run: TmuxRun,
  input: { name: string; cwd: string; command: readonly string[] },
): Promise<SourceError | null> {
  const { failure, stderr } = await run(newSessionArgv(input));
  return failure === null
    ? null
    : classifyTmuxFailure({ failure, stderr, action: `creating session ${input.name}` });
}

/**
 * The rendered screen, as plain text. This is the whole of the read path for
 * now, and deliberately: the LIVE path (`tmux pipe-pane -o`, which does stream
 * raw output with escape sequences intact) needs a terminal renderer vam does
 * not have and cannot add here -- no terminal emulator package is available.
 * A polled snapshot that is honest beats a stream drawn as garbage.
 */
export async function readPane(run: TmuxRun, name: string): Promise<TmuxText> {
  const { failure, stdout, stderr } = await run(capturePaneArgv(name));
  return failure === null
    ? { kind: 'ok', text: stdout }
    : {
        kind: 'unavailable',
        error: classifyTmuxFailure({ failure, stderr, action: `reading session ${name}` }),
      };
}
