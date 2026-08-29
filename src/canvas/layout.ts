/**
 * Where the canvas nodes go before anybody drags them.
 *
 * The canvas is an **overview**, not the place work happens: a 2-column grid
 * of cells (`vam-canvas-topology` task-1's `grid.ts`), each cell holding one
 * session card and, to its right, up to three step slots stacked vertically —
 * oldest at the top, newest at the bottom, nearest the detail panel that
 * expands it.
 *
 * No project frame any more (`vam-canvas-topology` task-4): `orderedForCanvas`
 * orders cells flat, urgency-first, project-blind, and every position is
 * absolute — no node names a parent.
 *
 * Pure and position-only. It does not know about ReactFlow, so it can be tested
 * without one, and the canvas component adapts it. All geometry — cell origin,
 * card offsets, card sizes — comes from `grid.ts`; this module places, it does
 * not measure.
 */

import type { CanvasModel, Decision, Project, Session } from '../domain/model.js';
import { allSessions, type SessionEntry, visibleDecisions } from '../domain/selectors.js';
import { cellOrigin, INFO_OFFSET, INFO_SIZE, STEP_SIZE, stepSlotOffset } from './grid.js';

export { INFO_SIZE, STEP_SIZE };

export type Position = { readonly x: number; readonly y: number };
export type Size = { readonly width: number; readonly height: number };

export type InfoNodeSpec = {
  readonly kind: 'info';
  readonly id: string;
  readonly entry: SessionEntry;
  /** Absolute — no node names a parent any more. */
  readonly position: Position;
  readonly size: Size;
  /** Status-derived; see `STATUS_OPACITY`. */
  readonly opacity: number;
};

export type StepNodeSpec = {
  readonly kind: 'step';
  readonly id: string;
  readonly entry: SessionEntry;
  readonly decision: Decision;
  /** 1-based, top to bottom — 3 is the newest. */
  readonly ordinal: number;
  readonly position: Position;
  readonly size: Size;
  /** Status-derived; see `STATUS_OPACITY`. */
  readonly opacity: number;
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

export type CanvasLayout = {
  /** The navigable nodes. Positions are absolute. */
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

/**
 * Per-cell opacity, derived from status alone (operator answer
 * factory-vam-2#37 q4). There is deliberately no `focused` entry: focus is
 * not in `CanvasModel`, so `layoutCanvas` cannot compute it; the cursor
 * override belongs to Canvas.tsx.
 */
const STATUS_OPACITY: Readonly<Record<Session['status'], number>> = {
  // waiting/running/done are measured off the mockup (epic.md §3.4).
  waiting: 0.72,
  running: 0.6,
  done: 0.45,
  // failed has no mockup cell — it shows QUEUED, which vam's model does not
  // have — so this value is inferred to match `done`, not measured.
  failed: 0.45,
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

/**
 * Every session, FLAT and urgency-first, project-blind — the order the canvas
 * places cells in. Not `orderedSessions`: that stays project-major for the
 * sidebar and is untouched. Sorts a fresh copy, never in place; stable.
 */
export function orderedForCanvas(model: CanvasModel): SessionEntry[] {
  return [...allSessions(model)].sort(
    (a, b) => STATUS_RANK[a.session.status] - STATUS_RANK[b.session.status],
  );
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
  const nodes: CanvasNodeSpec[] = [];
  const edges: CanvasEdgeSpec[] = [];

  // Emitted cell by cell in `orderedForCanvas` order, so reading order matches
  // visual order for a screen reader or a Tab traversal.
  orderedForCanvas(model).forEach((entry, index) => {
    const { session } = entry;
    const steps = visibleDecisions(session);
    const origin = cellOrigin(index);
    const opacity = STATUS_OPACITY[session.status];

    const info: InfoNodeSpec = {
      kind: 'info',
      id: infoNodeId(session.id),
      entry,
      position: { x: origin.x + INFO_OFFSET.x, y: origin.y + INFO_OFFSET.y },
      size: INFO_SIZE,
      opacity,
    };
    nodes.push(info);

    let previousId = info.id;
    const skipped = session.decisions.length - steps.length;

    steps.forEach((decision, slot) => {
      const id = stepNodeId(session.id, decision.id);
      const offset = stepSlotOffset(slot);
      nodes.push({
        kind: 'step',
        id,
        entry,
        decision,
        ordinal: slot + 1,
        position: { x: origin.x + offset.x, y: origin.y + offset.y },
        size: STEP_SIZE,
        opacity,
      });

      edges.push({
        id: `${previousId}->${id}`,
        source: previousId,
        target: id,
        elided: slot === 0,
        // Only the first edge can carry a count, and only when something was
        // actually dropped. Labelling it `+0` would be a mark that means
        // "nothing", which is worse than no mark.
        label: slot === 0 && skipped > 0 ? `+${skipped}` : null,
      });

      previousId = id;
    });
  });

  return { nodes, edges };
}
