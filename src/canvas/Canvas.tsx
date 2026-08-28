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
  MarkerType,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SmithApiError } from '../adapter/client.js';
import { useReviewQueue } from '../adapter/useReviewQueue.js';
import type { CanvasModel, Decision } from '../domain/model.js';
import { cycleMatch, searchMatches } from '../domain/search.js';
import type { SessionEntry } from '../domain/selectors.js';
import { type ChordState, EMPTY_CHORD, normalizeKey, resolveChord } from '../keyboard/chords.js';
import { nextNode } from '../keyboard/spatial-nav.js';
import { DetailPanel } from '../panels/DetailPanel.js';
import { IconPicker } from '../panels/IconPicker.js';
import { SessionList } from '../panels/SessionList.js';
import {
  applyIcons,
  browserStorage,
  type Prefs,
  pinDragged,
  readPrefs,
  setIcon,
  unpinAll,
  writePrefs,
} from '../prefs/prefs.js';
import { buildActions, clampIndex } from './actions.js';
import { CommandPalette } from './CommandPalette.js';
import { infoNodeId, layoutCanvas, orderedSessions } from './layout.js';
import { type FlowNodeLike, toNavNodes } from './nav-nodes.js';
import { ProjectGroupNode } from './ProjectGroupNode.js';
import { SessionInfoNode } from './SessionInfoNode.js';
import { StepNode } from './StepNode.js';
import { type CanvasSource, READ_ONLY_SOURCE } from './source.js';

const NODE_TYPES = { group: ProjectGroupNode, info: SessionInfoNode, step: StepNode };

