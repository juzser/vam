/**
 * THE STATEFUL HALF of the control-mode fast path: one persistent `tmux -C`
 * child per tmux SERVER, so a keystroke's send and its echo read ride an
 * already-open connection instead of paying `execFile`'s fork+exec twice.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * MEASURED end to end, on the real send/read chain, through the real
 * renderer bundle (`e2e/terminal-typing-latency-shots.mjs`, this task's own
 * report): a steady keystroke's `sendRoundTrip` and `captureRoundTrip` stages
 * -- the two `execFile` spawns `sendToPane` and `readAimedPane` each make --
 * were ~7ms and ~7ms of a ~15ms median keydown-to-painted total, over 90% of
 * it. `ECHO_MS`, `REFRESH_MS` and the screen-only echo read (`TerminalTab.tsx`,
 * `argv.ts`) had already cut everything ELSE on this chain; the two spawns
 * were what was left, and this removes them from the steady-typing path
 * entirely -- `CLAIMED_SPAWNS_PER_KEYSTROKE` in that same guard asserts `0`.
 *
 * ── WHAT THIS IS A DROP-IN REPLACEMENT FOR ─────────────────────────────────
 * `createControlTmuxRunner()` returns a `TmuxRun`, the exact type
 * `createTmuxRunner()` returns (`spawn.ts`) -- so every caller downstream
 * (`readPane`, `sendToPane`, `listVamSessions`, `resizeWindow`, and
 * everything built on them in `terminal/pane.ts` and `terminal/ipc.ts`) is
 * unchanged. Only `main/index.ts`'s ONE wiring line for the Terminal tab's
 * own runner is touched; every OTHER `createTmuxRunner()` call site in this
 * codebase (session creation, prompt delivery, the claude-code and codex
 * sources' own periodic listings) is untouched and keeps spawning exactly as
 * it always has -- this is not on any of their paths and has no reason to be.
 *
 * ── DEGRADE, NEVER BLOCK ────────────────────────────────────────────────────
 * `encodeControlLine` (`control-protocol.ts`) already turns any argv it does
 * not recognise into a `null` that sends the caller straight to a real spawn
 * -- `new-session`, `set-option` and `kill-session` never reach this file at
 * all. WITHIN what it does recognise, THIS file adds the other half of the
 * same rule: no persistent connection yet, a connection that just died, a
 * write that throws, or a reply that does not arrive within
 * `CONTROL_TIMEOUT_MS` all resolve the call through `fallback` -- a plain
 * `execFile`, the exact call this whole file exists to avoid paying for on
 * every keystroke, kept as the one answer that is always correct even when
 * the optimisation is not available. A dead client is retried lazily, backed
 * off by `RECONNECT_BACKOFF_MS` so a genuinely missing `tmux` binary cannot
 * turn every keystroke into a repeated connection attempt.
 *
 * ── ONE CLIENT PER SERVER ───────────────────────────────────────────────────
 * Keyed by `splitServerPrefix`'s own key (`control-protocol.ts`): production
 * runs the default server (`main/index.ts` calls `createTmuxRunner()` with no
 * `-L`), every private-socket test and this task's own e2e harnesses run
 * their own `-L <socket>` -- and a client bootstrapped for one must never be
 * asked to answer for the other, which a shared map keyed on anything less
 * than the exact prefix would risk.
 *
 * ── EXACTLY ONE COMMAND IN FLIGHT AT A TIME ────────────────────────────────
 * `run` chains through `this.#chain`, the same shape
 * `TerminalTab.tsx`'s own `chain.current` uses to serialise sends: a second
 * command is never written to the child's stdin until the first's reply (or
 * its timeout) has resolved, so there is exactly one `#pending` entry to
 * match a `%begin`/`%end` pair against and never a question of which command
 * a reply belongs to.
 */

import { spawn } from 'node:child_process';
import {
  CONTROL_SESSION_NAME,
  type ControlBlock,
  ControlFramer,
  encodeControlLine,
  reconstructResult,
  splitServerPrefix,
} from './control-protocol.js';
import { createTmuxRunner, type TmuxRun, type TmuxRunResult } from './spawn.js';

/**
 * How long a reply may take before this gives up on the persistent
 * connection for THIS call and answers through `fallback` instead. Mirrors
 * `spawn.ts`'s own `TMUX_TIMEOUT_MS`: the same "a slow tmux is a broken one"
 * judgment applies here, and a shorter number would risk timing out a
 * healthy reply on a loaded machine -- exactly the machine this file exists
 * to help.
 */
export const CONTROL_TIMEOUT_MS = 10_000;

/**
 * How long after the connection dies before the next call tries to
 * reconnect, rather than paying a fresh connection attempt (and its own
 * failure) on every single keystroke while `tmux` is genuinely unreachable.
 */
