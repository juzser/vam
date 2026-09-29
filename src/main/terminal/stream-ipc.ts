/**
 * The Terminal tab's STREAMING IPC: open a `StreamClient` (`./stream/
 * client.ts`) for one project/row, push its `%output`/reseed/down events to
 * the renderer, and write keystrokes into it.
 *
 * RESOLVED THE SAME WAY `terminal/ipc.ts`'s READ/SEND CHANNELS ARE, on
 * purpose: `listVamSessions(run)` + `targetSession(...)` is the one pairing
 * rule this codebase has for "whose tmux session is this" (`terminal/
 * pane.ts`'s own header), and a stream that resolved a session some OTHER
 * rule picked could attach somewhere the shipping read/send channels would
 * have refused.
 *
 * A `tmux -V` MINIMUM-VERSION GATE runs before any stream is opened (design
 * doc task 11). This design was measured against tmux 3.7b; the chosen
 * floor, major.minor >= 3.2, is a CONSERVATIVE GUESS at how far back
 * control-mode's `%output`/`%pause` notifications are reliably supported --
 * it was NOT independently re-verified against tmux's own changelog for this
 * task, exactly as this design doc's own honesty policy asks to be named
 * rather than hidden.
 */

import { randomBytes } from 'node:crypto';
import { MAX_PASTE_TEXT } from '../../shared/terminal.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { readPublishedPanes } from '../sources/claude-code/session-pane.js';
import { defaultSessionsRoot } from '../sources/claude-code/session-status.js';
import { deleteBufferArgv, pasteBufferNameOf, sendPasteArgv } from '../sources/tmux/argv.js';
import { listVamSessions, type TmuxRun } from '../sources/tmux/spawn.js';
import type { WebContentsLike } from '../stream/register.js';
import { MAX_PROJECT_ID_LENGTH } from './ipc.js';
import { targetSession } from './pane.js';
import { type SpawnControlChild, StreamClient, type StreamClientOptions } from './stream/client.js';

/**
 * The most bytes one `terminalStream.write` may carry.
 *
 * EVERY OTHER CALLER OF THIS CHANNEL IS xterm's OWN `onData`, one keystroke
 * at a time -- a handful of bytes. A paste is the one caller that can hand it
 * a whole clipboard (`TerminalStreamTab.tsx`'s paste listener); the renderer
 * already truncates to `MAX_PASTE_TEXT` code points before it ever builds
 * that write (`terminal-paste.ts`), but the renderer is the least trusted
 * process in the app, so the bound is enforced here too rather than only
 * there. FOUR TIMES `MAX_PASTE_TEXT` because the text crosses the bridge
 * UTF-8-encoded and a code point can be up to four bytes -- this is a ceiling
 * on the WIRE size of a legitimate paste, not a second, independent guess at
 * one.
 */
export const MAX_STREAM_WRITE_BYTES = MAX_PASTE_TEXT * 4;

/**
 * THE PER-STREAM BACKPRESSURE BOUND (finding 546486bb): the most forwarded
 * `terminalStreamData` bytes main will let go UNACKNOWLEDGED for one stream
 * before it stops forwarding and drops the rest. Without this, `onData`'s
 * `webContents.send` has no measure of renderer progress at all, so a
 * renderer that falls behind lets main's own outgoing IPC queue for that
 * stream grow without limit -- the renderer's own 2MiB high-water mark
 * (`terminal-stream-tuning.ts`) only ever applies AFTER delivery, too late to
 * bound what main has already queued. 2MiB, the same order of magnitude that
 * mark already uses on the other side of the wire.
 */
export const STREAM_UNACKED_HIGH_WATER_BYTES = 2 * 1024 * 1024;

/**
 * Once dropping, main resumes forwarding only after acks bring the
 * unacknowledged count back down to a quarter of the high-water mark --
 * enough headroom that an ack landing right at the edge does not immediately
 * flip back into dropping on the very next chunk.
 */
export const STREAM_UNACKED_LOW_WATER_BYTES = STREAM_UNACKED_HIGH_WATER_BYTES / 4;

/**
 * The most bytes of `terminalStreamWrite` text this file will HOLD (count,
 * not forward) while a stream's resync is connecting -- see the write
 * handler's own HOLD BOUND step. Reuses `MAX_STREAM_WRITE_BYTES` rather than
 * inventing a second ceiling: a resync is bounded by the same worst case one
 * write already is (a single paste), so there is nothing this number needs
 * to say differently.
 */
