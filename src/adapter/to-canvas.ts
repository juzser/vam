/**
 * black-smith's API → the one shape the canvas draws. Pure, no fetching.
 *
 * The whole reason `CanvasModel` exists is so this file can be the only place
 * that knows what a `dispatch_decision` is. Get the translation right here and
 * no component ever learns which system it is looking at — which is also what
 * keeps §6's write path honest, because a component that cannot tell the sources
 * apart cannot send one an envelope meant for the other.
 *
 * Three translations are judgement calls rather than renames, and each is
 * argued at its own function:
 *
 *  - what counts as a TURN (`toDecisions`),
 *  - what counts as an ANSWER to one (`summarise`),
 *  - and when a session is asking something of YOU (`statusOf`).
 */

import type { CanvasModel, Decision, Project, Session, SessionStatus } from '../domain/model.js';
import type { ApiOverview, ApiRunningSession, ApiTimelineEntry } from './api.js';
import { relativeTime } from './relative-time.js';

/**
 * Where a session with no project of its own goes.
 *
 * `RunningSession.projects` is derived from the session's tasks, so a session
 * that has not created one belongs to nowhere. Dropping those would hide
 * exactly the session you opened thirty seconds ago, which is the one you are
 * most likely looking for.
 */
export const NO_PROJECT_ID = '—';

/**
 * The events that open a turn: the ones YOU authored.
 *
 * `Decision.input` is defined as what the operator put in, so a turn cannot
 * start without an operator. A session that ran entirely on its own therefore
 * has no turns at all — honest rather than empty-looking: it made no decisions
 * *with* you, and its card still carries status, agent count and what it last
 * did.
 */
const OPERATOR_EVENTS = new Set(['user_prompt', 'operator-note']);

/**
 * Work leaving to be done, as opposed to an answer coming back.
 *
 * This is the distinction the `output: null` contract rests on. A dispatch is
 * the session going off to work; treating it as a reply would mark every
 * in-flight turn as finished and empty the waiting signal of meaning.
 */
const NOT_AN_ANSWER = new Set(['dispatch_decision']);

/** Payload keys worth putting on a one-line summary, in the order they read. */
const DETAIL_KEYS = ['outcome', 'status', 'verdict', 'reason', 'note', 'message'] as const;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * One outcome event, as one line.
 *
 * Deliberately shallow. The factory's payloads are open-ended and a renderer
 * that reached into them field by field would be a second copy of the event
 * taxonomy, drifting the first time black-smith adds a key. What it does
 * instead is name the event, name the task, and quote the one field that
 * usually carries the verdict.
 */
function summarise(entry: ApiTimelineEntry): string {
  const parts = [entry.eventType];
  if (entry.taskId !== null) {
    parts.push(entry.taskId);
  }
  for (const key of DETAIL_KEYS) {
    const detail = text(entry.payload[key]);
    if (detail !== null) {
      parts.push(detail);
      break;
    }
  }
  return parts.join(' · ');
}

/** What you said, for an event you authored. */
function operatorWords(entry: ApiTimelineEntry): string {
  return (
    text(entry.payload.prompt) ??
    text(entry.payload.note) ??
    text(entry.payload.message) ??
    entry.eventType
  );
}

/**
 * A session's timeline → its turns, newest first.
 *
 * A turn opens on an event you authored and stays open until the next one. What
 * happened in between is its aftermath, and the turn is answered only once the
 * aftermath contains something that is not work leaving to be done.
 *
 * Sorted by `ts` here rather than trusting the caller. The server orders its
 * rows, but this function is also handed merged and cached lists, and an
 * out-of-order pair would silently attach one turn's outcome to the turn
 * before it — a wrong answer under a right-looking question, which is the one
 * failure this file must not produce.
 */
export function toDecisions(entries: readonly ApiTimelineEntry[]): Decision[] {
  const ordered = [...entries].sort((a, b) => a.ts.localeCompare(b.ts));

  const turns: { readonly open: ApiTimelineEntry; readonly after: ApiTimelineEntry[] }[] = [];
  for (const entry of ordered) {
    if (OPERATOR_EVENTS.has(entry.eventType)) {
      turns.push({ open: entry, after: [] });
      continue;
    }
    // Anything before your first word answers no question of yours.
    turns[turns.length - 1]?.after.push(entry);
  }

  const decisions = turns.map(({ open, after }): Decision => {
    const answers = after.filter((e) => !NOT_AN_ANSWER.has(e.eventType));
    return {
      id: open.eventId,
      label: open.taskId ?? open.eventType,
      input: operatorWords(open),
      // `null` means the session is still working on this turn — see model.ts.
      output: answers.length === 0 ? null : answers.map(summarise).join('\n'),
      // The factory has no event carrying a command for a person to run, so
      // there is nothing honest to put here yet. `yy` stays wired for the day
      // there is; inventing a command from a payload guess would be a command
      // someone might paste into a shell.
      commands: [],
    };
  });

  // Newest first — the model's order (model.ts). The canvas reverses it.
  return decisions.reverse();
}

