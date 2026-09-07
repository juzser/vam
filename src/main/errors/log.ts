/**
 * MAIN's own failure buffer -- the backlog half of the fix for a failure that
 * happens before any renderer exists to receive it.
 *
 * `src/renderer/errors/log.ts` is the destination: it already carries the
 * app's whole vocabulary for "what went wrong" -- the status bar badge, the
 * `E`-key panel, the scrubbed GitHub report. Main cannot call into it
 * directly (a different process, a different module graph), so this module
 * is the SOURCE side of the same idea: a bounded, in-memory, append-only
 * record of what main itself could not do, kept independent of whether
 * anyone is listening.
 *
 * THAT INDEPENDENCE IS THE WHOLE POINT. `startRemoteTransport` (see
 * `src/main/index.ts`) attempts the remote endpoint's bind BEFORE
 * `createWindow()` runs, so a failure can be -- and often is -- recorded
 * while there is no `webContents` to push to and no renderer to receive a
 * push even if there were. `recordMainFailure` never assumes a listener:
 * it appends here and moves on. `src/main/errors/ipc.ts` is what a renderer,
 * once it exists, reads the backlog from (`vam:errors:get`, a plain pull)
 * and is ticked about anything recorded afterwards (`vam:errors:changed`,
 * payload-free -- the same "ask again" shape `vam:stream:change` already
 * uses). The renderer-side half of the ordering fix, which is what makes a
 * late pull recover everything and a duplicate pull recover nothing twice,
 * is `src/renderer/errors/main-errors-bridge.ts`.
 *
 * WHAT THIS DOES NOT DO: scrub, persist, or decide what is worth recording.
 * Scrubbing happens once, in `src/renderer/errors/scrub.ts`, when a report is
 * composed -- an event crossing into this buffer and then into the
 * renderer's own log via `recordFailure` is handled by that SAME gate, not a
 * second one invented here (see the callers in `src/main/index.ts` and
 * `src/main/stream/register.ts`). Nothing here is written to disk, for the
 * same reason the renderer's own log is not: these are absolute paths and
 * OS error text off the operator's own machine.
 */

export type MainFailureEvent = {
  readonly id: number;
  /** ISO 8601, from the recording moment. */
  readonly at: string;
  /** What main was attempting, in the app's words: `start the remote endpoint`. */
  readonly action: string;
  /** A stable code a caller can branch on -- `remote-port-in-use`, `remote-bind-failed`. */
  readonly code: string;
  readonly message: string;
};

/**
 * The bound. Startup failures are rare -- the remote endpoint attempts one
 * bind, the device registry opens once -- so this is generous headroom
 * against a buffer that grows without limit, not a number tuned to a real
 * volume of traffic.
 */
export const CAPACITY = 20;

const events: MainFailureEvent[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

/** Record something MAIN itself could not do. Safe to call with no listeners. */
export function recordMainFailure(action: string, code: string, message: string): MainFailureEvent {
  const event: MainFailureEvent = {
    id: nextId,
    at: new Date().toISOString(),
    action,
    code,
    message,
  };
  nextId += 1;
  events.push(event);
  // Oldest out, one at a time: a `while` rather than a splice so the bound
  // holds even if the capacity is ever lowered under a full buffer.
  while (events.length > CAPACITY) events.shift();
  for (const listener of listeners) listener();
  return event;
}

/** Everything recorded so far, oldest first -- the order they happened in. */
export function mainFailures(): readonly MainFailureEvent[] {
  return events;
}

/** Notified, payload-free, whenever `recordMainFailure` appends. */
export function subscribeMainFailures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: the module is a singleton, so a suite needs a way back to empty. */
export function clearMainFailures(): void {
  events.length = 0;
}
