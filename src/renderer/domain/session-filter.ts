/**
 * What narrows the one set the sidebar lists, the canvas draws and the cursor
 * moves over. Pure, so the rules can be tested without a DOM.
 *
 * There is exactly one home for all of it — the sidebar's filter popover.
 */

import type { Session, SessionOrigin, SessionStatus } from './model.js';

export type StatusFilter = 'all' | SessionStatus;

/** The popover's pill row, in the order it is drawn. `failed` is deliberately
 * absent: the mockup's row is four wide and a failed session already shows up
 * under `All` in its own colour. */
export const STATUS_FILTERS: readonly (readonly [StatusFilter, string])[] = [
  ['all', 'All'],
  ['running', 'Running'],
  ['waiting', 'Needs you'],
  ['done', 'Done'],
];

/**
 * The two origin toggles the filter popover owns.
 *
 * Not keyed by source, unlike `Prefs.icons`: these are a fact about how YOU
 * want the list read, the same kind of thing as the theme, and a session id
 * never enters them — so the (sourceId, id) keying that keeps two sources'
 * sessions apart has nothing to keep apart here.
 */
export type SessionFilters = {
  readonly hideAgentStarted: boolean;
  readonly onlyPrompted: boolean;
};

/**
 * Agent-made sessions are hidden by default; "only what I prompted" is not.
 *
 * The asymmetry is measured, not aesthetic. Against the live factory on
 * 2026-09-03 only six of fourteen sessions carry a `user_prompt` at all, and
 * the eight without include `dogfood-mcp-1` (379 events) and `dogfood-envkit-1`
 * (70) — real work, driven through a skill rather than a prompt box. A default
 * that hid those would be a default that loses things.
 */
export const DEFAULT_SESSION_FILTERS: SessionFilters = {
  hideAgentStarted: true,
  onlyPrompted: false,
};

/**
 * The actors that are a FACTORY ROLE rather than a person.
 *
 * Written as a denylist, deliberately, and the direction is the whole design.
 * An allowlist of human actors would hide any session opened by an actor
 * string black-smith invents next — silently, behind a toggle that is on by
 * default. A denylist of known roles merely fails to hide such a session,
 * which costs a row on screen instead of costing you the work.
 *
 * Measured against the live factory on 2026-09-03, 14 sessions: eleven start
 * as `operator`, two as `operator-skill`, one (`e2e-probe-1`) as `tester`.
 * `operator-skill` is a PERSON working through a skill and is not listed here
 * — treating it as an agent would hide `dogfood-mcp-1` (379 events) and
 * `dogfood-mcp-followup-1` (157) the moment the toggle came on.
 *
 * The roles themselves come from black-smith's own vocabulary: the agent roles
 * `/api/overview` reports under `liveAgents[].agentRole`, the ones that appear
 * as event actors on a real timeline, and `system` for what the factory writes
 * on its own behalf.
 */
const AGENT_ACTORS: ReadonlySet<string> = new Set([
  'coder',
  'grader',
  'orchestrator',
  'planner',
  'researcher',
  'reviewer',
  'scribe',
  'security-reviewer',
  'spec-reviewer',
  'system',
  'tester',
  'verifier',
]);

/**
 * The actors that are a person. Only `operator` and `user` occur as a
 * `session-start` actor today; `operator-skill` is here because a skill is
 * something an operator runs, not something that runs itself.
 */
const HUMAN_ACTORS: ReadonlySet<string> = new Set(['operator', 'operator-skill', 'user']);

/** Classify one `session-start` actor. Anything unlisted is `unknown`. */
export function classifyActor(actor: string | null): SessionOrigin['startedBy'] {
  if (actor === null) {
    return 'unknown';
  }
  if (HUMAN_ACTORS.has(actor)) {
    return 'human';
  }
  return AGENT_ACTORS.has(actor) ? 'agent' : 'unknown';
}

/** Toggle A's predicate. Only a session vam positively identified as
 * agent-opened is hidden — unknown and absent both stay. */
export function isAgentStarted(session: Session): boolean {
  return session.origin?.startedBy === 'agent';
}

/** Toggle B's predicate. `null` is "not counted" and is NOT zero. */
export function isUnprompted(session: Session): boolean {
  return session.origin?.promptCount === 0;
}
