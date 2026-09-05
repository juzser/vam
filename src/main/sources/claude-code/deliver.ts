/**
 * Delivering a prompt INTO an existing Claude Code session.
 *
 * `claude --resume <sessionId> -p "<prompt>" --output-format json`, run with
 * the session's own `cwd`, genuinely appends a turn to that session with its
 * earlier context intact -- verified against the real CLI, which is why this
 * source advertises `deliverPrompt` rather than merely `recordPrompt`.
 *
 * THE REFUSAL IS THE COMMON CASE, NOT THE EDGE. The CLI declines while the
 * target session is running -- and the operator's sessions usually are -- with
 * a message naming the session and offering `claude attach` / `claude stop`.
 * That is not an error to flatten into "delivery failed": it is the single
 * most likely outcome, and the operator can act on it only if the session and
 * the remedy survive the trip. So the CLI's own words are carried through to
 * `SourceError.message` and nothing here paraphrases them.
 *
 * `--fork-session` IS NEVER PASSED, and this is the load-bearing decision in
 * the file. It would turn every one of those refusals into an apparent
 * success -- by answering the operator's prompt inside a *copy* of the session
 * while the real one carried on somewhere else. A refusal the operator can see
 * beats a success that silently went to the wrong place.
 *
 * Argv construction and failure classification are pure and separately
 * testable, because the one thing that cannot be tested is the actual spawn:
 * a test that ran this would write into the operator's real sessions.
 */

import { execFile } from 'node:child_process';
import type { SourceError } from '../../ipc/channels.js';

/** How long the CLI gets. A resumed turn is a model call, so this is not short. */
const DELIVER_TIMEOUT_MS = 120_000;

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Enough of the CLI's message to act on, without pasting a whole stack. */
const MAX_CLI_MESSAGE = 600;

/**
 * The row id the renderer holds is `<sessionId>#<pid>` -- two processes can
 * resume one session, so a row is a process (see `agents.ts`). Delivery
 * addresses the SESSION, so the process half is dropped here.
 */
export function sessionIdOf(rowId: string): string {
  return rowId.split('#')[0] ?? rowId;
}

/**
 * The exact argv. The prompt is ONE element and is never interpolated into a
 * string: `execFile` does not use a shell, so there is no quoting, escaping or
 * metacharacter question to get wrong for text the operator typed.
 */
export function deliverArgv(sessionId: string, prompt: string): readonly string[] {
  return ['--resume', sessionId, '-p', prompt, '--output-format', 'json'];
}

const clip = (text: string): string =>
  text.trim().length > MAX_CLI_MESSAGE
    ? `${text.trim().slice(0, MAX_CLI_MESSAGE)}...`
    : text.trim();

/**
 * What a failed `execFile` hands back. Written out rather than reusing
 * `ErrnoException`: `ExecException.code` is `string | number` (a signal name
 * OR an exit status), and narrowing it to `string` made the compiler accept a
 * type this function never actually receives.
 */
export type SpawnFailure = {
  readonly message: string;
  readonly code?: string | number | null | undefined;
  readonly killed?: boolean | undefined;
  readonly signal?: string | undefined;
};

/** What node kills a timed-out child with, and the ONLY signal it ever sends. */
const TIMEOUT_SIGNAL = 'SIGTERM';

/**
 * What the operator is told when the CLI failed with nothing on stderr.
 *
 * `failure.message` is NOT used here and must never be: node builds it as
 * `Command failed: <file> <args joined>` (measured on node 26), and
 * `deliverArgv` puts the operator's whole prompt in that argv. Printing it
 * carries the prompt into the error log and from there into a prefilled
 * PUBLIC issue body, under a footer that promises no prompt is ever
 * included. Nothing downstream can undo that: the scrubber redacts shapes
 * -- paths, ids, quoted names -- and a prompt is free prose. The argv is
 * also unbounded (a prompt may be a million characters) while `clip` is
 * applied to stderr only. So the fallback is a fixed sentence, which costs
 * a detail node never had and keeps a guarantee vam does.
 */
const NO_WORDS = 'the CLI exited without saying why';

/** The CLI's own sentence for a session it will not resume while it runs. */
const RUNNING_MARKER = /is running as a background session/i;

/**
 * Turn a failed spawn into the port's one error shape.
 *
 * `refused` means the CLI understood and declined -- the session is busy, or
 * it exited non-zero with something to say. `unreachable` means vam never got
 * an answer at all: no binary, or no reply in time. The distinction matters to
 * a consumer, which can offer a retry for one and not the other.
 */
