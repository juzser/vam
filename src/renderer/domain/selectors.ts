/**
 * Reads over the canvas model. Pure, source-agnostic, and deliberately the only
 * place that knows the canvas shows *three* decisions — a component that slices
 * the array itself is a second copy of that rule, and the two drift the first
 * time the number changes.
 */

import type { CanvasModel, Command, Decision, Group, Project, Session } from './model.js';

/** How many decision rows a session node shows (docs/design/canvas-layout.md §3). */
export const VISIBLE_DECISION_COUNT = 3;

export type SessionEntry = {
  readonly project: Project;
  readonly session: Session;
  /**
   * The group this session's project sits in, or `null` for the top level.
   *
   * `null` RATHER THAN ABSENT, and that is the point of the field: a consumer
   * has to say what it does about a project belonging to no group instead of
   * leaving the case theoretical. It is not theoretical. With nothing stored
   * in `Prefs.groups` -- every store that exists, and the browser build
   * permanently -- every entry is `null`, so this is the common path and the
   * grouped one is the exception.
   *
   * Optional on the TYPE only, for the reason `Project.icon` is: MEASURED,
   * requiring it fails 60 entry literals across 13 test files that build an
   * entry by hand, none of which has an opinion about grouping. Optional costs
   * nothing here, because the only PRODUCER is `allSessions` and it always
   * writes the field -- a consumer that reads it still has to handle `null`,
   * which is the case that matters.
   */
  readonly group?: Group | null;
};

/**
 * Every session on the canvas, flattened but still carrying its project.
 *
 * `hjkl` moves between sessions regardless of which group they sit in — the
 * geometry sorts that out — while `gt`/`gT` is the move that thinks in
 * projects. Both need one flat list that has not forgotten the parent.
 */
export function allSessions(model: CanvasModel): SessionEntry[] {
  const entries: SessionEntry[] = [];
  for (const project of model.projects) {
    for (const session of project.sessions) {
      // Ungrouped: this reads the model's flat `projects`, which is the level
      // that has no group by definition.
      entries.push({ project, session, group: null });
    }
  }
  // The grouped level, after the ungrouped one. Order here is not display
  // order -- `orderedSessions` in `canvas/layout.ts` is -- so appending is
  // enough, and it keeps the ungrouped path (every store that exists) walking
  // exactly the loop it walked before groups were a thing.
  for (const group of model.groups ?? []) {
    for (const project of group.projects) {
      for (const session of project.sessions) {
        entries.push({ project, session, group });
      }
    }
  }
  return entries;
}

/** The `◐ N agents` in the title bar (§3). */
export function runningAgentTotal(model: CanvasModel): number {
  let total = 0;
  for (const { session } of allSessions(model)) {
    total += session.runningAgents;
  }
  return total;
}

/** The `N need you` in the status bar (§3). */
export function waitingCount(model: CanvasModel): number {
  return allSessions(model).filter(({ session }) => session.status === 'waiting').length;
}

/**
 * The three decisions this session renders, **in the order they are drawn**:
 * oldest of the three first, newest at the bottom.
 *
 * The model stores decisions newest-first, which is the right shape for "give
 * me the latest N" and the wrong one for reading. A node is read top to bottom
 * like a log, so the newest belongs at the bottom — where the eye already is
 * after reading the two above it, and where the next one will appear.
 *
 * Note which end is dropped: the *oldest* falls off, never the newest. Slicing
 * happens before the reverse for exactly that reason.
 */
export function visibleDecisions(session: Session): readonly Decision[] {
  return session.decisions.slice(0, VISIBLE_DECISION_COUNT).reverse();
}

/**
 * The turn you owe an answer to, if there is one.
 *
 * Keyed off the SESSION's status, not off an unanswered `output`. A turn with no
 * output yet is a session still working — it is not asking you for anything, and
 * flagging it would put a call for help on every session that is simply busy.
 * What you owe an answer to is the newest turn of a session that has stopped.
 *
 * It refuses to look past the three rows the node draws: flagging a node for
 * something you cannot see on it sends you looking for a row that is not there.
 */
export function decisionAwaitingYou(session: Session): Decision | null {
  if (session.status !== 'waiting') {
    return null;
  }
  // Display order, so the newest — the one that stopped — sits at the end.
  return visibleDecisions(session).at(-1) ?? null;
}

/**
 * Everything `yy` could copy from this session, newest decision first.
 *
 * §4: black-smith hands commands back as structured fields precisely so they do
 * not have to be dug out of prose with a mouse. This is the list that makes that
 * pay off.
 */
export function copyableCommands(session: Session): readonly Command[] {
  // Newest first — the reverse of how they are drawn. `yy` puts the clipboard's
  // first line under the cursor of whatever shell it is pasted into, so the
  // command from the decision blocking *now* has to lead.
  return [...visibleDecisions(session)].reverse().flatMap((decision) => decision.commands);
}
