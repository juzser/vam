/**
 * Reads over the canvas model. Pure, source-agnostic, and deliberately the only
 * place that knows the canvas shows *three* decisions — a component that slices
 * the array itself is a second copy of that rule, and the two drift the first
 * time the number changes.
 *
 * `orderedSessions` and its supporting ranking functions moved here from the
 * 0.1 canvas's `layout.ts` in the 0.2 migration's step 2: they were always
 * list-ordering logic with no graph dependency of their own — the sidebar,
 * `PhoneShell` and `Canvas.tsx`'s own `allEntries` all called them for the
 * SAME reason a canvas card never needed, and `layout.ts` only ever housed
 * them because the sidebar's order and the canvas's grid both started from
 * one file. `orderedForCanvas` (urgency-first, project-blind — "the order
 * the canvas places cells in", its own former doc comment) did not move: it
 * was the canvas's own arrangement and has no reader left now that
 * `layoutCanvas` is deleted.
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
  // order -- `orderedSessions` below is -- so appending is enough, and it
  // keeps the ungrouped path (every store that exists) walking exactly the
  // loop it walked before groups were a thing.
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
 * §4: the factory hands commands back as structured fields precisely so they do
 * not have to be dug out of prose with a mouse. This is the list that makes that
 * pay off.
 */
export function copyableCommands(session: Session): readonly Command[] {
  // Newest first — the reverse of how they are drawn. `yy` puts the clipboard's
  // first line under the cursor of whatever shell it is pasted into, so the
  // command from the decision blocking *now* has to lead.
  return [...visibleDecisions(session)].reverse().flatMap((decision) => decision.commands);
}

/**
 * Rank order in the list: what needs you, then what is working, then what is
 * over. Every reader of `orderedSessions` shares it, because they are views of
 * one order and disagreeing would make `j` mean two different things.
 *
 * `failed` sits with the finished ones on purpose. It is worth a colour because
 * you want to spot it, but not a place at the front — the front is reserved for
 * sessions still asking for something, and a failed run is not asking.
 */
const STATUS_RANK: Readonly<Record<Session['status'], number>> = {
  waiting: 0,
  running: 1,
  done: 2,
  failed: 2,
};

/** A project's rank is its most urgent session's. An empty project ranks last. */
function projectRank(project: Project): number {
  return project.sessions.reduce(
    (best, session) => Math.min(best, STATUS_RANK[session.status]),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Projects in display order: the one holding the most urgent session first.
 *
 * Grouping costs something and this is the payment. Once sessions are boxed by
 * project they have to be **contiguous**, so the flat "everything waiting floats
 * to the very top" order is no longer available — a group cannot wrap members
 * scattered down the list. Ranking the projects themselves by their most urgent
 * member keeps the property that matters (what needs you rises) while letting
 * each group stay in one piece.
 */
export function orderedProjects(model: CanvasModel): Project[] {
  return [...model.projects].sort((a, b) => projectRank(a) - projectRank(b));
}

/** A group's rank is its most urgent member's. An empty group ranks last. */
function groupRank(group: Group): number {
  return group.projects.reduce(
    (best, project) => Math.min(best, projectRank(project)),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * The top level in display order: the ungrouped projects and the groups, one
 * sequence, each ranked by its most urgent session.
 *
 * Ranking them TOGETHER is what keeps "what needs you rises" true across both
 * levels -- a group holding the only waiting session has to beat an ungrouped
 * project of done ones, or the operator learns to distrust the top of the
 * list. Contiguity is the same payment `orderedProjects` already documents,
 * one level up: a group's members stay together whatever their own ranks.
 *
 * With no groups this is `orderedProjects` and nothing else, which is the
 * state of every store in existence.
 */
export function orderedTopLevel(model: CanvasModel): (Project | Group)[] {
  const groups = model.groups ?? [];
  if (groups.length === 0) {
    return orderedProjects(model);
  }
  const tops: { readonly top: Project | Group; readonly rank: number }[] = [
    ...model.projects.map((project) => ({
      top: project as Project | Group,
      rank: projectRank(project),
    })),
    ...groups.map((group) => ({ top: group as Project | Group, rank: groupRank(group) })),
  ];
  // Stable, so equal ranks keep ungrouped-then-grouped and, within each, the
  // order the adapter and the store produced.
  return tops.sort((a, b) => a.rank - b.rank).map(({ top }) => top);
}

/** The members of one group, most urgent project first -- `orderedProjects`
 *  applied to the level below a group heading. */
export function orderedInGroup(group: Group): Project[] {
  return [...group.projects].sort((a, b) => projectRank(a) - projectRank(b));
}

/** The sessions of one project, most urgent first. */
export function orderedInProject(project: Project): Session[] {
  return [...project.sessions].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}

/**
 * Every session in one flat order — project-major, urgent-first within each.
 *
 * This is the single sequence `j`/`k` walks, the sidebar prints and (before
 * the 0.2 migration deleted it) the canvas stacked. The sidebar draws project
 * headings over it, but they are captions, not stops: nothing here yields a
 * position for a heading, which is what keeps `j` meaning exactly one thing.
 *
 * Sorted copies, never in place: the model is shared and read elsewhere. Both
 * sorts are stable, so equal ranks keep the order the adapter produced — which
 * matters more than it sounds, because a list that reshuffles two equally-idle
 * sessions on every poll is one you cannot navigate by muscle.
 */
export function orderedSessions(model: CanvasModel): SessionEntry[] {
  const byId = new Map(allSessions(model).map((entry) => [entry.session.id, entry]));
  const ordered: SessionEntry[] = [];
  const push = (project: Project) => {
    for (const session of orderedInProject(project)) {
      const entry = byId.get(session.id);
      if (entry !== undefined) {
        ordered.push(entry);
      }
    }
  };
  for (const top of orderedTopLevel(model)) {
    if ('sessions' in top) {
      push(top);
    } else {
      for (const project of orderedInGroup(top)) {
        push(project);
      }
    }
  }
  return ordered;
}