/**
 * Who owes the next move.
 *
 * `waiting` is the only status vam draws a call for help around, so it has to
 * mean the session has stopped and wants something from a person — not that an
 * agent inside it is busy, and not that a turn is still being answered.
 *
 * The order matters and each rung is a different question:
 *
 *  1. agents live → `running`, whatever the turns say. Something is happening.
 *  2. the log's last word was an error → `failed`.
 *  3. the newest turn has no answer → `running`. You asked and nothing has come
 *     back; the ball is with the factory. `liveAgentCount` is often 0 here,
 *     because a prompt is recorded the instant you send it and before anything
 *     has been dispatched to answer it.
 *  4. the newest turn was answered → `waiting`. It replied and stopped, so the
 *     next move is yours.
 *  5. no turns at all → `done`. Never spoken to; nothing owed either way.
 *
 * What this still cannot distinguish is "answered you and finished for good"
 * from "answered you and is expecting a reply", because black-smith has no
 * session-end event. Rung 4 errs towards showing you a session that may need
 * nothing, rather than hiding one that does.
 */
function statusOf(api: ApiRunningSession, decisions: readonly Decision[]): SessionStatus {
  if (api.liveAgentCount > 0) {
    return 'running';
  }
  if (api.lastEventType === 'error-logged') {
    return 'failed';
  }
  const newest = decisions[0];
  if (newest === undefined) {
    // Never spoken to. Nothing is owed in either direction.
    return 'done';
  }
  // Asked, nothing back yet — a turn in flight. `liveAgentCount` can be 0 here
  // and often is: a prompt is recorded the moment you send it, before anything
  // has been dispatched to answer it. Calling that `done` would mark the one
  // turn still open as finished.
  return newest.output === null ? 'running' : 'waiting';
}

/**
 * The activity line — what the session last DID, not what an agent is doing.
 *
 * §5 epic B (worker heartbeat) has not landed, so nothing in black-smith can
 * say what an agent is working on right now. What the log can say is the type
 * of the last event it wrote, and that is what this is: labelled as the past
 * tense it is, rather than dressed up as a live feed.
 *
 * Relative, not absolute. The question a person asks of this line in a column
 * of a dozen is "is this fresh", never "at what o'clock" — and an ISO stamp
 * makes them subtract in their head to find out.
 */
function activityOf(api: ApiRunningSession, now: Date): string | null {
  return api.lastEventType === null
    ? null
    : `${api.lastEventType} · ${relativeTime(api.lastEventAt, now)}`;
}

/**
 * Which epic a session is working in, or `null`.
 *
 * Derived from its turns' task ids, which black-smith qualifies as
 * `<epic>/<task>` — the same read `epicOfTaskId` does on the factory side. Not
 * from `overview.epicsInFlight`, which is factory-wide: picking one of those
 * for a row would put a plausible label on a session that has nothing to do
 * with it, and a plausible wrong label is worse than a blank.
 *
 * The newest turn wins. A session that moved on to another epic is labelled
 * with the one it is in now, not the one it started in.
 */
function epicOf(decisions: readonly Decision[]): string | null {
  for (const decision of decisions) {
    const slash = decision.label.indexOf('/');
    if (slash > 0) {
      return decision.label.slice(0, slash);
    }
  }
  return null;
}

function toSession(
  api: ApiRunningSession,
  timeline: readonly ApiTimelineEntry[],
  now: Date,
): Session {
  const decisions = toDecisions(timeline);
  return {
    id: api.sessionId,
    title: api.sessionId,
    // Nothing in black-smith stores an icon for a session, so nothing is
    // invented. The picker still opens; nothing saves it.
    icon: null,
    epic: epicOf(decisions),
    status: statusOf(api, decisions),
    runningAgents: api.liveAgentCount,
    activity: activityOf(api, now),
    decisions,
  };
}

/**
 * The whole canvas, from one overview and whatever timelines have been fetched.
 *
 * Timelines arrive as a map rather than being fetched here because this file is
 * pure and because they load per session, at their own pace. A session with no
 * timeline yet is not an error — it renders as a row with no steps, which is
 * also what a session that never had a turn looks like, and both are true.
 */
export function toCanvasModel(
  overview: ApiOverview,
  timelines: ReadonlyMap<string, readonly ApiTimelineEntry[]>,
  now: Date = new Date(),
): CanvasModel {
  const byProject = new Map<string, Session[]>();
  for (const api of overview.runningSessions) {
    const projectId = api.projects[0] ?? NO_PROJECT_ID;
    const sessions = byProject.get(projectId) ?? [];
    sessions.push(toSession(api, timelines.get(api.sessionId) ?? [], now));
    byProject.set(projectId, sessions);
  }

  const projects: Project[] = [...byProject.entries()].map(([id, sessions]) => ({
    id,
    name: id,
    // Every row here came out of black-smith. orca is a second adapter's job.
    source: 'black-smith',
    sessions,
  }));

  return { projects };
}
