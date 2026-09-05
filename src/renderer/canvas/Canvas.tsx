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
import { Box, Factory, FlaskConical, type LucideIcon, Maximize } from 'lucide-react';
import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  describeUsage,
  POLL_INTERVAL_MS,
  type UsageSnapshot,
  type UsageWindow,
} from '../../shared/usage.js';
import { composeGroups, groupSource } from '../domain/grouping.js';
import type {
  CanvasModel,
  Decision,
  Group,
  Project,
  SessionStatus,
  SourceId,
} from '../domain/model.js';
import { cycleMatch, searchMatches } from '../domain/search.js';
import type { SessionEntry } from '../domain/selectors.js';
import type { StatusFilter } from '../domain/session-filter.js';
import { isAgentStarted, isHiddenByOriginFilters, isUnprompted } from '../domain/session-filter.js';
import { ErrorLogPanel } from '../errors/ErrorLogPanel.js';
import { loggedEvents, noteFailure, recordRefusal, subscribeEvents } from '../errors/log.js';
import { type ChordState, EMPTY_CHORD, normalizeKey, resolveChord } from '../keyboard/chords.js';
import { type CursorMode, MODE_TITLES } from '../keyboard/keysheet.js';
import { primaryChord, ShortcutTip, TipProvider } from '../keyboard/ShortcutTip.js';
import { nextNode } from '../keyboard/spatial-nav.js';
import { DetailPanel, type Tab as DetailTab } from '../panels/DetailPanel.js';
import { FocusEdge } from '../panels/FocusEdge.js';
import { IconPicker } from '../panels/IconPicker.js';
import { Note } from '../panels/Note.js';
import { PaneResizer } from '../panels/PaneResizer.js';
import { type ProjectChoice, ProjectPicker } from '../panels/ProjectPicker.js';
import type { RemovalPlan } from '../panels/remove-project.js';
import { NEW_PROJECT_PENDING, SessionList } from '../panels/SessionList.js';
import { visibleTabs } from '../panels/tabs.js';
import { PhoneShell } from '../phone/PhoneShell.js';
import { usePhoneViewport } from '../phone/viewport.js';
import { type FocusCandidate, resolveFocusNodeId } from '../prefs/focus.js';
import {
  ALL_VISIBLE,
  CANVAS_STRIP,
  type ColumnId,
  canvasIsMain,
  columnOrder,
  DEFAULT_PANES,
  layoutForViewport,
  layoutWidths,
} from '../prefs/panes.js';
import {
  addProjectToGroup,
  applyIcons,
  applyPalette,
  applyRenames,
  applyTheme,
  browserStorage,
  createGroup,
  DEFAULT_FOCUS_SHARE,
  deleteGroup,
  type EffectiveTheme,
  FOCUS_SHARE_OFF,
  isGroupCollapsed,
  isProjectHidden,
  type Prefs,
  paletteFor,
  readPrefs,
  removeProjectFromGroup,
  renameGroup,
  setDetailTab,
  setGroupCollapsed,
  setGroupIcon,
  setIcon,
  setLastFocus,
  setLayout,
  setPaneVisibility,
  setPaneWidth,
  setProjectHidden,
  setProjectIcon,
  setRename,
  setSessionFilters,
  setTheme,
  type Theme,
  watchOsTheme,
  writePrefs,
} from '../prefs/prefs.js';
import { SettingsOverlay } from '../settings/SettingsOverlay.js';
import { canWriteTo, type SessionSource, type SourceWrites } from '../sources/port.js';
import { buildActions, clampIndex } from './actions.js';
import { CommandPalette } from './CommandPalette.js';
import { copyText } from './clipboard.js';
import { KeySheet } from './KeySheet.js';
import { infoNodeId, layoutCanvas, orderedSessions, sessionBounds } from './layout.js';
import { type FlowNodeLike, toNavNodes } from './nav-nodes.js';
import { countTurnsWithInput, type PendingPrompt, reconcile, withPending } from './optimistic.js';
import { PROVIDER_MARKS } from './provider-marks.js';
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
 * The operator asked for this twice with different numbers (70%, then 60%), and
 * said it would become a setting. It now is one: this constant is the DEFAULT,
 * the stored `focusViewportShare` overrides it, and `focusPadding` derives what
 * ReactFlow actually wants from whichever is in force. Keeping the target named
 * rather than folding it into a padding value is what let the settings pane
 * write to it without anyone re-deriving the formula.
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

/**
 * How many characters of a status message the bar will claim at most.
 *
 * This is a backstop, not the layout mechanism. The width-responsive half is
 * CSS (`min-w-0 truncate`): a flex child with `min-w-0` shrinks below its
 * content and ellipses, so a narrow window truncates further than this number
 * ever would, and no character count has to guess at the window. What the cap
 * buys is the wide window, where a two-hundred-character refusal would
 * otherwise stretch across the whole bar -- the same "give way before the
 * layout does" the token formatter above is written for.
 */
const STATUS_MAX_CHARS = 72;

/**
 * A status message shortened for the bar, never for the log.
 *
 * `describeFailure` renders failures as `code: message` and the codes are
 * deliberately distinct -- "no sessions" and "vam could not ask" are separate
 * facts and must not read alike. So the cut is at the TAIL: the code leads the
 * string, and clipping the end keeps the half that says which failure this is
 * while spending the sentence that elaborates it. The full text is one hover
 * or one focus away.
 */
