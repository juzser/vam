/**
 * Claude Code's BUILT-IN slash commands, asked of the installed CLI.
 *
 * ── WHY THIS IS A HANDSHAKE AND NOT A LIST IN A FILE ─────────────────────
 *
 * `slash-commands.ts` used to say built-ins were never listed because "`claude
 * --help` names no way to enumerate them for the installed version, and a
 * hand-maintained guess would drift". The second half of that is still exactly
 * right and is the reason this file exists in the shape it does. The first
 * half was a stopping point rather than a fact, and these are the measurements
 * that moved it, all against 2.1.267:
 *
 *  - `claude --help` lists CLI SUBCOMMANDS (`agents`, `attach`, `auth`,
 *    `doctor`, `mcp`, `plugin`, …). No slash command appears in it. TRUE.
 *  - The binary is a compiled bundle; command names appear in it as scattered
 *    strings with no adjacent descriptions and no delimited list. Grepping it
 *    against a word list confirms the word list, which is not evidence of
 *    anything. TRUE, and the trap this file exists to avoid.
 *  - BUT the CLI answers the SDK's own `initialize` control request with its
 *    command list -- `{ name, description, argumentHint }` per entry, 52 of
 *    them here -- and that answer is produced BY the installed binary. It is
 *    an enumeration, not a recollection: a command that has been renamed or
 *    removed cannot appear in it, which is the whole failure mode a curated
 *    list has.
 *
 * WHAT IT COSTS, measured on this machine:
 *
 *  - `--safe-mode`: 1086 ms, ZERO hooks run, 52 commands. This is the shape
 *    used below.
 *  - no flags: 846 ms but SIX of the operator's own `SessionStart` hooks ran.
 *    A list is a question; a question must not run somebody's automation to be
 *    answered. Hence safe mode, whose whole job is disabling customizations.
 *  - `--bare`: 217 ms but 48 commands -- it skips the keychain, so the four
 *    account-gated built-ins vanish. Faster and wronger.
 *
 * NO MODEL IS EVER ASKED. The handshake answers before a turn exists: no
 * prompt is passed, the reply is read, the child is killed. `total_cost_usd`
 * and `duration_api_ms` were 0 on every probe.
 *
 * WHAT IS NOT IN THE ANSWER, said here so the gap is on the record rather than
 * in the operator's surprise: commands that only exist in an interactive
 * TERMINAL -- `/resume`, `/status`, `/help` -- are not in this list. That is
 * not an omission, it is the right list for this feature: vam's own delivery
 * runs `claude --resume <id> -p "<prompt>"` (`deliver.ts`), which is precisely
 * the mode where those commands answer "isn't available in this environment".
 * Offering one would offer a command vam's own channel is guaranteed to
 * refuse. (Measured: `claude -p "/resume"` answers "/resume isn't available in
 * this environment", `claude -p "/zzz"` answers "Unknown command: /zzz" -- the
 * CLI is an ORACLE for a name you already have and never an enumerator, which
 * is why no list is written by hand here.)
 *
 * ONE QUESTION PER PROCESS. See `createBuiltinCommandReader`.
 *
 * Argv, the request line, parsing and failure classification are pure and
 * separately tested. The spawn itself is not, for `deliver.ts`'s reason: a
 * test that ran it would start a real Claude Code process on whatever machine
 * ran the suite.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import type { SlashCommand } from '../../../renderer/domain/model.js';
import { cliMissingMessage } from '../../env/cli-missing.js';

/**
 * How long the CLI gets to answer the handshake. Generous next to the 1.1 s
 * measured above, because a cold binary on a busy machine is slower and a
 * timeout costs the whole list; small next to `deliver.ts`'s 120 s, because
 * nothing here waits on a model.
 */
export const INITIALIZE_TIMEOUT_MS = 20_000;

/** Enough of a description to tell two commands apart in a 408px column. */
export const MAX_BUILTIN_DESCRIPTION = 120;

/** Enough of what the CLI said to act on, without pasting a whole stack. */
const MAX_CLI_MESSAGE = 400;

/** Bounds the read: the handshake is one line, everything else is chatter. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * How long a FAILED answer is remembered. A CLI installed while vam is running
 * has to become visible eventually; a broken one must not cost a process on
 * every ten-second poll.
 */
export const FAILURE_COOLDOWN_MS = 5 * 60_000;

/** The id vam stamps on its one request, and matches on the way back. */
export const INITIALIZE_REQUEST_ID = 'vam-initialize';