export const MAX_HELD_STREAM_WRITE_BYTES = MAX_STREAM_WRITE_BYTES;

/** The version floor named in the module header. */
const MIN_TMUX_MAJOR = 3;
const MIN_TMUX_MINOR = 2;

/**
 * `major.minor`, read from `tmux -V`'s own text -- exported for its own
 * direct test (`tmux-version-parse.test.ts`), not only through the IPC
 * handler below.
 *
 * NOT ANCHORED RIGHT AFTER `tmux `, on purpose: a plain release (`tmux
 * 3.2\n`) has the pair immediately there, but a lettered point release
 * (`tmux 3.2a`) still has to match with the trailing letter ignored, and
 * two real, differently-shaped `-V` outputs put something else in front of
 * the number entirely -- tmux's OWN development-branch naming (`tmux
 * next-3.4`) and OpenBSD's long-standing habit of tagging its bundled tmux
 * with the OS release instead of upstream's version (`tmux openbsd-7.4`).
 * `\S*?` (lazy, no whitespace) skips exactly that kind of prefix without
 * reaching past a real word boundary into a SECOND number a differently
 * shaped `-V` might print later on the line.
 */
export function parseTmuxVersion(
  text: string,
): { readonly major: number; readonly minor: number } | null {
  const match = /tmux\s+\S*?(\d+)\.(\d+)/.exec(text);
  if (match === null) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return { major, minor };
}

export function meetsMinimumTmuxVersion(text: string): boolean {
  const parsed = parseTmuxVersion(text);
  if (parsed === null) return false;
  return (
    parsed.major > MIN_TMUX_MAJOR ||
    (parsed.major === MIN_TMUX_MAJOR && parsed.minor >= MIN_TMUX_MINOR)
  );
}

/** Every way `terminalStreamOpen` refuses, named rather than thrown -- see
 * the module header on why a session refusal and a version-gate refusal are
 * both facts this channel answers, never exceptions across the bridge. */
export type StreamOpenRefusal =
  | { readonly ok: false; readonly reason: 'bad-request' }
  | { readonly ok: false; readonly reason: 'unavailable' }
  | { readonly ok: false; readonly reason: 'unresolved-session' }
  | { readonly ok: false; readonly reason: 'unsupported-tmux' };

export type StreamOpenResult =
  | {
      readonly ok: true;
      readonly streamId: string;
      readonly seed: string;
      /** The resolved tmux session name -- `match.name`, the SAME pairing
       * `targetSession` gives `terminal/ipc.ts`'s `read` channel, whose
       * answer's `view.name` is what `TerminalTab.tsx` draws on its own
       * status rule. `TerminalStreamTab.tsx` has no other way to know it:
       * the stream carries bytes, not the name they came from. */
      readonly name: string;
    }
  | StreamOpenRefusal;

/**
 * One `clients` entry, for a stream's whole life. `client` is `null` exactly
 * while a resync (see `resync` below) has disposed the old `StreamClient`
 * and is awaiting a replacement's own `connect()` -- never at any other
 * time. DISPOSAL INVARIANT: whoever sets `client` to `null` disposed it in
 * the SAME step; nobody else ever disposes a record's own `client`.
 */
type ClientRecord = {
  client: StreamClient | null;
  /** Forwarded `terminalStreamData` bytes not yet acked by the renderer. */
  unacked: number;
  /** `true` once a chunk was dropped for exceeding the high-water mark;
   * cleared only by a completed resync (swap-in) or record-close. */
  dropping: boolean;
  /** `true` from the moment a resync is queued until it settles (swap-in,
   * a rejected connect that gives up, or the record closes first). */
  resyncing: boolean;
  closed: boolean;
  /** Bytes of `terminalStreamWrite` text held (not forwarded) during the
   * CURRENT resync episode -- reset at both its START and its SETTLE. */
  heldWriteBytes: number;
  /** `true` once a held write would have exceeded `MAX_HELD_STREAM_WRITE_BYTES`
   * for the current resync episode -- every write after that is also held,
   * never counted (there is nothing left to count against). */
  heldOverflow: boolean;
};

