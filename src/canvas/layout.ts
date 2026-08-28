/**
 * Where the canvas nodes go before anybody drags them.
 *
 * The canvas is now an **overview**, not the place work happens: one row per
 * session, rows in the same order the sidebar lists them, and each row a chain
 *
 *     [ session ] ⟿ [ step ] → [ step ] → [ step ]
 *
 * The first link is drawn differently on purpose — it stands for however many
 * steps came before the three shown, and it is the only edge that means "there
 * is history here you are not looking at". The last three are the newest three,
 * oldest to newest left to right, so the newest step is the one nearest the
 * detail panel that expands it.
 *
 * Rows are wrapped by a dashed project frame, and the sidebar draws the same
 * grouping as headings. The cost is paid here: a frame can only wrap members
 * that are **contiguous**, so the flat "everything waiting floats to the very
 * top" order is no longer available. `orderedProjects` buys the important half
 * of it back by ranking each project by its most urgent session.
 *
 * The frames are `groups`, kept out of `nodes`, because they are scenery rather
 * than destinations — see `CanvasLayout`.
 *
 * Pure and position-only. It does not know about ReactFlow, so it can be tested
 * without one, and the canvas component adapts it.
 */

import type { CanvasModel, Decision, Project, Session } from '../domain/model.js';
import {
  allSessions,
  type SessionEntry,
  VISIBLE_DECISION_COUNT,
  visibleDecisions,
} from '../domain/selectors.js';

/**
 * Sizes, against the type scale in `styles.css` — which is orca's (§1.1), so a
 * vam node is the same size of thing as an orca card.
 *
 * Info and step share a height so the chain reads as one band rather than a
 * skyline. The step card is a strict summary now: anything that needs reading
 * in full is read in the detail panel, which is why this can be a fixed size at
 * all.
 */
export const INFO_SIZE = { width: 220, height: 174 } as const;
export const STEP_SIZE = { width: 250, height: 90 } as const;

/** Wider than the others: the gap is where the "N steps before this" mark sits. */
const ELIDED_GAP = 76;
const STEP_GAP = 26;
const ROW_GAP = 30;

/**
 * The project frame's inset. Generous, because the frame is now nothing but a
 * dashed line: without a fill, the only thing saying "these rows are inside
 * something" is the distance between the line and the first card. Still smaller
 * at the top than the sides would suggest — the project's name is a pill
 * straddling the top border rather than a header row, so only its lower half
 * intrudes.
 */
const GROUP_PADDING = { x: 30, top: 34, bottom: 30 } as const;
const GROUP_GAP = 56;
/** A project with no sessions is still a visible box, not a hairline. */
const EMPTY_GROUP_BODY = 44;

export type Position = { readonly x: number; readonly y: number };
export type Size = { readonly width: number; readonly height: number };

export type InfoNodeSpec = {
  readonly kind: 'info';
  readonly id: string;
  readonly entry: SessionEntry;
  /** The project frame this row sits inside — ReactFlow's `parentId`. */
  readonly parentId: string;
  /** Relative to that frame, which is what ReactFlow wants for a child node. */
  readonly position: Position;
  readonly size: Size;
};

export type StepNodeSpec = {
  readonly kind: 'step';
  readonly id: string;
  readonly entry: SessionEntry;
  readonly decision: Decision;
  /** 1-based, left to right — 3 is the newest. */
  readonly ordinal: number;
  readonly parentId: string;
  readonly position: Position;
  readonly size: Size;
};

export type CanvasNodeSpec = InfoNodeSpec | StepNodeSpec;

export type CanvasEdgeSpec = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  /**
   * True for the link out of the session node: it stands in for the steps that
   * are not drawn, and is styled as a break rather than a step.
   */
  readonly elided: boolean;
  /** `+N` when steps were skipped, else null. */
  readonly label: string | null;
};

export type GroupNodeSpec = {
  readonly id: string;
  readonly project: Project;
  readonly position: Position;
  readonly size: Size;
};

export type CanvasLayout = {
  /**
   * The project frames. Kept apart from `nodes` on purpose: these are scenery,
   * not destinations. `hjkl` navigates `nodes`, and a frame that could be
   * focused would put a stop on every journey down the canvas that nobody asked
   * for. Rendered behind their children, which are parented to them.
   */
  readonly groups: readonly GroupNodeSpec[];
  /** The navigable nodes. Positions are RELATIVE to their group. */
  readonly nodes: readonly CanvasNodeSpec[];
  readonly edges: readonly CanvasEdgeSpec[];
};

