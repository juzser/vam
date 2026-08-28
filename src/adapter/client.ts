/**
 * The one place vam talks to black-smith.
 *
 * Reads are ordinary. The writes are the reason this file is careful, and §6
 * says why: black-smith's event log is the factory's memory, every write
 * carries an envelope, and a malformed one is not a UI bug — it is a false
 * entry in the record of what happened and why.
 *
 * Three rules follow from that, and all three are enforced here rather than
 * left to callers:
 *
 *  - **The server's refusal is shown, not swallowed.** black-smith answers a
 *    bad write with `{error: {code, message}}` and its message names the actual
 *    problem (`events.unknown-causal-session`, `write.bad-request`). A client
 *    that collapsed that into "failed" would leave you guessing at the one
 *    thing the factory just told you.
 *  - **vam does not track causal ids.** `causalParent` is left off every write
 *    so the server chains onto the session's own last event. vam polls, so any
 *    id it held would already be stale by the time you pressed Enter.
 *  - **vam never runs a command.** There is no method here that executes
 *    anything; the closest it comes is copying text to your clipboard.
 */

import type {
  ApiError,
  ApiKanbanColumn,
  ApiLessons,
  ApiOverview,
  ApiTaskDetail,
  ApiTimelineEntry,
  WaiverDecision,
  WriteEnvelope,
} from './api.js';

/**
 * A refusal from black-smith, with the factory's own words kept intact.
 *
 * `code` is the machine-readable one from `errors.ts`; `message` is what the
 * factory would have printed on a terminal. The UI shows both.
 */
export class SmithApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SmithApiError';
    this.code = code;
    this.status = status;
  }
}

/** Thrown when the server is simply not there — a different problem from a refusal. */
export class SmithUnreachableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    super(`không kết nối được black-smith ở ${baseUrl}`);
    this.name = 'SmithUnreachableError';
    this.cause = cause;
  }
}

export type SmithClientOptions = {
  readonly baseUrl: string;
  /** Injected so the tests can drive it without a network or a server. */
  readonly fetch?: typeof globalThis.fetch;
  /** Stamped on every write so the log records that a person did this, via vam. */
  readonly actor?: string;
};

function isApiError(body: unknown): body is ApiError {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return false;
  }
  const { error } = body as { error: unknown };
  return typeof error === 'object' && error !== null && 'message' in error;
}

export class SmithClient {
  readonly baseUrl: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly actor: string;

  constructor(options: SmithClientOptions) {
    // Trailing slash trimmed once, here: `${base}/api/x` with a doubled slash
    // is a 404 whose cause is invisible in the UI and obvious in a log nobody
    // is reading.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.actor = options.actor ?? 'operator';
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.doFetch(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      // A transport failure is not a refusal. Keeping them apart is what lets
      // the UI say "black-smith chưa chạy" instead of blaming your input.
      throw new SmithUnreachableError(this.baseUrl, cause);
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = isApiError(body) ? body.error.code : 'server.unknown';
      const message = isApiError(body) ? body.error.message : `HTTP ${response.status}`;
      throw new SmithApiError(code, message, response.status);
    }
    return body as T;
  }

  private write<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `causalParent` is deliberately absent — see the header.
      body: JSON.stringify({ actor: this.actor, ...body }),
    });
  }

  // --- Reads -----------------------------------------------------------

  /**
   * The whole factory, or one session's slice of it.
   *
   * The canvas asks unscoped — it draws every session. The review queue asks
   * scoped, for `alerts.pendingWaivers`: that count comes straight off the
   * findings table, and is the only thing that can tell the queue it is short.
   */
  overview(sessionId?: string): Promise<ApiOverview> {
    return this.request<ApiOverview>(
      sessionId === undefined
        ? '/api/overview'
        : `/api/overview?session=${encodeURIComponent(sessionId)}`,
    );
  }

  timeline(sessionId: string): Promise<ApiTimelineEntry[]> {
    return this.request<ApiTimelineEntry[]>(
      `/api/timeline?session=${encodeURIComponent(sessionId)}`,
    );
  }

  /** Task ids for a session. Only used to find where its findings live. */
  async taskIds(sessionId: string): Promise<string[]> {
    const columns = await this.request<ApiKanbanColumn[]>(
      `/api/kanban?session=${encodeURIComponent(sessionId)}`,
    );
    return columns.flatMap((column) => column.tasks.map((task) => task.taskId));
  }

  taskDetail(taskId: string): Promise<ApiTaskDetail> {
    return this.request<ApiTaskDetail>(`/api/tasks/${encodeURIComponent(taskId)}`);
  }

  lessons(sessionId: string): Promise<ApiLessons> {
    return this.request<ApiLessons>(`/api/lessons?session=${encodeURIComponent(sessionId)}`);
  }

  // --- Writes ----------------------------------------------------------

  /**
   * Record what you just said, into the session's log.
   *
   * This RECORDS; it does not DELIVER. black-smith has no channel into a
   * running agent session — what it has is `user_prompt`, stored verbatim so
   * the dispatch that follows can hang off it and the timeline reads "this work
   * happened because a person asked for it". Every caller has to say so in its
   * own words, because a prompt box that looks like it sent is worse than one
   * that admits it did not.
   */
  recordPrompt(sessionId: string, prompt: string): Promise<{ eventId: string }> {
    return this.write<{ eventId: string }>('/api/prompt', { sessionId, prompt });
  }

  /**
   * Grant or deny a batch of S3/S4 waivers — the factory's own review queue.
   *
   * Keyed by FINGERPRINT, not finding id: `waivers.ts` groups findings by
   * fingerprint and refuses the whole batch if one is unknown or if a `granted`
   * would cover a non-waivable S1/S2. All-or-nothing is the point — a partial
   * apply would leave the operator guessing which half of their answer landed.
   */
  applyWaivers(
    envelope: WriteEnvelope,
    decisions: readonly WaiverDecision[],
  ): Promise<{ applied: number }> {
    return this.write<{ applied: number }>('/api/waivers/apply-batch', {
      ...envelope,
      decisions,
    });
  }

  /**
   * Approve or reject one lesson candidate.
   *
   * `acceptDuplicate` is not defaulted and never set from here. It is the
   * operator's decision to keep a statement the novelty gate scored as a
   * duplicate, and a UI that passed it silently would be making that decision
   * on their behalf.
   */
  transitionLesson(
    lessonId: string,
    to: 'approve' | 'reject',
    body: Partial<WriteEnvelope> & { note?: string } = {},
  ): Promise<{ lessonId: string; status: string }> {
    return this.write<{ lessonId: string; status: string }>(
      `/api/lessons/${encodeURIComponent(lessonId)}/${to}`,
      { ...body },
    );
  }
}
