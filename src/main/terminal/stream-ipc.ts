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

/** The version floor named in the module header. */
const MIN_TMUX_MAJOR = 3;
const MIN_TMUX_MINOR = 2;

function parseTmuxVersion(text: string): { readonly major: number; readonly minor: number } | null {
  const match = /tmux (\d+)\.(\d+)/.exec(text);
  if (match === null) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return { major, minor };
}

function meetsMinimumTmuxVersion(text: string): boolean {
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

  const clients = new Map<string, StreamClient>();

  function closeClient(streamId: string): void {
    const client = clients.get(streamId);
    if (client === undefined) return;
    client.dispose();
    clients.delete(streamId);
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
      const client = createClient({
        binary,
        prefix,
        target: match.name,
        spawnChild: options?.spawnChild,
      });
      client.onData((chunk) => webContents.send(CHANNELS.terminalStreamData, streamId, chunk));
      client.onSeed((seed) => webContents.send(CHANNELS.terminalStreamSeed, streamId, seed));
      // THE EVENT RIDES ALONG NOW (a review finding: this used to be
      // payload-free, so a renderer had no way to tell "still trying" from
      // "gave up for good" -- see `StreamClient`'s own `StreamDownEvent`).
      // A plain object, JSON-shaped, crosses `webContents.send`'s structured
      // clone with no further work.
      client.onDown((event) => webContents.send(CHANNELS.terminalStreamDown, streamId, event));
      try {
        const seed = await client.connect();
        clients.set(streamId, client);
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
      if (typeof streamId === 'string') closeClient(streamId);
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
      const client = clients.get(streamId);
      if (client === undefined) return;
      // Decoded back to the exact string xterm's own `onData` produced --
      // `Buffer.from(bytes).toString('utf8')` is the lossless inverse of
      // whatever UTF-8 encoding step put it on the wire as a `Uint8Array`, so
      // `StreamClient.write` can hex-encode it through the SAME `hexBytes`
      // `send-keys -H` path `sendTextArgv`'s own operator text always used
      // (see `control-protocol.ts`'s own note on why that path exists).
      client.write(Buffer.from(bytes).toString('utf8'));
    },
  );

  return {
    dispose: () => {
      for (const client of clients.values()) client.dispose();
      clients.clear();
    },
  };
}
