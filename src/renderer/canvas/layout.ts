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
import {
  CELL,
  cellOrigin,
  FAN,
  INFO_OFFSET,
  INFO_SIZE,
  STEP_SIZE,
  STEP_SLOTS,
  stepSlotOffset,
} from './grid.js';

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
  /**
   * One of the two steps immediately before the current one, which the card
   * draws with more `IN` and less `OUT` (see StepNode). Computed here because
   * this is the module that knows the chain: a node component is handed its
   * own decision and cannot see what came after it.
   */
  readonly recall: boolean;
  readonly position: Position;
  readonly size: Size;
  /** Status-derived; see `STATUS_OPACITY`. */
  readonly opacity: number;
};

export type CanvasNodeSpec = InfoNodeSpec | StepNodeSpec;

/** The four statuses a colour exists for on the canvas — matches SessionFanNode. */
/**
 * `empty` = no step in that slot. `idle` = a step is there but it is not the
 * one the session is on, so it draws as a plain line. Only the active slot
 * carries the session's status colour.
 */
export type FanBranchStatus = Session['status'] | 'empty' | 'idle';

/** Scenery: the connector to a session's three step slots (epic.md §5.2). Not
 *  navigable — kept out of `nodes` so Canvas.tsx's nodeIds memo never turns
 *  it into a `j`/`k` destination. `sessionId` lets the focus effect find its
 *  cell without parsing `id`. */
export type FanSpec = {
  readonly kind: 'fan';
  readonly id: string;
  readonly sessionId: string;
  readonly sessionStatus: Session['status'];
  /** One per slot position, top to bottom. `'empty'` where no step is drawn. */
  readonly branchStatuses: readonly [FanBranchStatus, FanBranchStatus, FanBranchStatus];
  /** Index of the drawn step the session is on, or null when it has none. */
  readonly activeSlot: number | null;
  /** `session.decisions.length` — NOT the number of branches drawn. */
  readonly totalSteps: number;
  readonly position: Position;
  readonly size: Size;
  readonly opacity: number;
};

/** Scenery: one of a session's three step positions. `placeholder` is true
 *  where no decision fills it — the dashed "no step yet" card. Not
 *  navigable, for the same reason `FanSpec` is not. */
export type StepSlotSpec = {
  readonly kind: 'slot';
  readonly id: string;
  readonly sessionId: string;
  readonly placeholder: boolean;
  readonly position: Position;
  readonly size: Size;
  readonly opacity: number;
};

export type CanvasLayout = {
  /** The navigable nodes. Positions are absolute. */
  readonly nodes: readonly CanvasNodeSpec[];
  /** Fans (one per session) and slots (exactly `STEP_SLOTS` per session).
   *  Neither is navigable. */
  readonly fans: readonly FanSpec[];
  readonly slots: readonly StepSlotSpec[];
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

/** Scenery ids: a session's fan, and one of its three slot positions (0-based). */
export function fanNodeId(sessionId: string): string {
  return `fan:${sessionId}`;
}
export function slotNodeId(sessionId: string, position: number): string {
  return `slot:${sessionId}:${position}`;
}

export function layoutCanvas(model: CanvasModel): CanvasLayout {
  const nodes: CanvasNodeSpec[] = [];
  const fans: FanSpec[] = [];
  const slots: StepSlotSpec[] = [];

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

    /**
     * The two steps just before the current one — the ones whose `IN` is worth
     * more than their `OUT` when you scan back over a chain.
     *
     * `steps` is newest-last, so the current step is the last drawn (the same
     * rule `activeSlot` uses below, and for the same reason: an older turn with
     * no output is common in a live log, so "first unanswered" would pick the
     * wrong one). Everything before those two, and the current step itself, is
     * untouched. A chain of one or none simply marks nothing.
     */
    const recallFrom = steps.length - 3;
    const recallTo = steps.length - 1;

    steps.forEach((decision, slot) => {
      const offset = stepSlotOffset(slot);
      nodes.push({
        kind: 'step',
        id: stepNodeId(session.id, decision.id),
        entry,
        decision,
        ordinal: slot + 1,
        recall: slot >= recallFrom && slot < recallTo,
        position: { x: origin.x + offset.x, y: origin.y + offset.y },
        size: STEP_SIZE,
        opacity,
      });
    });

    /**
     * Which drawn step the session is ON — the one the route lights up for.
     *
     * The mockup colours exactly one path: trunk, spine, and the single branch
     * reaching the current step. Everything else is a neutral line. Before
     * this every filled branch got `session.status`, so they were all the same
     * colour and the fan said "this session is waiting" three times instead of
     * "it is waiting HERE".
     *
     * `steps` is newest-last (visibleDecisions reverses), so the current step
     * is simply the last one drawn.
     *
     * This was first written as "the first step with no output, falling back
     * to the newest" — which reads plausibly and is wrong against real data.
     * `to-canvas.ts` gives `output: null` to any turn with no answer, and an
     * OLDER dispatch that never got answered is common in a live log. That
     * made the route light up an early branch and leave the newest grey: the
     * colour appeared reversed, which is exactly what the operator reported.
     * The mockup agrees with the simple rule — every artboard colours the
     * bottom branch `M45 245 H110`, the last one drawn.
     */
    const activeSlot = steps.length === 0 ? null : steps.length - 1;

    const branchStatuses = Array.from({ length: STEP_SLOTS }, (_, slot) =>
      slot >= steps.length ? 'empty' : slot === activeSlot ? session.status : 'idle',
    ) as [FanBranchStatus, FanBranchStatus, FanBranchStatus];

    fans.push({
      kind: 'fan',
      id: fanNodeId(session.id),
      sessionId: session.id,
      sessionStatus: session.status,
      branchStatuses,
      activeSlot,
      totalSteps: session.decisions.length,
      position: { x: origin.x + FAN.x, y: origin.y },
      size: { width: FAN.width, height: CELL.height },
      opacity,
    });

    for (let slot = 0; slot < STEP_SLOTS; slot += 1) {
      const offset = stepSlotOffset(slot);
      slots.push({
        kind: 'slot',
        id: slotNodeId(session.id, slot),
        sessionId: session.id,
        placeholder: slot >= steps.length,
        position: { x: origin.x + offset.x, y: origin.y + offset.y },
        size: STEP_SIZE,
        opacity,
      });
    }
  });

  return { nodes, fans, slots };
}
