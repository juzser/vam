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
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import { Bell, Maximize } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SmithApiError } from '../adapter/client.js';
import { useReviewQueue } from '../adapter/useReviewQueue.js';
import type { CanvasModel, Decision, SessionStatus, SourceId } from '../domain/model.js';
import { cycleMatch, searchMatches } from '../domain/search.js';
import type { SessionEntry } from '../domain/selectors.js';
import { type ChordState, EMPTY_CHORD, normalizeKey, resolveChord } from '../keyboard/chords.js';
import { nextNode } from '../keyboard/spatial-nav.js';
import { DetailPanel } from '../panels/DetailPanel.js';
import { IconPicker } from '../panels/IconPicker.js';
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
  setTheme,
  writePrefs,
} from '../prefs/prefs.js';
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

function CanvasInner({
  model: factoryModel,
  source,
}: {
  model: CanvasModel;
  source: CanvasSource;
}) {
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

  const model = useMemo(() => applyIcons(factoryModel, prefs.icons), [factoryModel, prefs.icons]);

  const layout = useMemo(() => layoutCanvas(model), [model]);
  const allEntries = useMemo(() => orderedSessions(model), [model]);

  const [focusedId, setFocusedId] = useState<string | null>(layout.nodes[0]?.id ?? null);
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
  const [filtering, setFiltering] = useState(false);
  /**
   * The mockup's pill row: All / Running / Needs you / Done.
   *
   * A SECOND narrowing, stacked on `/` rather than replacing it, because the
   * two answer different questions — "the one called permalink" and "the ones
   * that stopped". Both narrow where you navigate; neither hides anything the
   * canvas draws.
   */
  const [statusFilter, setStatusFilter] = useState<'all' | SessionStatus>('all');
  /** True while a write is in flight — Enter must not fire twice. */
  const [writing, setWriting] = useState(false);
  const searchOrigin = useRef<string | null>(null);
  const chord = useRef<ChordState>(EMPTY_CHORD);
  const { getNodes, zoomIn, zoomOut, fitView, setCenter } = useReactFlow();

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
    void fitView({ nodes: focusRowNodeIds, padding: 0.28, maxZoom: 1, duration: 220 });
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

  const matches = useMemo(() => searchMatches(allEntries, query), [allEntries, query]);

  /**
   * What the sidebar actually lists. `/` narrows it in place — orca's shape —
   * rather than opening a separate search that leaves the list untouched while
   * you type into it.
   *
   * The canvas is deliberately NOT filtered: it is the overview, and an overview
   * that hides things is not one. The filter narrows where you navigate, not
   * what exists.
   */
  const entries = useMemo(() => {
    const byText =
      query.trim() === '' ? allEntries : allEntries.filter((e) => matches.includes(e.session.id));
    return statusFilter === 'all'
      ? byText
      : byText.filter((e) => e.session.status === statusFilter);
  }, [allEntries, matches, query, statusFilter]);

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
   * What `hjkl`, `f` and `gg` may land on. The canvas still DRAWS everything —
   * it is the overview, and an overview that hides things is not one — but the
   * filter narrows where you can go, which is what "narrows where you navigate,
   * not what exists" has to mean if it means anything. Without this, `j` walks
   * into a session the sidebar just hid and the focus ring points at a row that
   * is no longer there.
   */
  const nodeIds = useMemo(() => {
    const visible = new Set(entries.map((e) => e.session.id));
    return layout.nodes.filter((n) => visible.has(n.entry.session.id)).map((n) => n.id);
  }, [layout, entries]);

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
   * Write what you typed into the focused session's log.
   *
   * The wording of every outcome here is load-bearing. black-smith RECORDS a
   * prompt; it has no channel into a running agent session, so "recorded" is
   * the truth and "sent" would not be. A prompt box that claimed to send would
   * have you waiting for an answer nobody is coming to give.
   *
   * A refusal is reported in the factory's own words. `events.unknown-causal-session`
   * and `write.bad-request` each name a different mistake, and collapsing them
   * into "error" throws away the one thing black-smith just told us.
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
      await source.client.recordPrompt(entry.session.id, draft);
      setDraft('');
      setComposing(false);
      setStatus(`recorded in the log of ${entry.session.title} — recorded, not sent to the agent`);
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
        setStatus(source.note);
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

            {/* The bell counts what is actually owed: sessions that stopped for
                you, plus rows in the review queue. */}
            <span
              data-bell
              className="relative flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] border border-line text-ink-dim"
            >
              <Bell size={15} strokeWidth={1.6} aria-hidden="true" />
              {tally.waiting + review.waivers.length > 0 && (
                <span className="-top-1.5 -right-1.5 absolute flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-waiting px-1 font-mono text-[8.5px] text-canvas">
                  {tally.waiting + review.waivers.length}
                </span>
              )}
            </span>
          </div>

          <div className="relative min-h-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={NO_EDGES}
              onNodesChange={onNodesChange}
              nodesDraggable={false}
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
              {/* `Panel` renders outside ReactFlow's pan/zoom transform (the
                  same mechanism `MiniMap` below relies on), so these pills
                  stay fixed at the canvas's top-left corner: panning or
                  zooming the canvas never moves them — "không liên quan đến
                  drag canvas". They still drive `statusFilter`, which
                  narrows `entries` (used by both the sidebar and this
                  panel's counts) but deliberately never the canvas itself;
                  see the note above `entries`. */}
              <Panel position="top-left" className="!m-3 flex items-center gap-1.5">
                {(
                  [
                    ['all', 'All', tally.all],
                    ['running', 'Running', tally.running],
                    ['waiting', 'Needs you', tally.waiting],
                    ['done', 'Done', tally.done],
                  ] as const
                ).map(([key, label, count]) => {
                  const on = statusFilter === key;
                  const loud = key === 'waiting' && count > 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      data-status-pill={key}
                      aria-pressed={on}
                      onClick={() => setStatusFilter(key)}
                      className={[
                        'cursor-pointer rounded-full border bg-canvas px-2.5 py-1 font-mono text-[10px]',
                        on
                          ? 'border-line-loud bg-raised text-ink'
                          : loud
                            ? 'border-waiting-tint text-waiting'
                            : 'border-line text-ink-dim hover:border-line-strong',
                      ].join(' ')}
                    >
                      {label} {count}
                    </button>
                  );
                })}
              </Panel>
              <MiniMap
                pannable
                zoomable
                ariaLabel="canvas minimap"
                maskColor="rgb(0 0 0 / 0.5)"
                style={{ width: 168, height: 96 }}
                className="!bottom-3 !right-3 !m-0 !rounded-[8px] !border !border-line !bg-sunken"
                nodeColor={(node) =>
                  node.type === 'info' ? 'var(--color-ink-dim)' : 'var(--color-line-loud)'
                }
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
        {/* The mockup spends its right end on a token and spend budget for the
            day. `/api/overview` carries both (`tokensByEpic`, `budgetUsedPct`)
            and vam's adapter does not read them yet — so the slot is here,
            saying what it is waiting for rather than showing a number nobody
            measured. See the todo. */}
        <span data-budget className="text-ink-ghost">
          today — · — / — cap
        </span>
        <span className="h-3 w-px bg-line" />
        <span>hjkl f / gt i yy ^K</span>
      </footer>
    </div>
  );
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