export type BuiltinCommandList =
  | { readonly kind: 'ok'; readonly commands: readonly SlashCommand[] }
  | { readonly kind: 'unavailable'; readonly code: string; readonly message: string };

const unavailable = (code: string, message: string): BuiltinCommandList => ({
  kind: 'unavailable',
  code,
  message,
});

/**
 * The exact argv, written out so a reader can see there is no prompt in it.
 *
 * `--safe-mode` is the load-bearing flag -- see the module header for what
 * happens without it. `-p` with `--input-format stream-json` is what opens the
 * control channel; `--verbose` is required by the CLI for stream-json output
 * and is not a debugging leftover. `--no-session-persistence` keeps the
 * throwaway session off the operator's disk and `--strict-mcp-config` keeps it
 * from starting their MCP servers to answer a question about command names.
 */
export function builtinCommandsArgv(): readonly string[] {
  return [
    '--safe-mode',
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--strict-mcp-config',
  ];
}

/** The one line vam ever writes to that process. */
export function initializeRequestLine(): string {
  return `${JSON.stringify({
    type: 'control_request',
    request_id: INITIALIZE_REQUEST_ID,
    request: { subtype: 'initialize' },
  })}\n`;
}

const clip = (text: string): string =>
  text.trim().length > MAX_CLI_MESSAGE
    ? `${text.trim().slice(0, MAX_CLI_MESSAGE)}...`
    : text.trim();

/**
 * One description, as the popover will carry it.
 *
 * CLIPPED, and the reason is the payload rather than the pixel: a skill's
 * description in this answer can run past a thousand characters (its whole
 * trigger list), the list is stamped on every session, and every session
 * travels over IPC and over the phone server's JSON on every poll. 52 full
 * descriptions measured ~19 KB; clipped they are ~5 KB.
 *
 * The clip is visible (`…`) and it is a DESCRIPTION -- the command NAME, which
 * is the only text that ever gets written into the composer, is never touched.
 * It does narrow matching: `matchSlashCommands` reads the description too, so
 * a word that only appeared in the tail of a paragraph no longer finds it.
 * That is the trade, stated rather than discovered.
 */
function describe(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return text.length > MAX_BUILTIN_DESCRIPTION
    ? `${text.slice(0, MAX_BUILTIN_DESCRIPTION)}…`
    : text;
}

/** The `commands` array out of a `control_response`, or `null` if this is not one. */
function commandsIn(line: string): { readonly commands: unknown[] } | 'refused' | null {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  const envelope = (message ?? {}) as Record<string, unknown>;
  if (envelope['type'] !== 'control_response') return null;
  const response = (envelope['response'] ?? {}) as Record<string, unknown>;
  if (response['subtype'] !== 'success') return 'refused';
  const inner = (response['response'] ?? {}) as Record<string, unknown>;
  const commands = inner['commands'];
  return Array.isArray(commands) ? { commands } : null;
}

/**
 * The CLI's stream, into the list or into a reason there is none.
 *
 * NEVER AN EMPTY LIST, and that is the rule this whole file is written around
 * (`pull-requests.ts` states it): "the CLI has no built-in commands" is not a
 * thing that happens, so every shape that is not a populated list is vam
 * failing to ask, and says so in its own words. A short list nobody can tell
 * from a real one is the failure this feature could most easily ship.
 */
export function parseBuiltinCommands(stdout: string): BuiltinCommandList {
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const found = commandsIn(line);
    if (found === null) continue;
    if (found === 'refused') {
      return unavailable('refused', 'the Claude Code CLI declined to list its commands');
    }
    const commands: SlashCommand[] = [];
    for (const entry of found.commands) {
      const record = (entry ?? {}) as Record<string, unknown>;
      const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
      if (name === '') continue;
      commands.push({ id: `builtin:${name}`, name, description: describe(record['description']) });
    }
    if (commands.length === 0) {
      return unavailable(
        'empty-list',
        'the Claude Code CLI answered without naming any command, which no working version does',
      );
    }
    return { kind: 'ok', commands: commands.sort((a, b) => a.name.localeCompare(b.name)) };
  }
  return unavailable(
    'no-response',
    'the Claude Code CLI did not answer vam’s request for its command list',
  );
}

/** What a failed spawn hands back. Written out for `deliver.ts`'s reason. */
export type SpawnFailure = {
  readonly message?: string | undefined;
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
};