export function classifyDeliverFailure(input: {
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
      message: `the \`claude\` command was not found, so vam cannot reach session ${sessionId}`,
    };
  }
  // A kill is TWO different facts, and `killed` is not the flag that tells
  // them apart: node sets it only when NODE killed the child, and node only
  // ever kills with `killSignal`. A child killed from OUTSIDE (the OOM
  // killer, a stray `kill`) arrives as `{code: null, killed: false, signal:
  // 'SIGKILL'}` -- measured on node 26 -- so branching on `killed` sent every
  // real external kill down to `cli-failed`, i.e. reported as a refusal the
  // CLI never made. Branch on the signal.
  if (failure.killed === true || failure.signal !== undefined) {
    if (failure.killed === true && failure.signal === TIMEOUT_SIGNAL) {
      return {
        kind: 'unreachable',
        code: 'timed-out',
        message: `session ${sessionId} did not answer within ${Math.round(DELIVER_TIMEOUT_MS / 1000)}s`,
      };
    }
    return {
      kind: 'unreachable',
      code: 'killed',
      message: `the \`claude\` process for session ${sessionId} was killed${
        failure.signal === undefined ? '' : ` by ${failure.signal}`
      }, which vam did not ask for`,
    };
  }
  if (RUNNING_MARKER.test(stderr)) {
    // The CLI's message already names the session and the remedy. It is
    // repeated verbatim after vam's own sentence rather than replaced, so the
    // operator sees exactly what the tool said.
    return {
      kind: 'refused',
      code: 'session-running',
      message: `session ${sessionId} is running, so Claude Code will not resume it here. ${said}`,
    };
  }
  return {
    kind: 'refused',
    code: 'cli-failed',
    message: `delivering to session ${sessionId} failed: ${said === '' ? NO_WORDS : said}`,
  };
}

/**
 * Read the `--output-format json` body. `null` means the turn landed.
 *
 * The `session_id` check is not ceremony: the CLI returns the id it actually
 * wrote to, so an id that is not the one addressed means the prompt went
 * somewhere else -- which is precisely what `--fork-session` would cause.
 * Since this module never passes that flag, a mismatch means an assumption
 * here is wrong, and the honest answer is to report it rather than tell the
 * operator their message arrived.
 */
export function readDeliverResult(stdout: string, sessionId: string): SourceError | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      kind: 'unreachable',
      code: 'bad-response',
      message: `session ${sessionId} answered with something that was not JSON`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {
      kind: 'unreachable',
      code: 'bad-response',
      message: `session ${sessionId} answered with something that was not a result object`,
    };
  }
  const body = parsed as Record<string, unknown>;
  const result = typeof body['result'] === 'string' ? clip(body['result']) : '';
  if (body['is_error'] === true) {
    return {
      kind: 'refused',
      code: 'delivery-failed',
      message: `session ${sessionId} rejected the prompt: ${result}`,
    };
  }
  const answered = typeof body['session_id'] === 'string' ? body['session_id'] : null;
  if (answered !== null && answered !== sessionId) {
    return {
      kind: 'refused',
      code: 'wrong-session',
      message: `the prompt was addressed to session ${sessionId} but the reply came back for ${answered}; vam will not report that as delivered`,
    };
  }
  return null;
}

/**
 * Run the delivery. Resolves to `null` on success and to a `SourceError`
 * otherwise -- it NEVER throws and never rejects, because main's IPC handler
 * turns a thrown error into a generic `unreachable/source-failed` and the
 * refusal above would lose both its code and its message on the way.
 */
export function deliverPromptViaCli(input: {
  sessionId: string;
  prompt: string;
  cwd: string;
  binary?: string;
}): Promise<SourceError | null> {
  const { sessionId, prompt, cwd, binary = 'claude' } = input;
  return new Promise((resolve) => {
    execFile(
      binary,
      deliverArgv(sessionId, prompt),
      {
        cwd,
        timeout: DELIVER_TIMEOUT_MS,
        killSignal: TIMEOUT_SIGNAL,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
      (failure, stdout, stderr) => {
        resolve(
          failure
            ? classifyDeliverFailure({ failure, stderr: String(stderr), sessionId })
            : readDeliverResult(String(stdout), sessionId),
        );
      },
    );
  });
}

/** What actually performs a delivery. Injectable so the join can be tested without a spawn. */
export type DeliverFn = (input: {
  sessionId: string;
  prompt: string;
  cwd: string;
}) => Promise<SourceError | null>;

/**
 * Resolve a row id to a live session and deliver into it.
 *
 * The working directory is taken from the CLI's own listing, never guessed:
 * `--resume` is run with the session's `cwd`, and a session vam cannot find
 * in the live list has no directory to run in. Refusing is the only honest
 * answer there -- running the prompt in some default directory would deliver
 * it into a session, just not reliably the one the operator meant.
 */
export async function deliverToSession(
  agents: readonly { key: string; sessionId: string; cwd: string }[],
  rowId: string,
  prompt: string,
  deliver: DeliverFn,
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
  return deliver({ sessionId: row.sessionId, prompt, cwd: row.cwd });
}
