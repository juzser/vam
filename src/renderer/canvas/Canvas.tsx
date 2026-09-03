/**
 * The three-column shell, and the one place a keypress becomes a move.
 *
 *     [ sessions ] [ ————— canvas ————— ] [ detail + answer ]
 *
 * The division of labour is the point: the chord grammar lives in
 * `keyboard/chords.ts`, the geometry in `keyboard/spatial-nav.ts`, the
 * coordinate maths in `canvas/nav-nodes.ts`, the positions in `canvas/layout.ts`
 * — all pure, all tested without a DOM. What is left here is what genuinely
 * needs React: owning the listener, holding focus, and asking ReactFlow where
 * things currently are.
 *
 * "Currently" is load-bearing. Every move reads `getNodes()` at the moment the
 * key is pressed rather than a list captured at render, which is what lets §4
 * promise that dragging cannot break `hjkl`.
 *
 * **One focus, three views.** The sidebar, the canvas and the detail panel all
 * read the same `focusedNodeId`; none of them owns a cursor of its own. That is
 * why `j` does not have to mean something different depending on which pane you
 * are "in" — there is no such thing as being in a pane. `j`/`k` walk sessions
 * because rows are stacked; `h`/`l` walk a session's chain because its nodes are
 * in a line. Nothing had to be added for the sidebar: it mirrors the same id.
 */

import {
  Background,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import { Maximize } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeUsage, POLL_INTERVAL_MS, type UsageSnapshot } from '../../shared/usage.js';
import { SmithApiError } from '../adapter/client.js';
import { useReviewQueue } from '../adapter/useReviewQueue.js';
import type { CanvasModel, Decision, Project, SessionStatus, SourceId } from '../domain/model.js';
import { cycleMatch, searchMatches } from '../domain/search.js';
import type { SessionEntry } from '../domain/selectors.js';
import type { StatusFilter } from '../domain/session-filter.js';
import { isAgentStarted, isUnprompted } from '../domain/session-filter.js';
import { type ChordState, EMPTY_CHORD, normalizeKey, resolveChord } from '../keyboard/chords.js';
import { nextNode } from '../keyboard/spatial-nav.js';
import { DetailPanel } from '../panels/DetailPanel.js';
import { IconPicker } from '../panels/IconPicker.js';
import { Note } from '../panels/Note.js';
import { PaneResizer } from '../panels/PaneResizer.js';
import { SessionList } from '../panels/SessionList.js';
import { DEFAULT_PANES, renderedWidth } from '../prefs/panes.js';
import {
  applyIcons,
  applyTheme,
  browserStorage,
  type Prefs,
  readPrefs,
  setIcon,
  setPaneWidth,
  setProjectIcon,
  setSessionFilters,
  setTheme,
  writePrefs,
} from '../prefs/prefs.js';
import { canWriteTo } from '../sources/port.js';
import { buildActions, clampIndex } from './actions.js';
import { CommandPalette } from './CommandPalette.js';
import { infoNodeId, layoutCanvas, orderedSessions } from './layout.js';
import { type FlowNodeLike, toNavNodes } from './nav-nodes.js';
import { SessionFanNode } from './SessionFanNode.js';
import { SessionInfoNode } from './SessionInfoNode.js';
import { StepNode } from './StepNode.js';
import { StepSlotNode } from './StepSlotNode.js';
import { type CanvasSource, READ_ONLY_SOURCE } from './source.js';

/**
 * A `StepSlotSpec` is emitted for all three of a session's slot positions
 * (layout.ts), including the one a real step already occupies — the fan's
 * scenery ids must be stable regardless of decision count (AC-9's `scenery`
 * set is read straight off `layout.slots`, unfiltered). Only the EMPTY
 * positions get the dashed "no step yet" card; an occupied position renders
 * nothing here, so it does not draw a second "no step yet" behind the real
 * step card it sits under.
 */
function OccupiedSlot() {
  return null;
}

const NODE_TYPES = {
  info: SessionInfoNode,
  step: StepNode,
  fan: SessionFanNode,
  slot: StepSlotNode,
  'slot-filled': OccupiedSlot,
};

/** ReactFlow requires an edges array; there is no custom edge type any more —
 *  the fan is a scenery node (epic.md §5.2). A module-level constant keeps
 *  this a stable reference across renders. */
const NO_EDGES: Edge[] = [];

/** Home-row first: the labels you can hit without looking. */
const JUMP_KEYS = 'asdfghjkl;qwertyuiop';

/**
 * Where the canvas opens: 80%, centred on the origin until focus moves it.
 *
 * `fitView` used to decide this, which meant the opening zoom depended on how
 * many sessions the workspace happened to have.
 */
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.8 } as const;

/**
 * How much of the canvas the focused session's row should occupy.
 *
 * The operator has asked for this twice with different numbers (70%, now 60%),
 * and has said it will become a setting. So it is a named target rather than a
 * padding value: `focusPadding` derives what ReactFlow actually wants, and a
 * settings pane will one day write to this constant's runtime equivalent
 * without anyone having to re-derive the formula.
 */
/**
 * Token counts at a glance: `578k`, `4.2M`.
 *
 * The status bar has one line and this cell shares it with six others, so the
 * digits have to give way before the layout does. Not `Intl.NumberFormat`'s
 * compact notation, which localises the suffix — a status bar that says `4,2 Mn`
 * in one locale and `4.2M` in another has a cell whose width nobody can plan.
 */
