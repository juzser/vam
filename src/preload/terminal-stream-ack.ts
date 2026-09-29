/**
 * THE PRELOAD HALF OF FINDING 546486bb: acknowledges `terminalStreamData`
 * bytes back to main so it can stop dropping once a stream falls behind.
 *
 * Main (`src/main/terminal/stream-ipc.ts`) counts forwarded bytes it has not
 * yet heard about and stops sending once that count crosses
 * `STREAM_UNACKED_HIGH_WATER_BYTES`; it only resumes once acks bring the
 * count back down to `STREAM_UNACKED_LOW_WATER_BYTES`. Nothing sent that ack
 * before this module existed, so a slow renderer forwarded 2 MiB once and
 * then nothing for the rest of the stream's life.
 *
 * WRAPS ONLY `onData`. Every other member of `TerminalStreamApi` -- `paste`
 * included -- passes through unchanged: this module adds bookkeeping to one
 * seam, not a second copy of the bridge.
 *
 * ONE ACK COUNTER PER STREAM, FED BY ONE UNDERLYING SUBSCRIPTION, however
 * many callers subscribe to that `streamId`. Acking once per caller would
 * over-count a chunk delivered to two listeners as two chunks received, and
 * main's ack handler closes the stream outright the moment an ack claims
 * more bytes than it ever forwarded (`stream-ipc.ts`'s own protocol-violation
 * rule) -- so a double-counted ack does not merely waste a resync, it kills
 * the stream.
 */

import { CHANNELS } from '../main/ipc/channels.js';
import type { TerminalStreamApi } from './api.js';

/** The slice of `ipcRenderer` this module needs -- `invoke` alone. */
export type AckInvoker = { invoke(channel: string, ...args: unknown[]): Promise<unknown> };

/**
 * How many UTF-8 bytes accumulate for one `streamId` before an ack goes out.
 *
 * MUST STAY <= `STREAM_UNACKED_LOW_WATER_BYTES` (`stream-ipc.ts`) -- the
 * relation this file's own test enforces, since importing that main-process
 * module here would drag `node:crypto`/`Buffer` into a preload that must stay
 * typecheckable under `tsconfig.web.json`. Once main starts dropping it
 * forwards nothing further, so the unacknowledged residue for a dropping
 * stream settles below whatever `pending` was at the last ack -- always
 * strictly less than one step. A step AT OR BELOW the low-water mark
 * therefore always lets that residue clear the mark once it is acked; a step
 * merely below `HIGH - LOW` (a weaker relation once considered) could leave a
 * residue that never reaches LOW, stranding the stream in the dropping state
 * forever.
 */
export const TERMINAL_STREAM_ACK_STEP_BYTES = 64 * 1024;

const encoder = new TextEncoder();

type StreamState = {
  /** Callers currently subscribed to this `streamId`. */
  listeners: Set<(chunk: string) => void>;
  /** UTF-8 bytes delivered since the last ack sent for this stream. */
  pending: number;
  /** Releases the ONE underlying `onData` subscription this state feeds. */
  unsubscribe: () => void;
};

/**
 * Wraps the API `createTerminalStreamApi(ipcRenderer)` returns so its
 * `onData` also acknowledges delivered bytes. `invoke` is accepted
 * separately (rather than read off `api`) so a test can fake it without
 * faking the whole bridge.
 */
export function wrapTerminalStreamApiWithAck(
  api: TerminalStreamApi,
  invoke: AckInvoker,
): TerminalStreamApi {
  const streams = new Map<string, StreamState>();

  function sendAck(streamId: string, bytes: number): void {
    invoke.invoke(CHANNELS.terminalStreamAck, streamId, bytes).catch((error: unknown) => {
      console.error('vam: terminal stream ack failed:', error);
    });
  }

  function stateFor(streamId: string): StreamState {
    const existing = streams.get(streamId);
    if (existing !== undefined) return existing;

    const listeners = new Set<(chunk: string) => void>();
    const state: StreamState = { listeners, pending: 0, unsubscribe: () => {} };
    state.unsubscribe = api.onData(streamId, (chunk) => {
      // Fan out to every caller BEFORE counting: an ack must never claim a
      // byte before it has actually reached a listener.
      for (const listener of state.listeners) listener(chunk);
      state.pending += encoder.encode(chunk).length;
      if (state.pending >= TERMINAL_STREAM_ACK_STEP_BYTES) {
        const acked = state.pending;
        state.pending = 0;
        sendAck(streamId, acked);
      }
    });
    streams.set(streamId, state);
    return state;
  }

  return {
    ...api,
    onData: (streamId, listener) => {
      const state = stateFor(streamId);
      state.listeners.add(listener);
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        state.listeners.delete(listener);
        if (state.listeners.size === 0) {
          state.unsubscribe();
          streams.delete(streamId);
        }
      };
    },
  };
}
