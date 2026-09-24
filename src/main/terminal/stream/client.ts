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
 */

import { StringDecoder } from 'node:string_decoder';
import {
  type ControlChildProcess,
  RECONNECT_BACKOFF_MS,
  type SpawnControlChild,
  spawnRealControlChild,
} from '../../sources/tmux/control.js';
import {
  ControlFramer,
  type ControlFramerEvent,
  hexBytes,
} from '../../sources/tmux/control-protocol.js';

export type { ControlChildProcess, SpawnControlChild } from '../../sources/tmux/control.js';

/** `=<name>:` -- the session target, exactly `argv.ts`'s own `target()`. */
const paneTarget = (name: string): string => `=${name}:`;

export type StreamClientOptions = {
  readonly binary?: string;
  readonly prefix: readonly string[];
  /** The resolved tmux session name -- see `terminal/pane.ts:targetSession`. */
  readonly target: string;
  readonly spawnChild?: SpawnControlChild;
};

type PendingBlock = { readonly resolve: (body: string) => void };

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
  #downListeners = new Set<() => void>();
  #disposed = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
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

  constructor(options: StreamClientOptions) {
    this.#binary = options.binary ?? 'tmux';
    this.#prefix = options.prefix;
    this.#target = options.target;
    this.#spawnChild = options.spawnChild ?? spawnRealControlChild;
  }

  get paneId(): string | null {
    return this.#paneId;
  }

  /**
   * Attach, resolve the pane id and seed the initial screen -- resolves with
   * the RAW `capture-pane -p -e -J` body (escape sequences intact, exactly
   * what `xterm.write()` wants).
   */
  async connect(): Promise<string> {
    const child = this.#spawn();
    this.#wire(child);
    const panes = await this.#send(`list-panes -t ${paneTarget(this.#target)} -F "#{pane_id}"`);
    const paneId = panes.split('\n').find((line) => line.length > 0);
    if (paneId === undefined) throw new Error(`no panes for ${this.#target}`);
    this.#paneId = paneId;
    return this.#reseed();
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

  /** Fired whenever the connection drops, before this client starts trying
   * to reconnect -- so the IPC layer can tell the renderer "reconnecting".
   * Returns an unsubscribe. */
  onDown(listener: () => void): () => void {
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
   * reconnect), which instead push through `onSeed`. */
  async #reseed(): Promise<string> {
    const seed = await this.#send(`capture-pane -p -e -J -t ${paneTarget(this.#target)}`);
    this.#seeded = true;
    return seed;
  }

  #write(line: string): void {
    try {
      this.#child?.stdin.write(`${line}\n`);
    } catch {
      // Best-effort: a write failure here is a dead connection, which
      // `#handleDown` (via the child's own 'error'/'exit') already covers.
    }
  }

  /** One command, awaiting its `%begin`/`%end` block in order -- a FIFO
   * queue, since more than one of these can be in flight before the first
   * `%output` can arrive at all. */
  #send(line: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.#blockQueue.push({ resolve });
      this.#write(line);
    });
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
      pending?.resolve(event.body);
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
    // task -- see the module header).
    this.#handlePauseOrContinue(event.line);
  }

  #handlePauseOrContinue(line: string): void {
    const pause = /^%pause (%\d+)/.exec(line);
    if (pause !== null && pause[1] === this.#paneId) {
      this.#paused = true;
      return;
    }
    const resume = /^%(?:continue|unpause) (%\d+)/.exec(line);
    if (resume !== null && resume[1] === this.#paneId) {
      this.#paused = false;
      // RESEED rather than trust nothing was missed while paused -- `%output`
      // that arrived during the pause was dropped above (see the module
      // header), so a fresh `capture-pane` is the only way to know the
      // screen is caught up.
      void this.#reseed().then((seed) => {
        for (const listener of this.#seedListeners) listener(seed);
      });
    }
  }

  #handleDown(): void {
    this.#child = null;
    for (const pending of this.#blockQueue.splice(0)) pending.resolve('');
    if (this.#disposed) return;
    for (const listener of this.#downListeners) listener();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      if (this.#disposed) return;
      void this.#reconnect();
    }, RECONNECT_BACKOFF_MS);
  }

  /**
   * Reconnect with a FRESH `ControlFramer` and `StringDecoder` (`#wire`),
   * then reseed -- never attempts to resume mid-stream, and never re-sends a
   * `write()` that was in flight when the connection dropped: `write()` is
   * fire-and-forget and this file tracks nothing past the moment it wrote
   * it, so there is nothing to resubmit (design doc's own Risks section;
   * `control.ts`'s A2 note on why a mutating command must never be blindly
   * re-run applies here for the identical reason).
   */
  async #reconnect(): Promise<void> {
    const child = this.#spawn();
    this.#wire(child);
    const seed = await this.#reseed();
    if (this.#disposed) return;
    for (const listener of this.#seedListeners) listener(seed);
  }
}
