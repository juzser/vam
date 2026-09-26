/**
 * The Terminal tab's STREAMING half: one persistent `tmux -C` connection per
 * OPEN, VISIBLE Terminal-stream view, attached directly to the session the
 * operator is looking at, so xterm.js can be fed `%output` instead of
 * polling `capture-pane` on a timer.
 *
 * Ported from the terminal-streaming spike's own `StreamClient`
 * (`terminal-stream-spike`, `src/main/terminal/stream/client.ts`), closing
 * the gaps that prototype named as scope cuts. See
 * `docs/design/terminal-streaming.md` for the measured latency win and the
 * three real tmux bugs a cross-review found.
 *
 * ── WHY A NEW CLIENT PER VIEW RATHER THAN ONE MORE VERB ON `ControlClient` ──
 * `control.ts`'s `ControlClient` runs exactly one command at a time and
 * answers it with exactly one client-visible reply. A client that is
 * ATTACHED also receives push notifications (`%output`) interleaved with any
 * reply it is waiting on -- a different shape of connection, which is why
 * this reuses `ControlFramer.feedEvents()` (the same shared block-parser
 * `control.ts` uses, via `feed()`) rather than a second parser.
 *
 * ── WHY THIS NEVER RESIZES ────────────────────────────────────────────────
 * `refresh-client -C` (what the spike used to declare this client's own
 * size) is a per-client report, unverified against a second real client and
 * flagged as an unresolved risk in the design doc's own Risks section. This
 * client therefore has NO resize method at all: the renderer calls the
 * EXISTING `window.api.terminal.resize(...)` (`resize-window`, already wired
 * through `terminal/pane.ts`), which resizes the whole window; the running
 * program's own redraw for its new size simply arrives as ordinary `%output`
 * on this already-open connection. Nobody should re-add `refresh-client -C`
 * here without re-reading why it was left out.
 *
 * ── THE TARGET IS VALIDATED, NOT TRUSTED (a review finding) ────────────────
 * Every other control-mode caller in this codebase builds its line through
 * `control-protocol.ts`'s `encodeSegment`, which refuses (falls back to a
 * real spawn) anything that does not match `SAFE_TARGET_RE`. THIS file does
 * not go through that function at all -- it is an ATTACHED connection, not a
 * `TmuxRun` call -- so nothing stopped `#target` from being interpolated
 * straight into a hand-built control-mode line. In production `#target`
 * always comes from `targetSession` (`terminal/pane.ts`), which only ever
 * returns a name `listVamSessions` read off a REAL tmux `list-sessions`, and
 * every name vam itself creates already passes `vamSessionName`'s own
 * `UNSAFE_NAME` filter -- so this was not reachable through vam's own UI.
 * It is still fixed here: tmux's control-mode line grammar performs
 * shell-like expansion (`control-protocol.ts`'s own module note), so a
 * session name carrying a `;`, a quote or a space -- however it got there,
 * including a session an operator created by hand outside vam and then
 * tagged to look like one of vam's own -- could inject a second command
 * onto a line this file writes verbatim. `#targetValid` is checked ONCE, in
 * `connect()`, before anything is ever spawned; every other method that
 * builds a line only ever runs downstream of a successful `connect()`, so
 * one check at that single entry point covers the whole class.
 */

import { StringDecoder } from 'node:string_decoder';
import { CURSOR_FORMAT } from '../../sources/tmux/argv.js';
import {
  CONTROL_TIMEOUT_MS,
  type ControlChildProcess,
  RECONNECT_BACKOFF_MS,
  type SpawnControlChild,
  spawnRealControlChild,
} from '../../sources/tmux/control.js';
import {
  ControlFramer,
  type ControlFramerEvent,
  hexBytes,
  SAFE_TARGET_RE,
} from '../../sources/tmux/control-protocol.js';
import { NO_SESSION } from '../../sources/tmux/spawn.js';
import { seedWithCursor } from './seed.js';

export type { ControlChildProcess, SpawnControlChild } from '../../sources/tmux/control.js';

/** `=<name>:` -- the session target, exactly `argv.ts`'s own `target()`. */
const paneTarget = (name: string): string => `=${name}:`;

