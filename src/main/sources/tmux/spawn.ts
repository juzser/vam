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
 * WHAT IS ACTUALLY CALLED IN PRODUCTION. `createVamSession`, from
 * `claude-code/create-session.ts`, and -- since the Terminal tab was built --
 * `listVamSessions` and `readPane`, from `main/terminal/pane.ts`. The
 * `has-session` builder is still called by nothing.
 *
 * The note that stood here asked whoever wired the tab to confirm the read
 * path on a real server, because the no-server-to-EMPTY-LIST mapping in
 * `listVamSessions` was asserted by test only. That was done, against a real
 * tmux on a private `-L` socket, and it found a defect no unit test could
 * have: `capture-pane -t '=name'` answers `can't find pane` and exits 1,
 * because `=name` is a target-SESSION and those verbs want a target-PANE
 * (`tmux/argv.ts` now explains the `:` that fixes it). Both halves were being
 * reported as `no-such-session` -- a working session drawn as one that had
 * ended. The mapping itself behaves: no server resolves to the empty list, a
 * live vam session to its screen.
 */

import { execFile } from 'node:child_process';
import type { PaneSize } from '../../../shared/terminal.js';
import type { SourceError } from '../../ipc/channels.js';
import {
  capturePaneArgv,
  isVamSession,
  listSessionsArgv,
  newSessionArgv,
  resizeWindowArgv,
  tagSessionArgv,
} from './argv.js';

/** tmux answers in milliseconds; a slow one is a broken one. */
const TMUX_TIMEOUT_MS = 10_000;

/**
 * The signal node sends when the timeout above fires. It is node's default for
 * `killSignal`, and it is what tells a timeout apart from a kill vam did not
 * ask for -- so `createTmuxRunner` passes it explicitly rather than leaving the
 * classifier's reasoning resting on a default that could change.
 */
const TIMEOUT_SIGNAL = 'SIGTERM';

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Enough of what tmux said to act on. */
const MAX_TMUX_MESSAGE = 400;

/** What a failed `execFile` hands back -- the shape `deliver.ts` documents. */
/**
 * What the operator is told when the process failed with nothing on stderr.
 *
 * `failure.message` is NOT used: node builds it as `Command failed: <file>
 * <args joined>`, so it republishes the argv -- tmux session names carry the
 * project label, and the same fallback in `deliver.ts` carried the whole
 * prompt into a prefilled PUBLIC issue body. It is also unbounded, while
 * `clip` is applied to stderr only.
 */
const NO_WORDS = 'the process exited without saying why';