export function registerTerminalStreamIpc(
  ipcMain: IpcMainLike,
  webContents: WebContentsLike,
  run: TmuxRun,
  options?: {
    readonly binary?: string;
    readonly prefix?: readonly string[];
    readonly readPanes?: () => Promise<ReadonlyMap<string, string>>;
    /** Injected so a test never has to spawn a real `StreamClient`'s own
     * real tmux -- mirrors `spawnChild` below and `registerTerminalIpc`'s own
     * `readPanes` injection. */
    readonly createClient?: (opts: StreamClientOptions) => StreamClient;
    readonly spawnChild?: SpawnControlChild;
  },
): { readonly dispose: () => void } {
  const binary = options?.binary ?? 'tmux';
  const prefix = options?.prefix ?? [];
  const readPanes = options?.readPanes ?? (() => readPublishedPanes(defaultSessionsRoot()));
  const createClient =
    options?.createClient ?? ((opts: StreamClientOptions) => new StreamClient(opts));

  /**
   * ONE RECORD PER OPEN STREAM, for the stream's whole life -- unlike the
   * old bare `StreamClient` map, `client` here can go `null` mid-life (while
   * a resync is connecting a replacement) without the streamId itself ever
   * leaving this map. `dropping`/`resyncing`/`unacked` are the backpressure
   * bookkeeping finding 546486bb asked for; `heldWriteBytes`/`heldOverflow`
   * are the write-side hold bound that keeps a resync's own replacement from
   * being handed a keystroke flood the instant it swaps in. See the module
   * header's DATA MODEL / DISPOSAL INVARIANT notes.
   */
  const clients = new Map<string, ClientRecord>();
  // The resolved tmux SESSION NAME for each open stream -- the SAME
  // `match.name` `terminalStreamOpen` already hands back to the renderer
  // (`StreamOpenResult['name']`), kept server-side too so `terminalStreamPaste`
  // can target `sendPasteArgv` at it without asking the renderer to echo a
  // name back for a bridge to trust.
  const pasteTargets = new Map<string, string>();
  // PER-STREAM ORDERING (a review finding): `terminalStreamWrite` (a
  // synchronous write to the control child's own stdin) and
  // `terminalStreamPaste` (>=2 sequential `execFile` spawns through `run`)
  // travel on genuinely different transports with no ordering guarantee
  // between them. "Paste, then press Enter" -- a very common action, both
  // fire-and-forget from the renderer -- could let the Enter's `write` reach
  // tmux before the paste's LATER spawns finished, submitting a partial or
  // empty line; the old single-transport code never had this gap. `pending`
  // is the tail of whatever this stream's own last-QUEUED operation is; see
  // `enqueue` below for how a write with nothing pending skips it entirely.
  const pending = new Map<string, Promise<void>>();

  /**
   * Chains `task` after any operation currently in flight for `streamId`,
   * in arrival order -- the SAME order `ipcMain.handle`'s per-channel
   * dispatch already delivers messages from one renderer in. Every call
   * (paste or a queued write) replaces `pending`'s own entry with its own
   * tail, so a THIRD arrival still waits on the second, which still waits on
   * the first. The entry is removed once its own tail settles, but only if
   * nothing NEWER has replaced it in the meantime -- otherwise a slow,
   * already-superseded cleanup could delete a fresher entry out from under
   * it.
   */
  function enqueue(streamId: string, task: () => Promise<void>): Promise<void> {
    const prior = pending.get(streamId) ?? Promise.resolve();
    const tail = prior.then(task);
    const settled = tail.catch(() => {});
    pending.set(streamId, settled);
    void settled.then(() => {
      if (pending.get(streamId) === settled) pending.delete(streamId);
    });
    return tail;
  }

  /**
   * THE RECORD-CLOSE ROUTINE (module header): used by `terminalStreamClose`,
   * an over-ack protocol violation, and a resync that learns its record
   * closed out from under it. Disposes `record.client` exactly once (the
   * DISPOSAL INVARIANT -- `null` is set in the same step) and drops every
   * per-stream entry, including `pasteTargets`/`pending`, so nothing leaks
   * and a post-close paste/write/ack on this `streamId` reads as unknown.
   */
  function closeRecord(streamId: string, record: ClientRecord): void {
    record.closed = true;
    if (record.client !== null) {
      record.client.dispose();
      record.client = null;
    }
    clients.delete(streamId);
    pasteTargets.delete(streamId);
    pending.delete(streamId);
  }

  /**
   * Wires one `StreamClient` instance's `onData`/`onSeed`/`onDown` -- shared
   * by `terminalStreamOpen`'s initial client and `resync`'s replacement.
   * Every listener checks, before sending anything, that `client` is STILL
   * `record.client` and the record is not closed: a listener from a client a
   * resync has already disposed and replaced (or a client whose record has
   * since closed) must never reach the renderer.
   */
  function wireClient(streamId: string, record: ClientRecord, client: StreamClient): void {
    const isLive = (): boolean => !record.closed && record.client === client;
    client.onData((chunk) => {
      if (!isLive()) return;
      handleStreamData(streamId, record, chunk);
    });
    client.onSeed((seed) => {
      if (!isLive()) return;
      webContents.send(CHANNELS.terminalStreamSeed, streamId, seed);
    });
    client.onDown((event) => {
      if (!isLive()) return;
      webContents.send(CHANNELS.terminalStreamDown, streamId, event);
    });
  }

  /**
   * THE DATA PATH: if already dropping, discard. Else if forwarding this
   * chunk would push `unacked` past the high-water mark, start dropping
   * instead of forwarding it. Else forward and count it.
   */
  function handleStreamData(streamId: string, record: ClientRecord, chunk: string): void {
    if (record.dropping) return;
    const bytes = Buffer.byteLength(chunk, 'utf8');
    if (record.unacked + bytes > STREAM_UNACKED_HIGH_WATER_BYTES) {
      record.dropping = true;
      return;
    }
    webContents.send(CHANNELS.terminalStreamData, streamId, chunk);
    record.unacked += bytes;
  }

  /**
   * `terminalStreamWrite`'s own delivery step, reading `clients` FRESH at
   * call time rather than closing over whatever client was current when the
   * write was first queued -- a write that sat behind a resync in `pending`
   * must land on whichever client is current the moment it actually runs,
   * not a client a resync may since have disposed.
   */
  function deliver(streamId: string, text: string): void {
    const record = clients.get(streamId);
    if (record === undefined || record.closed || record.client === null) return;
    record.client.write(text);
  }

  /**
   * ONE LINK on the per-stream `pending` FIFO (module header): replaces a
   * dropping stream's `StreamClient` and pushes a fresh seed under the same
   * `streamId`, composing with any write/paste queued around it in arrival
   * order. Guarded twice against a record that closed out from under it --
   * once before spawning a replacement, once after `connect()` settles --
   * because `terminalStreamClose`/`dispose()` can run at any point while
   * this is in flight and this must never touch a disposed client or send a
   * push for a stream the renderer was told is gone.
   */
  async function resync(streamId: string, record: ClientRecord): Promise<void> {
    const stillCurrent = (): boolean => !record.closed && clients.get(streamId) === record;

    if (!stillCurrent()) {
      // Episode SETTLE reset even when there is nothing left to resync.
      record.heldWriteBytes = 0;
      record.heldOverflow = false;
      return;
    }

    const oldClient = record.client;
    record.client = null;
    if (oldClient !== null) oldClient.dispose();

    // Read the paste target in the SAME synchronous step, before any await
    // -- `terminalStreamOpen` always sets it alongside `clients`, so it is
    // guaranteed present for a record that is still current.
    const target = pasteTargets.get(streamId) as string;
    const replacement = createClient({ binary, prefix, target, spawnChild: options?.spawnChild });
    wireClient(streamId, record, replacement);

    let swapped = false;
    try {
      const seed = await replacement.connect();
      if (!stillCurrent()) return; // resolve+closed: send nothing.
      record.client = replacement;
      swapped = true;
      webContents.send(CHANNELS.terminalStreamSeed, streamId, seed);
      record.dropping = false;
      record.resyncing = false;
    } catch {
      if (stillCurrent()) {
        webContents.send(CHANNELS.terminalStreamDown, streamId, {
          kind: 'gave-up',
          reason: 'session-gone',
        });
        closeRecord(streamId, record);
      }
      // reject+closed: send nothing, the record is already gone.
    } finally {
      if (!swapped) replacement.dispose();
      // Episode SETTLE reset -- every outcome above resets it, swap-in
      // included (spec: "clear dropping/resyncing/heldWriteBytes/heldOverflow").
      record.heldWriteBytes = 0;
      record.heldOverflow = false;
    }
  }

  ipcMain.handle(
    CHANNELS.terminalStreamOpen,
    async (_event, ...args: unknown[]): Promise<StreamOpenResult> => {
      const [projectId, rowId] = args;
      if (
        args.length < 1 ||
        args.length > 2 ||
        typeof projectId !== 'string' ||
        projectId.length > MAX_PROJECT_ID_LENGTH ||
        (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
      ) {
        return { ok: false, reason: 'bad-request' };
      }
      const version = await run(['-V']);
      if (version.failure !== null || !meetsMinimumTmuxVersion(version.stdout)) {
        return { ok: false, reason: 'unsupported-tmux' };
      }
      const listed = await listVamSessions(run);
      if (listed.kind === 'unavailable') return { ok: false, reason: 'unavailable' };
      const panes = rowId === undefined ? undefined : await readPanes();
      const match = targetSession(listed.sessions, projectId, rowId, panes);
      if (match.kind !== 'one') return { ok: false, reason: 'unresolved-session' };

      const streamId = randomBytes(16).toString('hex');
      const record: ClientRecord = {
        client: null,
        unacked: 0,
        dropping: false,
        resyncing: false,
        closed: false,
        heldWriteBytes: 0,
        heldOverflow: false,
      };
      const client = createClient({
        binary,
        prefix,
        target: match.name,
        spawnChild: options?.spawnChild,
      });
      // THE EVENT RIDES ALONG NOW (a review finding: this used to be
      // payload-free, so a renderer had no way to tell "still trying" from
      // "gave up for good" -- see `StreamClient`'s own `StreamDownEvent`).
      // A plain object, JSON-shaped, crosses `webContents.send`'s structured
      // clone with no further work.
      wireClient(streamId, record, client);
      try {
        const seed = await client.connect();
        record.client = client;
        clients.set(streamId, record);
        pasteTargets.set(streamId, match.name);
        return { ok: true, streamId, seed, name: match.name };
      } catch {
        client.dispose();
        return { ok: false, reason: 'unavailable' };
      }
    },
  );

  ipcMain.handle(
    CHANNELS.terminalStreamClose,
    async (_event, ...args: unknown[]): Promise<true> => {
      const [streamId] = args;
      if (typeof streamId === 'string') {
        const record = clients.get(streamId);
        if (record !== undefined) closeRecord(streamId, record);
      }
      return true;
    },
  );

  ipcMain.handle(
    CHANNELS.terminalStreamWrite,
    async (_event, ...args: unknown[]): Promise<void> => {
      const [streamId, bytes] = args;
      if (
        typeof streamId !== 'string' ||
        !(bytes instanceof Uint8Array) ||
        bytes.length > MAX_STREAM_WRITE_BYTES
      ) {
        return;
      }
      const record = clients.get(streamId);
      if (record === undefined || record.closed) return;
      // Decoded back to the exact string xterm's own `onData` produced --
      // `Buffer.from(bytes).toString('utf8')` is the lossless inverse of
      // whatever UTF-8 encoding step put it on the wire as a `Uint8Array`, so
      // `StreamClient.write` can hex-encode it through the SAME `hexBytes`
      // `send-keys -H` path `sendTextArgv`'s own operator text always used
      // (see `control-protocol.ts`'s own note on why that path exists).
      const text = Buffer.from(bytes).toString('utf8');
      // THE HOLD BOUND: only counted while a resync is connecting -- a write
      // outside a resync never touches `heldWriteBytes` at all, so it can
      // never pollute a LATER resync episode's own budget.
      if (record.resyncing) {
        const n = Buffer.byteLength(text, 'utf8');
        if (record.heldOverflow || record.heldWriteBytes + n > MAX_HELD_STREAM_WRITE_BYTES) {
          record.heldOverflow = true;
          return;
        }
        record.heldWriteBytes += n;
      }
      // THE SYNCHRONOUS FAST PATH: with NOTHING pending for this stream,
      // write straight to the client's own stdin, same as before this
      // channel's ordering fix -- ordinary typing latency is unaffected.
      // Only a write that actually arrives WHILE a paste (or a resync) is
      // still running pays for the queue (`enqueue`, above this handler).
      if (!pending.has(streamId)) {
        deliver(streamId, text);
        return;
      }
      await enqueue(streamId, async () => {
        deliver(streamId, text);
      });
    },
  );

  ipcMain.handle(CHANNELS.terminalStreamAck, async (_event, ...args: unknown[]): Promise<void> => {
    const [streamId, count] = args;
    if (
      args.length !== 2 ||
      typeof streamId !== 'string' ||
      typeof count !== 'number' ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count < 0
    ) {
      return;
    }
    const record = clients.get(streamId);
    if (record === undefined) return;
    if (count > record.unacked) {
      // A PROTOCOL VIOLATION, never clamped: the renderer is the least
      // trusted side of this bridge, and an ack for more than was ever
      // forwarded means it cannot be trusted to describe this stream at
      // all -- so the stream closes rather than main guessing at a
      // corrected count.
      closeRecord(streamId, record);
      return;
    }
    record.unacked -= count;
    if (
      record.dropping &&
      !record.resyncing &&
      record.client !== null &&
      record.unacked <= STREAM_UNACKED_LOW_WATER_BYTES
    ) {
      // Episode START reset, synchronously, before the resync link itself
      // ever runs -- a write arriving before the queued link gets to run
      // must already see `resyncing` true.
      record.resyncing = true;
      record.heldWriteBytes = 0;
      record.heldOverflow = false;
      void enqueue(streamId, () => resync(streamId, record));
    }
  });

  ipcMain.handle(
    CHANNELS.terminalStreamPaste,
    async (_event, ...args: unknown[]): Promise<void> => {
      const [streamId, bytes] = args;
      if (
        typeof streamId !== 'string' ||
        !(bytes instanceof Uint8Array) ||
        bytes.length > MAX_STREAM_WRITE_BYTES
      ) {
        return;
      }
      // Same posture as `terminalStreamWrite`: an id this bridge never
      // opened, or already closed, is silently ignored, not an error.
      const name = pasteTargets.get(streamId);
      if (name === undefined) return;
      const text = Buffer.from(bytes).toString('utf8');
      // ALWAYS QUEUED, never the fast path `terminalStreamWrite` has above --
      // a paste is inherently several sequential spawns (`sendPasteArgv`'s
      // own header), so there is no synchronous case to fast-path, and
      // queuing unconditionally is what keeps a SECOND paste fired right
      // after this one from racing it too (`enqueue`'s own header).
      await enqueue(streamId, () => sendPaste(name, text));
    },
  );

  /**
   * `sendPasteArgv` (`sources/tmux/argv.ts`) is the SAME mechanism
   * `terminal/pane.ts`'s already-shipped, polling-path `sendToPane` already
   * uses for a paste -- real `execFile` spawns through `run`, never the
   * persistent control-mode connection's own text grammar
   * (`control-protocol.ts`'s `encodeControlLine` does not recognise
   * `set-buffer`/`paste-buffer` at all, so `run` -- `createControlTmuxRunner`
   * in production -- falls back to a plain spawn for every step here
   * regardless). `-p` on the final step is tmux's OWN per-pane truth about
   * bracketed paste; this bridge never reads or guesses it.
   *
   * A STEP FAILING PARTWAY (a review finding) used to leave the buffer
   * `sendPasteArgv` named on the tmux server forever: `paste-buffer`'s own
   * `-d` is the ONLY thing that deletes it, and that step never runs once an
   * earlier one has already failed. `deleteBufferArgv` cleans it up on any
   * failure, best-effort (its own result is never checked) -- including a
   * buffer that was never created at all (the very first `set-buffer`
   * failed), which tmux simply refuses at no further cost.
   */
  async function sendPaste(name: string, text: string): Promise<void> {
    const steps = sendPasteArgv(name, text);
    for (const step of steps) {
      if ((await run(step)).failure !== null) {
        const bufferName = pasteBufferNameOf(steps);
        if (bufferName !== undefined) await run(deleteBufferArgv(bufferName));
        return;
      }
    }
  }

  return {
    dispose: () => {
      // Steps (1)-(2) of the record-close routine for every record -- marks
      // each closed (so an in-flight resync's `stillCurrent()` sees it) and
      // disposes its client exactly once, the DISPOSAL INVARIANT, before the
      // maps themselves are cleared.
      for (const record of clients.values()) {
        record.closed = true;
        if (record.client !== null) {
          record.client.dispose();
          record.client = null;
        }
      }
      clients.clear();
      pasteTargets.clear();
      pending.clear();
    },
  };
}