/**
 * How many consecutive failed reconnect attempts this file makes before it
 * gives up on a dropped connection entirely (a review finding: the loop was
 * unbounded). Five, the same order of magnitude `control.ts`'s own
 * `CONTROL_TIMEOUT_MS`/`RECONNECT_BACKOFF_MS` pair picks its numbers at --
 * enough to ride out a brief blip (the operator's laptop sleeping for a few
 * seconds, a loaded machine) without retrying forever against a server that
 * is genuinely gone. Once given up, THIS `StreamClient` instance stays down
 * for good; `stream-ipc.ts` mints a brand new one -- with its own fresh
 * attempt counter -- the next time the renderer's own visibility-driven
 * reconnect (`TerminalStreamTab.tsx`) opens a stream again.
 */
export const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * The ceiling the exponential backoff (`RECONNECT_BACKOFF_MS * 2^attempt`)
 * is clamped to, so the LAST couple of attempts before giving up do not
 * each wait minutes. Eight times the base backoff -- generous headroom
 * over a laptop waking from sleep, short of making the operator wait
 * through a full minute before the pane visibly gives up.
 */
export const MAX_RECONNECT_BACKOFF_MS = RECONNECT_BACKOFF_MS * 8;

/**
 * `refresh-client -f pause-after=<N>` seconds -- without this flag tmux
 * NEVER sends `%pause` at all (MEASURED against a real tmux 3.7b on a
 * private socket, a 20ms-per-chunk slow consumer draining a 5MB flood: zero
 * `%pause` in 8s of continuous `%extended-output`), so an unbounded backlog
 * can pile up in this file's own read buffer, the IPC bridge to the
 * renderer, and xterm's write queue while a long flood is in flight (a
 * verbose build log, `cat` of a large file). `1` -- the low end of the
 * operator's suggested 1-2s range -- bounds that backlog to roughly one
 * second's worth of output before tmux itself stops pumping the pty to this
 * client, while staying well above the round-trip cost of an ordinary
 * IPC hop, so a ordinary burst (a fast `ls`, a shell prompt redraw) never
 * spuriously pauses. This client is never the one CHOOSING to fall behind --
 * see `#continueAfterPause` -- so pause-after here is a backstop against a
 * stalled drain, not a throttle this file ever wants to hold open.
 */
export const PAUSE_AFTER_SECONDS = 1;

/** What `onDown` hands its listeners -- a transient drop this file is still
 * trying to recover from, or a permanent give-up and why. */
export type StreamDownEvent =
  | { readonly kind: 'reconnecting'; readonly attempt: number }
  | { readonly kind: 'gave-up'; readonly reason: 'max-attempts' | 'session-gone' };

export type StreamClientOptions = {
  readonly binary?: string;
  readonly prefix: readonly string[];
  /** The resolved tmux session name -- see `terminal/pane.ts:targetSession`.
   * Validated against `SAFE_TARGET_RE` before this file ever spawns
   * anything -- see the module header. */
  readonly target: string;
  readonly spawnChild?: SpawnControlChild;
};

/** One control-mode block reply -- `ok` carries the SAME distinction
 * `ControlBlock` always has (a `%end` vs a `%error`), which the reconnect
 * logic below reads to tell "the session is gone" (a real `%error` body)
 * apart from "the connection dropped again mid-reconnect" (flushed with an
 * empty body by `#handleDown`, which already owns rescheduling for that
 * case -- see `#reconnect`'s own note). */
type BlockResult = { readonly ok: boolean; readonly body: string };
type PendingBlock = {
  readonly resolve: (result: BlockResult) => void;
  /** Reference-identity marker shared by every entry ONE `#sendChain` call
   * pushes for its `;`-chained line -- lets the block handler recognise
   * "this reply's siblings, still queued right behind it, belong to the
   * SAME chain" without threading a separate id counter through, and
   * without risking a false match against an unrelated `#send()` (which
   * never sets this) or a LATER, unrelated chain. `undefined` for a plain
   * `#send()`, which only ever expects exactly one reply and has nothing
   * to abort-flush. */
  readonly chain?: object;
};

/**
 * One connection, attached to the session's window, for as long as the
 * operator has that Terminal view's streaming mode open.
 */
export class StreamClient {
  #binary: string;
  #prefix: readonly string[];
  #target: string;
  #spawnChild: SpawnControlChild;