export const RECONNECT_BACKOFF_MS = 2_000;

/** The housekeeping session's harmless, never-drawn size. */
const CONTROL_WINDOW_SIZE = { columns: 10, rows: 4 } as const;

/** The minimum shape this file needs from a spawned child -- narrow on
 * purpose so a test can hand it a fake without an event loop underneath. */
export type ControlChildProcess = {
  readonly stdin: { write(data: string): boolean };
  readonly stdout: { on(event: 'data', listener: (chunk: unknown) => void): void };
  on(event: 'exit' | 'error', listener: (...args: unknown[]) => void): void;
  kill(): void;
};

export type SpawnControlChild = (binary: string, argv: readonly string[]) => ControlChildProcess;

/** The real spawn, wrapping `node:child_process` behind this file's narrow shape. */
export const spawnRealControlChild: SpawnControlChild = (binary, argv) => spawn(binary, [...argv]);

type Pending = {
  readonly needed: number;
  readonly collected: ControlBlock[];
  readonly finish: (result: TmuxRunResult) => void;
  readonly onDown: () => void;
};

/**
 * One persistent connection to one tmux server. Not exported: reached only
 * through `createControlTmuxRunner`, which owns the one-per-server pool.
 */
class ControlClient {
  #binary: string;
  #prefix: readonly string[];
  #fallback: TmuxRun;
  #spawnChild: SpawnControlChild;
  #now: () => number;

  #child: ControlChildProcess | null = null;
  #framer = new ControlFramer();
  #pending: Pending | null = null;
  #timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  #deadUntil = 0;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(input: {
    binary: string;
    prefix: readonly string[];
    fallback: TmuxRun;
    spawnChild: SpawnControlChild;
    now: () => number;
  }) {
    this.#binary = input.binary;
    this.#prefix = input.prefix;
    this.#fallback = input.fallback;
    this.#spawnChild = input.spawnChild;
    this.#now = input.now;
  }

  /**
   * `argv` is the ORIGINAL, unencoded call -- kept only so a fallback can
   * still run the real thing; `encoded` is what `createControlTmuxRunner`
   * already turned it into, so this never re-derives it.
   */
  run(argv: readonly string[], encoded: { line: string; blocks: number }): Promise<TmuxRunResult> {
    const result = this.#chain.then(() => this.#runOne(argv, encoded));
    // A settled promise, always -- `#runOne` never rejects, it falls back --
    // so the chain can never wedge on one bad call.
    this.#chain = result;
    return result;
  }

  async #runOne(
    argv: readonly string[],
    encoded: { line: string; blocks: number },
  ): Promise<TmuxRunResult> {
    const connected = await this.#ensureConnected();
    if (!connected || this.#child === null) return this.#fallback(argv);
    const child = this.#child;
    return new Promise<TmuxRunResult>((resolve) => {
      this.#timeoutHandle = setTimeout(() => {
        this.#pending = null;
        this.#timeoutHandle = undefined;
        // A REPLY THAT NEVER ARRIVED MEANS THIS CONNECTION CAN NO LONGER BE
        // TRUSTED TO PAIR REPLIES TO COMMANDS. Timing out never told tmux to
        // stop working on the line this wrote -- its real reply can still
        // land later -- so the only way to guarantee it is never mistaken
        // for the NEXT command's answer is to stop listening to THIS child
        // altogether. `#onDown` will also fire once the kill takes effect;
        // harmless, since it is gated on `this.#child === child` below and
        // this has already cleared that.
        if (this.#child === child) {
          this.#child = null;
          this.#deadUntil = this.#now() + RECONNECT_BACKOFF_MS;
        }
        child.kill();
        this.#fallback(argv).then(resolve);
      }, CONTROL_TIMEOUT_MS);
      this.#pending = {
        needed: encoded.blocks,
        collected: [],
        finish: resolve,
        onDown: () => this.#fallback(argv).then(resolve),
      };
      try {
        child.stdin.write(`${encoded.line}\n`);
      } catch {
        this.#pending = null;
        if (this.#timeoutHandle !== undefined) clearTimeout(this.#timeoutHandle);
        this.#timeoutHandle = undefined;
        this.#fallback(argv).then(resolve);
      }
    });
  }

  async #ensureConnected(): Promise<boolean> {
    if (this.#child !== null) return true;
    if (this.#now() < this.#deadUntil) return false;
    try {
      const child = this.#spawnChild(this.#binary, [
        ...this.#prefix,
        '-C',
        'new-session',
        '-A',
        '-s',
        CONTROL_SESSION_NAME,
        '-x',
        String(CONTROL_WINDOW_SIZE.columns),
        '-y',
        String(CONTROL_WINDOW_SIZE.rows),
        // A fixed, minimal program rather than the operator's own `$SHELL`:
        // this session is never drawn or read, and the operator's shell
        // init (aliases, prompt, rc files) would run for no reader every
        // time this reconnects. MEASURED: an unattached `-A new-session`
        // with no trailing command instead ran a real interactive shell
        // and printed its full prompt-init escape sequences on this
        // connection, which `#onData` would then have had to skip.
        'cat',
      ]);
      // A FRESH FRAMER PER CONNECTION, deliberately never reused: a block
      // this parser had not yet closed when the OLD connection died is lost
      // with it, rather than answered against whatever the NEW connection's
      // first reply happens to be (`control-protocol.ts`'s own note).
      this.#framer = new ControlFramer();
      // EVERY CALLBACK IS GATED ON `this.#child === child`. Node does not
      // guarantee a killed child's queued events stop firing the instant
      // `kill()` returns -- already-buffered stdout can still arrive as one
      // more `'data'`, and `'exit'` always arrives asynchronously -- so a
      // callback bound to THIS child must first ask whether it is still the
      // one `this.#child` names before it is allowed to touch any shared
      // state. Without it, a late event from a connection this file already
      // gave up on (the timeout above, or a real crash) could null out -- or
      // worse, resolve a pending command against -- whatever connection
      // replaced it in the meantime.
      child.stdout.on('data', (chunk) => {
        if (this.#child === child) this.#onData(String(chunk));
      });
      const onDown = () => {
        if (this.#child === child) this.#onDown();
      };
      child.on('exit', onDown);
      child.on('error', onDown);
      this.#child = child;
      return true;
    } catch {
      this.#deadUntil = this.#now() + RECONNECT_BACKOFF_MS;
      return false;
    }
  }

  #onData(chunk: string): void {
    const blocks = this.#framer.feed(chunk);
    if (blocks.length === 0) return;
    const pending = this.#pending;
    // A reply with nothing left listening for it -- the command it answers
    // already timed out and fell back (and, since this connection is still
    // the current one, was NOT one this file gave up the connection over).
    // Dropped, not queued: there is no later caller who could still want it.
    if (pending === null) return;
    pending.collected.push(...blocks);
    if (pending.collected.length < pending.needed) return;
    this.#pending = null;
    if (this.#timeoutHandle !== undefined) clearTimeout(this.#timeoutHandle);
    this.#timeoutHandle = undefined;
    pending.finish(reconstructResult(pending.collected.slice(0, pending.needed)));
  }

  #onDown(): void {
    this.#child = null;
    this.#deadUntil = this.#now() + RECONNECT_BACKOFF_MS;
    const pending = this.#pending;
    this.#pending = null;
    if (this.#timeoutHandle !== undefined) clearTimeout(this.#timeoutHandle);
    this.#timeoutHandle = undefined;
    pending?.onDown();
  }

  /** Best-effort teardown -- app shutdown, or a test that spawned a real one. */
  dispose(): void {
    this.#child?.kill();
    this.#child = null;
  }
}