/**
 * Rank order in the list: what needs you, then what is working, then what is
 * over. The sidebar and the canvas share it, because they are two views of one
 * order and disagreeing would make `j` mean two different things.
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

/** The sessions of one project, most urgent first. */
export function orderedInProject(project: Project): Session[] {
  return [...project.sessions].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}

/**
 * Every session in one flat order — project-major, urgent-first within each.
 *
 * This is the single sequence `j`/`k` walks, the sidebar prints and the canvas
 * stacks. The sidebar draws project headings over it, but they are captions, not
 * stops: nothing here yields a position for a heading, which is what keeps `j`
 * meaning exactly one thing.
 *
 * Sorted copies, never in place: the model is shared and read elsewhere. Both
 * sorts are stable, so equal ranks keep the order the adapter produced — which
 * matters more than it sounds, because a list that reshuffles two equally-idle
 * sessions on every poll is one you cannot navigate by muscle.
 */
export function orderedSessions(model: CanvasModel): SessionEntry[] {
  const byId = new Map(allSessions(model).map((entry) => [entry.session.id, entry]));
  const ordered: SessionEntry[] = [];
  for (const project of orderedProjects(model)) {
    for (const session of orderedInProject(project)) {
      const entry = byId.get(session.id);
      if (entry !== undefined) {
        ordered.push(entry);
      }
    }
  }
  return ordered;
}

/** The node id for a project's frame. Ids are derived, never stored. */
export function groupNodeId(projectId: string): string {
  return `group:${projectId}`;
}

/** The node id for a session's info card. */
export function infoNodeId(sessionId: string): string {
  return `info:${sessionId}`;
}

/** The node id for one step of a session. */
export function stepNodeId(sessionId: string, decisionId: string): string {
  return `step:${sessionId}:${decisionId}`;
}

export function layoutCanvas(model: CanvasModel): CanvasLayout {
  const groups: GroupNodeSpec[] = [];
  const nodes: CanvasNodeSpec[] = [];
  const edges: CanvasEdgeSpec[] = [];

  const byId = new Map(allSessions(model).map((entry) => [entry.session.id, entry]));

  // The widest a row can get: the frame is that wide for every project, so the
  // boxes line up down the canvas instead of stepping in and out with whatever
  // happens to be the longest chain inside each one.
  const rowWidth =
    INFO_SIZE.width + ELIDED_GAP + VISIBLE_DECISION_COUNT * STEP_SIZE.width + 2 * STEP_GAP;

  let groupY = 0;
  for (const project of orderedProjects(model)) {
    const sessions = orderedInProject(project);
    const body =
      sessions.length === 0
        ? EMPTY_GROUP_BODY
        : sessions.length * INFO_SIZE.height + (sessions.length - 1) * ROW_GAP;

    const groupId = groupNodeId(project.id);
    groups.push({
      id: groupId,
      project,
      position: { x: 0, y: groupY },
      size: {
        width: rowWidth + GROUP_PADDING.x * 2,
        height: GROUP_PADDING.top + body + GROUP_PADDING.bottom,
      },
    });

    let y = GROUP_PADDING.top;
    for (const session of sessions) {
      const entry = byId.get(session.id);
      if (entry === undefined) {
        continue;
      }
      const steps = visibleDecisions(session);

      const info: InfoNodeSpec = {
        kind: 'info',
        id: infoNodeId(session.id),
        entry,
        parentId: groupId,
        position: { x: GROUP_PADDING.x, y },
        size: INFO_SIZE,
      };
      nodes.push(info);

      let x = GROUP_PADDING.x + INFO_SIZE.width + ELIDED_GAP;
      let previousId = info.id;

      steps.forEach((decision, index) => {
        const id = stepNodeId(session.id, decision.id);
        nodes.push({
          kind: 'step',
          id,
          entry,
          decision,
          ordinal: index + 1,
          parentId: groupId,
          position: { x, y },
          size: STEP_SIZE,
        });

        const skipped = session.decisions.length - steps.length;
        edges.push({
          id: `${previousId}->${id}`,
          source: previousId,
          target: id,
          elided: index === 0,
          // Only the first edge can carry a count, and only when something was
          // actually dropped. Labelling it `+0` would be a mark that means
          // "nothing", which is worse than no mark.
          label: index === 0 && skipped > 0 ? `+${skipped}` : null,
        });

        previousId = id;
        x += STEP_SIZE.width + STEP_GAP;
      });

      y += INFO_SIZE.height + ROW_GAP;
    }

    groupY += GROUP_PADDING.top + body + GROUP_PADDING.bottom + GROUP_GAP;
  }

  return { groups, nodes, edges };
}