  #child: ControlChildProcess | null = null;
  #framer = new ControlFramer();
  #decoder = new StringDecoder('utf8');
  #paneId: string | null = null;
  #blockQueue: PendingBlock[] = [];
  #dataListeners = new Set<(chunk: string) => void>();
  #seedListeners = new Set<(seed: string) => void>();
  #downListeners = new Set<(event: StreamDownEvent) => void>();
  #disposed = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  /** How many reconnect attempts have been scheduled in a row since the
   * last SUCCESSFUL (re)connection -- drives the exponential backoff and
   * the `MAX_RECONNECT_ATTEMPTS` cutoff (a review finding: this loop used
   * to be unbounded, fixed-interval). Reset to `0` on every successful
   * reseed, whether the initial `connect()` or a later `#reconnect()`. */
  #reconnectAttempts = 0;
  /** `true` once this client has given up reconnecting for good (either
   * `MAX_RECONNECT_ATTEMPTS` was reached, or a reconnect attempt learned
   * the session itself is gone) -- from here on this instance is inert:
   * no more spawns, no more `onDown` events. A fresh `StreamClient` (a
   * fresh `open()` from the renderer) is the only way back. */
  #givenUp = false;
  /** `true` once `#target` failed `SAFE_TARGET_RE` -- checked once, in
   * `connect()`, before anything is ever spawned (module header). */
  #targetValid: boolean;
  /** `false` until `capture-pane`'s own reply has landed for the CURRENT
   * connection. `%output` for the resolved pane is dropped while this is
   * `false`: it describes activity already folded into the seed text. */
  #seeded = false;
  /** `true` between a `%pause` for this client's own pane and the matching
   * `%continue`/`%unpause` -- tmux told this client it fell behind, so
   * `%output` arriving in between is not trusted to be complete and is
   * dropped rather than forwarded; the reseed after `%continue` is what
   * catches listeners back up. */
  #paused = false;
  /** `true` from the moment `#continueAfterPause` sends its own
   * `refresh-client -A "<pane>:continue"` until that command's reply lands
   * -- guards against writing a second one if `%pause` (for whatever real
   * tmux reason) arrives again before the first round-trip finishes, and
   * against the defensive bare-`%continue`/`%unpause` branch below double-
   * reseeding while that round-trip is already in flight. */
  #resuming = false;

  constructor(options: StreamClientOptions) {
    this.#binary = options.binary ?? 'tmux';
    this.#prefix = options.prefix;
    this.#target = options.target;
    this.#spawnChild = options.spawnChild ?? spawnRealControlChild;
    this.#targetValid = SAFE_TARGET_RE.test(paneTarget(this.#target));
  }

  get paneId(): string | null {
    return this.#paneId;
  }

  /**
   * Attach, resolve the pane id and seed the initial screen -- resolves with
   * `seedWithCursor`'s own composed body (the RAW `capture-pane -p -e -N`
   * text, escape sequences intact, with tmux's own cursor position appended
   * as a trailing CSI escape -- see `seed.ts`'s own header for why; this
   * file used to ask for `-J` and hand `xterm.write()` nothing but the
   * plain text dump, which is what that flag named here until the cursor
   * fix replaced it) -- exactly what `xterm.write()` wants.
   */
  async connect(): Promise<string> {
    // THE ONE VALIDATION GATE (module header) -- refused BEFORE anything is
    // spawned, so an unsafe target never reaches tmux's control-mode line
    // parser at all.
    if (!this.#targetValid) {
      throw new Error(
        `StreamClient refuses to attach: "${this.#target}" is not a safe tmux session target`,
      );
    }
    const child = this.#spawn();
    this.#wire(child);
    await this.#requestPauseAfter();
    const panes = await this.#send(`list-panes -t ${paneTarget(this.#target)} -F "#{pane_id}"`);
    if (!panes.ok) {
      throw new Error(`could not list panes for ${this.#target}: ${panes.body.trim()}`);
    }
    const paneId = panes.body.split('\n').find((line) => line.length > 0);
    if (paneId === undefined) throw new Error(`no panes for ${this.#target}`);
    this.#paneId = paneId;
    const seed = await this.#reseed();
    if (!seed.ok) {
      throw new Error(
        `could not capture the initial screen for ${this.#target}: ${seed.body.trim()}`,
      );
    }
    return seed.body;
  }

  /** Decoded `%output` for this client's own pane. Returns an unsubscribe. */
  onData(listener: (chunk: string) => void): () => void {
    this.#dataListeners.add(listener);
    return () => this.#dataListeners.delete(listener);
  }

  /** A fresh seed -- fired on reconnect and on `%pause`/`%continue`, never
   * on the initial `connect()` (whose return value already is the first
   * seed). Returns an unsubscribe. */
  onSeed(listener: (seed: string) => void): () => void {
    this.#seedListeners.add(listener);
    return () => this.#seedListeners.delete(listener);
  }