/**
 * The drop-in `TmuxRun`. A `.dispose()` is attached to the returned function
 * (functions are objects; every other `TmuxRun` in this codebase ignores an
 * extra property it does not know about) so a caller that wants a clean
 * shutdown -- `main/index.ts`, on app quit -- has something to call; nothing
 * requires it; a killed app leaves an idle, harmless `tmux -C` client behind,
 * exactly as an ordinary tmux client left attached does.
 */
export function createControlTmuxRunner(
  binary = 'tmux',
  options?: {
    readonly fallback?: TmuxRun;
    readonly spawnChild?: SpawnControlChild;
    readonly now?: () => number;
  },
): TmuxRun & { dispose(): void } {
  const fallback = options?.fallback ?? createTmuxRunner(binary);
  const spawnChild = options?.spawnChild ?? spawnRealControlChild;
  const now = options?.now ?? (() => Date.now());
  const clients = new Map<string, ControlClient>();

  const runner = (async (argv: readonly string[]): Promise<TmuxRunResult> => {
    const split = splitServerPrefix(argv);
    if (split === null) return fallback(argv);
    const encoded = encodeControlLine(split.rest);
    if (encoded === null) return fallback(argv);
    let client = clients.get(split.key);
    if (client === undefined) {
      client = new ControlClient({ binary, prefix: split.prefix, fallback, spawnChild, now });
      clients.set(split.key, client);
    }
    return client.run(argv, encoded);
  }) as TmuxRun & { dispose(): void };

  runner.dispose = () => {
    for (const client of clients.values()) client.dispose();
    clients.clear();
  };

  return runner;
}
