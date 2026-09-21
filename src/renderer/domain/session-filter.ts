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
 * The toggles the filter popover owns.
 *
 * Not keyed by source, unlike `Prefs.icons`: these are a fact about how YOU
 * want the list read, the same kind of thing as the theme, and a session id
 * never enters them — so the (sourceId, id) keying that keeps two sources'
 * sessions apart has nothing to keep apart here.
 *
 * That is also why `hideEnded` applies to every source rather than only to the
 * one whose rows prompted it. A filter that meant one thing for Codex and
 * another for Claude Code would be a single boolean standing for two claims,
 * which is the mistake `a-second-source.md` records `vamControlled` making.
 */
export type SessionFilters = {
  readonly hideAgentStarted: boolean;
  readonly onlyPrompted: boolean;
  /**
   * THE LIVE LIST HOLDS LIVE SESSIONS.
   *
   * The operator, of the Codex source PR 429 shipped: "Don't show recent threads
   * — it makes managing active sessions harder. Better to have a history
   * section to view and resume old sessions." And then, offering the cheaper
   * half themselves: "the filter should get a toggle to show/hide those recent
   * sessions."
   *
   * Measured on their own machine, that source drew 12 rows of which ONE was
   * live, under 8 project headings, with 6 of the 12 sharing a title. A
   * sidebar row is something that may need you and a finished conversation
   * never does — `docs/design/reopening-a-session.md`'s rule, and the reason
   * this one ships on.
   */
  readonly hideEnded: boolean;
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
  hideEnded: true,
};

/**
 * The actors that are a FACTORY ROLE rather than a person.
 *
 * Written as a denylist, deliberately, and the direction is the whole design.
 * An allowlist of human actors would hide any session opened by an actor
 * string the factory invents next — silently, behind a toggle that is on by
 * default. A denylist of known roles merely fails to hide such a session,
 * which costs a row on screen instead of costing you the work.
 *
 * Measured against the live factory on 2026-09-03, 14 sessions: eleven start
 * as `operator`, two as `operator-skill`, one (`e2e-probe-1`) as `tester`.
 * `operator-skill` is a PERSON working through a skill and is not listed here
 * — treating it as an agent would hide `dogfood-mcp-1` (379 events) and
 * `dogfood-mcp-followup-1` (157) the moment the toggle came on.
 *
 * The roles themselves come from the factory's own vocabulary: the agent roles
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

/**
 * Does the origin narrowing remove this session from the list?
 *
 * The two predicates above say what each rule MATCHES; this says what the
 * rules currently in force DO, which is the question the list and its tests
 * both ask. One function rather than a filter chain at the call site, so the
 * default that hides agent and test sessions is a thing that can be run
 * against a real session instead of a ternary nobody can reach.
 *
 * Fails safe in one direction, like its parts: a session vam never classified
 * is hidden by neither rule.
 */
export function isHiddenByOriginFilters(session: Session, filters: SessionFilters): boolean {
  return (
    (filters.hideAgentStarted && isAgentStarted(session)) ||
    (filters.onlyPrompted && isUnprompted(session))
  );
}

/**
 * Toggle C's predicate. Only a session whose own source POSITIVELY MEASURED
 * that it is over — the same direction as the two rules above, where a session
 * vam never classified survives.
 *
 * NOT `status === 'done'`, and `Session.ended`'s own comment carries the
 * measurement behind that: `done` is also what Claude Code calls a background
 * agent that finished inside a session you are still working in, and hiding
 * those was tried here and broke 461 assertions across 62 files. A finished
 * conversation dug out of an archive is a different row from a finished agent
 * beside live work, and only the source that produced it can tell them apart.
 */
export function isEnded(session: Session): boolean {
  return session.ended === true;
}

/**
 * Does the ended rule remove this session from the list?
 *
 * ── WHY THE STATUS PILL WINS ──────────────────────────────────────────────
 *
 * The popover holds both controls: a status pill row whose fourth pill is
 * `Done`, and this toggle, which is ON by default. Left alone they fight —
 * selecting `Done` would select nothing, and the explanation would be a
 * different control three rows further down the same popover.
 *
 * So an explicit status choice stands this rule down. Naming a status is a
 * narrower and more deliberate act than never having touched a default, and
 * the only status it can actually differ on is `Done` itself: no ended session
 * survives the `Running`, `Needs you` or `All`-minus-default paths anyway.
 *
 * Separate from `isHiddenByOriginFilters` rather than folded into it, because
 * an ending is not an origin and that function's name is load-bearing where it
 * is called.
 */
export function isHiddenByEndedFilter(
  session: Session,
  filters: SessionFilters,
  status: StatusFilter,
): boolean {
  if (!filters.hideEnded) return false;
  if (status !== 'all') return false;
  return isEnded(session);
}