export function truncateStatus(text: string): string {
  if (text.length <= STATUS_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, STATUS_MAX_CHARS - 1).trimEnd()}\u2026`;
}

/**
 * The status bar's message cell.
 *
 * ANNOUNCED, not merely drawn. This is the renderer's one refusal channel,
 * and on a refusal nothing else on screen changes -- no row dims, no control
 * goes busy -- so without a live region an assistive-technology user gets
 * exactly what the silent in-flight guards used to give everyone: a click
 * indistinguishable from a dead control. `polite` because the bar is the
 * outcome of a key the operator just pressed and must not interrupt what they
 * are reading (WCAG 2.1 SC 4.1.3; same pattern as `SettingsOverlay`). Both
 * shells draw their bar through this one component and they draw it
 * exclusively, so this is one live region, never two racing.
 *
 * What is announced is the SHORTENED text, because that is what this element
 * contains -- the tail past 72 characters is reachable by focus, through the
 * tooltip below, and the cut is at the tail on purpose so the code that names
 * which failure this is always survives it.
 *
 * The tooltip is `Note` (Radix) rather than a `title` attribute, and the
 * difference is not cosmetic: no browser opens a `title` on keyboard focus, so
 * on a modal keyboard-first app whose status bar sits beside a `?` shortcut
 * tag, a `title` would put the truncated half of every failure out of reach of
 * the primary input device. `Note` opens on focus too, which is why the cell
 * takes a tab stop -- a tooltip that opens on focus is worth nothing on an
 * element that cannot be focused.
 */
export function StatusCell({ text }: { readonly text: string }) {
  return (
    <Note text={text}>
      <span
        data-status
        role="status"
        aria-live="polite"
        // The suppression sits HERE, on the line directly above the attribute,
        // rather than above the element: biome reports this one at `tabIndex`
        // and suppresses by line, so when these attributes went multi-line for
        // the live region the old comment stopped covering it -- and said so
        // twice, as an unused suppression AND as the rule firing. It must also
        // be the LAST comment line before the attribute, which is why the
        // reason below is short and this explanation is above it.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the tab stop IS the feature -- see the doc comment.
        tabIndex={0}
        className="min-w-0 truncate text-ink-dim"
      >
        {truncateStatus(text)}
      </span>
    </Note>
  );
}

/** Now the DEFAULT of a stored preference rather than the value itself: the
 *  settings overlay writes `prefs.focusViewportShare`, and this is what a
 *  browser with nothing stored falls back to. Still 0.6, still one literal. */
export const FOCUS_VIEWPORT_SHARE = DEFAULT_FOCUS_SHARE;

/**
 * ReactFlow's fitting `padding` for a target share of the viewport.
 *
 * A numeric padding is resolved by the library as `(v - v / (1 + p)) / 2`
 * pixels on each side of the axis of length `v`, which leaves the content
 * spanning `1 / (1 + p)` of it. Inverting THAT gives p = 1/share - 1; at 0.6
 * the padding is 0.667.
 *
 * It used to be `(1/share - 1) / 2`, from a reading of `padding` as a fraction
 * of the fitted BOUNDS added to each side -- content at `1 / (1 + 2p)`. That
 * is not what the installed ReactFlow does, and the difference is not
 * academic: at the shipped 60% target it framed the session at 75%. Nothing
 * caught it because the value it fed was only ever asserted against the same
 * wrong model. `grid.test.ts` now measures the result through
 * `getViewportForBounds`, the library's own arithmetic.
 */
export function focusPadding(share: number): number {
  return 1 / share - 1;
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

/**
 * Whether a new session can be started at all, and through what.
 *
 * One function because there are three askers and they must never disagree:
 * `o`/the two `+` buttons that start one, the Projects header's `+` that
 * picks a directory first, and the TOOLTIPS on both buttons. A caption saying
 * a control works while the click path refuses is the exact defect the
 * per-project `+` shipped with for weeks, so the caption is computed from the
 * same answer the click reads rather than from a second opinion.
 */
type NewSessionRoute =
  | { readonly ok: true; readonly write: SourceWrites; readonly label: string }
  | { readonly ok: false; readonly decline: string };

function newSessionRoute(source: CanvasSource): NewSessionRoute {
  if (source.kind === 'connecting') {
    // The SAME sentence the source cell is showing. `error` set means the
    // source answered and refused, or could not be assembled at all: the
    // connection is over, not in progress, and a caption still saying
    // "connecting" would be this canvas making two claims about one source --
    // the thing `source.error` exists to prevent (`source.ts`).
    return {
      ok: false,
      decline:
        source.error === undefined || source.error === null
          ? 'still connecting to the source — nothing can start yet'
          : `no source to start one in — ${source.error}`,
    };
  }
  if (source.kind !== 'session') {
    return { ok: false, decline: 'black-smith has no new-session command' };
  }
  const sessionSource: SessionSource = source.source;
  if (!canWriteTo(sessionSource) || sessionSource.write.createSession === undefined) {
    return {
      ok: false,
      decline: `${sessionSource.label} cannot start a session — ${
        sessionSource.declines.createSession ?? 'it advertises no way to'
      }`,
    };
  }
  return { ok: true, write: sessionSource.write, label: sessionSource.label };
}

/**
 * The last segment of a path, as the new session's name. Not `node:path`:
 * this file is renderer code and the web build has no node builtins. A
 * trailing separator is dropped rather than yielding an empty name, and a
 * path that is nothing but separators keeps its own text -- an unnamed
 * session is worse than an odd one.
 */
function directoryName(cwd: string): string {
  const segments = cwd.split(/[/\\]/).filter((part) => part !== '');
  return segments[segments.length - 1] ?? cwd;
}

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
    // Which request's answer is still wanted. `cancelled` alone only covered
    // unmount: two polls in flight both applied their result, so a slow one
    // answering after a newer one overwrote a fresher reading with an older
    // one -- reachable whenever background-tab throttling releases a burst of
    // queued intervals. Only the most recently ISSUED request may write.
    let issued = 0;
    const poll = () => {
      issued += 1;
      const seq = issued;
      const mine = () => !cancelled && seq === issued;
      getUsage()
        .then((next) => {
          if (mine()) setSnapshot(next);
        })
        .catch(() => {
          if (mine()) setSnapshot(UNKNOWN_SNAPSHOT);
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

/**
 * The three columns, mounted or not.
 *
 * Wrappers around the call sites rather than a guard inside SessionList and
 * DetailPanel: both panels open with hooks, so an early `return null` inside
 * them would be a conditional hook. A wrapper never creates the component at
 * all, which is what "unmounted" has to mean — a display:none pane is still a
 * pane, still measured, and still findable by every query that should now miss.
 *
 * A hidden `CanvasColumn`'s children are still BUILT (JSX is evaluated at the
 * call site) — they are plain element objects, never rendered, so nothing in
 * them mounts, subscribes or measures.
 */
function SidebarSlot({ show, ...props }: ComponentProps<typeof SessionList> & { show: boolean }) {
  return show ? <SessionList {...props} /> : null;
}

function DetailSlot({ show, ...props }: ComponentProps<typeof DetailPanel> & { show: boolean }) {
  return show ? <DetailPanel {...props} /> : null;
}

/**
 * The canvas column, in one of its two jobs.
 *
 * As the main column it flexes: it is what the window is about, and it takes
 * whatever the two fixed panes leave. As a strip it is a fixed `CANVAS_STRIP`
 * wide and flexes not at all, because in that layout the RESPONSE is what takes
 * the leftover room. Which of the two it is comes from the layout's order —
 * `canvasIsMain` — never from a width someone dragged.
 */
function CanvasColumn({
  show,
  strip,
  keyboardHere,
  children,
}: {
  show: boolean;
  strip: boolean;
  /** Select is ONE cursor drawn in two columns -- the sidebar row's ring and
      the canvas card's -- so in that mode this column wears the line too. */
  keyboardHere: boolean;
  children: ReactNode;
}) {
  return show ? (
    <div
      data-canvas-pane
      className={`relative flex min-w-0 flex-col bg-canvas ${strip ? 'flex-none border-line border-l' : 'flex-1'}`}
      style={strip ? { width: CANVAS_STRIP } : undefined}
    >
      {keyboardHere && <FocusEdge />}
      {children}
    </div>
  ) : null;
}

/**
 * The three columns, drawn in the layout's order.
 *
 * The children are written in `Canvas.tsx` in reading order and matched to the
 * order by their KEY, so the sequence lives in one place — the layout
 * descriptor — instead of in this file's JSX, which is exactly the thing
 * `panes.ts` said could not be expressed while the order was hard-coded here.
 */
function Columns({ order, children }: { order: readonly ColumnId[]; children: ReactNode }) {
  const byId = new Map(
    Children.toArray(children).map((child) => [
      isValidElement(child) ? String(child.key).replace(/^\.\$/, '') : '',
      child,
    ]),
  );
  // An order naming no column is not an empty row of columns, it is no row at
  // all -- which is what the phone shell asks for, and what leaves nothing of
  // the desktop layout in the tree beside it.
  if (order.length === 0) return null;
  return <div className="flex min-h-0 flex-1">{order.map((id) => byId.get(id))}</div>;
}

/**
 * Where the rows came from, said out loud.
 *
 * Its own component because two shells draw it: the canvas top bar, and the
 * phone shell's app bar, which has no canvas top bar to put it in. The one
 * thing a dashboard must never do is look the same whether or not it is
 * connected, so it is never dropped from either.
 */
function SourceReadout({ source }: { source: CanvasSource }) {
  return (
    <span data-source className="min-w-0 truncate font-mono text-[10px]">
      {source.kind === 'demo' ? (
        <span className="text-waiting">● {source.note}</span>
      ) : source.kind === 'connecting' ? (
        // Not `text-ink-faint`, which the browser arm below still uses: it
        // measures 3.27:1 dark and 3.01:1 light (issue 188). Not a status token
        // either -- "connecting" is not one of the four session states, and
        // the hollow glyph is what carries "not yet".
        source.error === undefined || source.error === null ? (
          <span className="text-ink-dim">○ connecting to the source…</span>
        ) : (
          <span className="text-failed">● {source.error}</span>
        )
      ) : source.kind === 'session' ? (
        // The error is the WHOLE claim of this cell, so it is what colours it.
        // A green dot next to a source whose every poll is failing is the
        // defect this arm exists to prevent, and the failure badge in the
        // status bar was the only surface saying otherwise.
        source.error === undefined || source.error === null ? (
          <span className="text-done">● {source.source.label}</span>
        ) : (
          <span className="text-failed">● {source.error}</span>
        )
      ) : source.status === 'error' ? (
        <span className="text-failed">● {source.error}</span>
      ) : source.status === 'loading' ? (
        <span className="text-ink-faint">○ connecting to black-smith…</span>
      ) : (
        <span className="text-done">● black-smith</span>
      )}
    </span>
  );
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
  // Visibility is read here and passed down, never asked of a child: which
  // columns exist is a fact about the layout, and `layoutWidths` is the one
  // place that knows an unmounted pane owes its sibling nothing.
  // And read through `layoutForViewport`, so that "which columns exist" also
  // answers the window too narrow to hold them: with the canvas demoted none of
  // the three columns flexes, and the strip is what gives. Render-time only —
  // `prefs.paneVisibility` is untouched, so widening the window restores it.
  const visible = layoutForViewport(prefs.paneVisibility, viewportWidth);
  const order = columnOrder(visible);
  /**
   * Which shell this viewport gets. `false` wherever `matchMedia` is missing,
   * so every environment without one -- jsdom, happy-dom, the tests -- keeps
   * the columns it was written against.
   */
  const phone = usePhoneViewport();
  // The canvas is a strip exactly when it is drawn but is not the main column.
  const canvasStrip = visible.canvas && !canvasIsMain(visible);
  const { sidebar: sidebarWidth, detail: detailWidth } = layoutWidths(
    visible,
    { sidebar: storedSidebar, detail: storedDetail },
    viewportWidth,
  );

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
  // `system` is a subscription, not a sample: without the listener the OS
  // flipping at sunset leaves a dashboard on the appearance it had at mount,
  // which is not what the overlay's own hint promises. Keeping the resolved
  // value in state is what lets the sidebar's label and its click describe the
  // screen rather than the store.
  // The colour overrides move HERE too, in the same statement, because they are
  // stored per theme: the class and the bucket in force are two halves of one
  // appearance, and a flip that moved only the class would leave a light theme
  // wearing dark's canvas until the next write. `writePrefs` covers an edit;
  // only this covers the OS changing its mind with nothing else happening.
  const [effective, setEffective] = useState<EffectiveTheme>('dark');
  useEffect(() => {
    const show = (theme: Theme) => {
      const next = applyTheme(theme);
      setEffective(next);
      applyPalette(paletteFor(prefs.palette, next));
    };
    show(prefs.theme);
    if (prefs.theme !== 'system') return;
    return watchOsTheme(() => show('system'));
  }, [prefs.theme, prefs.palette]);

  const sourceModel = useMemo(
    // Renames after icons, and in the same one place, for the same reason:
    // the sidebar, the node and the detail panel all render `session.title`,
    // and none of them should know a title can be vam's own rather than the
    // source's.
    () => applyRenames(applyIcons(factoryModel, prefs.icons, prefs.projectIcons), prefs.renames),
    [factoryModel, prefs.icons, prefs.projectIcons, prefs.renames],
  );

  /**
   * The replies sent but not yet reported back by the source (`optimistic.ts`).
   *
   * Held here, one level above `model`, so every pane draws a pending reply
   * exactly as it draws a real turn -- the sidebar, the step nodes and the
   * detail panel all read `model` and none of them learns that a turn can be
   * vam's own, which is the same rule the rename above follows.
   */
  const [pending, setPending] = useState<readonly PendingPrompt[]>([]);
  const pendingSeq = useRef(0);
  // Reconciled against `sourceModel`, which is the model WITHOUT the paint:
  // counting a painted turn as a real one would retire the paint on the render
  // that drew it.
  useEffect(() => {
    setPending((current) => {
      const next = reconcile(sourceModel, current);
      // Identity, not length, is what stops this effect from looping.
      return next.length === current.length ? current : next;
    });
  }, [sourceModel]);
  /**
   * The drawn model: the source's, plus the optimistic paint, plus the
   * operator's grouping resolved on top.
   *
   * COMPOSING RUNS LAST, downstream of `withPending`, because `withPending`
   * spreads the model and rewrites `projects` -- composing first would have it
   * rebuild the top level out of the ungrouped half alone. With nothing in
   * `prefs.groups`, which is every store that exists, `composeGroups` hands
   * back the very object it was given and this line costs nothing.
   */
  const model = useMemo(
    () => composeGroups(withPending(sourceModel, pending), prefs.groups),
    [sourceModel, pending, prefs.groups],
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
  const [keySheetOpen, setKeySheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [errorLogOpen, setErrorLogOpen] = useState(false);
  /** Any full-screen overlay on screen. See the keydown handler for the rule. */
  const overlayOpen = paletteOpen || keySheetOpen || settingsOpen || errorLogOpen;
  /**
   * Whether the source has a terminal to draw, which decides how many tabs the
   * bar has. Read in two places -- the pane is told, and `Mod-<digit>` counts
   * the same list -- and that is the point: the digit must count what is drawn.
   */
  const terminalTab = source.kind === 'session' && source.source.capabilities.terminal;
  /**
   * How many things have BROKEN this session. Refusals are excluded on
   * purpose: a badge that counted vam's intended "no"s would be a number that
   * grows during correct use, and a number like that is one nobody reads.
   */
  const events = useSyncExternalStore(subscribeEvents, loggedEvents, loggedEvents);
  const failureCount = events.filter((event) => event.kind === 'failure').length;
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  /**
   * WHICH CURSOR MODE THE KEYBOARD IS IN — Select or Insert.
   *
   * `I` enters Insert, `H` and `Esc` return to Select. One explicit owner
   * rather than a guess based on what was last clicked: a keyboard-first tool
   * cannot afford to be wrong about where the next keystroke goes.
   *
   * THIS IS ONE FACT, NOT TWO, and that is the whole reason it is named. The
   * same state decides which pane the keyboard belongs to AND what a key
   * means, so `hjkl` and `Mod+<digit>` read it rather than carrying a second
   * notion of where focus is — two parallel notions of one fact is how the
   * digit table went stale three times in a day.
   *
   *   Select — `hjkl` chooses a session, `Mod+<digit>` a session by position.
   *   Insert — `hjkl` chooses an agent option when one is being asked,
   *            `Mod+<digit>` switches tab.
   *
   * The names are the operator's own, and `keysheet.ts` prints the same two.
   */
  const [mode, setMode] = useState<CursorMode>('select');
  const [actionIndex, setActionIndex] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /**
   * WHICH source's session is being renamed, captured when the editor opens
   * rather than re-derived when it commits -- the same argument `IconTarget`
   * makes above, and the same bug avoided: a lookup by session id across
   * every source returns whichever sorts first, and the name would land in
   * the wrong source's bucket.
   */
  const [renameTarget, setRenameTarget] = useState<IconTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pickingIconFor, setPickingIconFor] = useState<IconTarget | null>(null);
  /** The group whose glyph is being picked, captured when the picker opens --
   *  the reasoning `ProjectIconTarget` records, one level up again. */
  const [pickingGroupIconFor, setPickingGroupIconFor] = useState<{
    readonly source: SourceId;
    readonly groupId: string;
    readonly name: string;
  } | null>(null);
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

  /**
   * The one route into the session icon chooser.
   *
   * Both askers come through here — the `s` chord and the root node's own
   * glyph — because two openers writing through two copies of this is how
   * they drift, and only one of them would keep the refusal below. Stable by
   * construction (functional setState, no model read), so it can sit in a
   * node's data without going stale as the model refreshes.
   */
  const openSessionIconPicker = useCallback((entry: SessionEntry) => {
    // A project with no source cannot store an icon under one: guessing a
    // fallback here would reintroduce the exact cross-source collision this
    // epic's storage re-key removed.
    const projectSource = entry.project.source;
    if (projectSource === undefined) {
      setStatus('this project has no source — icon unavailable');
      return;
    }
    setPickingIconFor((current) =>
      current !== null && current.sessionId === entry.session.id && current.source === projectSource
        ? null
        : {
            source: projectSource,
            sessionId: entry.session.id,
            title: entry.session.title,
          },
    );
  }, []);
  /** The sidebar's filter popover — the ONE home for narrowing (SessionList). */
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  /**
   * The two chords whose EFFECT belongs to a panel: `Mod-<digit>` picks
   * a detail tab, `p` reveals a project. A fresh object per press, never the
   * state itself — the tab and the reveal stay where they are drawn and only
   * the ask travels, which keeps both keys in the chord table (so the sheet
   * lists them and an open overlay silences them) without pulling a panel's
   * presentation into the canvas's model.
   */
  const [tabRequest, setTabRequest] = useState<{ readonly tab: DetailTab } | null>(null);
  const [revealRequest, setRevealRequest] = useState<{ readonly projectId: string } | null>(null);
  /** True while a write is in flight — Enter must not fire twice. */
  const [writing, setWriting] = useState(false);
  /** The same guard for `x`: one keypress must not become two stop attempts. */
  /**
   * THE ONE PENDING FLAG, and it is one on purpose.
   *
   * Creating a session and closing one both spawn a subprocess with a ten
   * second timeout, and nothing on screen used to change between the click and
   * the result -- so a slow action and an ignored click looked the same, which
   * is what the operator reported. This holds the id of whatever is currently
   * in flight (a project id for a create, a session id for a close) and is
   * threaded outward; a flag per button would be several sources of truth for
   * one fact, and the second press guard is exactly the thing that must not
   * disagree with the spinner.
   *
   * A press while it is set RETURNS BEFORE SPAWNING. A double press that
   * starts two sessions is a worse bug than the missing indicator.
   */
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  /** Removals that cannot be stored, because the project has no source to key
   *  them under. See `hiddenProjects`. */
  const [hiddenSourceless, setHiddenSourceless] = useState<readonly string[]>([]);
  const searchOrigin = useRef<string | null>(null);
  const chord = useRef<ChordState>(EMPTY_CHORD);
  const { getNodes, zoomIn, zoomOut, fitView, fitBounds, setCenter } = useReactFlow();

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
  /**
   * The projects removed from vam, as the ids the sidebar draws from.
   *
   * Derived per project from `prefs.hiddenProjects`, which is keyed by SOURCE:
   * an id counts as removed only under ITS OWN source's bucket, so one
   * source's removal cannot hide another source's project that happens to
   * share an id. A project with no source at all cannot be keyed, so its
   * removal is kept for the session in `hiddenSourceless` rather than
   * refused -- the same shape `onPickIcon` refuses on, answered differently
   * because a removal that silently did nothing would be worse than one that
   * is not remembered.
   */
  const hiddenProjects = useMemo(() => {
    const ids: string[] = [];
    for (const entry of allEntries) {
      const { id, source: projectSource } = entry.project;
      if (ids.includes(id)) continue;
      if (
        projectSource === undefined
          ? hiddenSourceless.includes(id)
          : isProjectHidden(prefs, projectSource, id)
      ) {
        ids.push(id);
      }
    }
    return ids;
  }, [allEntries, prefs, hiddenSourceless]);

  /**
   * The groups folded shut, flattened across sources for the sidebar.
   *
   * Flattened because a group id is minted locally and derived from nothing,
   * so it collides with nothing -- unlike a project id, which is a cwd digest
   * unique only within its source and therefore has to stay keyed (see
   * `hiddenProjects` above).
   */
  const collapsedGroups = useMemo(
    () => Object.values(prefs.collapsedGroups).flat(),
    [prefs.collapsedGroups],
  );

  /**
   * Fold one group, and remember it. The source comes from the store the
   * group is written in -- a group carries no source of its own, and guessing
   * one from its members would have nothing to guess from while it is empty.
   */
  /**
   * Which source a NEW group is written under.
   *
   * A group has no cwd, so it has no source of its own; membership, on the
   * other hand, is matched within a source, because a project id is a cwd
   * digest unique only there. So a group has to be filed under one, and the
   * only honest candidate is the source the drawn projects come from: the
   * first one that names one, which with vam's one live source is the only
   * one there is. A model whose projects name none has nowhere to file a
   * group, and the control says so rather than guessing -- the same refusal
   * the project icon picker already makes, for the same reason.
   *
   * KNOWN AND STATED: with two sources on screen, a group made here is filed
   * under the first and can therefore never hold the second's projects, since
   * membership is matched within a source. Nothing in vam draws two sources
   * at once today; the day something does, this is where the operator has to
   * be asked which.
   */
  const groupHomeSource = useCallback((): SourceId | null => {
    for (const project of model.projects) {
      if (project.source !== undefined) return project.source;
    }
    for (const group of model.groups ?? []) {
      for (const project of group.projects) {
        if (project.source !== undefined) return project.source;
      }
    }
    return null;
  }, [model]);

  const createNewGroup = useCallback(
    (name: string) => {
      const source = groupHomeSource();
      if (source === null) {
        setStatus('no source to file a project under — nothing was created');
        return;
      }
      // Minted locally and derived from nothing: a group has no cwd to
      // digest, must survive a rename, and must exist while it is empty.
      const id = `group:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      savePrefs(createGroup(prefs, source, id, name));
      setStatus(`${name} — a project kept on this machine, never in the event log`);
    },
    [groupHomeSource, prefs, savePrefs],
  );

  const renameOneGroup = useCallback(
    (group: Group, name: string) => {
      const source = groupSource(prefs.groups, group.id);
      if (source === null) return;
      savePrefs(renameGroup(prefs, source, group.id, name));
    },
    [prefs, savePrefs],
  );

  /**
   * Dissolve a group. NO CONFIRM, and that is the decision rather than an
   * omission: no session ends, nothing is hidden, `hiddenProjects` is not
   * touched, and there is no source call to serialise behind `pendingAction`.
   * What is lost is a name and a glyph; every project and every session stays
   * on screen, one level up. The status line is the whole disclosure, and it
   * is enough because the outcome is already visible.
   */
  const ungroup = useCallback(
    (group: Group) => {
      const source = groupSource(prefs.groups, group.id);
      if (source === null) return;
      const moved = group.projects.length;
      savePrefs(deleteGroup(prefs, source, group.id));
      setStatus(`${group.name} ungrouped — ${moved} ${moved === 1 ? 'repo' : 'repos'} moved up`);
    },
    [prefs, savePrefs],
  );

  /**
   * The group whose membership is being edited, captured when the list opens
   * -- the reasoning both icon targets record.
   */
  const [pickingMembersFor, setPickingMembersFor] = useState<{
    readonly source: SourceId;
    readonly groupId: string;
    readonly name: string;
  } | null>(null);

  /**
   * What the membership list offers: THE PROJECTS VAM ALREADY KNOWS, within
   * the group's own source, because a project id is a cwd digest unique only
   * there and membership is matched the same way.
   *
   * There is no directory dialog on this path and no `.git` validation:
   * `repo.ts` refuses to list what vam knows for CREATING a project, on the
   * grounds that the only list it could offer is the directories it already
   * has sessions in -- which is the wrong set there and exactly the right one
   * here. You can only group what exists.
   */
  const memberChoices = useMemo((): readonly ProjectChoice[] => {
    if (pickingMembersFor === null) return [];
    const { source, groupId } = pickingMembersFor;
    const choices: ProjectChoice[] = [];
    for (const project of model.projects) {
      if (project.source === source) {
        choices.push({ id: project.id, name: project.name, member: false, groupName: null });
      }
    }
    for (const group of model.groups ?? []) {
      for (const project of group.projects) {
        if (project.source !== source) continue;
        choices.push({
          id: project.id,
          name: project.name,
          member: group.id === groupId,
          groupName: group.id === groupId ? null : group.name,
        });
      }
    }
    return choices;
  }, [model, pickingMembersFor]);

  const toggleGroupCollapse = useCallback(
    (group: Group) => {
      const source = groupSource(prefs.groups, group.id);
      if (source === null) return;
      savePrefs(
        setGroupCollapsed(prefs, source, group.id, !isGroupCollapsed(prefs, source, group.id)),
      );
    },
    [prefs, savePrefs],
  );

  const entries = useMemo(() => {
    // FIRST, and not only in the sidebar. A removed project whose cards stayed
    // drawn would leave `j` stepping onto a session with no row -- the exact
    // defect the note below this memo describes, reintroduced by a different
    // route. The three views agree on the SET.
    const visible = allEntries.filter((e) => !hiddenProjects.includes(e.project.id));
    const byText =
      query.trim() === '' ? visible : visible.filter((e) => matches.includes(e.session.id));
    const byStatus =
      statusFilter === 'all' ? byText : byText.filter((e) => e.session.status === statusFilter);
    // Both origin rules only ever exclude something vam POSITIVELY classified
    // — see `session-filter.ts`. A session whose timeline has not arrived is
    // `unknown` and survives both, because hiding what you did not check is
    // how a filter loses work rather than narrowing it.
    return byStatus.filter((e) => !isHiddenByOriginFilters(e.session, prefs.filters));
  }, [allEntries, hiddenProjects, matches, query, statusFilter, prefs.filters]);

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
    const kept = new Set(entries.map((e) => e.session.id));
    if (kept.size === allEntries.length) {
      return model;
    }
    const narrow = (projects: readonly Project[]) =>
      projects
        .map((project) => ({
          ...project,
          sessions: project.sessions.filter((s) => kept.has(s.id)),
        }))
        .filter((project) => project.sessions.length > 0);
    // The grouped half is narrowed the same way and by the same set. Dropping
    // it here instead would make a filter delete every grouped card from the
    // canvas -- the "drawn but unreachable" defect this memo's own comment
    // describes, in reverse.
    const groups = model.groups?.map((group) => ({ ...group, projects: narrow(group.projects) }));
    return { projects: narrow(model.projects), ...(groups === undefined ? {} : { groups }) };
  }, [model, entries, allEntries]);

  const layout = useMemo(() => layoutCanvas(visibleModel), [visibleModel]);

  /**
   * What `hjkl`, `f` and `gg` may land on: every node on the canvas, no filter
   * of its own. The set is narrowed once, at `entries` above, and the canvas is
   * drawn from the result — so a second narrowing here is what would put the
   * cursor and the picture back out of step.
   */
  const nodeIds = useMemo(() => layout.nodes.map((n) => n.id), [layout]);

  /**
   * Every node focus could land on, paired with the SESSION it draws.
   *
   * The pairing is the point. A remembered focus stores a session id under its
   * source, never a node id: node ids are derived from the layout, so they are
   * rebuilt whenever the model, the filters or the fold state change and a
   * stored one would go stale between launches without anything having ended.
   * This is where the two vocabularies meet (`prefs/focus.ts`).
   */
  const focusCandidates: readonly FocusCandidate[] = useMemo(
    () =>
      layout.nodes.map((n) => ({
        nodeId: n.id,
        source: sourceKeyOf(n.entry),
        session: n.entry.session.id,
      })),
    [layout],
  );

  /** Which session the focused node belongs to — the id all three panes share. */
  const focusedSpec = useMemo(
    () => layout.nodes.find((n) => n.id === focusedId) ?? null,
    [layout, focusedId],
  );
  const focusedEntry: SessionEntry | null = focusedSpec?.entry ?? null;
  /** Which session the focus sits in — the id the strip filter and the
   *  sidebar cursor both read. */
  const focusedSessionId = focusedSpec?.entry.session.id ?? null;

  /**
   * The viewport follows focus, and frames a session when you arrive in one.
   *
   * `j`/`k` can walk to a session that is off screen, and before any of this
   * the canvas simply did not move — the sidebar and the detail panel updated
   * while the cards stayed put, so the one pane that shows a session's SHAPE
   * was the one pane that did not follow you.
   *
   * WHEN IT FRAMES IS THE WHOLE DESIGN, and it is a correction of a mistake
   * this file has already made once. A previous version fitted on every focus
   * move; the operator asked for it to be removed, and the comment that came
   * with it admitted it deliberately overrode a zoom they had set by hand. The
   * fault was not the fit, it was the frequency. Inside one session the
   * framing is already right — every node of it is on screen — so a re-fit
   * there can do nothing except undo whatever the operator just did with the
   * zoom controls. Between sessions there is a new thing to look at and the
   * old framing was chosen for something else.
   *
   * So: arriving in a DIFFERENT session frames that session, whole — root card
   * and step nodes, `sessionBounds` — at the operator's own share of the
   * canvas width. Moving about inside one pans and nothing else, with the zoom
   * argument omitted so `setCenter` keeps the scale exactly where it was.
   *
   * The share can be turned OFF (`FOCUS_SHARE_OFF`), and then this is a pan
   * and only a pan, which is precisely the behaviour that shipped between the
   * two asks. Somebody who wants that back should not have to ask for code to
   * be deleted a second time.
   *
   * The FIRST landing is not a move between sessions and does not frame: focus
   * settles on a session shortly after mount without anyone moving it, and the
   * opening viewport belongs to `DEFAULT_VIEWPORT`, not to this effect.
   */
  // Lifted out of the effect so the dependency array names exactly what the
  // effect reads. Depending on `focusedSpec` itself would re-centre on every
  // layout rebuild — the object is rebuilt each render — and fight a manual pan.
  const focusCenterX =
    focusedSpec === null ? null : focusedSpec.position.x + focusedSpec.size.width / 2;
  const focusCenterY =
    focusedSpec === null ? null : focusedSpec.position.y + focusedSpec.size.height / 2;

  // Same rule, and the same reason, for the session's frame: four numbers the
  // geometry makes deterministic rather than one object identity that changes
  // whenever the model is polled.
  const frame = useMemo(
    () => (focusedSessionId === null ? null : sessionBounds(layout, focusedSessionId)),
    [layout, focusedSessionId],
  );
  const frameX = frame?.x ?? null;
  const frameY = frame?.y ?? null;
  const frameWidth = frame?.width ?? null;
  const frameHeight = frame?.height ?? null;

  /** The session last framed, so "a different session" is a comparison and not
   *  a guess. `undefined` until focus first lands, which is what keeps the
   *  opening render out of it. */
  const framedSession = useRef<string | null | undefined>(undefined);
  const focusShare = prefs.focusViewportShare;

  useEffect(() => {
    if (focusCenterX === null || focusCenterY === null) {
      return;
    }
    // Re-frame when the SHARE changes too: the operator is looking at the
    // canvas while they turn the stepper, and a setting whose effect waits for
    // the next keypress reads as a setting that did nothing.
    const key = focusedSessionId === null ? null : `${focusedSessionId}:${focusShare}`;
    const arrived = framedSession.current !== undefined && framedSession.current !== key;
    framedSession.current = key;
    if (
      arrived &&
      focusShare !== FOCUS_SHARE_OFF &&
      frameX !== null &&
      frameY !== null &&
      frameWidth !== null &&
      frameHeight !== null
    ) {
      void fitBounds(
        { x: frameX, y: frameY, width: frameWidth, height: frameHeight },
        { padding: focusPadding(focusShare), duration: 220 },
      );
      return;
    }
    setCenter(focusCenterX, focusCenterY, { duration: 220 });
  }, [
    focusCenterX,
    focusCenterY,
    focusedSessionId,
    focusShare,
    frameX,
    frameY,
    frameWidth,
    frameHeight,
    fitBounds,
    setCenter,
  ]);

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
   * The command row whose copy control `i` has just asked for. Cleared by the
   * panel once the focus has landed, so pressing `i` twice on the same row
   * asks twice, rather than the first press being the only one that lands.
   */

  /**
   * Everything the action pane can land on, in the order it is drawn.
   *
   * Built here rather than inside the panel because `Enter` has to activate it
   * and `Enter` is handled by the window listener. A panel that owned its own
   * cursor would be a second source of truth about what is selected.
   */
  const actions = useMemo(() => buildActions(), []);

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
            ? { entry: spec.entry, onPickIcon: openSessionIconPicker }
            : { entry: spec.entry, decision: spec.decision, recall: spec.recall }),
          focused: false,
          jumpLabel: null,
          sessionId: spec.entry.session.id,
          baseOpacity: spec.opacity,
        },
      })),
    ],
    [layout, openSessionIconPicker],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  /**
   * What the canvas column actually draws.
   *
   * The full canvas draws every session, which is what makes it a canvas. The
   * strip draws the focused session and nothing else — that is the "less
   * detail" half of demoting it, and it is a RENDERING decision, not a width
   * one: a 300px column showing every fan would be a canvas you cannot read,
   * whereas one row of cards at 300px is exactly the amount of graph a person
   * glances at while reading the response beside it. Filtered here rather than
   * in `initialNodes` so `nodeIds` — the set the cursor may land on — stays the
   * whole model in every layout: the strip narrows what is DRAWN, never what
   * `j`/`k` can reach, and the sidebar still lists them all.
   */
  const drawnNodes = useMemo(
    () => (canvasStrip ? nodes.filter((node) => node.data.sessionId === focusedSessionId) : nodes),
    [canvasStrip, nodes, focusedSessionId],
  );

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
    if (focusCandidates.length === 0) {
      return;
    }
    if (focusedId === null || !nodeIds.includes(focusedId)) {
      setFocusedId(resolveFocusNodeId(prefs.lastFocus, focusCandidates));
    }
  }, [nodeIds, focusCandidates, focusedId, prefs.lastFocus]);

  /**
   * The other half: record where focus is, so the next launch can ask.
   *
   * ONE EFFECT RATHER THAN A WRITE AT EVERY `setFocusedId`. Focus is moved from
   * eight places -- the chords, a click on a card, a click on a sidebar row,
   * search landing and search escaping -- and a write bolted onto each is
   * seven chances to add a ninth that forgets. Watching the resulting entry
   * catches all of them, including the ones this file has not grown yet.
   *
   * The equality guard is what stops it looping: `savePrefs` replaces `prefs`,
   * which re-runs this effect, which finds the stored pointer already says what
   * it was about to write and returns. A focus that lands on nothing keeps the
   * last pointer rather than clearing it -- an empty canvas is a filter or a
   * still-loading model, not the operator telling us to forget where they were.
   */
  useEffect(() => {
    if (focusedEntry === null) {
      return;
    }
    const next = {
      source: sourceKeyOf(focusedEntry),
      session: focusedEntry.session.id,
    };
    if (prefs.lastFocus?.source === next.source && prefs.lastFocus?.session === next.session) {
      return;
    }
    savePrefs(setLastFocus(prefs, next));
  }, [focusedEntry, prefs, savePrefs]);

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
   * WHAT THE WORDING IS ACTUALLY DERIVED FROM, said here because it reads
   * like a per-call outcome and is not one. `deliverPrompt` is the source's
   * own DECLARATION, and no layer under it returns what happened:
   * `SourceWrites.recordPrompt` is `Promise<void>` (`sources/port.ts`), the
   * preload unwraps it as `void` (`preload/api.ts`), and main's
   * `recordPrompt` resolves to `SourceError | null` -- a refusal or nothing
   * (`main/sources/source.ts`). The Claude Code source routes a reply two
   * ways, into a tmux pane it owns or into `claude --resume`
   * (`main/sources/claude-code/reply.ts`), and reports neither: both count as
   * delivered, and both refuse loudly rather than quietly recording, which is
   * why resolving without an error is enough to say "sent" here. The gap that
   * remains is a source declaring `deliverPrompt` while its write only
   * appends -- vam cannot see that, and it cannot be closed in this file. It
   * needs an outcome carried back through those four layers. Do not paper
   * over it here with a wording that guesses.
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
    // TOTALITY, not a reachable path: with no source there is no model, so
    // there is no focused entry and the guard above has already returned. It
    // refuses rather than falling through to the browser branch, which would
    // read `client` off a source that has none.
    if (source.kind === 'connecting') {
      setStatus('still connecting to the source — there is nothing to send to yet');
      return;
    }
    if (writing) {
      return;
    }
    const text = draft;
    /**
     * Draw the turn now and empty the composer, so the pane reacts to the key
     * rather than to the round trip (`optimistic.ts`). `live` is the source's
     * own `deliverPrompt` and decides ONLY whether the session is painted as
     * running: a recorded prompt is still shown, because the operator typed it
     * and it exists, but nothing claims an agent is answering it.
     */
    const beginPaint = (live: boolean): PendingPrompt => {
      pendingSeq.current += 1;
      const one: PendingPrompt = {
        id: `vam-pending-${pendingSeq.current}`,
        sessionId: entry.session.id,
        input: text,
        seen: countTurnsWithInput(sourceModel, entry.session.id, text),
        live,
      };
      setPending((current) => [...current, one]);
      setDraft('');
      setComposing(false);
      setWriting(true);
      return one;
    };
    // A refusal must leave no trace of a turn that never happened -- and give
    // the words back, so nothing has to be retyped.
    const rollBack = (one: PendingPrompt) => {
      setPending((current) => current.filter((other) => other.id !== one.id));
      setDraft(text);
      setComposing(true);
    };
    if (source.kind === 'session') {
      const sessionSource = source.source;
      if (!canWriteTo(sessionSource)) {
        setStatus(`${sessionSource.label} cannot be written to`);
        return;
      }
      const painted = beginPaint(sessionSource.capabilities.deliverPrompt);
      try {
        await sessionSource.write.recordPrompt(entry.session.id, text);
        setStatus(
          sessionSource.capabilities.deliverPrompt
            ? `sent into the running session of ${entry.session.title} — it will answer there`
            : `recorded in the log of ${entry.session.title} — recorded, not sent to the agent`,
        );
        source.onWrote();
      } catch (cause) {
        rollBack(painted);
        setStatus(noteFailure('send prompt', cause));
      } finally {
        setWriting(false);
      }
      return;
    }
    const painted = beginPaint(false);
    try {
      await source.client.recordPrompt(entry.session.id, text);
      setStatus(`recorded in the log of ${entry.session.title} — recorded, not sent to the agent`);
      source.onWrote();
    } catch (cause) {
      rollBack(painted);
      setStatus(noteFailure('send prompt', cause));
    } finally {
      setWriting(false);
    }
  }, [focusedEntry, draft, source, writing, sourceModel]);

  /**
   * Stop the focused session — really, when the source can.
   *
   * NO CONFIRM STEP, and that is a decision rather than an omission. `claude
   * stop` keeps the conversation and `claude attach <id>` brings it back, so
   * this is not a delete; the status line names the session it acted on and
   * says the conversation is kept, which is what a confirm dialog would have
   * been for. A modal in front of a resumable, named, undoable action is a
   * keystroke tax on the common case.
   *
   * WHAT IT WILL NOT DO is decide for itself which sessions are stoppable.
   * `claude stop` stops BACKGROUND sessions only; an interactive one is a
   * terminal the operator is sitting in, and main refuses it by name with the
   * remedy that is actually theirs (`src/main/sources/claude-code/stop.ts`).
   * That refusal arrives here as a `SourceError` and is rendered verbatim —
   * the renderer never guesses at the distinction, and never reports a stop
   * it did not perform.
   *
   * IT REPORTS ITS OUTCOME, `true` only where the source confirmed the close.
   * Nothing here throws — a refusal is a status line and a normal return, and
   * that is deliberate — so a caller acting on several sessions has no
   * exception to count and would otherwise have to count its own intentions
   * instead. `removeProject` did exactly that, and told the operator it had
   * ended sessions that were still running.
   */
  const closeSession = useCallback(
    async (sessionId: string, title: string): Promise<boolean> => {
      if (pendingAction !== null) {
        // NAMED, and named for the session the operator just clicked: only
        // the pending control is disabled, so this click landed on a `×` that
        // looked pressable, and silence there is indistinguishable from a
        // dead button. `removeProject` has always said this; these two did
        // not. The sentence stays in one form across all three.
        setStatus(
          `something else is still running — "${title}" was not closed; try again in a moment`,
        );
        return false;
      }
      if (source.kind !== 'session') {
        setStatus(`black-smith has no close-session command — "${title}" is still here`);
        return false;
      }
      const sessionSource = source.source;
      if (!canWriteTo(sessionSource) || sessionSource.write.closeSession === undefined) {
        setStatus(
          `${sessionSource.label} cannot close a session — ${
            sessionSource.declines.closeSession ?? 'it advertises no way to'
          }; "${title}" is still here`,
        );
        return false;
      }
      setPendingAction(sessionId);
      setStatus(`stopping "${title}"…`);
      try {
        await sessionSource.write.closeSession(sessionId);
        setStatus(
          `stopped "${title}" — the conversation is kept; resume it with \`claude attach\``,
        );
        source.onWrote();
        return true;
      } catch (cause) {
        setStatus(noteFailure('close session', cause));
        return false;
      } finally {
        // EVERY path, and that is the whole of this `finally`. A spinner still
        // spinning after a refusal turns a clear failure into an apparent
        // hang, which is worse than never having shown one.
        setPendingAction(null);
      }
    },
    [source, pendingAction],
  );

  /**
   * The ONE way into the composer, from the keyboard and from the mouse alike.
   *
   * Composing happens INSIDE Insert; there was never a third mode. It was
   * entered from two places that could disagree, and they did: `i` set both
   * the mode and the flag, while the textarea's own `onFocus` set the flag
   * alone -- so clicking into the box left the bar reading Select to an
   * operator typing a prompt, and `Mod+<digit>`, which reads the mode and is
   * let through the typing guard on purpose, moved a session instead of
   * switching a tab. One function, three callers, nothing left to diverge.
   */
  const beginComposing = useCallback(() => {
    setMode('insert');
    setComposing(true);
  }, []);

  /**
   * Store the removal -- or, when there is nowhere to store it, keep it for
   * this run and let the project come back.
   *
   * `prefs.hiddenProjects` is keyed by SOURCE, which is what stops one
   * source's removal from hiding another source's project of the same id. A
   * project with no `source` has no bucket to key under, and the three
   * available answers are: invent a key, which reintroduces exactly the
   * collision the keying exists to prevent; refuse, which leaves a Remove item
   * that does nothing; or remove it for this run and let it return on the next
   * launch. THE THIRD IS CHOSEN. It is the weakest of the three outcomes and
   * the only honest one -- vam removes what the operator asked it to remove,
   * and does not claim to have remembered something it could not write. A test
   * holds it there, because a hidden-until-reload project is defensible only
   * as a decision somebody made rather than as something nobody noticed. Every
   * project from a real source has a source; this is the fixture case.
   */
  const setProjectRemoved = useCallback(
    (project: Project, removed: boolean) => {
      const projectSource = project.source;
      if (projectSource === undefined) {
        setHiddenSourceless((current) =>
          removed
            ? current.includes(project.id)
              ? current
              : [...current, project.id]
            : current.filter((id) => id !== project.id),
        );
        return;
      }
      savePrefs(setProjectHidden(prefs, projectSource, project.id, removed));
    },
    [prefs, savePrefs],
  );

  /**
   * Remove a project: end what vam started, then stop drawing it.
   *
   * THE ORDER IS THE SAFETY. The hide is what makes a removal stick, and doing
   * it first would take the sessions out of reach before they were ended --
   * running, with no row and no card to reach them by. So every close is
   * awaited first and the project is hidden only after.
   *
   * IT REFUSES OUTRIGHT while another action is in flight, rather than trying.
   * `closeSession` returns at its own guard when `pendingAction` is set -- a
   * `claude stop` can burn its full 15s timeout -- so a removal that pressed
   * on would hide the project having ended nothing and said nothing. Refusing
   * here also makes the loop below sound: with `pendingAction` proven null at
   * entry, the `closeSession` this closure holds is one whose own guard cannot
   * fire, so each session is really closed rather than silently skipped.
   *
   * `plan` is the SIDEBAR'S, and is not recomputed: it is exactly what the
   * confirm dialog disclosed and the operator agreed to. Recomputing it here
   * against a model that may have polled since would end sessions the sentence
   * they read did not mention.
   *
   * IT COUNTS OUTCOMES, NOT INTENTIONS, and a close that failed cancels the
   * hide. `plan.end.length` is what `removalPlan` proposed before anything was
   * attempted; reporting it as the number ended told the operator that two
   * sessions had been stopped while both were still running -- and the hide
   * had just taken away the rows that would have shown otherwise. So each
   * close's own answer is counted, and where any of them said no the project
   * is left drawn: the sessions stay reachable and Remove can be pressed again
   * once the source is.
   */
  const removeProject = useCallback(
    async (project: Project, plan: RemovalPlan) => {
      if (pendingAction !== null) {
        setStatus(
          `something else is still running — "${project.name}" was not removed; try again in a moment`,
        );
        return;
      }
      const stillRunning: string[] = [];
      let ended = 0;
      for (const sessionId of plan.end) {
        const entry = allEntries.find((e) => e.session.id === sessionId);
        const title = entry?.session.title ?? sessionId;
        if (await closeSession(sessionId, title)) {
          ended += 1;
        } else {
          stillRunning.push(title);
        }
      }
      if (stillRunning.length > 0) {
        // NOT HIDDEN, and that is the decision. Hiding is what would make
        // these sessions unreachable: still running, with no row, no card and
        // no Remove item to try again from. A removal that could not end what
        // it disclosed it would end is a removal that did not happen, so the
        // project stays exactly where it was and the sentence names the
        // sessions the operator now has to deal with. The close's own refusal
        // is one line above this one in the log; this is the summary of it.
        setStatus(
          `"${project.name}" was NOT removed — ${stillRunning.join(', ')} ${
            stillRunning.length === 1 ? 'is' : 'are'
          } still running${ended === 0 ? '' : ` (${ended} ended)`}; nothing was hidden, so you can try again`,
        );
        return;
      }
      setProjectRemoved(project, true);
      setStatus(
        ended === 0
          ? `removed "${project.name}" from vam — nothing was ended, and nothing left this machine`
          : `removed "${project.name}" from vam — ended ${ended} session${ended === 1 ? '' : 's'} vam started; nothing left this machine`,
      );
    },
    [allEntries, closeSession, pendingAction, setProjectRemoved],
  );

  /**
   * Start a new session — really, when the source can.
   *
   * WHICH PROJECT, and never a guess. A new session has to be born somewhere,
   * and the only directory vam is entitled to use is one it already knows a
   * project by; so this takes the project explicitly and the keyboard path
   * passes the focused session's own. With nothing focused there is no
   * project, and it says so rather than starting a session in a plausible
   * directory — the same discipline main keeps in `create-session.ts`.
   *
   * The refusal is rendered in the source's own words. A source that cannot
   * create carries no `createSession` member at all (the port's promise:
   * absent means absent), so the guard below is what makes "it cannot" and
   * "it failed" two different sentences -- and, on the success side, what
   * keeps "it started" and "you can see it" two different sentences too.
   */
  const createSession = useCallback(
    async (projectId: string, projectName: string) => {
      if (pendingAction !== null) {
        setStatus(
          `something else is still running — no new session in ${projectName}; try again in a moment`,
        );
        return;
      }
      const route = newSessionRoute(source);
      if (!route.ok) {
        setStatus(route.decline);
        return;
      }
      setPendingAction(projectId);
      // The first half of one sentence: this and the success below are a
      // sequence -- "starting…" then "started … it may take a moment to
      // appear" -- rather than two unrelated remarks about the same click.
      setStatus(`starting a new session in ${projectName}…`);
      try {
        await route.write.createSession?.(projectId, projectName);
        // The write resolves when the SESSION exists, not when the agent
        // inside it has registered where vam can see it -- `tmux new-session
        // -d` returns immediately. So the reload below very often comes back
        // without the new row, and the status has to say so: an operator who
        // was told the session is there and cannot see it reads a success as a
        // failure. vam has nothing to wait ON here (registration is the
        // agent's own, on its own schedule), so the honest sentence is the fix
        // rather than a poll.
        setStatus(`started a new session in ${projectName} — it may take a moment to appear`);
        if (source.kind === 'session') source.onWrote();
      } catch (cause) {
        setStatus(noteFailure('new session', cause));
      } finally {
        setPendingAction(null);
      }
    },
    [source, pendingAction],
  );

  /**
   * New PROJECT: choose a directory, then start a session in it.
   *
   * vam has no stored project — a project is a grouping of live sessions on
   * their cwd — so "create a project" can only mean this, and the project
   * exists afterwards because something is running there. Anything else would
   * be a control reporting it did something while nothing changed.
   *
   * Three refusals, in this order, and each returns before doing anything:
   * the source cannot create (so the picker never opens — an operator should
   * not choose a directory only to be told afterwards), there is no picker
   * (the browser build at 127.0.0.1:5275 has no Electron and therefore no
   * `showOpenDialog`), and nothing was chosen (cancel is an answer, not a
   * failure). Only past all three does anything spawn.
   */
  const newProject = useCallback(async () => {
    if (pendingAction !== null) {
      // OUT LOUD, like `removeProject` one screen up. A refused click that
      // says nothing is indistinguishable from a dead control.
      setStatus('something else is still running — nothing was started; try again in a moment');
      return;
    }
    const route = newSessionRoute(source);
    if (!route.ok) {
      // A refusal vam INTENDED. Recorded, because an operator who cannot see
      // why the control did nothing is still stuck -- but never as a failure.
      recordRefusal('new project', route.decline);
      setStatus(route.decline);
      return;
    }
    const choose = window.api?.dialog?.chooseDirectory;
    if (choose === undefined || route.write.createSessionIn === undefined) {
      setStatus('choosing a directory needs the desktop app — the browser build has no picker');
      return;
    }
    const createSessionIn = route.write.createSessionIn;
    // THE PENDING STATE STARTS AT THE DIALOG, not after it. The dialog is the
    // first await on this path, and it is the window a second click used to
    // land in: with nothing set, the guard above was false and the operator
    // got a second picker and a SECOND session in the same directory. It also
    // makes the `+` wear the action, which is the only thing on screen that
    // does -- a native dialog is the OS's feedback, not vam's, and it is gone
    // for the ~10s of spawning that follows it.
    setPendingAction(NEW_PROJECT_PENDING);
    setStatus('choosing a directory for a new session…');
    try {
      let cwd: string | null;
      try {
        cwd = await choose();
      } catch (cause) {
        setStatus(noteFailure('choose a directory', cause));
        return;
      }
      if (cwd === null) {
        setStatus('no directory chosen — nothing started');
        return;
      }
      const name = directoryName(cwd);
      // The first half of one sentence, exactly as `createSession` says it:
      // "starting…" here, "started … it may take a moment to appear" below.
      setStatus(`starting a new session in ${name}…`);
      try {
        await createSessionIn(cwd, name);
        setStatus(`started a new session in ${name} — it may take a moment to appear`);
        if (source.kind === 'session') source.onWrote();
      } catch (cause) {
        setStatus(noteFailure('new project', cause));
      }
    } finally {
      // Every path THIS `try` HAS -- the cancel, the picker's own failure,
      // the failed spawn and the success. The three refusals above return
      // before it and set no pending state to clear, which is why they are
      // above it rather than inside. A spinner still spinning after a failure
      // turns a clear one into an apparent hang.
      setPendingAction(null);
    }
  }, [source, pendingAction]);

  /** The caption both `+` controls wear: the refusal, or nothing to say. */
  const newSessionDecline = useMemo(() => {
    const route = newSessionRoute(source);
    return route.ok ? null : route.decline;
  }, [source]);

  /**
   * Keep the name the operator just typed. Local by design: `claude agents`
   * has no rename subcommand, so there is nothing upstream to call, and vam
   * does not write into the operator's own Claude Code state — see
   * `RenameChoice` in `prefs.ts`. An empty name clears the override and the
   * source's own title comes back, which is the undo.
   */
  const commitRename = useCallback(() => {
    const target = renameTarget;
    setRenamingId(null);
    setRenameTarget(null);
    if (target === null) {
      return;
    }
    savePrefs(setRename(prefs, target.source, target.sessionId, renameDraft, new Date()));
    setStatus(
      renameDraft.trim() === ''
        ? `"${target.title}" goes back to the name its source gives it`
        : `renamed to "${renameDraft.trim()}" — vam's own name for it, kept on this machine`,
    );
  }, [renameTarget, renameDraft, prefs, savePrefs]);

  const copyAllCommands = useCallback(async () => {
    const commands = focusedDecision?.commands ?? [];
    if (commands.length === 0) {
      setStatus('no command to copy');
      return;
    }
    const copied = await copyText(commands.map((c) => c.command).join('\n'));
    setStatus(
      copied ? `copied ${commands.length} commands` : `could not copy ${commands.length} commands`,
    );
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
    // The chord layer is OFF on a phone, not simulated: `hjkl` moves a cursor
    // that does not exist, `Mod-<digit>` resolves against panes that are not
    // drawn, and a soft keyboard fires `keydown` for ordinary typing behind a
    // focus guard already known to leak. An armed grammar there is how `x`
    // closes a session nobody meant to close.
    if (phone) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const typing = target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(target.tagName);
      // A Cmd/Ctrl chord is never text entry — no layout produces a character
      // from one — so a box that is capturing letters has no claim on it. That
      // matters for exactly the case the digit chords were added for: the
      // operator is in the prompt box, which is where the reason to look at
      // another tab comes from, so a shortcut dead there is dead. Unmodified,
      // everything still belongs to the box: the palette's filtering, the
      // search line, the prompt's `!` typeahead and its Enter and Escape.
      if (typing && !(event.metaKey || event.ctrlKey)) {
        return; // the palette, the search line and the prompt own their own keys
      }

      /**
       * A KEY SOMETHING ELSE HAS ALREADY ANSWERED IS NOT THIS GRAMMAR'S.
       *
       * The options list of an open question is a real widget with its own
       * `hjkl`, its own digits and its own Enter, and it calls
       * `preventDefault` on precisely the keys it handled. React dispatches at
       * its root container, which is BELOW this window listener, so by the
       * time a key arrives here the pane has already had its say — and this is
       * how the two cursor modes stay out of each other's way without either
       * side enumerating the other's keys.
       *
       * It is deliberately not `stopPropagation` on the other side. The list
       * handles some keys and not others, and the ones it does not handle
       * (`Escape`, `H`) are exactly the ways OUT of it: swallowing everything
       * would strand the keyboard in a list it could not leave.
       */
      if (event.defaultPrevented) {
        return;
      }

      // A bare modifier is a hand moving, not a keystroke. Letting it through
      // would abandon a half-typed chord the moment you reached for Cmd and
      // thought better of it.
      const key = normalizeKey(event);
      if (key === null) {
        return;
      }

      /**
       * One rule for every overlay, rather than one flag per overlay.
       *
       * While the palette, the key sheet or the settings overlay is on screen
       * it owns the keyboard: the canvas hears Escape and nothing else. Only
       * the palette used to be safe, and only by accident — it contains an
       * input, and the check above steps aside for inputs. The sheet and the
       * settings overlay contain none, so `j` moved a cursor nobody could see
       * and `zc` closed the canvas under the sheet that was describing it. Any
       * overlay added later inherits this by joining `overlayOpen`, which is
       * the point of writing it as one condition.
       *
       * Escape is the exception because it is the way out: `cancel` below is
       * what closes all three, and a full-screen overlay whose only exit was
       * the mouse would be a trap on a keyboard-first tool.
       *
       * Deliberately, a chord that OPENS an overlay does nothing while another
       * is open — `?` over settings leaves settings alone. Overlays are
       * full-screen, so stacking them hides the one underneath and makes
       * Escape ambiguous: you could no longer tell what one press would close.
       * Esc peels one layer at a time, and one layer is all there is.
       */
      if (overlayOpen && key !== 'Escape') {
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
          if (mode === 'insert' && (action.direction === 'down' || action.direction === 'up')) {
            // In the action pane the vertical axis belongs to the actions —
            // every command the step proposed, and the prompt last.
            const delta = action.direction === 'down' ? 1 : -1;
            setActionIndex((current) => clampIndex(current + delta, actions.length));
            return;
          }
          if (mode === 'insert' && action.direction === 'left') {
            setMode('select');
            return;
          }
          if (mode === 'insert') {
            // `right` — the fourth direction, and the one that had no branch.
            // Insert owns all of `hjkl` or none of it: while a question is
            // open the listbox handles `l` itself and this never runs, but
            // with no question open (or with the option cursor momentarily
            // off a button) `l` fell through to the spatial walk below and
            // moved the canvas cursor under the pane being read. That is the
            // "the keys work, they just do the wrong thing" failure the mode
            // naming exists to end, so the grammar closes it here rather than
            // leaving it to a DOM focus that can be dropped.
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
          // Live geometry, read now — not a list captured at render time —
          // over the WHOLE laid-out set, not only what the canvas draws.
          // `getNodes` returns what ReactFlow was given, which in the strip is
          // the focused session alone; navigating that would make `l` answer
          // "nothing lies right" at the edge of a cell while the sidebar still
          // lists the session sitting beside it. The strip narrows what is
          // drawn, never what the model holds, so the undrawn nodes fall back
          // to their laid-out rectangles — the same ones `layoutCanvas`
          // computed for them — and every other consumer's rule holds here too.
          const drawn = new Map(
            (getNodes() as unknown as FlowNodeLike[]).map((node) => [node.id, node]),
          );
          const live = toNavNodes(
            (initialNodes as unknown as FlowNodeLike[]).map((node) => drawn.get(node.id) ?? node),
            nodeIds,
          );
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
        case 'position': {
          /**
           * One digit, two meanings, and `pane` is what decides — the same
           * state the status-bar mode cell reads, deliberately not a second
           * notion of where focus is.
           *
           * In the response pane the digit is a TAB. Past the four that exist
           * it says so and stops: falling through to the sidebar would move a
           * cursor in a pane the operator is not looking at, which is the
           * failure this whole change is about, and silence would leave them
           * pressing it again. Refusing out loud is what the sidebar half
           * below already does for an out-of-range row.
           */
          if (mode === 'insert') {
            if (!visible.detail) {
              setStatus('the detail pane is hidden — z0 brings it back');
              return;
            }
            // THE DRAWN LIST, not the constant. A source with no terminal
            // has that tab withdrawn and everything after it moves up a
            // position, so indexing the constant opened a tab that was not
            // there -- accepted, then silently reverted to Response -- and
            // refused with a count the operator could see was wrong.
            const drawn = visibleTabs(terminalTab);
            const tab = drawn[action.digit - 1];
            if (tab === undefined) {
              setStatus(`only ${drawn.length} tab${drawn.length === 1 ? '' : 's'}`);
              return;
            }
            setTabRequest({ tab });
            return;
          }
          // `entries` is what the sidebar prints — filter, status pills and
          // all — so the digits count the rows the operator can see. Counting
          // the whole model would land the cursor somewhere nobody is looking.
          //
          // 9 is the LAST row whatever the count, the convention every browser
          // tab bar taught, and far more use than a ninth position once the
          // list outgrows nine.
          const target =
            action.digit === 9 ? entries[entries.length - 1] : entries[action.digit - 1];
          if (target === undefined) {
            // Refused out loud, and not clamped to the last row: a jump that
            // silently lands one short is worse than one that does not happen,
            // because you only find out by reading where you ended up.
            setStatus(
              entries.length === 0
                ? 'no session matches'
                : `only ${entries.length} session${entries.length === 1 ? '' : 's'} in view`,
            );
            return;
          }
          focusSession(target.session.id);
          return;
        }
        case 'project':
          stepSession(action.delta);
          return;
        case 'jump':
          setJumping(true);
          return;
        case 'copy':
          void copyAllCommands();
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
        case 'help':
          setKeySheetOpen(true);
          return;
        case 'palette':
          setPaletteOpen(true);
          return;
        case 'errorLog':
          setErrorLogOpen(true);
          return;
        case 'filterMenu':
          setFilterMenuOpen((open) => !open);
          return;
        case 'focusAction':
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          // The second half of the action-parity invariant: the cursor may
          // only enter a pane that is DRAWN. Without this, `I` sets 'action' on an
          // unmounted detail pane and every `j`/`k`/Enter after it walks and
          // fires actions nothing is showing.
          if (!visible.detail) {
            setStatus('the detail pane is hidden — z0 brings it back');
            return;
          }
          setMode('insert');
          setActionIndex(0);
          return;
        case 'focusList':
          setMode('select');
          setComposing(false);
          return;
        case 'rename':
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          if (focusedEntry.project.source === undefined) {
            setStatus('this project has no source — rename unavailable');
            return;
          }
          setRenameDraft(focusedEntry.session.title);
          setRenameTarget({
            source: focusedEntry.project.source,
            sessionId: focusedEntry.session.id,
            title: focusedEntry.session.title,
          });
          setRenamingId(focusedEntry.session.id);
          return;
        case 'icon':
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          openSessionIconPicker(focusedEntry);
          return;
        case 'close':
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          void closeSession(focusedEntry.session.id, focusedEntry.session.title);
          return;
        case 'newSession':
          // Real now: main starts a detached tmux session running `claude` in
          // the project's own directory. Which project is the focused
          // session's — with nothing focused there is no directory to use, and
          // vam will not pick one.
          if (focusedEntry === null) {
            setStatus('pick a session first — a new one is started in its project');
            return;
          }
          void createSession(focusedEntry.project.id, focusedEntry.project.name);
          return;
        case 'settings':
          setSettingsOpen(true);
          return;
        case 'revealProject':
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          setRevealRequest({ projectId: focusedEntry.project.id });
          return;
        case 'resizePane': {
          // Which pane owns the keyboard right now decides which one moves —
          // the same `pane` state `I`/`H` already set, nothing new (epic.md §4.5).
          const target: 'sidebar' | 'detail' = mode === 'insert' ? 'detail' : 'sidebar';
          // A width you cannot see change is a keypress that did nothing and
          // said nothing. The `I` guard above keeps the cursor off a hidden
          // detail pane, but the sidebar can be hidden under a cursor that is
          // legitimately on the list, so this one is not redundant.
          if (!visible[target]) {
            setStatus(`the ${target} pane is hidden — z0 brings it back`);
            return;
          }
          const step = action.delta * 24;
          savePrefs(setPaneWidth(prefs, target, prefs.panes[target] + step));
          return;
        }
        case 'resetPanes':
          // `z0` restores VISIBILITY as well as the two widths. It is the only
          // "put it back" key, and the person most likely to press it is the
          // one who just hid the wrong pane and cannot see the chord table any
          // more — so the narrow reading ("widths only") would answer that
          // person with a layout that still has a column missing, and set both
          // widths they cannot see while it did. Restoring the shipped layout
          // is one idea, not two.
          setMode('select');
          savePrefs(
            setPaneVisibility(
              setPaneWidth(
                setPaneWidth(prefs, 'sidebar', DEFAULT_PANES.sidebar),
                'detail',
                DEFAULT_PANES.detail,
              ),
              ALL_VISIBLE,
            ),
          );
          return;
        case 'layout': {
          const next = setLayout(prefs, action.name);
          const shown = next.paneVisibility;
          // Hiding the pane the keyboard is in strands the cursor in a pane
          // nothing draws — the same defect the `I` guard refuses, arriving
          // from the other side, so the layout has to move the focus itself.
          //
          // Both directions are live. Losing the detail pane sends the
          // keyboard back to 'list', the fallback the composer and Escape
          // already use. Losing BOTH the sidebar and the canvas is the same
          // problem mirrored: 'list' is drawn by those two — the row's focus
          // ring and the card's — so with neither on screen a list cursor is
          // pointing at nothing, and the only pane left is the one to be in.
          if (!shown.detail && mode === 'insert') {
            setMode('select');
            setComposing(false);
          } else if (!shown.sidebar && !shown.canvas && mode === 'select') {
            setMode('insert');
            setActionIndex(0);
          }
          savePrefs(next);
          return;
        }
        case 'prompt': {
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          // `i` means "type something into the thing I am pointing at", and
          // the prompt is now the only thing in this pane: the command rows it
          // used to land on went with the strip the operator asked to remove,
          // and their commands are offered by the `!` typeahead inside the
          // composer instead.
          //
          // AND IT ENTERS INSERT, which it did not before. Composing was its
          // own third name in the mode cell while the mode state stayed on
          // Select, so the bar said Select to an operator typing a prompt —
          // and `Mod+<digit>`, which reads the mode and is designed to work
          // from inside the box, moved a session instead of switching a tab.
          // Composing happens INSIDE Insert; there was never a third mode,
          // and `beginComposing` is the one place that says so.
          beginComposing();
          return;
        }
        case 'open': {
          if (mode !== 'insert') {
            setStatus('the full detail is already in the right panel');
            return;
          }
          // The prompt is the only action this pane has left, so Enter on it
          // opens the composer. It was a switch over the action kinds while a
          // command row was one of them.
          if (actions[clampIndex(actionIndex, actions.length)] !== undefined) {
            beginComposing();
          }
          return;
        }
        case 'cancel':
          // Esc peels one layer at a time and always ends up back in the list —
          // there is never a state you cannot press Esc out of.
          setJumping(false);
          setPaletteOpen(false);
          setKeySheetOpen(false);
          setSettingsOpen(false);
          setFilterMenuOpen(false);
          setFiltering(false);
          setComposing(false);
          setRenamingId(null);
          setPickingIconFor(null);
          setMode('select');
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
    phone,
    focusedId,
    focusedEntry,
    focusedSessionId,
    nodeIds,
    initialNodes,
    entries,
    getNodes,
    jumping,
    labels,
    matches,
    query,
    copyAllCommands,
    beginComposing,
    closeSession,
    createSession,
    stepSession,
    focusSession,
    mode,
    actionIndex,
    actions,
    prefs,
    savePrefs,
    terminalTab,
    visible,
    overlayOpen,
    openSessionIconPicker,
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

  /**
   * The two panels’ props, lifted out of the JSX.
   *
   * A mechanical extraction with no behaviour of its own: the phone shell
   * (`PhoneShell`) is handed the SAME two objects the columns are built from,
   * so there is one assembly of each panel’s props and not a second one that
   * could drift from it.
   */
  const sidebarProps: ComponentProps<typeof SessionList> = {
    // The line at this column's top edge, off the SAME `mode` the status
    // bar's word reads. A hidden column is not rendered at all, so
    // "every shown column Select is drawn in" needs no second test
    // against `visible` here -- the slot already is that test.
    keyboardHere: mode === 'select',
    entries: entries,
    // The UNFILTERED set, for the two things about removing a project
    // that must not read a narrowed list -- see `allEntries` on
    // `SessionListProps`. `entries` above has already been through
    // search, the status pills and the origin rules.
    allEntries: allEntries,
    focusedSessionId: focusedEntry?.session.id ?? null,
    workspace: 'black-smith',
    theme: effective,
    onToggleTheme: () => savePrefs(setTheme(prefs, effective === 'dark' ? 'light' : 'dark')),
    onOpenFilter: () => {
      searchOrigin.current = focusedId;
      setFiltering(true);
    },
    filter: query,
    filtering: filtering,
    onFilterChange: (next) => {
      setQuery(next);
      // incsearch: the answer arrives while you type, not after you
      // commit. Without it the list narrows under a focus ring that is
      // still pointing at a row the filter just removed.
      const first = searchMatches(allEntries, next)[0];
      if (first !== undefined) {
        focusSession(first);
      }
    },
    statusFilter: statusFilter,
    onStatusFilter: setStatusFilter,
    statusTally: {
      all: tally.all,
      running: tally.running,
      waiting: tally.waiting,
      done: tally.done,
      failed: tally.failed,
    },
    filterMenuOpen: filterMenuOpen,
    onFilterMenuToggle: setFilterMenuOpen,
    originFilters: prefs.filters,
    onOriginFilters: (next) => savePrefs(setSessionFilters(prefs, next)),
    hiddenCounts: hiddenCounts,
    onFilterCommit: () => setFiltering(false),
    onFilterCancel: () => {
      setFiltering(false);
      setQuery('');
      setFocusedId(searchOrigin.current);
    },
    renamingId: renamingId,
    renameDraft: renameDraft,
    onRenameChange: setRenameDraft,
    onRenameCommit: commitRename,
    onRenameCancel: () => {
      setRenamingId(null);
      setRenameTarget(null);
    },
    onPick: (sessionId) => {
      focusSession(sessionId);
      setMode('select');
    },
    onClose: (sessionId) => {
      // The row's title, not the id: the same sentence the keyboard
      // path writes, about the same session.
      const entry = allEntries.find((e) => e.session.id === sessionId);
      void closeSession(sessionId, entry?.session.title ?? sessionId);
    },
    onAdd: () => {
      // The footer strip names no project, so it uses the focused
      // session's, exactly as `o` does — the two controls are one path.
      if (focusedEntry === null) {
        setStatus('pick a session first — a new one is started in its project');
        return;
      }
      void createSession(focusedEntry.project.id, focusedEntry.project.name);
    },
    onAddInProject: (project) => void createSession(project.id, project.name),
    pendingAction: pendingAction,
    // The group layer. `model.groups` rather than the filtered model's,
    // because the only thing this prop is for is a group holding no live
    // project -- see the prop -- and a filter cannot narrow one further.
    groups: model.groups ?? [],
    collapsedGroups: collapsedGroups,
    onToggleGroupCollapse: toggleGroupCollapse,
    onCreateGroup: createNewGroup,
    onRenameGroup: renameOneGroup,
    onPickGroupIcon: (group) => {
      const source = groupSource(prefs.groups, group.id);
      if (source === null) return;
      setPickingGroupIconFor((current) =>
        current !== null && current.groupId === group.id
          ? null
          : { source, groupId: group.id, name: group.name },
      );
    },
    onUngroup: ungroup,
    onAddToGroup: (group) => {
      const source = groupSource(prefs.groups, group.id);
      if (source === null) return;
      setPickingMembersFor({ source, groupId: group.id, name: group.name });
    },
    hiddenProjects: hiddenProjects,
    // Restoring is the only thing the sidebar asks for by itself: it
    // ends nothing, so there is nothing to serialise or refuse.
    onHideProject: setProjectRemoved,
    onRemoveProject: (project, plan) => void removeProject(project, plan),
    revealRequest: revealRequest,
    onNewProject: () => void newProject(),
    newSessionDecline: newSessionDecline,
    onPickIcon: (project: Project) => {
      // Same refusal as the session picker (§ above): a project with no
      // source has no bucket to store under, and guessing one would
      // reintroduce the cross-source collision AC-1 removed.
      if (project.source === undefined) {
        setStatus('this project has no source — icon unavailable');
        return;
      }
      const projectSource = project.source;
      setPickingProjectIconFor((current) =>
        current !== null && current.projectId === project.id && current.source === projectSource
          ? null
          : { source: projectSource, projectId: project.id, name: project.name },
      );
    },
    onSettings: () => setSettingsOpen(true),
    width: sidebarWidth,
    resizeHandle: (
      <PaneResizer
        pane="sidebar"
        ariaLabel="resize sessions panel"
        layout={visible}
        stored={{ sidebar: storedSidebar, detail: storedDetail }}
        viewportWidth={viewportWidth}
        onChange={onPaneChange}
        onCommit={onPaneCommit}
      />
    ),
  };

  const detailProps: ComponentProps<typeof DetailPanel> = {
    entry: focusedEntry,
    decision: focusedDecision,
    delivers: source.kind === 'session' && source.source.capabilities.deliverPrompt,
    // The bridge the question card answers through. Passed beside
    // `delivers` because the two are read together: a source that
    // declares delivery and a shell that has no main process behind it
    // are both reasons to draw no Submit at all. `undefined` in the
    // browser build.
    answer: globalThis.window?.api?.terminal?.answer,
    // The flag the source declares, finally read. `false` withdraws the
    // tab rather than mounting one that can only apologise.
    terminal: terminalTab,
    // The flag has guarded double-submit here since the composer was
    // written; the pane never saw it, so a two-minute `claude --resume`
    // looked like Enter doing nothing.
    sending: writing,
    tabRequest: tabRequest,
    // Opaque both ways: the store never learns the tab names, and the
    // guard keeps the pane's mount-time report from being a write.
    initialTab: prefs.detailTab,
    onTabChange: (next) => {
      if (next !== prefs.detailTab) {
        savePrefs(setDetailTab(prefs, next));
      }
    },
    draft: draft,
    onDraftChange: setDraft,
    onSubmit: sendPrompt,
    active: mode === 'insert',
    actionIndex: actionIndex,
    composing: composing,
    // The mouse route into the box, and the same function the `i` route
    // uses -- a focus that entered the composer without entering Insert
    // is the divergence this call closes.
    onCompose: beginComposing,
    onStopComposing: () => {
      setComposing(false);
      setDraft('');
      // Escape out of the composer returns the keyboard to the SIDEBAR,
      // which is the pane the operator asked to get back to. Without
      // this, a prompt opened with `I` leaves `mode === 'insert'`, so
      // the blur hands the keys back to a window where `j`/`k` walk the
      // detail pane's actions instead of the session list — the keys
      // work, they just do the wrong thing, which is worse than being
      // swallowed. The `i` path already sat on 'list' and was unaffected,
      // which is why this only ever bit one of the two entry points.
      setMode('select');
    },
    width: detailWidth,
    /* Only where it would move something. The detail pane is a fixed
       column with the leftover room beside it exactly while the canvas
       is the main column; everywhere else its width is derived from the
       sidebar and the canvas's reserve, so its own edge has nothing to
       drag and the seam that does move is the sidebar's. A handle that
       moves nothing is worse than no handle: it advertises a gesture the
       layout cannot honour. */
    resizeHandle: canvasIsMain(visible) ? (
      <PaneResizer
        pane="detail"
        ariaLabel="resize detail panel"
        layout={visible}
        stored={{ sidebar: storedSidebar, detail: storedDetail }}
        viewportWidth={viewportWidth}
        onChange={onPaneChange}
        onCommit={onPaneCommit}
      />
    ) : null,
  };

  // Read once per render, from the bindings in force. `null` means the
  // operator unbound `help`, and the status bar then prints no key at all.
  const helpChord = primaryChord({ kind: 'help' });

  return (
    // `vam-phone` is the hook the OVERLAYS hang off: they are siblings of the
    // shell rather than children of it, so `[data-phone-shell]` cannot reach
    // them and this class on the common root can. It is set from the same
    // derived breakpoint, never from a second media query with the number
    // written out again.
    <div className={`relative flex h-full flex-col ${phone ? 'vam-phone' : ''}`}>
      {/* Named none of them on a phone: `Columns` renders by order, so a
          column the order does not name is never created -- which is what
          "unmounted" has to mean for a pane that is measured, focused and
          queried. The phone shell below takes their place. */}
      <Columns order={phone ? [] : order}>
        <SidebarSlot key="sidebar" show={visible.sidebar} {...sidebarProps} />

        <CanvasColumn
          key="canvas"
          show={visible.canvas}
          strip={canvasStrip}
          keyboardHere={mode === 'select'}
        >
          {/* The toolbar is chrome inside a column, not a column: hidden rather
              than unmounted in the strip, where 300px has no room for a source
              readout and four filters. The unmount rule this file argues for
              elsewhere is about PANES — things that are measured, focused and
              queried — and keeping the source line mounted keeps its polling
              exactly as it was in every other layout. */}
          <div
            className={`flex h-12 flex-none items-center gap-[9px] border-line border-b px-3.5 ${canvasStrip ? 'hidden' : ''}`}
          >
            <span className="shrink-0 font-medium text-[13px] text-ink">Canvas</span>
            <span className="mx-1 h-3.5 w-px shrink-0 bg-line-strong" />

            <SourceReadout source={source} />

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
              {/* Zoom and fit take no `action`: the grammar has no zoom
                  chord, and a tip must not invent one. */}
              <ShortcutTip label="Zoom out">
                <button
                  type="button"
                  aria-label="zoom out"
                  onClick={() => zoomOut()}
                  className="flex h-full w-[26px] cursor-pointer items-center justify-center hover:text-ink"
                >
                  −
                </button>
              </ShortcutTip>
              <span className="flex h-full items-center border-line border-r border-l px-1.5 font-mono text-[10px] text-ink">
                {zoomPct}%
              </span>
              <ShortcutTip label="Zoom in">
                <button
                  type="button"
                  aria-label="zoom in"
                  onClick={() => zoomIn()}
                  className="flex h-full w-[26px] cursor-pointer items-center justify-center hover:text-ink"
                >
                  +
                </button>
              </ShortcutTip>
            </div>

            <ShortcutTip label="Fit the whole canvas in view">
              <button
                type="button"
                aria-label="fit view"
                onClick={() => fitView()}
                className="flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-line px-2.5 font-mono text-[10px] text-ink-dim hover:text-ink"
              >
                <Maximize size={13} strokeWidth={1.6} aria-hidden="true" />
              </button>
            </ShortcutTip>
          </div>

          <div className="relative min-h-0 flex-1">
            <ReactFlow
              nodes={drawnNodes}
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
                  session cell in that session's status colour. The mockup's
                  viewport outline is the one measurement not reproduced — see
                  the note on `maskColor` below. `nodeStrokeWidth` is in flow
                  units, not pixels, where 1px is ~26 at this scale, so the
                  mockup's bordered chip is drawn as a filled one instead — at
                  8px wide the fill is what carries the colour anyway. */}
              <MiniMap
                pannable
                zoomable
                ariaLabel="canvas minimap"
                // The spotlight is a DIMMED OUTSIDE and NOTHING ELSE — no
                // `maskStrokeColor`, no `maskStrokeWidth`. An outline draws a
                // rectangle around the visible area, and when that area is
                // wider than the content — the normal case at any ordinary
                // zoom — its top and bottom edges fall outside the map. Only
                // the two vertical edges survive, and they read as two bright
                // rules cut off down the sides, not as a rectangle.
                //
                // This has now been removed TWICE: once with the outline in the
                // ink colour, and again after it was re-added in a quieter line
                // tone on the argument that a softer tone would read as the
                // edge of the lit area. It does not. The tone was never the
                // problem — the geometry is, and no colour fixes a rectangle
                // whose horizontal edges are off-canvas. Please do not
                // re-litigate it a third time; masking outside says the same
                // thing with no lines at all and degrades correctly, dimming
                // nothing when everything is visible. The absence is guarded
                // by `test/canvas/Canvas.minimap.test.tsx`, so re-adding
                // either prop fails a test rather than shipping.
                maskColor="color-mix(in srgb, var(--color-canvas) 66%, transparent)"
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
                className={`!bottom-3 !right-3 !m-0 !rounded-[8px] !border !border-line !bg-sunken ${canvasStrip ? 'hidden' : ''}`}
                nodeColor={minimapChipColor}
              />
            </ReactFlow>
          </div>
        </CanvasColumn>

        <DetailSlot key="detail" show={visible.detail} {...detailProps} />
      </Columns>

      {phone && (
        <PhoneShell
          sidebar={sidebarProps}
          detail={detailProps}
          sourceReadout={<SourceReadout source={source} />}
          // A read-only server registers no write routes at all, so the box is
          // withdrawn rather than drawn and refused. Only a `session` source
          // can say; the demo and live sources both record.
          records={source.kind !== 'session' || source.source.capabilities.recordPrompt}
          failureCount={failureCount}
          onOpenErrorLog={() => setErrorLogOpen(true)}
          // The SAME cell the desktop bar draws, not a second rendering of the
          // same string: `StatusCell` shortens and carries the whole message
          // on its tooltip, and a phone-only copy would drift from it.
          statusCell={status === null ? null : <StatusCell text={status} />}
          tally={tally}
          declines={source.kind === 'session' ? source.source.declines : {}}
        />
      )}

      {/* Moved out of the canvas column when the canvas became hideable: the
          palette is a window overlay, not part of the graph, and left inside
          that column `Mod-k` opened a palette nothing could draw in either of
          the two layouts that hide the canvas. It sits with the other overlays
          now, over whichever columns are on screen. */}
      {/* Same reason as the palette above: `?` in a layout that hides the
          canvas would otherwise open a sheet nothing could draw. */}
      {keySheetOpen && <KeySheet onClose={() => setKeySheetOpen(false)} />}

      {/* Same reason as the sheet above, and one more of its own: the log is
          opened FROM the status bar, so it must be able to draw over whatever
          the layout is showing at the time. */}
      {errorLogOpen && <ErrorLogPanel onClose={() => setErrorLogOpen(false)} />}

      {/* Same reason again: settings is a window overlay, so it sits with the
          palette and the sheet rather than inside the canvas column. */}
      {settingsOpen && (
        <SettingsOverlay
          prefs={prefs}
          theme={effective}
          onChange={savePrefs}
          onClose={() => setSettingsOpen(false)}
        />
      )}

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

      {pickingMembersFor !== null && (
        <ProjectPicker
          groupName={pickingMembersFor.name}
          choices={memberChoices}
          onToggle={(projectId, member) => {
            const name = memberChoices.find((choice) => choice.id === projectId)?.name ?? projectId;
            savePrefs(
              member
                ? // MOVES it, at most one group per project: a project in two
                  // groups walks its sessions twice and mints duplicate
                  // `info:<sessionId>` node ids, which break ReactFlow and the
                  // id `j`/`k` navigates by (`to-canvas.ts:312`).
                  addProjectToGroup(
                    prefs,
                    pickingMembersFor.source,
                    pickingMembersFor.groupId,
                    projectId,
                  )
                : removeProjectFromGroup(
                    prefs,
                    pickingMembersFor.source,
                    pickingMembersFor.groupId,
                    projectId,
                  ),
            );
            setStatus(
              member
                ? `${name} → ${pickingMembersFor.name}`
                : `${name} left ${pickingMembersFor.name} — it is back at the top level`,
            );
          }}
          onClose={() => setPickingMembersFor(null)}
        />
      )}

      {pickingGroupIconFor !== null && (
        <IconPicker
          title={pickingGroupIconFor.name}
          onPick={(icon) => {
            savePrefs(
              setGroupIcon(prefs, pickingGroupIconFor.source, pickingGroupIconFor.groupId, icon),
            );
            setStatus(
              icon === ''
                ? 'icon cleared — kept on this machine, never in the event log'
                : `${icon} — kept on this machine, never in the event log`,
            );
            setPickingGroupIconFor(null);
          }}
          onClose={() => setPickingGroupIconFor(null)}
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

      {/* Not drawn on a phone. Its mode cell names Select/Insert, which do
          not exist there, and its usage bars read a `window.api` a browser
          does not have -- a bar that is always empty and a cell reporting a
          state nothing can change. The phone shell draws its own bar with the
          two things that survive. */}
      {/* Named cells, not positional ones. There are three `<footer>`s in this
          tree now and a query that counted on order would silently start
          reading the sidebar's. */}
      {!phone && (
        <footer
          data-status-bar
          className="flex h-8 flex-none items-center gap-3 border-line border-t bg-sidebar px-3 font-mono text-[10px] text-ink-faint"
        >
          {/* The mode indicator is not in the mockup, and it stays: ADE is a
              mouse-and-keyboard app, vam is a modal one, and a modal app that
              does not say which mode it is in is the single worst thing a modal
              app can be. */}
          <span data-mode className="font-semibold text-ink">
            {/* JUMP and FILTER are transient — a key is being awaited — so they
                outrank the resting mode and keep their own names. Underneath
                them there are exactly two, and they are the operator's words:
                Select and Insert. `PROMPT` is gone as a third name because it
                never was one: composing happens INSIDE Insert, and printing it
                as a peer of the other two implied a mode the grammar has no
                state for. */}
            {jumping ? 'JUMP' : filtering ? 'FILTER' : MODE_TITLES[mode]}
          </span>
          {/* The `project/session` cell that used to sit here is gone at the
              operator's request: the slash between a project and a session made
              the pair read as a git ref, and the sidebar row, the canvas card
              and the detail header all already say which session the keyboard
              is on. The REAL branch displays -- the sidebar row's and the
              card's -- are untouched; only this restatement is gone. */}
          <SourceGlyph
            source={
              focusedEntry === null
                ? null
                : (focusedEntry.session.source ?? focusedEntry.project.source ?? null)
            }
          />

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
          {usage.windows !== null && (
            <span className="flex items-center gap-2">
              {/* Five hours first: it is the window that moves minute to minute. */}
              <UsageBar label="5h" usageWindow={usage.windows.fiveHour} high={usage.highUsage} />
              <UsageBar label="7d" usageWindow={usage.windows.sevenDay} high={usage.highUsage} />
            </span>
          )}

          {/* The session tallies and the project count are gone at the
              operator's request: "statusbar khong can list so session va
              session status". Every one of those numbers is already on screen
              as the thing it counts -- the sidebar's filter counts, the cards
              on the canvas -- so the bar was restating a view of itself.
              `tally` itself stays: the sidebar's filter counts read it. */}

          {status !== null && <StatusCell text={status} />}

          {/* The way back to a failure that has already scrolled past. A status
              line lives until the next status replaces it, which in practice is
              seconds; before this cell existed the only record of a `cli-failed`
              was whatever the operator managed to read. Hidden entirely while
              nothing has broken -- a permanent `0` is noise. */}
          {failureCount > 0 && (
            <ShortcutTip label="Open the error log" action={{ kind: 'errorLog' }}>
              <button
                type="button"
                data-error-log-button
                onClick={() => setErrorLogOpen(true)}
                className="rounded-[4px] border border-line-strong px-1.5 py-px text-failed"
              >
                {failureCount} {failureCount === 1 ? 'failure' : 'failures'}
              </button>
            </ShortcutTip>
          )}

          <span className="flex-1" />
          {/* The right-hand end is one cell wide, again at the operator's
              request: "Phan ben phai status bar, chi de `?` keyboard shortcut
              thoi". The budget cell that used to sit here went with the rest.
              The key itself is READ from the bindings in force, not printed:
              `?` is only the shipped default for `help`, and an operator who
              moves it would otherwise be left staring at the most prominent
              hint in the chrome naming a key bound to nothing. Gone entirely
              when they unbind it, because a caption for no key is worse. */}
          <span className="flex items-center gap-1.5">
            {/* A tag rather than loose text: the key has to read as something
                you press, which is what a bordered cap does and a bare glyph
                does not. The label beside it makes the sheet discoverable to
                someone who does not already know it is there.
                `primaryChord` rather than `InlineChord` for one reason: this
                cell carries `data-keysheet-hint`, which the status-bar tests
                query, and the chip component takes no marker. */}
            {helpChord !== null && (
              <span
                data-keysheet-hint
                className="rounded-[4px] border border-line-strong px-1.5 py-px text-ink-dim"
              >
                {helpChord}
              </span>
            )}
            Keyboard shortcut
          </span>
        </footer>
      )}
    </div>
  );
}

/**
 * One usage window as a few pixels of fill: which window it is, and how much of
 * it is spent.
 *
 * `percent` is ALREADY a percentage (40.0 means 40%), so the width is that
 * number verbatim -- nothing here divides or multiplies it into a second
 * interpretation. It is clamped only because the endpoint is undocumented and
 * a figure past 100 would otherwise paint outside the track.
 *
 * A window the reader could not parse draws nothing rather than an empty
 * track: the same reason `describeUsage` hands over `null` windows for an
 * unknown or stale snapshot, at which point this component is never reached.
 *
 * The fill colour comes from `describeUsage().highUsage` and from no second
 * threshold of its own, so the bar and the text beside it cannot disagree
 * about what counts as high.
 */
function UsageBar({
  label,
  usageWindow,
  high,
}: {
  readonly label: string;
  readonly usageWindow: UsageWindow;
  readonly high: boolean;
}) {
  if (usageWindow.kind !== 'known') {
    return null;
  }
  return (
    <span className="flex items-center gap-1">
      <span className="text-ink-ghost">{label}</span>
      <span className="h-1 w-8 overflow-hidden rounded-sm bg-line-strong">
        <span
          data-usage-bar={label}
          className={`block h-full ${high ? 'bg-failed' : 'bg-ink-dim'}`}
          style={{ width: `${Math.min(100, Math.max(0, usageWindow.percent))}%` }}
        />
      </span>
    </span>
  );
}

/**
 * Which system the focused session came from -- a real, varying fact, not a
 * decoration: `Session.source` is what the Claude Code reader stamps on every
 * row, `Project.source` is what the factory adapter stamps instead, and a
 * model assembled without either says nothing here rather than borrowing a
 * glyph it has not earned.
 *
 * A source id is a free string (the registry validates it, this file does
 * not), so an id nobody here has drawn an icon for still gets one — the
 * generic box — and its name in words either way.
 */
/**
 * The vam-native sources. These are concepts rather than companies -- the
 * factory, the sample fixture -- so they are drawn in the app's own visual
 * language rather than with a borrowed brand mark. `claude-code` is NOT here
 * any more: it names a real product, and `PROVIDER_MARKS` carries its actual
 * mark, which says more at eleven pixels than a generic terminal glyph did.
 */
/**
 * Which source an entry belongs to, as a key a stored pointer can be matched
 * on. The same `session.source ?? project.source` order the glyph reads, for
 * its reason -- the two readers stamp different halves of the model -- and `''`
 * for an entry that carries neither, which is a consistent key rather than a
 * claim: it is written and matched by the same expression, so a sourceless
 * model still remembers its focus and still cannot collide with a named source.
 */
function sourceKeyOf(entry: SessionEntry): string {
  return entry.session.source ?? entry.project.source ?? '';
}

const SOURCE_ICON: Readonly<Record<string, LucideIcon>> = {
  'black-smith': Factory,
  'bundled-sample': FlaskConical,
};

function SourceGlyph({ source }: { readonly source: SourceId | null }) {
  if (source === null || source === undefined || source === '') {
    return null;
  }
  // Three registers, in order, and the order is the point: a real provider's
  // own mark; else vam's own glyph for one of vam's own sources; else the
  // neutral box. The last is the honest answer to a source nobody has drawn --
  // a shape that claims nothing, never another provider's logo and never a
  // blank. `data-source-mark` records WHICH register answered, so the fallback
  // is an assertable outcome rather than an invisible default.
  const mark = PROVIDER_MARKS[source];
  const Native = SOURCE_ICON[source];
  const register = mark !== undefined ? 'brand' : Native !== undefined ? 'native' : 'neutral';
  const Icon = Native ?? Box;
  return (
    <Note text={`this session comes from ${source}`}>
      {/* `role="img"` is load-bearing: `aria-label` on a roleless span is
          ignored, and the icon itself is hidden. */}
      <span
        data-status-source={source}
        data-source-mark={register}
        role="img"
        aria-label={`source: ${source}`}
        className="flex items-center text-ink-dim"
      >
        {mark === undefined ? (
          <Icon size={11} strokeWidth={1.6} aria-hidden="true" />
        ) : (
          <mark.Glyph size={11} />
        )}
      </span>
    </Note>
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
      {/* One tooltip group for the whole chrome: once one is open, the button
          beside it opens with no second delay. */}
      <TipProvider>
        <CanvasInner model={model} source={source} />
      </TipProvider>
    </ReactFlowProvider>
  );
}
