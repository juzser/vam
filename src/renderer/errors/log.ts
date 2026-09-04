/**
 * The event log: what went wrong, in vam's own vocabulary, kept in memory.
 *
 * The motivating case was real. A reply failed with `cli-failed` and close
 * refused, and telling those two apart took reading four modules and running
 * `claude agents --json --all` by hand -- because the status bar shows a
 * failure for as long as the next status takes to arrive and then it is
 * gone. One line kept somewhere readable would have been a five-second
 * diagnosis.
 *
 * FAILURE IS NOT REFUSAL, and that distinction is the log's whole value.
 * `close` declining to stop an interactive session vam never started is
 * CORRECT: it is vam saying no, on purpose, and recording it as an error
 * would bury the one entry that is actually broken under twenty that are
 * working exactly as designed. Both are recorded -- a refusal you did not
 * expect is still worth reading -- under `kind`, and `failureEvents()` is
 * what the report path and the badge count read.
 *
 * NOTHING IS PERSISTED, deliberately. Two reasons, in order of weight: the
 * events carry absolute home paths, project names and branch names, and
 * writing them to disk creates a second copy of exactly the material the
 * scrubber exists to keep off a public tracker -- one that outlives the
 * session and that nothing scrubs on the way out. And the log's job is
 * diagnosing the session you are in; a crash that loses it also loses the
 * app state the entries describe. The cost is named rather than hidden: a
 * hard crash takes the log with it, and diagnosing one still needs the
 * terminal.
 *
 * The store is module-level rather than React state because failures are
 * recorded from callbacks all over the canvas, most of which are not
 * rendering anything at the time. `subscribeEvents` is the read path for a
 * component (`useSyncExternalStore` in `ErrorLogPanel`).
 */

import { describeFailure } from '../sources/port.js';

export type EventKind = 'failure' | 'refusal';

/**
 * One recorded event. Note what it CANNOT hold: there is no field for a
 * prompt, a draft or a transcript line, so no caller can put one in and no
 * report can later grow one. The absence is the guarantee.
 */
export type LoggedEvent = {
  readonly id: number;
  /** ISO 8601, from the recording moment. */
  readonly at: string;
  readonly kind: EventKind;
  /** What vam was attempting, in the app's words: `close session`, `send prompt`. */
  readonly action: string;
  /** The source's own failure code -- `cli-failed`, `no-such-session`. */
  readonly code: string;
  readonly message: string;
};

/**
 * The bound. 100 events: far more than any one diagnosis reads (the case
 * above needed two), small enough that a session running for a day cannot
 * grow the buffer into a memory concern, and small enough that the panel
 * stays scannable rather than becoming a second thing to search.
 */
export const EVENT_CAPACITY = 100;

/** The code a failure gets when the thrown thing carried none of its own. */
const UNKNOWN = 'unknown';
/** The code every intended refusal shares, so they are one grep. */
const DECLINED = 'declined';

const events: LoggedEvent[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function push(event: Omit<LoggedEvent, 'id' | 'at'>): LoggedEvent {
  const recorded: LoggedEvent = { ...event, id: nextId, at: new Date().toISOString() };
  nextId += 1;
  events.push(recorded);
  // Oldest out, one at a time: a `while` rather than a splice so the bound
  // holds even if the capacity is ever lowered under a full buffer.
  while (events.length > EVENT_CAPACITY) events.shift();
  for (const listener of listeners) listener();
  return recorded;
}

/**
 * Split a rejected call into a code and a message.
 *
 * The shape test comes first for the same reason `describeFailure` does it:
 * what lands in a `catch` is usually a structured-cloned plain object from
 * the preload bridge, not an `Error`.
 */
function partsOf(reason: unknown): { code: string; message: string } {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && 'message' in reason) {
    return { code: String(reason.code), message: String(reason.message) };
  }
  return { code: UNKNOWN, message: reason instanceof Error ? reason.message : String(reason) };
}

/** Record something that broke. */
export function recordFailure(action: string, reason: unknown): LoggedEvent {
  return push({ kind: 'failure', action, ...partsOf(reason) });
}

/** Record a "no" vam meant to say. Not an error, and never counted as one. */
export function recordRefusal(action: string, message: string): LoggedEvent {
  return push({ kind: 'refusal', action, code: DECLINED, message });
}

/**
 * Record a failure and return the sentence the status bar already showed.
 *
 * This exists so that a call site changes from `setStatus(describeFailure(c))`
 * to `setStatus(noteFailure(action, c))` -- one line, no new control flow, and
 * no way to log a failure the operator was not also told about.
 */
export function noteFailure(action: string, reason: unknown): string {
  recordFailure(action, reason);
  return describeFailure(reason);
}

/** Everything recorded, newest first -- the order the panel reads. */
export function loggedEvents(): readonly LoggedEvent[] {
  return [...events].reverse();
}

/** Only the things that are broken. The badge count and the report path. */
export function failureEvents(): readonly LoggedEvent[] {
  return loggedEvents().filter((event) => event.kind === 'failure');
}

export function clearEvents(): void {
  events.length = 0;
  for (const listener of listeners) listener();
}

export function subscribeEvents(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