/** Turn a failed handshake into a distinct, honest reason. */
export function classifyInitializeFailure(
  failure: SpawnFailure,
  stderr: string,
): { readonly kind: 'unavailable'; readonly code: string; readonly message: string } {
  if (failure.code === 'ENOENT') {
    return {
      kind: 'unavailable',
      code: 'cli-missing',
      message: cliMissingMessage('claude', 'vam cannot list Claude Code’s own commands'),
    };
  }
  if (failure.killed === true) {
    return {
      kind: 'unavailable',
      code: 'timed-out',
      message: `the Claude Code CLI did not list its commands within ${Math.round(
        INITIALIZE_TIMEOUT_MS / 1000,
      )}s`,
    };
  }
  const said = clip(stderr);
  return {
    kind: 'unavailable',
    code: 'cli-failed',
    message:
      said === ''
        ? 'asking the Claude Code CLI for its commands failed, and it said nothing about why'
        : `asking the Claude Code CLI for its commands failed: ${said}`,
  };
}

/** Kill the child however it is still alive; nothing here waits on it. */
function stop(child: ChildProcess): void {
  try {
    child.kill('SIGKILL');
  } catch {
    // Already gone. Nothing to report: this is cleanup, not the answer.
  }
}

/**
 * Ask the installed CLI, once.
 *
 * `spawn` rather than `execFile` because the process must be KILLED as soon as
 * the answer arrives: with no prompt to run it would otherwise sit on its open
 * stdin until the timeout, and `execFile` only resolves when the child exits.
 * Argv is an array and no shell is involved.
 */
export function readBuiltinSlashCommands(binary = 'claude'): Promise<BuiltinCommandList> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(binary, [...builtinCommandsArgv()], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve(classifyInitializeFailure(error as SpawnFailure, ''));
      return;
    }
    let out = '';
    let err = '';
    let settled = false;
    const finish = (result: BuiltinCommandList) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop(child);
      resolve(result);
    };
    const timer = setTimeout(
      () => finish(classifyInitializeFailure({ killed: true }, err)),
      INITIALIZE_TIMEOUT_MS,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      if (out.length > MAX_OUTPUT_BYTES) return;
      out += chunk.toString();
      // Answered as soon as the one line vam wants has arrived: waiting for
      // exit would mean waiting out the timeout on a process nothing will
      // ever send a prompt to.
      if (out.includes('"control_response"')) finish(parseBuiltinCommands(out));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (err.length > MAX_OUTPUT_BYTES) return;
      err += chunk.toString();
    });
    child.on('error', (error) => finish(classifyInitializeFailure(error as SpawnFailure, err)));
    child.on('close', (code) => {
      // A close before the answer is a failure whatever the exit status: the
      // list is what was asked for, and not getting it is not a success.
      finish(
        out.includes('"control_response"')
          ? parseBuiltinCommands(out)
          : classifyInitializeFailure({ code: code ?? undefined }, err),
      );
    });
    try {
      child.stdin?.write(initializeRequestLine());
    } catch {
      // A stdin that is already closed shows up as an `error`/`close` above;
      // there is nothing better to say here than what those will say.
    }
  });
}

/**
 * ONE QUESTION PER PROCESS, and the reason is the poll.
 *
 * `useSourceModel` calls `load()` every ten seconds. The installed CLI does
 * not change under a running app, so asking it per load would spend a process
 * and a second of wall clock, forever, on an answer that cannot have moved --
 * exactly the cost `PR_READER` exists to avoid, and the same shape: one object
 * for the life of the process, not one per `load()`.
 *
 * A FAILURE IS NOT REMEMBERED FOREVER. `claude` installed (or repaired) while
 * vam is running has to become visible without a restart, so a failed answer
 * ages out after `FAILURE_COOLDOWN_MS` and is asked again -- but not on the
 * next poll, which would be a process every ten seconds for a broken setup.
 */
export function createBuiltinCommandReader(
  ask: () => Promise<BuiltinCommandList> = () => readBuiltinSlashCommands(),
  now: () => number = Date.now,
): () => Promise<BuiltinCommandList> {
  let pending: Promise<BuiltinCommandList> | null = null;
  let failedAt: number | null = null;
  return () => {
    if (pending !== null && (failedAt === null || now() - failedAt < FAILURE_COOLDOWN_MS)) {
      return pending;
    }
    const asked = ask().catch(
      (error): BuiltinCommandList => classifyInitializeFailure(error as SpawnFailure, ''),
    );
    failedAt = null;
    pending = asked.then((result) => {
      if (result.kind === 'unavailable') failedAt = now();
      return result;
    });
    return pending;
  };
}