  /** Fired whenever the connection drops (a `reconnecting` event, before
   * this client tries again) and once more, finally, if it ever gives up
   * for good (a `gave-up` event, `MAX_RECONNECT_ATTEMPTS` reached or the
   * session found to be gone) -- so the IPC layer, and through it the
   * renderer, can show something truer than a silently frozen pane.
   * Returns an unsubscribe. */
  onDown(listener: (event: StreamDownEvent) => void): () => void {
    this.#downListeners.add(listener);
    return () => this.#downListeners.delete(listener);
  }

  /**
   * Send raw text (xterm's own `onData`) as keystrokes -- fire-and-forget,
   * exactly `sendTextArgv`'s own reasoning: nothing downstream of a keypress
   * needs to know the SEND landed, only what tmux prints back, which arrives
   * as `%output`. Never re-sent on reconnect (see the module header and
   * `control.ts`'s own A2 note): there is nothing to resubmit safely for a
   * write this client never tracked past the moment it wrote it.
   */
  write(text: string): void {
    if (this.#child === null || this.#disposed) return;
    const hex = hexBytes(text).join(' ');
    this.#write(`send-keys -t ${paneTarget(this.#target)} -H ${hex}`);
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#dataListeners.clear();
    this.#seedListeners.clear();
    this.#downListeners.clear();
    this.#child?.kill();
    this.#child = null;
  }

  #spawn(): ControlChildProcess {
    return this.#spawnChild(this.#binary, [
      ...this.#prefix,
      '-C',
      'attach-session',
      '-t',
      paneTarget(this.#target),
    ]);
  }

  #wire(child: ControlChildProcess): void {
    this.#child = child;
    this.#framer = new ControlFramer();
    this.#decoder = new StringDecoder('utf8');
    this.#seeded = false;
    this.#paused = false;
    this.#resuming = false;
    child.stdout.on('data', (chunk) => {
      if (this.#child === child) this.#onData(this.#decoder.write(chunk as Buffer));
    });
    const onDown = () => {
      if (this.#child === child) this.#handleDown();
    };
    child.on('exit', onDown);
    child.on('error', onDown);
  }

  /** A fresh `capture-pane` for the resolved pane, delivered as `%output`
   * can be trusted from again -- used by the initial `connect()` (whose
   * result IS the first seed) and by every later reseed (`%continue`,
   * reconnect), which instead push through `onSeed`. `ok` is carried
   * through unchanged: a `%error` here (the session is gone) must not be
   * mistaken for a real screen by a caller that only reads `.body`.
   *
   * CHAINED WITH A CURSOR QUERY, in ONE control-mode line (`#sendChain`),
   * exactly `argv.ts`'s `capturePaneArgv` shape -- see `seed.ts`'s own
   * header for why a plain `capture-pane` text dump on its own is not
   * enough (it carries no cursor position at all) and why this asks for
   * `-N` rather than this file's old `-J` (row-count exactness `cursor_y`
   * depends on). `seedWithCursor` turns the pair into the one body this
   * method returns -- xterm's cursor lands on tmux's own cell the moment
   * this text is written, never wherever the text itself happened to end.
   *
   * NEVER HANGS (a review finding on PR 505): this method's only `await` is
   * `#sendChain`, which is itself bounded -- see its own header for both
   * halves of that fix (an aborted chain settled the instant it happens,
   * a silent one bounded by a timeout) -- so bounding `#sendChain` bounds
   * this method overall, with nothing further needed here. */
  async #reseed(): Promise<BlockResult> {
    const target = paneTarget(this.#target);
    const results = await this.#sendChain(
      `display-message -p -t ${target} -F "${CURSOR_FORMAT}" ; capture-pane -p -e -N -t ${target}`,
      2,
    );
    const cursor = results[0];
    const screen = results[1];
    // `#sendChain(line, 2)` always resolves an array of exactly two entries
    // (it pushes exactly `count` promises before writing the line, and
    // `Promise.all` preserves both their order and count) -- this is only
    // reachable if that invariant itself is ever broken, never in ordinary
    // operation, and TypeScript's `noUncheckedIndexedAccess` cannot see that
    // invariant through a fixed-index destructure on a `readonly T[]`.
    if (cursor === undefined || screen === undefined) {
      throw new Error('StreamClient#reseed: #sendChain did not answer with two replies');
    }
    if (screen.ok) this.#seeded = true;
    return { ok: screen.ok, body: seedWithCursor(screen.body, cursor.body) };
  }

  /** Best-effort: a real tmux answers `%error` for an unsupported flag
   * rather than an unsupported request typing an unknown option, and this
   * file already refuses to offer streaming below the minimum tmux version
   * `stream-ipc.ts` gates on -- but even if the reply were ever a failure,
   * this must never block `connect()`/`#reconnect()` on it: the stream still
   * works perfectly well without `%pause` ever firing, exactly as it did
   * before this fix existed. The result is intentionally discarded. */
  async #requestPauseAfter(): Promise<void> {
    await this.#send(`refresh-client -f pause-after=${PAUSE_AFTER_SECONDS}`);
  }

  #write(line: string): void {
    try {
      this.#child?.stdin.write(`${line}\n`);
    } catch {
      // Best-effort: a write failure here is a dead connection, which
      // `#handleDown` (via the child's own 'error'/'exit') already covers.
    }
  }

  /** One command, awaiting its `%begin`/`%end`/`%error` block in order -- a
   * FIFO queue, since more than one of these can be in flight before the
   * first `%output` can arrive at all. */
  #send(line: string): Promise<BlockResult> {
    return new Promise<BlockResult>((resolve) => {
      this.#blockQueue.push({ resolve });
      this.#write(line);
    });
  }

  /**
   * A `;`-chained control-mode LINE, exactly `argv.ts`'s own `capturePaneArgv`
   * shape (cursor query first, screen read second, ONE tmux invocation) --
   * `#send` above only ever expects ONE `%begin`/`%end` per line it writes,
   * so a chained line needs its own method: `count` block replies are queued
   * in the SAME FIFO `#blockQueue` `#send` already uses (tmux answers a
   * `;`-chained line with one block PER sub-command, in order -- this file's
   * own `#handleEvent` already shifts one queued resolver per block event
   * REGARDLESS of how many were pushed for a single write, so queueing
   * `count` of them here needs no change there at all), then written as ONE
   * line so tmux runs both commands back to back with no OTHER client's
   * command -- and no `%output` this connection would otherwise have to
   * wait out -- able to land in between (`argv.ts`'s own note: "THE ORDER IS
   * LOAD-BEARING").
   *
   * NEVER HANGS (a review finding on PR 505, real-tmux MEASURED): a real tmux
   * aborts the WHOLE chained line the instant its first sub-command fails to
   * parse or otherwise errors at parse time (an unknown command, an unknown
   * flag) -- exactly ONE `%begin`/`%error`/`%end` for the entire line, and
   * every command chained after it is neither run nor answered. Before this
   * fix, `count` resolvers were queued but only the ones a real block
   * actually arrived for were ever settled, so `Promise.all` below waited
   * forever for whichever sibling tmux silently dropped. Two independent
   * backstops close that:
   *   1. `#handleEvent`'s block branch settles every remaining SIBLING of an
   *      erroring block synchronously, the instant the error itself is
   *      handled -- covers the measured case above with no timer needed.
   *   2. THIS method's own timer (`#timeoutChain`, `CONTROL_TIMEOUT_MS` --
   *      the same budget `control.ts`'s own `ControlClient` bounds a single
   *      command to, this file's only established number for "tmux never
   *      answered at all") -- covers anything (1) does not: a connection
   *      that goes fully silent rather than answering with an error at all.
   * Cleared the moment `Promise.all` itself settles, whichever backstop (or
   * neither, the ordinary case) got there first.
   */
  #sendChain(line: string, count: number): Promise<readonly BlockResult[]> {
    const chain = {};
    const results: Promise<BlockResult>[] = [];
    for (let i = 0; i < count; i += 1) {
      results.push(
        new Promise<BlockResult>((resolve) => this.#blockQueue.push({ resolve, chain })),
      );
    }
    const child = this.#child;
    this.#write(line);
    const settled = Promise.all(results);
    const timer = setTimeout(() => this.#timeoutChain(chain, child), CONTROL_TIMEOUT_MS);
    return settled.finally(() => clearTimeout(timer));
  }

  /**
   * Fires only if `#sendChain`'s own `Promise.all` has NOT already settled
   * `CONTROL_TIMEOUT_MS` after its line was written -- see that method's own
   * header for why this is the second of two backstops, not the only one.
   *
   * ALWAYS settles whatever this chain is still owed, unconditionally: even
   * if the connection itself is already gone (this chain was written to a
   * child that had already died, or died before answering at all -- either
   * way nothing else will ever pair a reply to these resolvers). Settled
   * with an EMPTY body, exactly `#handleDown`'s own flush convention below
   * -- `#reconnect`'s and `#handleReseedFailure`'s own `result.body === ''`
   * checks already read that as "this failure was already handled here,
   * take no further action", so this must never invent different text.
   *
   * THEN, ONLY if the connection itself is still THIS chain's own -- alive,
   * simply never answering -- treats it exactly like any other lost
   * connection: kills it and runs the ordinary `#handleDown` reconnect
   * bookkeeping, so a stuck reseed surfaces through `onDown` (a review
   * finding: this used to be able to leave a phantom, nobody-is-tracking
   * connection open instead). Guarded on `this.#child === child`: if the
   * connection already dropped (or a fresh one already replaced it) by the
   * time this fires, that drop's own handling already ran and this must not
   * repeat it against an unrelated child.
   */
  #timeoutChain(chain: object, child: ControlChildProcess | null): void {
    for (let i = this.#blockQueue.length - 1; i >= 0; i -= 1) {
      const entry = this.#blockQueue[i];
      if (entry !== undefined && entry.chain === chain) {
        this.#blockQueue.splice(i, 1);
        entry.resolve({ ok: false, body: '' });
      }
    }
    if (child !== null && this.#child === child) {
      child.kill();
      this.#handleDown();
    }
  }

  #onData(chunk: string): void {
    for (const event of this.#framer.feedEvents(chunk)) {
      this.#handleEvent(event);
    }
  }

  #handleEvent(event: ControlFramerEvent): void {
    if (event.kind === 'block') {
      // A1's own fix, reused here rather than a position-based "discard the
      // first block" hack (`control-protocol.ts`'s own note): a stray
      // non-reply block -- tmux's own unsolicited block on every `-C`
      // connect -- is dropped unconditionally, wherever in the connection's
      // life it arrives, never paired with a command this file wrote.
      if (!event.reply) return;
      const pending = this.#blockQueue.shift();
      if (pending === undefined) return;
      pending.resolve({ ok: event.ok, body: event.body });
      if (event.ok || pending.chain === undefined) return;
      // A CHAIN-ABORTING %error (a review finding on PR 505, real-tmux
      // MEASURED -- see `#sendChain`'s own header): tmux never runs, or
      // answers, anything chained after a failing sub-command, so every
      // SIBLING this same chain still owes a reply to never gets one on its
      // own. Settled right here, synchronously, with the SAME error text --
      // there is nothing else to give them, and `#reconnect`'s existing
      // non-empty-body handling already knows what to do with a real error.
      // Stops at the first entry that is not this chain's own (a different
      // chain, a plain `#send()`, or the queue is simply empty).
      let sibling = this.#blockQueue[0];
      while (sibling !== undefined && sibling.chain === pending.chain) {
        this.#blockQueue.shift();
        sibling.resolve({ ok: false, body: event.body });
        sibling = this.#blockQueue[0];
      }
      return;
    }
    if (event.kind === 'output') {
      if (event.paneId !== this.#paneId || !this.#seeded || this.#paused) return;
      for (const listener of this.#dataListeners) listener(event.data);
      return;
    }
    // 'other' -- %session-changed, %exit, %window-add, %layout-change, ...
    // and the two this file DOES act on: %pause/%continue (%unpause is
    // tmux's alternate spelling; coded for defensively since this was not
    // independently verified against a real tmux's exact wire text for this
    // task -- see the module header). `%extended-output` is NOT handled
    // here: `control-protocol.ts`'s `feedEvents()` already decodes it into
    // the SAME `kind: 'output'` event `%output` produces (a review finding
    // -- this file used to claim that handling in the design doc without
    // actually doing it), so it rides the branch above, with the identical
    // pane-id/seeded/paused gating. Dropping it while `#paused` is
    // deliberate, not an oversight: this file's own flow-control answer is
    // "trust nothing printed during a pause, reseed on `%continue`" rather
    // than reconstructing the gap from `%extended-output`'s age-tagged
    // chunks, and that policy should apply uniformly to every shape of pane
    // output, not just the plain one.
    this.#handlePauseOrContinue(event.line);
  }

  #handlePauseOrContinue(line: string): void {
    const pause = /^%pause (%\d+)/.exec(line);
    if (pause !== null && pause[1] === this.#paneId) {
      this.#paused = true;
      // tmux never resumes a paused pane on its own -- MEASURED against a
      // real tmux 3.7b on a private socket: a client that set `pause-after`
      // and then fell behind stayed paused for as long as it was observed,
      // with no auto-`%continue`, until an explicit `refresh-client -A
      // "<pane>:continue"` was sent. This client is never intentionally the
      // slow party (`PAUSE_AFTER_SECONDS`'s own note), so it answers every
      // pause immediately rather than waiting on anything else to decide to.
      // `#resuming` guards against writing a second one if `%pause` somehow
      // repeats before the first round-trip finishes.
      const paneId = pause[1];
      if (!this.#resuming) {
        this.#resuming = true;
        void this.#continueAfterPause(paneId);
      }
      return;
    }
    // Defensive: kept in case a future tmux (or a shape this task's own
    // measurement did not cover) ever emits a bare `%continue`/`%unpause`
    // line outside a block. `#resuming` guards against this racing the
    // primary path below, which drives the SAME reseed off the `-A`
    // command's own reply instead (see `#continueAfterPause`) -- measured:
    // the `%continue` that command produces is nested INSIDE its own
    // %begin/%end reply block, not emitted as a line like this one.
    const resume = /^%(?:continue|unpause) (%\d+)/.exec(line);
    if (resume !== null && resume[1] === this.#paneId && !this.#resuming) {
      this.#finishResume();
    }
  }

  /** The explicit resume tmux requires (see `#handlePauseOrContinue`'s own
   * note) -- `pane:state` MUST be quoted: MEASURED against a real tmux
   * 3.7b, `refresh-client -A %0:continue` (unquoted) is a parse error in
   * tmux's own command grammar, while `refresh-client -A "%0:continue"`
   * succeeds. Sent through `#send()`, not the fire-and-forget `#write()`
   * `write()` (keystrokes) uses, so its reply is tracked in `#blockQueue`
   * like every other command this file waits on, rather than risking that
   * reply being mistaken for whatever ELSE this file might be waiting on. */
  async #continueAfterPause(paneId: string): Promise<void> {
    await this.#send(`refresh-client -A "${paneId}:continue"`);
    this.#resuming = false;
    this.#finishResume();
  }

  /** Reseed after a pause resume, however it was learned about -- shared by
   * the primary (`#continueAfterPause`'s own reply landing) and defensive
   * (a bare `%continue`/`%unpause` line) paths, guarded so a pause already
   * resolved is never reseeded twice. */
  #finishResume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    // RESEED rather than trust nothing was missed while paused -- `%output`
    // that arrived during the pause was dropped above (see the module
    // header), so a fresh `capture-pane` is the only way to know the
    // screen is caught up. A FAILED reseed here (the session vanished
    // between the pause and the resume, or its chain aborted/timed out --
    // `#sendChain`'s own header) is routed through the SAME
    // `#handleReseedFailure` `#reconnect` uses below (a review finding on
    // PR 505: this used to just swallow a failed reseed here, silently --
    // nothing else was guaranteed to ever notice or retry, since `%continue`
    // implies the connection was never lost, so there may be no "next drop"
    // coming on its own to discover it through). `child` is captured before
    // the reseed rather than re-read from `this.#child` afterwards: nothing
    // else in this class changes it while this reseed is in flight, but
    // capturing it up front matches every OTHER identity check in this file
    // and costs nothing.
    const child = this.#child;
    void this.#reseed().then((result) => {
      if (result.ok) {
        for (const listener of this.#seedListeners) listener(result.body);
        return;
      }
      if (child !== null) this.#handleReseedFailure(result.body, child);
    });
  }

  #handleDown(): void {
    this.#child = null;
    for (const pending of this.#blockQueue.splice(0)) pending.resolve({ ok: false, body: '' });
    if (this.#disposed || this.#givenUp) return;
    // THE CAP (a review finding: this loop was unbounded). Checked BEFORE
    // scheduling anything: reaching the cap is a permanent state change,
    // never one more `reconnecting` tick.
    if (this.#reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.#giveUp('max-attempts');
      return;
    }
    const attempt = this.#reconnectAttempts;
    this.#reconnectAttempts += 1;
    for (const listener of this.#downListeners) {
      listener({ kind: 'reconnecting', attempt: this.#reconnectAttempts });
    }
    // EXPONENTIAL, CAPPED (a review finding: this used to be one fixed
    // `RECONNECT_BACKOFF_MS` forever). `attempt` (pre-increment, `0` on the
    // very first drop) keeps the FIRST wait exactly `RECONNECT_BACKOFF_MS`,
    // unchanged from before this fix -- only the SECOND and later attempts
    // back off further.
    const delay = Math.min(RECONNECT_BACKOFF_MS * 2 ** attempt, MAX_RECONNECT_BACKOFF_MS);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      if (this.#disposed || this.#givenUp) return;
      void this.#reconnect();
    }, delay);
  }

  /** Permanent: no more spawns, no more scheduled attempts, from here on.
   * Cancels whatever timer `#handleDown` may already have set (relevant
   * only for the `session-gone` path below, discovered from a REPLY rather
   * than another drop) and tells `onDown`'s listeners plainly why. */
  #giveUp(reason: 'max-attempts' | 'session-gone'): void {
    this.#givenUp = true;
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    for (const listener of this.#downListeners) listener({ kind: 'gave-up', reason });
  }

  /**
   * Reconnect with a FRESH `ControlFramer` and `StringDecoder` (`#wire`),
   * then reseed -- never attempts to resume mid-stream, and never re-sends a
   * `write()` that was in flight when the connection dropped: `write()` is
   * fire-and-forget and this file tracks nothing past the moment it wrote
   * it, so there is nothing to resubmit (design doc's own Risks section;
   * `control.ts`'s A2 note on why a mutating command must never be blindly
   * re-run applies here for the identical reason).
   *
   * A FAILED reseed here is routed through `#handleReseedFailure` (a review
   * finding on the unbounded loop, closed together with the cap above; that
   * method's own header covers the empty-vs-non-empty-body split in full --
   * shared, since `#finishResume` below needs the identical decision for a
   * failed reseed of its own).
   */
  async #reconnect(): Promise<void> {
    const child = this.#spawn();
    this.#wire(child);
    await this.#requestPauseAfter();
    const result = await this.#reseed();
    if (this.#disposed || this.#givenUp) return;
    if (!result.ok) {
      this.#handleReseedFailure(result.body, child);
      return;
    }
    this.#reconnectAttempts = 0;
    for (const listener of this.#seedListeners) listener(result.body);
  }

  /**
   * A failed reseed, however it was learned about -- `#reconnect`'s own
   * attempt above, or `#finishResume`'s after `%pause`/`%continue` -- landed
   * the SAME way rather than one of them silently swallowing it (a review
   * finding on PR 505: `#finishResume` used to just give up quietly on a
   * failed reseed; unless the connection also happened to drop for some
   * OTHER reason afterwards, nothing would ever prompt a reconnect attempt
   * or tell `onDown`'s listeners anything was wrong -- exactly the silent
   * freeze this fix closes, since `write()` would keep accepting keystrokes
   * into a pane nothing is reading from anymore).
   *
   * AN EMPTY body means the reply was synthesised by `#handleDown`'s own
   * queue-flush OR `#sendChain`'s own timeout backstop (`#timeoutChain`,
   * which already kills the child and calls `#handleDown` itself before
   * this ever runs) -- that call has ALREADY run and already decided
   * whether to schedule the next attempt or give up; nothing further
   * happens here, or that decision would be double-made.
   *
   * A NON-EMPTY body means the connection stayed up long enough to ask and
   * tmux actually answered `%error` (including a chain-aborting one --
   * `#sendChain`'s own header: real tmux stays healthy after aborting one
   * chained line, so this is never presumed dead by that alone) -- `child`
   * is killed here either way, since neither branch below reuses it. If the
   * text matches `NO_SESSION` ("can't find session/pane/window"), the
   * session itself is gone and this gives up FOR GOOD, immediately, never
   * spending the remaining attempts on a server that will never answer
   * differently. Any OTHER real error text is treated as "try again" --
   * `#handleDown` is called explicitly (nothing else would, since this
   * child never actually died on its own) to run the same cap/backoff
   * decision an ordinary connection drop would, but ONLY if `child` is
   * still `this.#child` -- a concurrent drop or a later successful
   * reconnect may already have moved it on by the time this runs.
   */
  #handleReseedFailure(body: string, child: ControlChildProcess): void {
    if (body === '') return;
    const stillCurrent = this.#child === child;
    if (stillCurrent) this.#child = null;
    child.kill();
    if (NO_SESSION.test(body)) {
      this.#giveUp('session-gone');
    } else if (stillCurrent) {
      this.#handleDown();
    }
  }
}