export type SpawnFailure = {
  readonly message: string;
  readonly code?: string | number | null | undefined;
  readonly killed?: boolean | undefined;
  /** Which signal ended it, when one did. `execFile` reports this beside `killed`. */
  readonly signal?: string | undefined;
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
  // A kill is TWO different facts wearing one flag. `createTmuxRunner` sets a
  // timeout, and node enforces it with SIGTERM -- that one is a hang. Any other
  // signal means something outside vam ended tmux (the OOM killer sends
  // SIGKILL), which is not a hang and must not be reported as one: the
  // operator would go looking for a slow tmux that was never slow.
  // `killed` is NOT the flag that distinguishes them: node sets it only when
  // node itself killed the child, and it only ever kills with TIMEOUT_SIGNAL.
  // An external kill arrives as `{code: null, killed: false, signal:
  // 'SIGKILL'}` -- measured on node 26 -- so the arm below was unreachable in
  // production and every real kill fell through to `refused/tmux-failed`,
  // i.e. "tmux understood and declined", for a process that was killed.
  if (failure.killed === true || failure.signal !== undefined) {
    if (failure.killed === true && failure.signal === TIMEOUT_SIGNAL) {
      return {
        kind: 'unreachable',
        code: 'timed-out',
        message: `tmux did not answer within ${Math.round(TMUX_TIMEOUT_MS / 1000)}s (${action})`,
      };
    }
    return {
      kind: 'unreachable',
      code: 'killed',
      message: `tmux was killed before it answered${
        failure.signal === undefined ? '' : ` by ${failure.signal}`
      }, which vam did not ask for (${action})`,
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
    message: `tmux failed while ${action}: ${said === '' ? NO_WORDS : said}`,
  };
}

/** The real runner. Never rejects: a failed spawn is data, like everywhere else here. */
export function createTmuxRunner(binary = 'tmux'): TmuxRun {
  return (argv) =>
    new Promise((resolve) => {
      execFile(
        binary,
        [...argv],
        {
          timeout: TMUX_TIMEOUT_MS,
          killSignal: TIMEOUT_SIGNAL,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
        },
        (failure, stdout, stderr) => {
          resolve({ failure, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}

/**
 * One session on the server, as vam sees it: the project id vam recorded on it
 * (`''` when nothing did -- see `VAM_PROJECT_OPTION`) and the session name.
 */
export type TmuxSession = {
  readonly project: string;
  readonly name: string;
};

/** Either the thing, or why vam could not get it -- never one standing in for the other. */
export type TmuxSessions =
  | { readonly kind: 'ok'; readonly sessions: readonly TmuxSession[] }
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
export async function listVamSessions(run: TmuxRun): Promise<TmuxSessions> {
  const { failure, stdout, stderr } = await run(listSessionsArgv());
  if (failure !== null) {
    const error = classifyTmuxFailure({ failure, stderr, action: 'listing sessions' });
    return error.code === 'no-server'
      ? { kind: 'ok', sessions: [] }
      : { kind: 'unavailable', error };
  }
  const sessions: TmuxSession[] = [];
  for (const line of stdout.split('\n')) {
    // Split ONCE. The name is whatever follows the first tab, so a value that
    // somehow held one cannot shorten the name it is paired with.
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const name = line.slice(tab + 1).trim();
    if (!isVamSession(name)) continue;
    sessions.push({ project: line.slice(0, tab).trim(), name });
  }
  return { kind: 'ok', sessions };
}

/**
 * Start a detached session. Resolves to `null` when it started, and to the
 * `SourceError` otherwise.
 */
export async function createVamSession(
  run: TmuxRun,
  input: { name: string; cwd: string; command: readonly string[]; projectId: string },
): Promise<SourceError | null> {
  const { failure, stderr } = await run(newSessionArgv(input));
  if (failure !== null) {
    return classifyTmuxFailure({ failure, stderr, action: `creating session ${input.name}` });
  }
  // THE PAIRING IS RECORDED HERE OR NOWHERE. tmux has no way to create a
  // session and set an option on it in one command, so this is a second call
  // and it can fail on its own.
  const tagged = await run(tagSessionArgv(input.name, input.projectId));
  if (tagged.failure === null) return null;
  // The session IS running -- reporting a failure to start it would send the
  // operator looking for something that is not wrong. What is wrong is that
  // the Terminal tab will not find it, and that is what this says.
  const error = classifyTmuxFailure({
    failure: tagged.failure,
    stderr: tagged.stderr,
    action: `recording which project ${input.name} belongs to`,
  });
  return {
    ...error,
    code: 'session-untagged',
    message: `the session started, but vam could not record which project it belongs to, so the Terminal tab will not find it: ${error.message}`,
  };
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

/**
 * Give a session the size the pane can actually show. Resolves to `null` when
 * tmux did it, and to the `SourceError` otherwise.
 *
 * The CALLER decides whether this session may be touched at all
 * (`main/terminal/pane.ts` -- only a session vam recorded for this project).
 * Nothing here re-derives that from a name.
 */
export async function resizeWindow(
  run: TmuxRun,
  name: string,
  size: PaneSize,
): Promise<SourceError | null> {
  const { failure, stderr } = await run(resizeWindowArgv(name, size.columns, size.rows));
  return failure === null
    ? null
    : classifyTmuxFailure({ failure, stderr, action: `resizing session ${name}` });
}
