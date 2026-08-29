/**
 * Where the canvas nodes go before anybody drags them.
 *
 * The canvas is an **overview**, not the place work happens: one row per
 * session, and each row a chain
 *
 *     [ session ] ⟿ [ step ] → [ step ] → [ step ]
 *
 * The first link is drawn differently on purpose — it stands for however many
 * steps came before the three shown, and it is the only edge that means "there
 * is history here you are not looking at". The last three are the newest three,
 * oldest to newest left to right, so the newest step is the one nearest the
 * detail panel that expands it.
 *
 * There is no project frame any more (`vam-canvas-topology` task-4).
 * `orderedForCanvas` stacks rows flat, urgency-first, project-blind. Every
 * position is absolute — no node names a parent.
 *
 * Pure and position-only. It does not know about ReactFlow, so it can be tested
 * without one, and the canvas component adapts it.
 */

import type { CanvasModel, Decision, Project, Session } from '../domain/model.js';
import { allSessions, type SessionEntry, visibleDecisions } from '../domain/selectors.js';

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
/** Left margin of every row, now that there is no frame to inset from. */
const ROW_MARGIN = 30;

export type Position = { readonly x: number; readonly y: number };
export type Size = { readonly width: number; readonly height: number };

export type InfoNodeSpec = {
  readonly kind: 'info';
  readonly id: string;
  readonly entry: SessionEntry;
  /** Absolute — no node names a parent any more. */
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
 * stacks rows in. Not `orderedSessions`: that stays project-major for the
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

  let y = 0;
  for (const entry of orderedForCanvas(model)) {
    const { session } = entry;
    const steps = visibleDecisions(session);

    const info: InfoNodeSpec = {
      kind: 'info',
      id: infoNodeId(session.id),
      entry,
      position: { x: ROW_MARGIN, y },
      size: INFO_SIZE,
    };
    nodes.push(info);

    let x = ROW_MARGIN + INFO_SIZE.width + ELIDED_GAP;
    let previousId = info.id;

    steps.forEach((decision, index) => {
      const id = stepNodeId(session.id, decision.id);
      nodes.push({
        kind: 'step',
        id,
        entry,
        decision,
        ordinal: index + 1,
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

  return { nodes, edges };
}
