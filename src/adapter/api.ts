/**
 * The slice of black-smith's HTTP API that vam consumes.
 *
 * Transcribed from `factory/orchestrator/src/db/queries.ts` — `RunningSession`,
 * `TimelineEntry`, `OverviewResult` — and deliberately NOT imported from it.
 * vam is a separate repo with its own build; reaching across would couple the
 * two package graphs to make one type-check pass, and the wire format is the
 * real contract anyway. What this file owes in exchange is honesty about being
 * a copy: every type below names the source it was copied from, so the day the
 * factory changes one there is a string to grep for.
 *
 * Only the fields vam reads are listed. The server sends more; a narrower type
 * is not a lie, it is the subset this app is willing to depend on.
 */

/** `queries.ts` → `RunningSession`. One row per session the factory has seen. */
export type ApiRunningSession = {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly lastEventAt: string;
  readonly eventCount: number;
  /** `agents` rows still live for this session. Becomes vam's `●N`. */
  readonly liveAgentCount: number;
  /** The most recent event's type — what this session just did. */
  readonly lastEventType: string | null;
  /**
   * Derived from the session's tasks, so a session that has not created one
   * belongs to no project. vam groups those under their own heading rather
   * than dropping them (see `to-canvas.ts`).
   */
  readonly projects: readonly string[];
};

/** `queries.ts` → `OverviewResult`, narrowed to what the canvas needs. */
export type ApiOverview = {
  readonly runningSessions: readonly ApiRunningSession[];
  readonly alerts: { readonly escalations: number; readonly pendingWaivers: number };
};

/** `queries.ts` → `TimelineEntry`. One row per event on a session's log. */
export type ApiTimelineEntry = {
  readonly eventId: string;
  readonly ts: string;
  readonly eventType: string;
  readonly taskId: string | null;
  readonly planVersion: number;
  readonly causalParent: string | null;
  readonly payload: Record<string, unknown>;
  readonly project: string | null;
  readonly actor: string | null;
};

/**
 * `ui/server/src/app.ts` → `WriteEnvelope`. Every write carries it.
 *
 * `causalParent` is optional and omitting it is the normal case: the server's
 * `resolveContext` reads the session's own last event and chains onto that.
 * vam does not track causal ids and must not start — it polls, so anything it
 * held would be stale by the time you pressed Enter, and a write chained onto a
 * stale parent is exactly the corruption §6 warns about.
 */
export type WriteEnvelope = {
  readonly sessionId: string;
  readonly planVersion?: number;
  readonly causalParent?: string | null;
  readonly actor?: string;
};

/** What the server sends back when a write is refused. */
export type ApiError = {
  readonly error: { readonly code: string; readonly message: string };
};

/**
 * `waivers.ts` → `WaiverBatchDecision`. One operator answer about one finding.
 *
 * `fingerprint`, not a finding id: the factory groups findings by fingerprint,
 * so one answer covers every occurrence of the same defect. `operatorNote` is
 * required by the factory and not optional here either — a waiver with no
 * reason is the kind of record that reads as an accident later.
 */
export type WaiverDecision = {
  readonly fingerprint: string;
  readonly decision: 'granted' | 'denied';
  readonly operatorNote: string;
};

/** `db/schema.ts` → `findings`, narrowed to what a review queue needs. */
export type ApiFinding = {
  readonly findingId: string;
  readonly taskId: string;
  readonly fingerprint: string;
  readonly severity: string;
  readonly findingStatus: string;
  readonly summary: string;
  readonly foundBy: string;
  /** Non-null once an operator has already answered this fingerprint. */
  readonly waiverId: string | null;
};

/** `queries.ts` → `TaskDetail`, narrowed the same way. */
export type ApiTaskDetail = {
  readonly findings: readonly ApiFinding[];
};

/** `queries.ts` → `KanbanTask`. Used only to enumerate a session's task ids. */
export type ApiKanbanTask = { readonly taskId: string };
export type ApiKanbanColumn = { readonly tasks: readonly ApiKanbanTask[] };

/** `db/schema.ts` → `lessons`, narrowed to what a review queue needs. */
export type ApiLesson = {
  readonly lessonId: string;
  readonly sessionId: string;
  readonly lessonType: string;
  readonly lessonScope: string;
  readonly lessonStatus: string;
  readonly statement: string;
};

/** `queries.ts` → `LessonsResult`. `pending` is the candidate queue. */
export type ApiLessons = {
  readonly pending: readonly ApiLesson[];
  readonly approved: readonly ApiLesson[];
  readonly closed: readonly ApiLesson[];
};
