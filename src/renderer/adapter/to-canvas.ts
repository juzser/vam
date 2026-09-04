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

import type {
  CanvasBudget,
  CanvasModel,
  Decision,
  Project,
  Session,
  SessionOrigin,
  SessionStatus,
  SourceId,
} from '../domain/model.js';
import { classifyActor } from '../domain/session-filter.js';
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
function activityOf(api: ApiRunningSession): string | null {
  return api.lastEventType;
}

/** How long since it last did anything, or `null` if the stamp is unusable. */
function ageOf(api: ApiRunningSession, now: Date): string | null {
  return api.lastEventAt === null ? null : relativeTime(api.lastEventAt, now);
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

/**
 * Who opened this session, and how often a person has spoken in it.
 *
 * Costs nothing extra: `useCanvas` already fetches every session's timeline on
 * every load, so this reads a list that is in hand rather than asking for one.
 * That is also why there is no cache — there is no second request to avoid,
 * and a cache would only introduce a way for the answer to go stale.
 *
 * An EMPTY list is treated exactly like an absent one. Every real session has
 * at least a `session-start`, so `[]` means "not fetched", not "nothing
 * happened", and answering `unknown` keeps it on screen.
 */
function originOf(timeline: readonly ApiTimelineEntry[]): SessionOrigin {
  if (timeline.length === 0) {
    return { startedBy: 'unknown', promptCount: null };
  }
  const start = timeline.find((e) => e.eventType === 'session-start');
  return {
    startedBy: start === undefined ? 'unknown' : classifyActor(start.actor),
    promptCount: timeline.filter((e) => e.eventType === 'user_prompt').length,
  };
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
    // black-smith's API reports no branch or worktree per session -- there is
    // no field on `ApiRunningSession` to derive one from. `null` is the honest
    // answer, and the sidebar renders it as a gap that names itself rather
    // than as an empty string pretending to be a branch name.
    branch: null,
    status: statusOf(api, decisions),
    // `Session.agents` is deliberately ABSENT here, not `[]`. black-smith's
    // API reports how many agents are live and nothing about which they are,
    // and an empty roster beside a non-zero count would read as "this session
    // spawned none" -- a claim this adapter cannot make. Absent is model.ts's
    // "the source cannot answer", and the pane says exactly that.
    runningAgents: api.liveAgentCount,
    activity: activityOf(api),
    age: ageOf(api, now),
    decisions,
    origin: originOf(timeline),
  };
}

/**
 * The whole canvas, from one overview and whatever timelines have been fetched.
 *
 * Timelines arrive as a map rather than being fetched here because this file is
 * pure and because they load per session, at their own pace. A session with no
 * timeline yet is not an error — it renders as a row with no steps, which is
 * also what a session that never had a turn looks like, and both are true.
 *
 * `source` arrives as a parameter rather than a literal here: this file
 * translates one source's API shape, but which source that is belongs to the
 * caller, not to this adapter.
 */
export function toCanvasModel(
  overview: ApiOverview,
  timelines: ReadonlyMap<string, readonly ApiTimelineEntry[]>,
  source: SourceId,
  now: Date = new Date(),
): CanvasModel {
  const byProject = new Map<string, Session[]>();
  for (const api of overview.runningSessions) {
    /**
     * KNOWN LOSS, measured and deliberately not papered over: a session that
     * belongs to several projects is filed under its first one only.
     *
     * Against the live factory on 2026-09-03 — 14 running sessions — three of
     * them (`factory-vam-2`, `factory-sse-1`, `dogfood-novel-rpg-1`) each list
     * two projects, and in all three cases `projects[0]` is `black-smith`. So
     * the sidebar files them under the factory and the groups an operator
     * looks for (`vam`, `novel-rpg`) never appear at all.
     *
     * What it is NOT is a session that vanishes: every session still gets
     * exactly one row on the canvas and one row in the sidebar. Fixing the
     * grouping properly means a session appearing under EACH of its projects
     * while staying ONE canvas row, and that is not a change to this line.
     * `Session` has no project field; membership is expressed by which
     * `Project.sessions` array holds it, so listing a session twice duplicates
     * it through `allSessions`, `orderedSessions` and `layoutCanvas` — which
     * mints two nodes with the same `info:<id>`, and duplicate node ids break
     * both ReactFlow and the id `j`/`k` navigate by. The honest fix is a
     * membership list on the session plus a sidebar that groups by it and a
     * layout that stays keyed on the session; that spans the domain model,
     * the selectors, the layout and the sidebar, and belongs in its own task.
     *
     * Until then this stays positional and stays documented, rather than
     * acquiring a heuristic ("prefer the project that is not the factory")
     * that would be a guess wearing a rule's clothes.
     */
    const projectId = api.projects[0] ?? NO_PROJECT_ID;
    const sessions = byProject.get(projectId) ?? [];
    sessions.push(toSession(api, timelines.get(api.sessionId) ?? [], now));
    byProject.set(projectId, sessions);
  }

  const projects: Project[] = [...byProject.entries()].map(([id, sessions]) => ({
    id,
    name: id,
    source,
    sessions,
  }));

  return { projects, budget: toBudget(overview) };
}

/**
 * The factory's token spend, or `null` when this payload does not carry it.
 *
 * `null` rather than zeros. The status bar showed a hardcoded placeholder for
 * as long as the adapter ignored these fields, and the fix must not replace
 * one lie with a quieter one: a payload without budget data has to be
 * distinguishable from a factory that has spent nothing.
 *
 * `usedPct` is the server's own figure and is NOT recomputed from the totals.
 * They can disagree — the server prices against per-epic caps and the sum of
 * those caps is not the account's cap — and the server is the one that owns
 * the definition. Measured live: 324%, i.e. it exceeds 100 routinely and
 * nothing here may clamp it.
 */
function toBudget(overview: ApiOverview): CanvasBudget | null {
  const rows = overview.tokensByEpic;
  if (rows === undefined || overview.budgetUsedPct === undefined) {
    return null;
  }
  let tokensSpent = 0;
  let tokensBudget = 0;
  for (const row of rows) {
    tokensSpent += row.tokensSpent;
    tokensBudget += row.tokensBudget;
  }
  return { tokensSpent, tokensBudget, usedPct: overview.budgetUsedPct };
}