export function compactTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${Math.round(n / 1_000)}k`;
  }
  return String(n);
}

export const FOCUS_VIEWPORT_SHARE = 0.6;

/**
 * ReactFlow's `fitView` padding for a target share of the viewport.
 *
 * `padding` is a fraction added on each side of the fitted bounds, so the
 * content ends up occupying `1 / (1 + 2p)`. Inverting that gives the padding
 * for a share: p = (1/share - 1) / 2. At 0.6 that is 0.333.
 */
export function focusPadding(share: number): number {
  return (1 / share - 1) / 2;
}

function jumpLabels(ids: readonly string[]): Map<string, string> {
  const labels = new Map<string, string>();
  ids.forEach((id, index) => {
    const key = JUMP_KEYS[index];
    if (key !== undefined) {
      labels.set(id, key);
    }
  });
  return labels;
}

/**
 * What the icon picker is aiming at.
 *
 * The SOURCE is captured when the picker opens, not re-derived when it
 * closes. Re-deriving it meant `allEntries.find(e => e.session.id === id)`,
 * a lookup by session id ACROSS EVERY SOURCE — the exact ambiguity this
 * epic re-keyed storage to remove. With two sources holding a session
 * `D-257`, `.find` returns whichever sorts first, so the glyph could land in
 * the wrong source's bucket and appear on the other session. The title is
 * carried for the same reason: it was a second lookup with the same flaw,
 * and it also cannot go stale if the entry disappears while the picker is
 * open.
 */
type IconTarget = {
  readonly source: SourceId;
  readonly sessionId: string;
  readonly title: string;
};

/**
 * What the PROJECT icon picker is aiming at — same shape and same reasoning
 * as `IconTarget`, one level up: captured when the picker opens rather than
 * re-derived, so a model refresh mid-pick cannot move the write to the wrong
 * project.
 */
type ProjectIconTarget = {
  readonly source: SourceId;
  readonly projectId: string;
  readonly name: string;
};

/** Neither `window.api` nor its `usage` member exists in the browser build. */
const UNKNOWN_SNAPSHOT: UsageSnapshot = { kind: 'unknown', reason: 'unavailable' };

/**
 * Polls `window.api.usage.get()` on `POLL_INTERVAL_MS` and clears the
 * interval on unmount. `getUsage` is `undefined` in the browser build --
 * there is no main process behind it and its CSP would refuse the call
 * regardless -- so this hook then makes no request at all and holds the
 * unknown snapshot forever, rather than trying and failing.
 */
function useUsageSnapshot(getUsage: (() => Promise<UsageSnapshot>) | undefined): UsageSnapshot {
  const [snapshot, setSnapshot] = useState<UsageSnapshot>(UNKNOWN_SNAPSHOT);

  useEffect(() => {
    if (getUsage === undefined) {
      return;
    }
    let cancelled = false;
    const poll = () => {
      getUsage()
        .then((next) => {
          if (!cancelled) setSnapshot(next);
        })
        .catch(() => {
          if (!cancelled) setSnapshot(UNKNOWN_SNAPSHOT);
        });
    };
    poll();
    const id = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [getUsage]);

  return snapshot;
}

function CanvasInner({
  model: factoryModel,
  source,
}: {
  model: CanvasModel;
  source: CanvasSource;
}) {
  // `window.api` exists only in the Electron shell (App.tsx); in the browser
  // build `usage` is `undefined` and the hook below never calls anything.
  const usageSnapshot = useUsageSnapshot(window.api?.usage?.get);
  const usage = describeUsage(usageSnapshot, new Date());

  /**
   * What you arranged, as opposed to what the factory reported. Read once —
   * `localStorage` is synchronous and this is two small maps — and written on
   * every change, so a reload finds the canvas as you left it.
   */
  const storage = useMemo(() => browserStorage(), []);
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs(storage));
  const savePrefs = useCallback(
    (next: Prefs) => {
      setPrefs(next);
      writePrefs(storage, next);
    },
    [storage],
  );

  /**
   * The two pane widths, live. `viewportWidth` re-renders the clamp on every
   * resize but never writes (epic.md §4.2 point 2). `liveWidths` holds a
   * pane's in-progress drag value so the other pane's rendered width can
   * react to it without touching storage; it is cleared and `savePrefs` is
   * called only at drag end, never mid-drag (AC-2(c)).
   */
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    function onResize() {
      setViewportWidth(window.innerWidth);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [liveWidths, setLiveWidths] = useState<{
    sidebar: number | null;
    detail: number | null;
  }>({ sidebar: null, detail: null });

  const storedSidebar = liveWidths.sidebar ?? prefs.panes.sidebar;
  const storedDetail = liveWidths.detail ?? prefs.panes.detail;
  const sidebarWidth = renderedWidth('sidebar', storedSidebar, storedDetail, viewportWidth);
  const detailWidth = renderedWidth('detail', storedDetail, storedSidebar, viewportWidth);

  const onPaneChange = useCallback((pane: 'sidebar' | 'detail', width: number) => {
    setLiveWidths((prev) => ({ ...prev, [pane]: width }));
  }, []);

  const onPaneCommit = useCallback(
    (pane: 'sidebar' | 'detail', width: number) => {
      setLiveWidths((prev) => ({ ...prev, [pane]: null }));
      savePrefs(setPaneWidth(prefs, pane, width));
    },
    [prefs, savePrefs],
  );

  /**
   * The factory's model with your icons on it. Done here, once, so neither the
   * sidebar nor the canvas node has to know that an icon comes from somewhere
   * different than the rest of a session.
   */
  // The class on <html> is what styles.css switches on, and prefs is the only
  // source for it — so this effect, not the toggle's click handler, is what
  // moves the document. A handler that also wrote the class would be a second
  // writer, and the two disagree the first time prefs is restored from storage.
  useEffect(() => {
    applyTheme(prefs.theme);
  }, [prefs.theme]);

  const model = useMemo(
    () => applyIcons(factoryModel, prefs.icons, prefs.projectIcons),
    [factoryModel, prefs.icons, prefs.projectIcons],
  );

  const allEntries = useMemo(() => orderedSessions(model), [model]);

  /**
   * `null` until there is a layout to point at.
   *
   * This used to seed itself from `layout.nodes[0]`, which was only possible
   * while the layout came straight from the model. It is now built from the
   * FILTERED model, and that cannot be computed above the filter state
   * declared below. Nothing is lost: the "land focus on something real" effect
   * already had to cover the live case, where the first model arrives after
   * mount and the first layout is empty whatever this says.
   */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [jumping, setJumping] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  /**
   * Which pane the keyboard belongs to. `I` hands it to the action pane, `H` and
   * `Esc` hand it back. Two panes and one explicit owner, rather than a guess
   * based on what was last clicked — a keyboard-first tool cannot afford to be
   * wrong about where the next keystroke goes.
   */
  const [pane, setPane] = useState<'list' | 'action'>('list');
  const [actionIndex, setActionIndex] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pickingIconFor, setPickingIconFor] = useState<IconTarget | null>(null);
  const [pickingProjectIconFor, setPickingProjectIconFor] = useState<ProjectIconTarget | null>(
    null,
  );
  const [filtering, setFiltering] = useState(false);
  /**
   * The pill row: All / Running / Needs you / Done — drawn by the sidebar's
   * filter popover, which is now its only control.
   *
   * A SECOND narrowing, stacked on `/` rather than replacing it, because the
   * two answer different questions — "the one called permalink" and "the ones
   * that stopped". Both narrow where you navigate; neither hides anything the
   * canvas draws.
   */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  /** The sidebar's filter popover — the ONE home for narrowing (SessionList). */
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  /** True while a write is in flight — Enter must not fire twice. */
  const [writing, setWriting] = useState(false);
  const searchOrigin = useRef<string | null>(null);
  const chord = useRef<ChordState>(EMPTY_CHORD);
  const { getNodes, zoomIn, zoomOut, fitView } = useReactFlow();

  const matches = useMemo(() => searchMatches(allEntries, query), [allEntries, query]);

  /**
   * The one set the sidebar lists, the canvas draws and the cursor may land on.
   * `/` narrows it in place — orca's shape — rather than opening a separate
   * search that leaves the list untouched while you type into it, and the
   * status pills narrow it the same way.
   *
   * This used to narrow the SIDEBAR alone, on the reasoning that "the canvas is
   * the overview, and an overview that hides things is not one". That reasoning
   * cost more than it bought. The canvas went on drawing cards the cursor could
   * not reach and the sidebar had no row for, so `j` stepped straight over a
   * card that was plainly on screen and there was no sidebar row to click
   * instead — reported as "some sessions do not show on the canvas and cannot
   * be navigated to from the sidebar". A card nothing can focus is not
   * overview; it is scenery shaped like a session. The file's own "one focus,
   * three views" rule only means something if the three views also agree on the
   * SET, so a filter now narrows what is drawn as well, and `All` (or Escape
   * out of `/`) puts every card back.
   */
  const entries = useMemo(() => {
    const byText =
      query.trim() === '' ? allEntries : allEntries.filter((e) => matches.includes(e.session.id));
    const byStatus =
      statusFilter === 'all' ? byText : byText.filter((e) => e.session.status === statusFilter);
    // Both origin rules only ever exclude something vam POSITIVELY classified
    // — see `session-filter.ts`. A session whose timeline has not arrived is
    // `unknown` and survives both, because hiding what you did not check is
    // how a filter loses work rather than narrowing it.
    const byOrigin = prefs.filters.hideAgentStarted
      ? byStatus.filter((e) => !isAgentStarted(e.session))
      : byStatus;
    return prefs.filters.onlyPrompted ? byOrigin.filter((e) => !isUnprompted(e.session)) : byOrigin;
  }, [allEntries, matches, query, statusFilter, prefs.filters]);

  /**
   * What each origin rule takes away, counted over the WHOLE workspace and
   * independently of whether its toggle is on — the popover shows it either
   * way, so turning one on is a number you saw coming rather than a row that
   * went missing. The two overlap freely: an agent-made session with no
   * prompt is counted by both, because each number answers "how many does
   * THIS rule match", not "how many would I lose next".
   */
  const hiddenCounts = useMemo(
    () => ({
      agent: allEntries.filter((e) => isAgentStarted(e.session)).length,
      unprompted: allEntries.filter((e) => isUnprompted(e.session)).length,
    }),
    [allEntries],
  );

  /** The pill counts are off the UNFILTERED list — a count that moved when you
      clicked it would be a count of your own click. */
  const tally = useMemo(() => {
    const of = (status: SessionStatus) =>
      allEntries.filter((e) => e.session.status === status).length;
    return {
      all: allEntries.length,
      running: of('running'),
      waiting: of('waiting'),
      done: of('done'),
      failed: of('failed'),
    };
  }, [allEntries]);

  /**
   * The model the canvas draws: `model`, minus whatever the filter excluded.
   *
   * Re-filters `model.projects` rather than rebuilding a model out of
   * `entries`, so every project keeps its identity — id, name and source — and
   * only its membership changes. A project the filter empties drops out
   * entirely instead of drawing a heading over nothing. Unfiltered, the very
   * same object comes back, so the layout memo below does not recompute for a
   * filter nobody set.
   */
  const visibleModel = useMemo<CanvasModel>(() => {
    const visible = new Set(entries.map((e) => e.session.id));
    if (visible.size === allEntries.length) {
      return model;
    }
    return {
      projects: model.projects
        .map((project) => ({
          ...project,
          sessions: project.sessions.filter((s) => visible.has(s.id)),
        }))
        .filter((project) => project.sessions.length > 0),
    };
  }, [model, entries, allEntries]);

  const layout = useMemo(() => layoutCanvas(visibleModel), [visibleModel]);

  /**
   * What `hjkl`, `f` and `gg` may land on: every node on the canvas, no filter
   * of its own. The set is narrowed once, at `entries` above, and the canvas is
   * drawn from the result — so a second narrowing here is what would put the
   * cursor and the picture back out of step.
   */
  const nodeIds = useMemo(() => layout.nodes.map((n) => n.id), [layout]);

  /** Which session the focused node belongs to — the id all three panes share. */
  const focusedSpec = useMemo(
    () => layout.nodes.find((n) => n.id === focusedId) ?? null,
    [layout, focusedId],
  );
  const focusedEntry: SessionEntry | null = focusedSpec?.entry ?? null;

  /**
   * The viewport follows focus.
   *
   * `j`/`k` can walk to a session that is off screen, and before this the
   * canvas simply did not move — the sidebar and the detail panel updated
   * while the cards stayed put, so the one pane that shows a session's SHAPE
   * was the one pane that did not follow you. Centring on the focused node
   * makes the three views agree about where you are, which is the same
   * "one focus, three views" rule this file opens with.
   *
   * The zoom argument is deliberately omitted: `setCenter` keeps the current
   * scale, so following focus never overrides a zoom the operator chose.
   */
  /**
   * Which nodes make up the focused session's ROW — its info card, its steps,
   * its fan and its slots. The slots matter: they hold the three step
   * positions even when the session has fewer than three, so framing them is
   * what guarantees all three slots are visible rather than however many
   * happen to be filled.
   */
  const focusedSessionId = focusedSpec?.entry.session.id ?? null;
  const focusRowNodeIds = useMemo(() => {
    if (focusedSessionId === null) {
      return null;
    }
    return [
      ...layout.nodes.filter((n) => n.entry.session.id === focusedSessionId),
      ...layout.fans.filter((f) => f.sessionId === focusedSessionId),
      ...layout.slots.filter((sl) => sl.sessionId === focusedSessionId),
    ].map((n) => ({ id: n.id }));
  }, [layout, focusedSessionId]);

  /**
   * The viewport frames the focused row.
   *
   * `j`/`k` can walk to an off-screen session, and before this the canvas did
   * not move at all — the sidebar and detail panel updated while the cards
   * stayed put, so the one pane that shows a session's SHAPE was the one that
   * did not follow you.
   *
   * `fitView` over the row's own nodes rather than `setCenter`, because the
   * ask is a ZOOM as well as a position: all three steps legible, with the
   * neighbouring sessions still peeking in at the edges so you keep your place
   * in the list. `padding` is what buys that peek — it is a fraction of the
   * fitted bounds, so it scales with the viewport instead of assuming one.
   * `maxZoom` stops a session with a single short step from filling the screen.
   *
   * This deliberately overrides a zoom the operator set by hand. An earlier
   * version preserved it (`setCenter` keeps the current scale) and the
   * operator asked for the opposite: focusing should frame the row.
   */
  useEffect(() => {
    if (focusRowNodeIds === null || focusRowNodeIds.length === 0) {
      return;
    }
    // `padding` is derived, not tuned. It is a fraction added around the fitted
    // bounds, so the row occupies 1/(1 + 2p) of the viewport — and the target
    // is the thing worth naming, since it is what a settings pane will
    // eventually write to. See FOCUS_VIEWPORT_SHARE above.
    //
    // `maxZoom` is 1.6 rather than 1 because a short row would otherwise stop
    // scaling at 1 and sit well under the target — the case the cap used to
    // silently produce.
    void fitView({
      nodes: focusRowNodeIds,
      padding: focusPadding(FOCUS_VIEWPORT_SHARE),
      maxZoom: 1.6,
      duration: 220,
    });
  }, [focusRowNodeIds, fitView]);

  /**
   * What the detail panel expands: the focused step if a step is focused, else
   * the session's newest step. Focusing the session head should still show you
   * something — an empty panel next to a selected session reads as broken.
   */
  const focusedDecision: Decision | null = useMemo(() => {
    if (focusedSpec?.kind === 'step') {
      return focusedSpec.decision;
    }
    return focusedEntry?.session.decisions[0] ?? null;
  }, [focusedSpec, focusedEntry]);

  /**
   * The focused session's review queue. Only the focused one: answering is a
   * per-session act, and the waiver half costs a request per task.
   */
  const review = useReviewQueue(
    source.kind === 'live' ? source.client : null,
    focusedEntry?.session.id ?? null,
  );
  /** Which queue row is mid-write, so it can stop taking clicks. */
  const [answering, setAnswering] = useState<string | null>(null);
  /**
   * The reason typed against each queue row, keyed by fingerprint or lesson id.
   * Lifted out of the rows so `Enter` on a verdict can read it — see
   * `ReviewQueue`'s `notes`.
   */
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** The row whose note box `i` has just asked for. */
  const [noteFocus, setNoteFocus] = useState<string | null>(null);

  /**
   * Everything the action pane can land on, in the order it is drawn.
   *
   * Built here rather than inside the panel because `Enter` has to activate it
   * and `Enter` is handled by the window listener. A panel that owned its own
   * cursor would be a second source of truth about what is selected.
   */
  const actions = useMemo(
    () => buildActions(review.waivers, review.lessons, focusedDecision?.commands ?? []),
    [review.waivers, review.lessons, focusedDecision],
  );

  const labels = useMemo(
    () => (jumping ? jumpLabels(nodeIds) : new Map<string, string>()),
    [jumping, nodeIds],
  );

  const initialNodes = useMemo<Node[]>(
    () => [
      // Scenery first, painted behind the navigable nodes (epic.md §5.2).
      // Never a `j`/`k` destination: draggable/selectable/focusable are each
      // explicit — omitted, they'd default true (@xyflow/react board level).
      ...layout.fans.map((spec) => ({
        id: spec.id,
        type: 'fan',
        position: spec.position,
        width: spec.size.width,
        height: spec.size.height,
        style: { width: spec.size.width, height: spec.size.height, opacity: spec.opacity },
        draggable: false,
        selectable: false,
        focusable: false,
        data: {
          sessionId: spec.sessionId,
          baseOpacity: spec.opacity,
          sessionStatus: spec.sessionStatus,
          branchStatuses: spec.branchStatuses,
          totalSteps: spec.totalSteps,
        },
      })),
      ...layout.slots.map((spec) => ({
        id: spec.id,
        type: spec.placeholder ? 'slot' : 'slot-filled',
        position: spec.position,
        width: spec.size.width,
        height: spec.size.height,
        style: { width: spec.size.width, height: spec.size.height, opacity: spec.opacity },
        draggable: false,
        selectable: false,
        focusable: false,
        data: { sessionId: spec.sessionId, baseOpacity: spec.opacity },
      })),
      ...layout.nodes.map((spec) => ({
        id: spec.id,
        type: spec.kind,
        position: spec.position,
        // `width`/`height` as well as `style`: we know these sizes, and stating
        // them means the very first keypress navigates correctly instead of
        // falling back to a zero rectangle before ReactFlow has measured.
        width: spec.size.width,
        height: spec.size.height,
        style: { width: spec.size.width, height: spec.size.height, opacity: spec.opacity },
        data: {
          ...(spec.kind === 'info'
            ? { entry: spec.entry }
            : { entry: spec.entry, decision: spec.decision }),
          focused: false,
          jumpLabel: null,
          sessionId: spec.entry.session.id,
          baseOpacity: spec.opacity,
        },
      })),
    ],
    [layout],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  /**
   * Keep the drawn nodes in step with the model.
   *
   * `useNodesState` takes its argument as INITIAL state and never looks at it
   * again. Against a fixture that is invisible — the model never changes — but
   * against a live factory the first render happens before the first fetch
   * answers, so the canvas latched onto an empty layout and stayed empty
   * forever while the sidebar filled in beside it. Positions are a pure
   * function of the model, so every render simply re-applies the layout.
   */
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  /**
   * Land focus on something real once there is something real.
   *
   * The first model arrives after mount, so the initial focus is null; and a
   * filter can strip the node under the cursor. Both end with a canvas nobody
   * is pointing at, which makes the first keypress do nothing.
   */
  useEffect(() => {
    if (nodeIds.length === 0) {
      return;
    }
    if (focusedId === null || !nodeIds.includes(focusedId)) {
      setFocusedId(nodeIds[0] ?? null);
    }
  }, [nodeIds, focusedId]);

  // Focus, jump labels and the focused-cell opacity override are all
  // presentation, written onto the existing nodes rather than rebuilding
  // them: `layoutCanvas` is a pure function of the model and cannot see
  // focus, so it can only ever emit the status opacity read from
  // `data.baseOpacity` (stamped once in `initialNodes`).
  useEffect(() => {
    const focusedSessionId = focusedEntry?.session.id ?? null;
    setNodes((current) =>
      current.map((node) => {
        const data = node.data as { sessionId?: string; baseOpacity?: number };
        const opacity =
          data.sessionId !== undefined && data.sessionId === focusedSessionId
            ? 1
            : (data.baseOpacity ?? 1);
        return {
          ...node,
          style: { ...node.style, opacity },
          data: {
            ...node.data,
            focused: node.id === focusedId,
            jumpLabel: labels.get(node.id) ?? null,
          },
        };
      }),
    );
  }, [focusedId, focusedEntry, labels, setNodes]);

  /** Move focus to a session by id — what the sidebar and the palette do. */
  const focusSession = useCallback((sessionId: string) => {
    setFocusedId(infoNodeId(sessionId));
  }, []);

  const copyCommand = useCallback(
    (commandId: string) => {
      const command = focusedDecision?.commands.find((c) => c.id === commandId);
      if (command === undefined) {
        return;
      }
      // Vam copies. Vam does not run — §4: the nod is still yours.
      void navigator.clipboard?.writeText(command.command);
      setStatus(`copied: ${command.label}`);
    },
    [focusedDecision],
  );

  /**
   * Write what you typed into the focused session's log — or, for a `'session'`
   * source whose capabilities say so, into the running agent itself.
   *
   * The wording of every outcome here is load-bearing. black-smith RECORDS a
   * prompt; it has no channel into a running agent session, so "recorded" is
   * the truth and "sent" would not be. A `'session'` source can be different:
   * when `capabilities.deliverPrompt` is true the write really does reach a
   * running `claude --resume`, and saying "recorded" there would be the same
   * lie in the other direction — the operator would think nothing happened
   * when an agent is about to answer.
   *
   * A refusal is reported in the factory's own words. `events.unknown-causal-session`
   * and `write.bad-request` each name a different mistake, and collapsing them
   * into "error" throws away the one thing black-smith just told us. A
   * `'session'` source whose `write` is absent (`recordPrompt: false`) is
   * refused before anything is called at all — `canWriteTo` is the only way in.
   */
  const sendPrompt = useCallback(async () => {
    const entry = focusedEntry;
    if (entry === null || draft.trim() === '') {
      return;
    }
    if (source.kind === 'demo') {
      setStatus(source.note);
      return;
    }
    if (writing) {
      return;
    }
    setWriting(true);
    try {
      if (source.kind === 'session') {
        const sessionSource = source.source;
        if (!canWriteTo(sessionSource)) {
          setStatus(`${sessionSource.label} cannot be written to`);
          return;
        }
        await sessionSource.write.recordPrompt(entry.session.id, draft);
        setDraft('');
        setComposing(false);
        setStatus(
          sessionSource.capabilities.deliverPrompt
            ? `sent into the running session of ${entry.session.title} — it will answer there`
            : `recorded in the log of ${entry.session.title} — recorded, not sent to the agent`,
        );
        source.onWrote();
      } else {
        await source.client.recordPrompt(entry.session.id, draft);
        setDraft('');
        setComposing(false);
        setStatus(
          `recorded in the log of ${entry.session.title} — recorded, not sent to the agent`,
        );
        source.onWrote();
      }
    } catch (cause) {
      setStatus(
        cause instanceof SmithApiError
          ? `${cause.code}: ${cause.message}`
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      setWriting(false);
    }
  }, [focusedEntry, draft, source, writing]);

  /**
   * Answer one of the factory's questions.
   *
   * Both writes report the factory's own words on refusal and force a reload of
   * BOTH the queue and the canvas on success — an answered row that stayed on
   * screen is one you would answer twice.
   */
  const answer = useCallback(
    async (id: string, write: () => Promise<unknown>, done: string) => {
      if (source.kind === 'demo') {
        setStatus(source.note);
        return;
      }
      if (answering !== null) {
        return;
      }
      setAnswering(id);
      try {
        await write();
        setStatus(done);
        // Back to the top of the list. The answered row vanishes, and leaving
        // the cursor at the same index drops it onto whatever slid up into that
        // slot — which after clearing a waiver was the NEXT row's "approve". A
        // cursor that lands on a consequential button you did not aim at is the
        // one way this pane could do real damage.
        setActionIndex(0);
        review.reload();
        source.onWrote();
      } catch (cause) {
        setStatus(
          cause instanceof SmithApiError
            ? `${cause.code}: ${cause.message}`
            : cause instanceof Error
              ? cause.message
              : String(cause),
        );
      } finally {
        setAnswering(null);
      }
    },
    [source, answering, review],
  );

  /**
   * Grant or deny one waiver. Reachable from the button and from `Enter`, so it
   * lives here rather than in the panel's props — and so the reason, which the
   * factory requires, is read from one place either way.
   */
  const answerWaiver = useCallback(
    (fingerprint: string, decision: 'granted' | 'denied') => {
      const session = focusedEntry?.session.id;
      if (source.kind !== 'live' || session === undefined) {
        setStatus(source.kind === 'demo' ? source.note : 'no session picked');
        return;
      }
      const note = (notes[fingerprint] ?? '').trim();
      if (note === '') {
        // waivers.ts refuses this anyway. Saying so here means the refusal
        // arrives before a round trip, and names the missing thing.
        setStatus('a waiver needs a reason — press i to write one');
        return;
      }
      void answer(
        fingerprint,
        () =>
          source.client.applyWaivers({ sessionId: session }, [
            { fingerprint, decision, operatorNote: note },
          ]),
        decision === 'granted'
          ? `waived ${fingerprint} — the reason is in the log`
          : `sent back for a fix: ${fingerprint}`,
      );
    },
    [source, focusedEntry, notes, answer],
  );

  const answerLesson = useCallback(
    (lessonId: string, to: 'approve' | 'reject') => {
      if (source.kind !== 'live') {
        setStatus(source.kind === 'demo' ? source.note : 'governance is not available here');
        return;
      }
      const note = (notes[lessonId] ?? '').trim();
      void answer(
        lessonId,
        () => source.client.transitionLesson(lessonId, to, note === '' ? {} : { note }),
        to === 'approve' ? `approved ${lessonId}` : `rejected ${lessonId}`,
      );
    },
    [source, notes, answer],
  );

  const copyAllCommands = useCallback(() => {
    const commands = focusedDecision?.commands ?? [];
    if (commands.length === 0) {
      setStatus('no command to copy');
      return;
    }
    void navigator.clipboard?.writeText(commands.map((c) => c.command).join('\n'));
    setStatus(`copied ${commands.length} commands`);
  }, [focusedDecision]);

  const stepSession = useCallback(
    (delta: 1 | -1) => {
      const index = entries.findIndex((e) => e.session.id === focusedEntry?.session.id);
      // -1 means the cursor is on nothing this list holds: an empty list, or a
      // focus the filter or a refresh has just made unreachable. Left to the
      // arithmetic below it became `-1 + 1 = 0`, which for an empty list read
      // as "off the end" and announced a LAST session that does not exist,
      // and for a non-empty one silently jumped to the first row with no word
      // said. `hjkl` already answers this state honestly one branch away.
      if (index === -1) {
        setStatus('no session matches');
        return;
      }
      // Clamped, not wrapped. Stopping dead is information: it tells you where
      // you are. Wrapping to the far end tells you nothing.
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= entries.length) {
        setStatus(delta > 0 ? 'last session already' : 'first session already');
        return;
      }
      const target = entries[nextIndex];
      if (target !== undefined) {
        focusSession(target.session.id);
      }
    },
    [entries, focusedEntry, focusSession],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(target.tagName)) {
        return; // the palette, the search line and the prompt own their own keys
      }

      // A bare modifier is a hand moving, not a keystroke. Letting it through
      // would abandon a half-typed chord the moment you reached for Cmd and
      // thought better of it.
      const key = normalizeKey(event);
      if (key === null) {
        return;
      }

      // Jump mode eats the very next key, so a label can safely reuse a letter
      // that means something else in normal mode.
      if (jumping && key !== 'Escape') {
        event.preventDefault();
        const hit = [...labels.entries()].find(([, label]) => label === key);
        setJumping(false);
        if (hit !== undefined) {
          setFocusedId(hit[0]);
        }
        return;
      }

      const step = resolveChord(chord.current, key);
      chord.current = step.state;
      const action = step.action;
      if (action === null) {
        // Swallow a chord's first key so `g` cannot reach the browser.
        if (step.state.pending !== null) {
          event.preventDefault();
        }
        return;
      }
      event.preventDefault();
      setStatus(null);

      switch (action.kind) {
        case 'move': {
          if (pane === 'action' && (action.direction === 'down' || action.direction === 'up')) {
            // In the action pane the vertical axis belongs to the actions —
            // every verdict button in the review queue, every command, and the
            // prompt last.
            const delta = action.direction === 'down' ? 1 : -1;
            setActionIndex((current) => clampIndex(current + delta, actions.length));
            return;
          }
          if (pane === 'action' && action.direction === 'left') {
            setPane('list');
            return;
          }
          // The cursor can be left on a node the filter has just made
          // unreachable. Land on the first survivor rather than navigating from
          // a node that is no longer in the set — `nextNode` throws on an origin
          // it cannot find, and rightly so.
          if (focusedId === null || !nodeIds.includes(focusedId)) {
            const first = nodeIds[0] ?? null;
            if (first === null) {
              setStatus('no session matches');
              return;
            }
            setFocusedId(first);
            return;
          }
          /**
           * Vertical is the LIST; horizontal is the canvas.
           *
           * `j`/`k` walk the sidebar's own order, one session at a time, and
           * land on that session's card. They used to walk canvas geometry,
           * which is a different order: with two projects side by side, `j`
           * from the first session went to the one physically below it — in
           * the other column — rather than to the next row in the list you are
           * reading. The sidebar is how sessions are enumerated, so it is what
           * "next session" has to mean.
           *
           * `h`/`l` keep the spatial walk, which is what they are for: moving
           * along a session's own row, card to step to step.
           */
          if (action.direction === 'down' || action.direction === 'up') {
            const at = entries.findIndex((e) => e.session.id === focusedSessionId);
            if (at === -1) {
              setStatus('no session matches');
              return;
            }
            const next = entries[at + (action.direction === 'down' ? 1 : -1)];
            if (next === undefined) {
              // The ends do not wrap. A cursor that reappears at the far end of
              // a long list is a cursor you then have to go looking for.
              setStatus(`nothing lies ${action.direction}`);
              return;
            }
            focusSession(next.session.id);
            return;
          }
          // Live geometry, read now — not a list captured at render time.
          const live = toNavNodes(getNodes() as unknown as FlowNodeLike[], nodeIds);
          const landed = nextNode(live, focusedId, action.direction);
          if (landed === null) {
            setStatus(`nothing lies ${action.direction}`);
          } else {
            setFocusedId(landed);
          }
          return;
        }
        case 'first':
          setFocusedId(nodeIds[0] ?? null);
          return;
        case 'last': {
          const lastEntry = entries[entries.length - 1];
          if (lastEntry !== undefined) {
            focusSession(lastEntry.session.id);
          }
          return;
        }
        case 'project':
          stepSession(action.delta);
          return;
        case 'jump':
          setJumping(true);
          return;
        case 'copy':
          copyAllCommands();
          return;
        case 'search':
          searchOrigin.current = focusedId;
          setQuery('');
          setFiltering(true);
          return;
        case 'searchNext':
        case 'searchPrev': {
          if (matches.length === 0) {
            setStatus(query.trim() === '' ? 'nothing searched yet' : 'No match');
            return;
          }
          const current = focusedEntry?.session.id ?? null;
          const landed = cycleMatch(matches, current, action.kind === 'searchNext' ? 1 : -1);
          if (landed !== null) {
            focusSession(landed);
            setStatus(`${matches.indexOf(landed) + 1}/${matches.length}`);
          }
          return;
        }
        case 'palette':
          setPaletteOpen(true);
          return;
        case 'filterMenu':
          setFilterMenuOpen((open) => !open);
          return;
        case 'focusAction':
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          setPane('action');
          setActionIndex(0);
          return;
        case 'focusList':
          setPane('list');
          setComposing(false);
          return;
        case 'rename':
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          setRenameDraft(focusedEntry.session.title);
          setRenamingId(focusedEntry.session.id);
          return;
        case 'icon': {
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          // A project with no source cannot store an icon under one: guessing
          // a fallback here would reintroduce the exact cross-source
          // collision this epic's storage re-key removed.
          const projectSource = focusedEntry.project.source;
          if (projectSource === undefined) {
            setStatus('this project has no source — icon unavailable');
            return;
          }
          setPickingIconFor((current) =>
            current !== null &&
            current.sessionId === focusedEntry.session.id &&
            current.source === projectSource
              ? null
              : {
                  source: projectSource,
                  sessionId: focusedEntry.session.id,
                  title: focusedEntry.session.title,
                },
          );
          return;
        }
        case 'close':
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          setStatus(
            `black-smith has no close-session command — "${focusedEntry.session.title}" is still here`,
          );
          return;
        case 'newSession':
          // A session is created by a person running `smith event append`
          // session-start, or by opening one. There is no route, and inventing
          // one would let vam mint sessions nobody is driving.
          setStatus('sessions are created from the CLI — smith event append session-start');
          return;
        case 'settings':
          setStatus('settings not built yet');
          return;
        case 'resizePane': {
          // Which pane owns the keyboard right now decides which one moves —
          // the same `pane` state `I`/`H` already set, nothing new (epic.md §4.5).
          const target: 'sidebar' | 'detail' = pane === 'action' ? 'detail' : 'sidebar';
          const step = action.delta * 24;
          savePrefs(setPaneWidth(prefs, target, prefs.panes[target] + step));
          return;
        }
        case 'resetPanes':
          savePrefs(
            setPaneWidth(
              setPaneWidth(prefs, 'sidebar', DEFAULT_PANES.sidebar),
              'detail',
              DEFAULT_PANES.detail,
            ),
          );
          return;
        case 'prompt': {
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          // `i` means "type something into the thing I am pointing at". In the
          // action pane that is usually a queue row's reason box, and sending
          // it to the prompt instead would put a waiver's justification into a
          // message to the session.
          const selected =
            pane === 'action' ? actions[clampIndex(actionIndex, actions.length)] : undefined;
          if (selected !== undefined && selected.rowId !== null && selected.kind !== 'command') {
            setNoteFocus(selected.rowId);
            return;
          }
          setComposing(true);
          return;
        }
        case 'open': {
          if (pane !== 'action') {
            setStatus('the full detail is already in the right panel');
            return;
          }
          const chosen = actions[clampIndex(actionIndex, actions.length)];
          if (chosen === undefined) {
            return;
          }
          switch (chosen.kind) {
            case 'waiver':
              answerWaiver(chosen.rowId, chosen.verdict);
              return;
            case 'lesson':
              answerLesson(chosen.rowId, chosen.verdict);
              return;
            case 'command': {
              const command = focusedDecision?.commands.find((c) => c.id === chosen.rowId);
              if (command === undefined) {
                return;
              }
              void navigator.clipboard?.writeText(command.command);
              setStatus(`vam does not run them — copied "${command.label}", run it yourself`);
              return;
            }
            case 'prompt':
              setComposing(true);
              return;
            default: {
              const unhandled: never = chosen;
              void unhandled;
              return;
            }
          }
        }
        case 'cancel':
          // Esc peels one layer at a time and always ends up back in the list —
          // there is never a state you cannot press Esc out of.
          setJumping(false);
          setPaletteOpen(false);
          setFilterMenuOpen(false);
          setFiltering(false);
          setComposing(false);
          setRenamingId(null);
          setPickingIconFor(null);
          setNoteFocus(null);
          setPane('list');
          setStatus(null);
          return;
        default: {
          // Every KeyAction is handled above, and this binding is what makes the
          // compiler say so. It is not dead code: the day a new action is added
          // to the grammar and forgotten here, this line stops the build instead
          // of the key quietly doing nothing.
          const unhandled: never = action;
          void unhandled;
          return;
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    focusedId,
    focusedEntry,
    focusedSessionId,
    nodeIds,
    entries,
    getNodes,
    jumping,
    labels,
    matches,
    query,
    copyAllCommands,
    stepSession,
    focusSession,
    pane,
    actionIndex,
    focusedDecision,
    actions,
    answerWaiver,
    answerLesson,
    prefs,
    savePrefs,
  ]);

  /**
   * Subscribed, not read.
   *
   * This was `Math.round(getZoom() * 100)` computed during render. `getZoom()`
   * is an imperative call into ReactFlow's store: it returns the right number
   * at the moment it runs, and it does not make the component re-render when
   * the viewport changes. So the readout only refreshed when something ELSE
   * caused a render, and scrolling to zoom left it showing a stale figure.
   * `useStore` subscribes to `transform[2]` — the viewport's scale — so the
   * number tracks the canvas.
   */
  const zoom = useStore((state) => state.transform[2]);
  const zoomPct = Math.round(zoom * 100);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <SessionList
          entries={entries}
          focusedSessionId={focusedEntry?.session.id ?? null}
          workspace="black-smith"
          theme={prefs.theme}
          onToggleTheme={() =>
            savePrefs(setTheme(prefs, prefs.theme === 'dark' ? 'light' : 'dark'))
          }
          onOpenFilter={() => {
            searchOrigin.current = focusedId;
            setFiltering(true);
          }}
          filter={query}
          filtering={filtering}
          onFilterChange={(next) => {
            setQuery(next);
            // incsearch: the answer arrives while you type, not after you
            // commit. Without it the list narrows under a focus ring that is
            // still pointing at a row the filter just removed.
            const first = searchMatches(allEntries, next)[0];
            if (first !== undefined) {
              focusSession(first);
            }
          }}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          statusTally={{
            all: tally.all,
            running: tally.running,
            waiting: tally.waiting,
            done: tally.done,
            failed: tally.failed,
          }}
          filterMenuOpen={filterMenuOpen}
          onFilterMenuToggle={setFilterMenuOpen}
          originFilters={prefs.filters}
          onOriginFilters={(next) => savePrefs(setSessionFilters(prefs, next))}
          hiddenCounts={hiddenCounts}
          onFilterCommit={() => setFiltering(false)}
          onFilterCancel={() => {
            setFiltering(false);
            setQuery('');
            setFocusedId(searchOrigin.current);
          }}
          renamingId={renamingId}
          renameDraft={renameDraft}
          onRenameChange={setRenameDraft}
          onRenameCommit={() => {
            // A session's id IS its name in black-smith, and ids are what the
            // whole event log chains on. Renaming one is not a UI feature.
            setStatus(`black-smith cannot rename a session — "${renameDraft}" was not saved`);
            setRenamingId(null);
          }}
          onRenameCancel={() => setRenamingId(null)}
          onPick={(sessionId) => {
            focusSession(sessionId);
            setPane('list');
          }}
          onClose={(sessionId) =>
            setStatus(`black-smith has no close-session command — "${sessionId}" is still here`)
          }
          onAdd={() =>
            setStatus('sessions are created from the CLI — smith event append session-start')
          }
          onAddInProject={(project) =>
            setStatus(
              `sessions are created from the CLI — smith event append session-start (${project.name})`,
            )
          }
          onPickIcon={(project: Project) => {
            // Same refusal as the session picker (§ above): a project with no
            // source has no bucket to store under, and guessing one would
            // reintroduce the cross-source collision AC-1 removed.
            if (project.source === undefined) {
              setStatus('this project has no source — icon unavailable');
              return;
            }
            const projectSource = project.source;
            setPickingProjectIconFor((current) =>
              current !== null &&
              current.projectId === project.id &&
              current.source === projectSource
                ? null
                : { source: projectSource, projectId: project.id, name: project.name },
            );
          }}
          onSettings={() => setStatus('settings not built yet')}
          width={sidebarWidth}
          resizeHandle={
            <PaneResizer
              pane="sidebar"
              ariaLabel="resize sessions panel"
              width={sidebarWidth}
              otherRendered={detailWidth}
              viewportWidth={viewportWidth}
              onChange={onPaneChange}
              onCommit={onPaneCommit}
            />
          }
        />

        <div className="relative flex min-w-0 flex-1 flex-col bg-canvas">
          <div className="flex h-12 flex-none items-center gap-[9px] border-line border-b px-3.5">
            <span className="shrink-0 font-medium text-[13px] text-ink">Canvas</span>
            <span className="mx-1 h-3.5 w-px shrink-0 bg-line-strong" />

            {/* Where the rows came from, said out loud. The one thing a
                dashboard must never do is look the same whether or not it is
                connected — so this sits before the filters, not in a corner. */}
            <span data-source className="min-w-0 truncate font-mono text-[10px]">
              {source.kind === 'demo' ? (
                <span className="text-waiting">● {source.note}</span>
              ) : source.kind === 'session' ? (
                <span className="text-done">● {source.source.label}</span>
              ) : source.status === 'error' ? (
                <span className="text-failed">● {source.error}</span>
              ) : source.status === 'loading' ? (
                <span className="text-ink-faint">○ connecting to black-smith…</span>
              ) : (
                <span className="text-done">● black-smith</span>
              )}
            </span>

            <span className="flex-1" />

            {/* Positions are a pure function of the model, always — there is
                no drag to opt a node out of it, so this has nothing to
                report but "on". */}
            <span
              data-auto-layout
              className="flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-line px-2.5 font-mono text-[10px] text-ink-dim"
            >
              auto-layout <span className="text-running">on</span>
            </span>

            <div className="flex h-[26px] shrink-0 items-center overflow-hidden rounded-[7px] border border-line text-ink-dim">
              <button
                type="button"
                aria-label="zoom out"
                onClick={() => zoomOut()}
                className="flex h-full w-[26px] cursor-pointer items-center justify-center hover:text-ink"
              >
                −
              </button>
              <span className="flex h-full items-center border-line border-r border-l px-1.5 font-mono text-[10px] text-ink">
                {zoomPct}%
              </span>
              <button
                type="button"
                aria-label="zoom in"
                onClick={() => zoomIn()}
                className="flex h-full w-[26px] cursor-pointer items-center justify-center hover:text-ink"
              >
                +
              </button>
            </div>

            <button
              type="button"
              aria-label="fit view"
              onClick={() => fitView()}
              className="flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-line px-2.5 font-mono text-[10px] text-ink-dim hover:text-ink"
            >
              <Maximize size={13} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>

          <div className="relative min-h-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={NO_EDGES}
              onNodesChange={onNodesChange}
              nodesDraggable={false}
              // A click lands the cursor on the node you clicked, exactly as
              // `j`/`k` would have. `nodeIds` is the navigable set, so a click
              // can only reach somewhere the keyboard could also reach — the
              // mouse takes a shortcut through the same door, it does not open
              // a second one. Scenery (fans, empty slots) is not in that set
              // and is therefore inert, which is right: there is nothing to
              // focus on a connector.
              onNodeClick={(_event, node) => {
                if (nodeIds.includes(node.id)) {
                  setFocusedId(node.id);
                }
              }}
              nodeTypes={NODE_TYPES}
              // 80%, not `fitView`. Fitting picks whatever scale makes every
              // node visible, so the canvas opened at a different zoom for
              // every workspace size and the cards were unreadable in a busy
              // one. A fixed default means the first frame always looks the
              // same, and the "move to the focused session" effect below is
              // what keeps you from having to hunt for where you are.
              defaultViewport={DEFAULT_VIEWPORT}
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="var(--color-dots)" gap={24} size={1} />
              {/* Measured off the mockup's minimap: 176x56, one chip per
                  session cell in that session's status colour, and a viewport
                  drawn as a 1px outline in the ink colour over an UNDIMMED
                  map. `maskColor` transparent is the whole point — the mockup
                  has no dark wash, and xyflow's default one hid the part of
                  the canvas the map exists to show you. `maskStrokeWidth` is
                  in pixels (xyflow multiplies it by the map's own scale), so 1
                  is the mockup's hairline. `nodeStrokeWidth` is NOT: it is in
                  flow units, where 1px is ~26 at this scale, so the mockup's
                  bordered chip is drawn as a filled one instead — at 8px wide
                  the fill is what carries the colour anyway. */}
              <MiniMap
                pannable
                zoomable
                ariaLabel="canvas minimap"
                // The spotlight is a DIMMED OUTSIDE, not an outlined viewport.
                // An outline draws a rectangle around the visible area, and
                // when that area is wider than the content — the normal case —
                // its top and bottom edges fall outside the map and only the
                // two vertical edges survive, reading as two bright rules down
                // the sides rather than as a spotlight. Masking outside instead
                // says the same thing with no lines at all, and degrades
                // correctly: when everything is visible, nothing is dimmed.
                maskColor="color-mix(in srgb, var(--color-canvas) 66%, transparent)"
                // The spotlight is dimmed outside AND outlined. The outline was
                // dropped once because, drawn in the ink colour, the only part
                // of it usually on screen is its two vertical edges — the
                // viewport is wider than the map's content bounds at any
                // ordinary zoom — and two bright full-height rules do not read
                // as a rectangle. In a line tone it reads as an edge to the lit
                // area instead of as decoration, which is what was wanted both
                // times.
                maskStrokeColor="var(--color-line-loudest)"
                maskStrokeWidth={1}
                // `nodeStrokeWidth` is in FLOW units and is drawn around the
                // chip, so it is also the only lever that makes a chip bigger
                // than the node it stands for. A session card is 220 wide, so
                // 40 is a visible fattening without merging neighbours.
                nodeStrokeWidth={70}
                nodeStrokeColor={minimapChipColor}
                nodeBorderRadius={3}
                // Narrower than the mockup's 176. A minimap earns its corner by
                // being glanceable, not by being legible on its own, and the
                // width it gives up is width the canvas gets back.
                style={{ width: 132, height: 56 }}
                className="!bottom-3 !right-3 !m-0 !rounded-[8px] !border !border-line !bg-sunken"
                nodeColor={minimapChipColor}
              />
            </ReactFlow>

            {paletteOpen && (
              <CommandPalette
                entries={entries}
                onPick={(sessionId) => {
                  focusSession(sessionId);
                  setPaletteOpen(false);
                }}
                onClose={() => setPaletteOpen(false)}
              />
            )}
          </div>
        </div>

        <DetailPanel
          entry={focusedEntry}
          decision={focusedDecision}
          delivers={source.kind === 'session' && source.source.capabilities.deliverPrompt}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={sendPrompt}
          onPickCommand={(commandId) => {
            const command = focusedDecision?.commands.find((c) => c.id === commandId);
            setStatus(
              command === undefined
                ? 'no such command'
                : `vam does not run them — copied "${command.label}", run it yourself`,
            );
            copyCommand(commandId);
          }}
          onCopyCommand={copyCommand}
          active={pane === 'action'}
          actionIndex={actionIndex}
          review={{
            waivers: review.waivers,
            lessons: review.lessons,
            error: review.error,
            hidden: review.hidden,
            busyId: answering,
            notes,
            onNoteChange: (rowId, note) => setNotes((all) => ({ ...all, [rowId]: note })),
            onNoteDone: () => setNoteFocus(null),
            selectedActionId:
              pane === 'action'
                ? (actions[clampIndex(actionIndex, actions.length)]?.id ?? null)
                : null,
            focusNoteFor: noteFocus,
            onWaiver: (fingerprint, decision) => answerWaiver(fingerprint, decision),
            onLesson: (lessonId, to) => answerLesson(lessonId, to),
          }}
          composing={composing}
          onCompose={() => setComposing(true)}
          onStopComposing={() => {
            setComposing(false);
            setDraft('');
            // Escape out of the composer returns the keyboard to the SIDEBAR,
            // which is the pane the operator asked to get back to. Without
            // this, a prompt opened with `I` leaves `pane === 'action'`, so
            // the blur hands the keys back to a window where `j`/`k` walk the
            // detail pane's actions instead of the session list — the keys
            // work, they just do the wrong thing, which is worse than being
            // swallowed. The `i` path already sat on 'list' and was unaffected,
            // which is why this only ever bit one of the two entry points.
            setPane('list');
          }}
          width={detailWidth}
          resizeHandle={
            <PaneResizer
              pane="detail"
              ariaLabel="resize detail panel"
              width={detailWidth}
              otherRendered={sidebarWidth}
              viewportWidth={viewportWidth}
              onChange={onPaneChange}
              onCommit={onPaneCommit}
            />
          }
        />
      </div>

      {pickingIconFor !== null && (
        <IconPicker
          title={pickingIconFor.title}
          onPick={(icon) => {
            // Both the source and the session come from the target captured
            // when the picker opened, so there is nothing to look up and
            // nothing to guess: AC-1's collision cannot reach this path.
            savePrefs(
              setIcon(prefs, pickingIconFor.source, pickingIconFor.sessionId, icon, new Date()),
            );
            setStatus(
              icon === ''
                ? 'icon cleared — kept on this machine, never in the event log'
                : `${icon} — kept on this machine, never in the event log`,
            );
            setPickingIconFor(null);
          }}
          onClose={() => setPickingIconFor(null)}
        />
      )}

      {pickingProjectIconFor !== null && (
        <IconPicker
          title={pickingProjectIconFor.name}
          onPick={(icon) => {
            savePrefs(
              setProjectIcon(
                prefs,
                pickingProjectIconFor.source,
                pickingProjectIconFor.projectId,
                icon,
                new Date(),
              ),
            );
            setStatus(
              icon === ''
                ? 'icon cleared — kept on this machine, never in the event log'
                : `${icon} — kept on this machine, never in the event log`,
            );
            setPickingProjectIconFor(null);
          }}
          onClose={() => setPickingProjectIconFor(null)}
        />
      )}

      {/* Named cells, not positional ones. There are three `<footer>`s in this
          tree now and a query that counted on order would silently start
          reading the sidebar's. */}
      <footer
        data-status-bar
        className="flex h-8 flex-none items-center gap-3 border-line border-t bg-sidebar px-3 font-mono text-[10px] text-ink-faint"
      >
        {/* The mode indicator is not in the mockup, and it stays: ADE is a
            mouse-and-keyboard app, vam is a modal one, and a modal app that
            does not say which mode it is in is the single worst thing a modal
            app can be. */}
        <span data-mode className="font-semibold text-ink">
          {jumping
            ? 'JUMP'
            : filtering
              ? 'FILTER'
              : composing
                ? 'PROMPT'
                : pane === 'action'
                  ? 'ACTION'
                  : 'NORMAL'}
        </span>
        <span data-focus className="truncate">
          {focusedEntry === null
            ? '—'
            : `${focusedEntry.project.name}/${focusedEntry.session.title}`}
        </span>

        <span className="h-3 w-px bg-line" />
        {usage.reason === null ? (
          <span data-usage className={usage.highUsage ? 'text-failed' : undefined}>
            {usage.text}
          </span>
        ) : (
          <Note text={usage.reason}>
            <span data-usage>{usage.text}</span>
          </Note>
        )}

        <span className="h-3 w-px bg-line" />
        <span>
          <span className="text-ink-dim">{tally.all}</span> sessions
        </span>
        {tally.running > 0 && <span className="text-running">{tally.running} running</span>}
        {tally.waiting > 0 && <span className="text-waiting">{tally.waiting} need you</span>}
        {tally.done > 0 && <span className="text-done">{tally.done} done</span>}
        {tally.failed > 0 && <span className="text-failed">{tally.failed} failed</span>}
        <span className="h-3 w-px bg-line" />
        <span>{model.projects.length} projects</span>

        {status !== null && <span className="truncate text-ink-dim">{status}</span>}

        <span className="flex-1" />
        {/* The mockup spends its right end on token spend against budget.
            It says `today`, and this does not: `/api/overview` carries a
            cumulative `tokensByEpic` and no daily bucket, so a cell labelled
            "today" would be a caption the number cannot support.
            A source with no budget at all renders the em-dashes rather than
            zeros — a factory that has spent nothing must stay distinguishable
            from a source that has no such concept. */}
        {model.budget === null || model.budget === undefined ? (
          <span data-budget className="text-ink-ghost">
            — / — cap
          </span>
        ) : (
          <span
            data-budget
            className={model.budget.usedPct > 100 ? 'text-waiting' : 'text-ink-ghost'}
          >
            {compactTokens(model.budget.tokensSpent)} / {compactTokens(model.budget.tokensBudget)}{' '}
            cap · {Math.round(model.budget.usedPct)}%
          </span>
        )}
        <span className="h-3 w-px bg-line" />
        <span>hjkl f / gt i yy ^K</span>
      </footer>
    </div>
  );
}

/**
 * A minimap chip's colour: the session's status, or nothing at all.
 *
 * Only the info card earns a chip. Its steps, its fan and its slots all belong
 * to the same row, and drawing four more rectangles per session turns a map you
 * read at a glance into a texture — the mockup draws one chip per cell, and so
 * does this. `transparent` rather than an omission because xyflow renders a
 * rect for every node either way.
 */
function minimapChipColor(node: Node): string {
  if (node.type !== 'info') {
    return 'transparent';
  }
  const { entry } = node.data as { entry?: SessionEntry };
  return entry === undefined ? 'transparent' : `var(--color-${entry.session.status})`;
}

export function Canvas({
  model,
  source = READ_ONLY_SOURCE,
}: {
  readonly model: CanvasModel;
  readonly source?: CanvasSource;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner model={model} source={source} />
    </ReactFlowProvider>
  );
}