/** Home-row first: the labels you can hit without looking. */
const JUMP_KEYS = 'asdfghjkl;qwertyuiop';

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
   * The factory's model with your icons on it. Done here, once, so neither the
   * sidebar nor the canvas node has to know that an icon comes from somewhere
   * different than the rest of a session.
   */
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
  const [pickingIconFor, setPickingIconFor] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  /** True while a write is in flight — Enter must not fire twice. */
  const [writing, setWriting] = useState(false);
  const searchOrigin = useRef<string | null>(null);
  const chord = useRef<ChordState>(EMPTY_CHORD);
  const { getNodes } = useReactFlow();

  /** Which session the focused node belongs to — the id all three panes share. */
  const focusedSpec = useMemo(
    () => layout.nodes.find((n) => n.id === focusedId) ?? null,
    [layout, focusedId],
  );
  const focusedEntry: SessionEntry | null = focusedSpec?.entry ?? null;

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
  const entries = useMemo(
    () =>
      query.trim() === '' ? allEntries : allEntries.filter((e) => matches.includes(e.session.id)),
    [allEntries, matches, query],
  );

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
      // Frames first: ReactFlow paints in array order, so a group listed after
      // its children would cover them.
      ...layout.groups.map((spec) => ({
        id: spec.id,
        type: 'group',
        position: spec.position,
        width: spec.size.width,
        height: spec.size.height,
        style: { width: spec.size.width, height: spec.size.height },
        data: {
          project: spec.project,
          waiting: spec.project.sessions.filter((s) => s.status === 'waiting').length,
        },
        draggable: true,
        selectable: false,
      })),
      ...layout.nodes.map((spec) => ({
        id: spec.id,
        type: spec.kind,
        parentId: spec.parentId,
        extent: 'parent' as const,
        position: spec.position,
        // `width`/`height` as well as `style`: we know these sizes, and stating
        // them means the very first keypress navigates correctly instead of
        // falling back to a zero rectangle before ReactFlow has measured.
        width: spec.size.width,
        height: spec.size.height,
        style: { width: spec.size.width, height: spec.size.height },
        data:
          spec.kind === 'info'
            ? { entry: spec.entry, focused: false, jumpLabel: null }
            : { entry: spec.entry, decision: spec.decision, focused: false, jumpLabel: null },
        draggable: true,
      })),
    ],
    [layout],
  );

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((spec) => ({
        id: spec.id,
        source: spec.source,
        target: spec.target,
        type: 'smoothstep',
        // The elided link is drawn as a break, not a step: dashed, labelled with
        // what it swallowed. An ordinary link between two shown steps is solid,
        // because nothing is missing between them.
        animated: false,
        style: spec.elided
          ? { stroke: 'var(--color-line-strong)', strokeDasharray: '3 4' }
          : { stroke: 'var(--color-line-strong)' },
        label: spec.label ?? undefined,
        labelStyle: { fill: 'var(--color-ink-faint)', fontSize: 10 },
        labelBgStyle: { fill: 'var(--color-canvas)' },
        labelBgPadding: [4, 2] as [number, number],
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10, color: '#4b535d' },
      })),
    [layout],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  /**
   * Node ids under the hand right now.
   *
   * A poll answering mid-drag would otherwise re-place the node from the fresh
   * layout and yank it out from under the cursor. A ref rather than state: the
   * merge effect must see it immediately, and re-rendering on mousedown would
   * be a re-render per drag start for nothing.
   */
  const dragging = useRef(new Set<string>());

  /** Where auto-layout would put each node, to tell a real move from a twitch. */
  const layoutPositions = useMemo(
    () => new Map(initialNodes.map((node) => [node.id, node.position])),
    [initialNodes],
  );

  /**
   * Keep the drawn nodes in step with the model.
   *
   * `useNodesState` takes its argument as INITIAL state and never looks at it
   * again. Against a fixture that is invisible — the model never changes — but
   * against a live factory the first render happens before the first fetch
   * answers, so the canvas latched onto an empty layout and stayed empty
   * forever while the sidebar filled in beside it.
   *
   * What survives a refresh is exactly what you PINNED by dragging it. This
   * used to keep every node's current position instead, which sounds like the
   * same thing and is not: it froze the auto-layout at whatever it was on the
   * first render, so a session that started waiting for you while you watched
   * never rose to the top of its frame. §3's ranking — đang-chờ-bạn, then
   * đang-chạy, then newest — only means something if it can still happen after
   * the page is open, which is the only time anybody is looking.
   */
  useEffect(() => {
    setNodes((current) => {
      const held = new Map(current.map((node) => [node.id, node.position]));
      return initialNodes.map((spec) => {
        const stored = prefs.pinned[spec.id];
        if (stored !== undefined) {
          return { ...spec, position: { x: stored.x, y: stored.y } };
        }
        const held_ = dragging.current.has(spec.id) ? held.get(spec.id) : undefined;
        return held_ === undefined ? spec : { ...spec, position: held_ };
      });
    });
  }, [initialNodes, prefs.pinned, setNodes]);

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

  // Focus and jump labels are presentation, not layout: they are written onto
  // the existing nodes rather than rebuilding them, so a node that has been
  // dragged keeps where the person put it.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) =>
        // Frames are neither focusable nor jump targets, so they are left
        // alone rather than handed two fields they would have to ignore.
        node.type === 'group'
          ? node
          : {
              ...node,
              data: {
                ...node.data,
                focused: node.id === focusedId,
                jumpLabel: labels.get(node.id) ?? null,
              },
            },
      ),
    );
  }, [focusedId, labels, setNodes]);

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
      setStatus(`đã chép: ${command.label}`);
    },
    [focusedDecision],
  );

  /**
   * Write what you typed into the focused session's log.
   *
   * The wording of every outcome here is load-bearing. black-smith RECORDS a
   * prompt; it has no channel into a running agent session, so "đã ghi" is the
   * truth and "đã gửi" would not be. A prompt box that claimed to send would
   * have you waiting for an answer nobody is coming to give.
   *
   * A refusal is reported in the factory's own words. `events.unknown-causal-session`
   * and `write.bad-request` each name a different mistake, and collapsing them
   * into "lỗi" throws away the one thing black-smith just told us.
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
      setStatus(`đã ghi vào log của ${entry.session.title} — ghi lại, không gửi tới agent`);
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
        // slot — which after clearing a waiver was the NEXT row's "duyệt". A
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
        setStatus(source.kind === 'demo' ? source.note : 'chưa chọn session');
        return;
      }
      const note = (notes[fingerprint] ?? '').trim();
      if (note === '') {
        // waivers.ts refuses this anyway. Saying so here means the refusal
        // arrives before a round trip, and names the missing thing.
        setStatus('waiver cần lý do — bấm i để nhập');
        return;
      }
      void answer(
        fingerprint,
        () =>
          source.client.applyWaivers({ sessionId: session }, [
            { fingerprint, decision, operatorNote: note },
          ]),
        decision === 'granted'
          ? `đã bỏ qua ${fingerprint} — lý do đã vào log`
          : `đã bắt sửa ${fingerprint}`,
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
        to === 'approve' ? `đã duyệt ${lessonId}` : `đã bỏ ${lessonId}`,
      );
    },
    [source, notes, answer],
  );

  const copyAllCommands = useCallback(() => {
    const commands = focusedDecision?.commands ?? [];
    if (commands.length === 0) {
      setStatus('không có command nào để chép');
      return;
    }
    void navigator.clipboard?.writeText(commands.map((c) => c.command).join('\n'));
    setStatus(`đã chép ${commands.length} command`);
  }, [focusedDecision]);

  const stepSession = useCallback(
    (delta: 1 | -1) => {
      const index = entries.findIndex((e) => e.session.id === focusedEntry?.session.id);
      // Clamped, not wrapped. Stopping dead is information: it tells you where
      // you are. Wrapping to the far end tells you nothing.
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= entries.length) {
        setStatus(delta > 0 ? 'session cuối rồi' : 'session đầu rồi');
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
              setStatus('không có session nào khớp');
              return;
            }
            setFocusedId(first);
            return;
          }
          // Live geometry, read now — not a list captured at render time.
          const live = toNavNodes(getNodes() as unknown as FlowNodeLike[], nodeIds);
          const landed = nextNode(live, focusedId, action.direction);
          if (landed === null) {
            setStatus(`không có node nào ở phía ${action.direction}`);
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
            setStatus(query.trim() === '' ? 'chưa tìm gì' : 'không khớp');
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
            setStatus('chọn một session trước đã');
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
            setStatus('chọn một session trước đã');
            return;
          }
          setRenameDraft(focusedEntry.session.title);
          setRenamingId(focusedEntry.session.id);
          return;
        case 'icon':
          if (focusedEntry === null) {
            setStatus('chọn một session trước đã');
            return;
          }
          setPickingIconFor((current) =>
            current === focusedEntry.session.id ? null : focusedEntry.session.id,
          );
          return;
        case 'close':
          if (focusedEntry === null) {
            setStatus('chọn một session trước đã');
            return;
          }
          setStatus(
            `black-smith không có lệnh đóng session — "${focusedEntry.session.title}" vẫn còn`,
          );
          return;
        case 'newSession':
          // A session is created by a person running `smith event append`
          // session-start, or by opening one. There is no route, and inventing
          // one would let vam mint sessions nobody is driving.
          setStatus('tạo session phải làm từ CLI — smith event append session-start');
          return;
        case 'settings':
          setStatus('settings chưa dựng');
          return;
        case 'resetLayout': {
          const count = Object.keys(prefs.pinned).length;
          if (count === 0) {
            setStatus('không có node nào bị ghim — canvas đang tự xếp');
            return;
          }
          savePrefs(unpinAll(prefs));
          setStatus(`bỏ ghim ${count} node — canvas tự xếp lại`);
          return;
        }
        case 'prompt': {
          if (focusedEntry === null) {
            setStatus('chọn một session trước đã');
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
            setStatus('detail đầy đủ đã ở panel bên phải');
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
              setStatus(`vam không tự chạy — đã chép "${command.label}", chạy tay`);
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

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex items-center gap-3 border-line border-b bg-panel px-3 py-2">
        <span className="font-mono font-semibold text-[13px] text-ink tracking-wide">VAM</span>
        {/* Where the rows came from, said out loud. The one thing a dashboard
            must never do is look the same whether or not it is connected. */}
        <span data-source className="truncate text-[11px]">
          {source.kind === 'demo' ? (
            <span className="text-waiting">● {source.note}</span>
          ) : source.status === 'error' ? (
            <span className="text-failed">● {source.error}</span>
          ) : source.status === 'loading' ? (
            <span className="text-ink-faint">○ đang kết nối black-smith…</span>
          ) : (
            <span className="text-done">● black-smith</span>
          )}
        </span>
        <span className="ml-auto text-[11px] text-running">
          ◐ {entries.reduce((sum, e) => sum + e.session.runningAgents, 0)} agents
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <SessionList
          entries={entries}
          focusedSessionId={focusedEntry?.session.id ?? null}
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
            setStatus(`black-smith không đổi tên session được — "${renameDraft}" chưa lưu`);
            setRenamingId(null);
          }}
          onRenameCancel={() => setRenamingId(null)}
          onPick={(sessionId) => {
            focusSession(sessionId);
            setPane('list');
          }}
          onClose={(sessionId) =>
            setStatus(`black-smith không có lệnh đóng session — "${sessionId}" vẫn còn`)
          }
          onAdd={() => setStatus('tạo session phải làm từ CLI — smith event append session-start')}
          onSettings={() => setStatus('settings chưa dựng')}
        />

        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onNodeDragStart={(_event, node) => dragging.current.add(node.id)}
            onNodeDragStop={(_event, node, moved) => {
              // ReactFlow reports a multi-select drag in `moved` and a single
              // one in `node`; past that, the decision belongs to pinDragged.
              const dragged = moved.length > 0 ? moved : [node];
              for (const one of dragged) {
                dragging.current.delete(one.id);
              }
              const next = pinDragged(prefs, dragged, (id) => layoutPositions.get(id), new Date());
              if (next !== prefs) {
                savePrefs(next);
              }
            }}
            // A drag has to be a drag. Below this a click on a card would pin it
            // where auto-layout had already put it, quietly opting that one card
            // out of ever sorting again — the least visible way to break §3's
            // ranking.
            nodeDragThreshold={4}
            nodeTypes={NODE_TYPES}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#21262d" gap={16} />
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
                ? 'không có command đó'
                : `vam không tự chạy — đã chép "${command.label}", chạy tay`,
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
        />
      </div>

      {pickingIconFor !== null && (
        <IconPicker
          title={
            allEntries.find((e) => e.session.id === pickingIconFor)?.session.title ?? pickingIconFor
          }
          onPick={(icon) => {
            savePrefs(setIcon(prefs, pickingIconFor, icon, new Date()));
            setStatus(
              icon === ''
                ? 'đã bỏ icon — lưu trên máy này, không vào event log'
                : `${icon} — lưu trên máy này, không vào event log`,
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
        className="flex items-center gap-4 border-line border-t bg-panel px-3 py-1.5 text-[11px] text-ink-dim"
      >
        <span data-mode className="font-mono font-semibold text-ink">
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
        <span data-focus className="font-mono">
          {focusedEntry === null
            ? '—'
            : `${focusedEntry.project.name}/${focusedEntry.session.title}`}
        </span>
        <span className="text-waiting">
          ⏸ {entries.filter((e) => e.session.status === 'waiting').length} chờ bạn
        </span>
        {status !== null && <span className="text-ink-faint">{status}</span>}
        <span className="ml-auto font-mono text-ink-faint">hjkl f / gt i yy ^K</span>
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
