/**
 * The two-pane shell, and the one place a keypress becomes a move.
 *
 *     [ sessions ] [ —— tabs —— / detail + answer ]
 *
 * 0.2 migration, A12.1: the middle canvas column is gone. There are exactly
 * two panes now — the sidebar, and the detail pane, which fills everything
 * to the sidebar's right. A tab IS that session's detail pane: `TabStrip`
 * (below) draws a VSCode-shaped strip along the TOP of the detail pane, not
 * a strip above a separate middle column, and selecting a tab shows that
 * session's `DetailPanel` filling the rest of the same pane.
 *
 * A13.1: the strip shows one PROJECT's sessions, not every session vam
 * knows about (`SessionEntry.project` — the sidebar's grouping level, not
 * `Group`). "The active project" is the focused session's project; with
 * nothing focused (a genuinely empty filtered view) there is no project to
 * scope by and the strip is empty. See `activeProjectId` below.
 *
 * The chord grammar still lives in `keyboard/chords.ts`; what used to live
 * beside it in `keyboard/spatial-nav.ts` and `canvas/nav-nodes.ts` (the
 * coordinate maths `h`/`l` used to walk a session's own chain of steps) was
 * deleted with the graph in step 2 — `h`/`l` walk the active project's tabs
 * instead. See the `move` case of `onKeyDown` below.
 *
 * **One focus, two views.** The sidebar and the detail pane both read the
 * same `focusedSessionId`; neither owns a cursor of its own. That is why `j`
 * does not have to mean something different depending on which pane you are
 * "in" — there is no such thing as being in a pane. `j`/`k` walk the
 * sidebar's own order, one session at a time. Nothing had to be added for
 * the sidebar: it mirrors the same id, and the tab strip's `activeId` is
 * that same id again.
 */

import { Box, Factory, FlaskConical, type LucideIcon, Plus } from 'lucide-react';
import {
  type ComponentProps,
  type DragEvent as ReactDragEvent,
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
import {
  countTurnsWithInput,
  type PendingPrompt,
  reconcile,
  withPending,
} from '../domain/optimistic.js';
import { cycleMatch, searchMatches } from '../domain/search.js';
import type { SessionEntry } from '../domain/selectors.js';
import { orderedSessions } from '../domain/selectors.js';
import type { SessionFilters, StatusFilter } from '../domain/session-filter.js';
import { isAgentStarted, isHiddenByOriginFilters, isUnprompted } from '../domain/session-filter.js';
import { ErrorLogPanel } from '../errors/ErrorLogPanel.js';
import { loggedEvents, noteFailure, recordRefusal, subscribeEvents } from '../errors/log.js';
import { DEMO_PROMPT } from '../fixtures/demo.js';
import { type ChordState, EMPTY_CHORD, normalizeKey, resolveChord } from '../keyboard/chords.js';
import { type CursorMode, MODE_TITLES } from '../keyboard/keysheet.js';
import { primaryChord, ShortcutTip, TipProvider } from '../keyboard/ShortcutTip.js';
import { buildActions, clampIndex } from '../panels/actions.js';
import { CommandPalette } from '../panels/CommandPalette.js';
import { ConfirmForceClose } from '../panels/ConfirmForceClose.js';
import { copyText } from '../panels/clipboard.js';
import { DetailPanel, type Tab as DetailTab } from '../panels/DetailPanel.js';
import { GroupPicker, type GroupPickerChoice } from '../panels/GroupPicker.js';
import { IconPicker } from '../panels/IconPicker.js';
import { KeySheet } from '../panels/KeySheet.js';
import { Note } from '../panels/Note.js';
import { PaneResizer } from '../panels/PaneResizer.js';
import { type ProjectChoice, ProjectPicker } from '../panels/ProjectPicker.js';
import type { RemovalPlan } from '../panels/remove-project.js';
import { NEW_PROJECT_PENDING, SessionList } from '../panels/SessionList.js';
import { resolveSessionGlyph } from '../panels/session-icon.js';
import { visibleTabs } from '../panels/tabs.js';
import { PhoneShell } from '../phone/PhoneShell.js';
import { usePhoneViewport } from '../phone/viewport.js';
import { type FocusCandidate, resolveFocusNodeId } from '../prefs/focus.js';
import { ALL_VISIBLE, DEFAULT_PANES, layoutWidths, PANE_RESIZE_STEP } from '../prefs/panes.js';
import {
  addProjectToGroup,
  applyIcons,
  applyPalette,
  applyRenames,
  applyTheme,
  browserStorage,
  createGroup,
  deleteGroup,
  type EffectiveTheme,
  type FocusChoice,
  isGroupCollapsed,
  isProjectHidden,
  type Prefs,
  paletteFor,
  readPrefs,
  removeProjectFromGroup,
  renameGroup,
  setDefaultProvider,
  setDetailTab,
  setGroupCollapsed,
  setGroupIcon,
  setIcon,
  setLastFocus,
  setPaneVisibility,
  setPaneWidth,
  setProjectHidden,
  setProjectIcon,
  setProjectRename,
  setRename,
  setSessionFilters,
  setTheme,
  type Theme,
  watchOsTheme,
  writePrefs,
} from '../prefs/prefs.js';
import { SettingsOverlay } from '../settings/SettingsOverlay.js';
import type { SectionId } from '../settings/sections.js';
import { canWriteTo, type SessionSource, type SourceWrites } from '../sources/port.js';
import { PROVIDER_MARKS } from '../sources/provider-marks.js';
import { type CanvasSource, READ_ONLY_SOURCE } from '../sources/source.js';
import {
  closePane,
  type Edge,
  findLeaf,
  type Leaf,
  leaves,
  nearestEdge,
  pruneClosedTabs,
  removeTab,
  restoreLayout,
  type SplitOrientation,
  type SplitTree,
  setPaneSession,
  singlePane,
  splitPane,
  stepPane,
} from './split.js';

/** `model.groups ?? []` on every render is a fresh reference each keystroke,
 *  defeating `SessionList`'s memo -- a module-level constant keeps this a
 *  stable reference across renders. */
const EMPTY_GROUPS: readonly Group[] = [];

/** Home-row first: the labels you can hit without looking. */
const JUMP_KEYS = 'asdfghjkl;qwertyuiop';

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
    return { ok: false, decline: 'the factory has no new-session command' };
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

/**
 * Whether a rejected `closeSession` offers the confirmed kill route -- the
 * source's own `SourceError.forcible`, and nothing this reads guesses at it:
 * a plain `Error`, a string, or a refusal with the field absent all answer
 * `false`, which is the safe default for a signal this destructive.
 */
function isForcible(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'forcible' in cause &&
    (cause as { forcible?: unknown }).forcible === true
  );
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
 * A hidden pane's children are still BUILT (JSX is evaluated at the call
 * site) — they are plain element objects, never rendered, so nothing in them
 * mounts, subscribes or measures.
 */
function SidebarSlot({ show, ...props }: ComponentProps<typeof SessionList> & { show: boolean }) {
  return show ? <SessionList {...props} /> : null;
}

/**
 * The detail pane's own column: the tab strip along its top edge, and
 * `DetailPanel` filling the rest — A12.1's "a tab IS that session's detail
 * pane", not a strip above a separate column.
 *
 * `width` is applied HERE, on the wrapper, not on `DetailPanel` (which is
 * handed `width={undefined}` and fills via its own `w-full`, the same
 * contract `PhoneShell` already relies on) — one width, in one place, so the
 * toolbar above `DetailPanel` cannot render a different width than the pane
 * below it.
 *
 * `DetailPanel` is still mounted only while `show` is true, for the same
 * "unmounted is not display:none" reason `SidebarSlot` gives: it opens with
 * hooks, so an early return inside it would be a conditional hook, and a
 * wrapper is what keeps this a real unmount rather than a hidden pane still
 * measured and still findable by every query that should now miss it.
 */
function DetailColumn({
  show,
  width,
  children,
}: {
  readonly show: boolean;
  readonly width: number;
  readonly children: ReactNode;
}) {
  return show ? (
    <div data-detail-pane className="relative flex min-w-0 flex-col" style={{ width }}>
      {children}
    </div>
  ) : null;
}

/** A15.2: the strip is chrome, not content — `h-9` (36px) is the shortest
 *  height that still keeps an 11px tab label and its icon clear of the row's
 *  own top/bottom edge (see `TabStrip`'s own `py-1`). A15.5 moved this row
 *  out of `DetailColumn` and INTO each pane: one strip per pane is the whole
 *  point, and a row above the split layout could only ever draw one. */
function TabStripRow({ children }: { readonly children: ReactNode }) {
  return (
    <div
      data-tab-strip-row
      className="flex h-9 flex-none items-stretch gap-[9px] border-line border-b px-1.5"
    >
      {children}
    </div>
  );
}

/**
 * The session tab strip — VSCode-shaped: one tab per session in the active
 * project (A13.1), click to switch, `×` to close.
 *
 * `×` closes the SESSION, exactly what the sidebar row's own `×` and the `x`
 * chord do (A11.3: "a tab that cannot be closed independently of its
 * session makes it meaningless. One action, two keys.") — decision 6's
 * lighter "close the tab, leave the session running" is void under the
 * every-session-is-a-tab model, because there is no tab to close that is
 * not the session itself.
 *
 * `orientation` IS A PROP FROM THE START, even though only `'horizontal'` is
 * wired up in this task, per epic.md Amendment A1.5: the strip must
 * eventually support a vertical arrangement and drag-to-reorder, and a strip
 * hard-coded horizontal with the axis bolted on later is a rewrite landing on
 * top of the largest diff in this migration. `tabs` is handed in the ORDER
 * the sidebar draws its own project (`orderedSessions`) — never re-sorted
 * here by title or status.
 *
 * A15.1: `data-tab-select` is now `draggable`, and dropping it onto a pane
 * splits that pane rather than reordering the strip — the operator asked
 * for split, not reorder, when this was revisited. `onTabDragStart`/
 * `onTabDragEnd` are optional so every caller that predates splitting (and
 * every existing test) is unaffected.
 */
/**
 * The `+` at the end of one pane's strip — the operator's request, and
 * VSCode's own "new editor in THIS group": the session it starts is born in
 * the pane whose button was pressed, not in whichever pane holds the
 * keyboard (`renderLeaf` passes the leaf id through).
 *
 * A SIBLING of the strip rather than a child of it, so it stays pinned at
 * the row's right edge while a pane full of tabs scrolls under it, and so a
 * pane holding nothing yet — where `TabStrip` draws its "no sessions open"
 * placeholder instead of any tabs — still has one.
 *
 * `decline` is `newSessionDecline`: the reason there is no route, computed
 * from the same `newSessionRoute` the click reads, so the caption cannot
 * disagree with what pressing it does. It is worn as the TOOLTIP and said
 * out loud in the status bar on click; the button is never drawn inert.
 * (`ViewIcons`' rule for icon-only controls applies here too: a real
 * `<button>`, reachable by Tab, with an `aria-label`. A `title` alone is not
 * a name.)
 */
function NewTabButton({
  decline,
  onClick,
}: {
  readonly decline: string | null;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-tab-new
      aria-label="new session in this pane"
      title={decline ?? 'New session in this pane'}
      onClick={onClick}
      className="vam-tap flex flex-none cursor-pointer items-center self-center rounded-[4px] px-1.5 py-1 text-ink-faint hover:text-ink"
    >
      <Plus size={13} strokeWidth={1.7} />
    </button>
  );
}

/** The literal class strings, not a template literal, so Tailwind's static
 *  scanner can see them rather than a computed `` `text-${status}` ``. */
const TAB_STATUS_INK: Readonly<Record<SessionStatus, string>> = {
  running: 'text-running',
  waiting: 'text-waiting',
  done: 'text-done',
  failed: 'text-failed',
};

function TabStrip({
  orientation,
  tabs,
  activeId,
  onSelect,
  onClose,
  onTabDragStart,
  onTabDragEnd,
}: {
  readonly orientation: 'horizontal' | 'vertical';
  readonly tabs: readonly SessionEntry[];
  readonly activeId: string | null;
  readonly onSelect: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
  /**
   * A15.1 — dragging a tab is how a split is made. Optional so every
   * existing caller (and every existing test) that has no reason to care
   * about splitting keeps working unchanged; `Canvas.tsx`'s own render is
   * the one caller that supplies both.
   */
  readonly onTabDragStart?: (
    sessionId: string,
  ) => (event: ReactDragEvent<HTMLButtonElement>) => void;
  readonly onTabDragEnd?: () => void;
}) {
  if (tabs.length === 0) {
    return (
      <div
        data-tab-strip
        data-orientation={orientation}
        className="flex min-w-0 flex-1 items-center px-1 text-[11px] text-ink-faint"
      >
        no sessions open — pick one from the sidebar
      </div>
    );
  }
  return (
    <div
      data-tab-strip
      data-orientation={orientation}
      className={
        orientation === 'horizontal'
          ? 'flex min-w-0 flex-1 items-stretch overflow-x-auto'
          : 'flex min-h-0 flex-1 flex-col overflow-y-auto'
      }
    >
      {tabs.map((entry) => {
        const active = entry.session.id === activeId;
        // The chain (`panels/session-icon.ts`): the session's own choice, else
        // its project's, else nothing drawn -- deliberately not the module's
        // own placeholder glyph, which would put a Monitor icon on every tab
        // nobody has picked one for. Adopting the chain is the point: this
        // used to read `entry.session.icon` alone, so a tab never fell back
        // to its project's glyph the way the (now-deleted) canvas root node
        // already did, and the two surfaces disagreed the moment one carried
        // a project icon and no session icon of its own.
        const glyph = resolveSessionGlyph(entry);
        return (
          <div
            key={entry.session.id}
            data-session-tab
            data-active={active ? 'true' : 'false'}
            className={`group flex flex-none items-center gap-1.5 border-line border-r px-2.5 text-[11px] ${active ? 'bg-canvas text-ink' : 'text-ink-dim hover:text-ink'}`}
          >
            <button
              type="button"
              data-tab-select
              draggable={onTabDragStart !== undefined}
              onDragStart={onTabDragStart?.(entry.session.id)}
              onDragEnd={onTabDragEnd}
              onClick={() => onSelect(entry.session.id)}
              className={`max-w-[160px] truncate py-1 ${active ? TAB_STATUS_INK[entry.session.status] : ''}`}
            >
              {glyph !== null && (
                <>
                  <span data-session-icon={entry.session.id} aria-hidden="true">
                    {glyph}
                  </span>{' '}
                </>
              )}
              {entry.session.title}
            </button>
            <button
              type="button"
              data-tab-close
              aria-label={`close ${entry.session.title} tab`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(entry.session.id);
              }}
              className="shrink-0 rounded-[4px] px-1 text-ink-faint opacity-0 hover:text-ink group-hover:opacity-100 data-[active=true]:opacity-100"
              data-active={active ? 'true' : 'false'}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
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
        <span className="text-ink-faint">○ connecting to factory…</span>
      ) : (
        <span className="text-done">● factory</span>
      )}
    </span>
  );
}

/**
 * The highlighted rectangle a drag draws before it lands — the only visible
 * sign, while dragging, of which half of which pane a drop would split.
 * `pointer-events-none` so it never itself becomes a drop target (the drag
 * events are bound to the pane underneath, not to this overlay), and reuses
 * `--color-cursor-ring` (`styles.css`): the token has carried no consumer
 * since its own graph-node origin died in the 0.2 migration, its VALUE is
 * independent of who reads it, and `token-contrast.test.ts` already pins it
 * for contrast against `--color-canvas` — exactly the background this draws
 * over.
 */
function DropZoneOverlay({ edge }: { readonly edge: Edge }) {
  const SIDE_CLASS: Readonly<Record<Edge, string>> = {
    left: 'inset-y-0 left-0 w-1/2',
    right: 'inset-y-0 right-0 w-1/2',
    top: 'inset-x-0 top-0 h-1/2',
    bottom: 'inset-x-0 bottom-0 h-1/2',
  };
  return (
    <div
      data-drop-zone={edge}
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 border-2 border-cursor-ring bg-cursor-ring/15 ${SIDE_CLASS[edge]}`}
    />
  );
}

/**
 * Walks a `SplitTree` (`split.ts`) into nested flex containers — `row` a
 * vertical divider (panes side by side), `column` a horizontal one (panes
 * stacked) — and calls `renderLeaf` for every leaf it reaches. Purely a
 * geometry translation: the tree already says everything about WHAT is
 * shown and in what order, so this component owns no state of its own.
 *
 * `gap-px` over a `bg-line` container draws the seam between panes as a
 * single-pixel line without a border on every child fighting its neighbour
 * for whose edge draws it — the same trick a two-column CSS grid uses for a
 * shared divider.
 */
function SplitLayout({
  tree,
  renderLeaf,
}: {
  readonly tree: SplitTree;
  readonly renderLeaf: (leaf: Leaf) => ReactNode;
}) {
  if (tree.kind === 'leaf') {
    return <>{renderLeaf(tree)}</>;
  }
  return (
    <div
      data-split
      data-split-orientation={tree.orientation}
      className={`flex min-h-0 min-w-0 flex-1 gap-px bg-line ${
        tree.orientation === 'row' ? 'flex-row' : 'flex-col'
      }`}
    >
      {tree.children.map((child) => (
        <div key={child.id} className="flex min-h-0 min-w-0 flex-1">
          <SplitLayout tree={child} renderLeaf={renderLeaf} />
        </div>
      ))}
    </div>
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
  // panes exist is a fact about the layout, and `layoutWidths` is the one
  // place that knows an unmounted pane owes its sibling nothing.
  const visible = prefs.paneVisibility;
  /**
   * Which shell this viewport gets. `false` wherever `matchMedia` is missing,
   * so every environment without one -- jsdom, happy-dom, the tests -- keeps
   * the columns it was written against.
   */
  const phone = usePhoneViewport();

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
    () =>
      applyRenames(
        applyIcons(factoryModel, prefs.icons, prefs.projectIcons),
        prefs.renames,
        prefs.projectNames,
      ),
    [factoryModel, prefs.icons, prefs.projectIcons, prefs.renames, prefs.projectNames],
  );

  /**
   * The replies sent but not yet reported back by the source (`optimistic.ts`).
   *
   * Held here, one level above `model`, so every pane draws a pending reply
   * exactly as it draws a real turn -- the sidebar and the detail panel both
   * read `model` and neither learns that a turn can be vam's own, which is
   * the same rule the rename above follows.
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
   * A15.1 — the detail pane's own layout: one or more panes, arranged by
   * `split.ts`'s tree, each showing one session. Before any split exists
   * this is a single leaf, and the whole rest of the file goes on reading
   * `focusedSessionId` exactly as it did pre-split — see the pair below.
   *
   * `paneSeq` mints every pane id after the first, the same
   * increment-a-ref-and-stringify shape `pendingSeq` already uses for
   * optimistic prompts: ids only ever need to be unique for the life of one
   * mounted shell, never stable across a reload. Starts at `1`, not `0` —
   * the initial leaf is already hardcoded `pane-1`, so a counter starting at
   * `0` mints `pane-1` again for the very FIRST split, two leaves sharing
   * one id and React warning about a duplicate key on the one render that
   * matters most for this feature. Caught by `Canvas.split.test.tsx`, not
   * by eye.
   */
  const paneSeq = useRef(1);
  const [panes, setPanes] = useState<SplitTree>(() => singlePane(null, 'pane-1'));
  /**
   * Which pane a `+` just started a session FOR, and which sessions already
   * existed when it did.
   *
   * `write.createSession` resolves `void` (`preload-api.ts`) — `tmux
   * new-session -d` returns before the agent inside has registered anywhere
   * vam can read, so the id of what was started is not knowable at the call
   * and cannot be opened on the spot. The pane is remembered instead, and the
   * session that turns up in a later model is opened into it (the effect
   * beside the prune below). A ref, not state: nothing renders from it, and
   * an intervening render must not reset it.
   *
   * Armed only after the write RESOLVES, so a refused or failed creation
   * leaves nothing behind to capture an unrelated session that appears later.
   */
  const pendingNewTab = useRef<{ paneId: string; known: ReadonlySet<string> } | null>(null);
  /**
   * Two derived values, mirrored into refs during render, so
   * `setFocusedSessionId` below can read them and still be the
   * stably-identified callback its ~40 existing callers rely on (see its own
   * comment). Assigned further down, immediately after each is computed —
   * an effect would be one commit behind, and a click is what reads them.
   */
  const entriesByIdRef = useRef<ReadonlyMap<string, SessionEntry>>(new Map());
  const activeProjectIdRef = useRef<string | null>(null);
  /** Which project each session that EXISTS belongs to — built from
   *  `allEntries`, never the filtered `entries`, so a restore cannot drop a
   *  pane's tab merely because a filter is hiding it right now. */
  const projectOfSessionRef = useRef<ReadonlyMap<string, string>>(new Map());
  /** The tree as last rendered, for `setFocusedSessionId` to store when the
   *  project changes — the same render-phase mirror the two above are, for
   *  the same reason: it must stay a stably-identified callback. */
  const panesRef = useRef<SplitTree>(panes);
  /**
   * A15.7 — ONE REMEMBERED LAYOUT PER PROJECT, and which pane in it had the
   * keyboard. Written when the operator leaves a project, read when they come
   * back (`restoreLayout` reconciles it against what is still open). A ref
   * rather than state: nothing renders from it, it must survive the render
   * that swaps the panes, and it is deliberately not persisted to `prefs` —
   * pane ids are minted per mounted shell (see `paneSeq`), so a layout is
   * only meaningful for as long as this shell lives.
   */
  const paneLayouts = useRef(new Map<string, { tree: SplitTree; paneId: string }>());
  const [focusedPaneId, setFocusedPaneIdState] = useState('pane-1');
  /**
   * Mirrors `focusedPaneId`, updated in the SAME tick as the state (never
   * through an effect one commit behind), so `setFocusedSessionId` below can
   * read it and stay a stably-identified callback — exactly the contract its
   * ~40 existing callers already rely on from the plain `useState` setter
   * this replaces. Without the mirror, every one of those callers' own
   * dependency arrays would need auditing for a setter that now silently
   * changes identity underneath them.
   */
  const focusedPaneIdRef = useRef(focusedPaneId);
  const setFocusedPaneId = useCallback((id: string) => {
    focusedPaneIdRef.current = id;
    setFocusedPaneIdState(id);
  }, []);

  /**
   * The one session the keyboard is pointed at — `null` until there is
   * something real to point at.
   *
   * Before the 0.2 migration this held a ReactFlow NODE id (an info card or a
   * step), and the session it belonged to was derived a level down. With the
   * graph gone there is no second granularity left inside a session to
   * distinguish, so this is now the session id directly — the state IS the
   * derived value the rest of the file used to compute from it. Nothing is
   * lost by seeding it `null`: the "land focus on something real" effect
   * already had to cover the live case, where the first model arrives after
   * mount and the first `entries` list is empty whatever this says.
   *
   * A15.1 changes WHERE this lives, not what it means: it is now the
   * FOCUSED PANE's own session, derived from `panes`/`focusedPaneId` rather
   * than owned directly. Every one of this file's ~40 existing call sites —
   * the chords, the sidebar wiring, `sendPromptFor(focusedEntry)` — keeps
   * reading and writing the same two names and is unaffected by there now
   * being more than one pane, the same "the zero-argument names stay bound
   * to whichever is active" idiom the per-session composer state below
   * already established for `setComposing`/`actionIndex`.
   */
  const focusedSessionId = useMemo(
    () => findLeaf(panes, focusedPaneId)?.sessionId ?? null,
    [panes, focusedPaneId],
  );
  /**
   * A15.5 — WHAT A PROJECT SWITCH DOES TO THE PANES, reported by the
   * operator as "after splitting a tab, when I switch project, the old tab
   * still shows and is still split". Panes held session ids and nothing
   * reconciled them, so a split kept drawing the PREVIOUS project's
   * sessions after the strip (project-scoped since A13.1) had stopped
   * listing them: the shell showing something it could no longer justify
   * showing, and saying nothing about it.
   *
   * Picking a session in another project COLLAPSES the layout to a single
   * pane holding it. The alternative — remembering one layout per project
   * and restoring it — is the richer answer and is deliberately not what
   * this does: it needs a second store keyed by project, kept in step with
   * sessions that end while their project is off screen, which is a larger
   * change than this one is scoped for. Collapsing is the smaller rule that
   * makes the invariant true and visible in one place: every pane on screen
   * holds sessions of the project on screen. It is also loud by
   * construction — the split visibly folds — rather than a reconciliation
   * the operator has to notice the absence of.
   */
  const setFocusedSessionId = useCallback(
    (sessionId: string | null) => {
      const nextProjectId =
        sessionId === null ? null : (entriesByIdRef.current.get(sessionId)?.project.id ?? null);
      const currentProjectId = activeProjectIdRef.current;
      if (
        sessionId !== null &&
        nextProjectId !== null &&
        currentProjectId !== null &&
        nextProjectId !== currentProjectId
      ) {
        // The outgoing project keeps its layout, exactly as it stands.
        paneLayouts.current.set(currentProjectId, {
          tree: panesRef.current,
          paneId: focusedPaneIdRef.current,
        });
        paneSeq.current += 1;
        const freshId = `pane-${paneSeq.current}`;
        const stored = paneLayouts.current.get(nextProjectId);
        if (stored === undefined) {
          // A project never opened in this shell starts as one pane holding
          // what was picked — VSCode's own answer for a workspace it has
          // never seen.
          setPanes(singlePane(sessionId, freshId));
          setFocusedPaneId(freshId);
          return;
        }
        const restored = restoreLayout(
          stored.tree,
          // A15.5's invariant, enforced on the way back IN: a tab survives
          // only if its session still exists AND still belongs to the
          // project being opened, so a restored layout can never redraw
          // another project's session.
          (id) => projectOfSessionRef.current.get(id) === nextProjectId,
          sessionId,
          stored.paneId,
          freshId,
        );
        setPanes(restored.tree);
        setFocusedPaneId(restored.paneId);
        return;
      }
      setPanes((tree) => setPaneSession(tree, focusedPaneIdRef.current, sessionId));
    },
    [setFocusedPaneId],
  );
  const [jumping, setJumping] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keySheetOpen, setKeySheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which section Settings opens on next — `appearance` unless the Remote
   *  icon or its key just asked for `remote` directly (see `openSettings`). */
  const [settingsSection, setSettingsSection] = useState<SectionId>('appearance');
  const [errorLogOpen, setErrorLogOpen] = useState(false);
  /**
   * The row a close refused without being able to prove it is not vam's own
   * -- `SourceError.forcible` -- and offered the operator a confirmed kill
   * for. `null` means no such prompt is on screen. See `ConfirmForceClose`.
   */
  const [confirmForceClose, setConfirmForceClose] = useState<{
    sessionId: string;
    title: string;
  } | null>(null);
  /** Any full-screen overlay on screen. See the keydown handler for the rule. */
  const overlayOpen =
    paletteOpen || keySheetOpen || settingsOpen || errorLogOpen || confirmForceClose !== null;
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
  /**
   * Composer state, KEYED BY SESSION — the load-bearing change a tab shell
   * makes here, and the reason A15.1's split panes cost this file almost
   * nothing extra for the composer specifically. A draft typed in one tab
   * must survive switching to another and back rather than bleeding into it
   * or vanishing, and (A15.1) two SPLIT PANES showing two different
   * sessions must never share one either — both are the same requirement,
   * "keyed by session, not by whichever pane happens to be looking", and
   * this was already keyed that way before a second pane existed. One
   * `Record` per piece of state, read and written through the
   * `*For(sessionId, …)` helpers below. `buildDetailProps` (further down)
   * reads these directly per pane; `setComposing`/`actionIndex` are the two
   * zero-argument aliases still used by keyboard-only callers that only
   * ever mean "whichever session the keyboard is in right now" (the chord
   * switch, `beginComposing`) — see that declaration's own comment.
   */
  const [draftsBySession, setDraftsBySession] = useState<Readonly<Record<string, string>>>({});
  const [composingBySession, setComposingBySession] = useState<Readonly<Record<string, boolean>>>(
    {},
  );
  const setDraftFor = useCallback((sessionId: string, value: string) => {
    setDraftsBySession((current) => ({ ...current, [sessionId]: value }));
  }, []);
  const setComposingFor = useCallback((sessionId: string, value: boolean) => {
    setComposingBySession((current) => ({ ...current, [sessionId]: value }));
  }, []);
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
  /** Same per-session shape as the composer state above, and the same reason:
   *  which action `j`/`k` has landed on in the Insert pane is a fact about
   *  the tab you are reading, not a single global cursor. */
  const [actionIndexBySession, setActionIndexBySession] = useState<
    Readonly<Record<string, number>>
  >({});
  const setActionIndexFor = useCallback(
    (sessionId: string, updater: number | ((current: number) => number)) => {
      setActionIndexBySession((current) => ({
        ...current,
        [sessionId]: typeof updater === 'function' ? updater(current[sessionId] ?? 0) : updater,
      }));
    },
    [],
  );
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
  /** The project `gm` is asking a folder for, captured when the picker opens —
   *  the same reasoning as the two icon targets above. */
  const [pickingGroupFor, setPickingGroupFor] = useState<{
    readonly source: SourceId;
    readonly projectId: string;
    readonly name: string;
  } | null>(null);
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
  /** True while a write is in flight for THAT session — Enter must not fire
   *  twice, and a send in one tab must not gate Enter in another. */
  const [writingBySession, setWritingBySession] = useState<Readonly<Record<string, boolean>>>({});
  const setWritingFor = useCallback((sessionId: string, value: boolean) => {
    setWritingBySession((current) => ({ ...current, [sessionId]: value }));
  }, []);
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

  /**
   * What `gm`'s picker offers: every folder in the project's own source, each
   * marked `current` when the project is already there. At most one can be —
   * `addProjectToGroup` enforces that on write, and `composeGroups` on read.
   */
  const groupPickerChoices = useMemo((): readonly GroupPickerChoice[] => {
    if (pickingGroupFor === null) return [];
    const { source, projectId } = pickingGroupFor;
    return (prefs.groups[source] ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      current: group.projects.includes(projectId),
    }));
  }, [prefs.groups, pickingGroupFor]);

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
   * What `hjkl`, `f` and `gg` may land on: every session in view, no filter
   * of its own. The set is narrowed once, at `entries` above, and the sidebar
   * and the tab strip are both drawn from the result — so a second narrowing
   * here is what would put the cursor and the picture back out of step.
   */
  const sessionIds = useMemo(() => entries.map((e) => e.session.id), [entries]);

  /**
   * A15.1 — every split pane besides the focused one is looked up from the
   * UNFILTERED set, deliberately unlike `focusedEntry` below (which stays on
   * the filtered `entries`, its existing and unchanged contract). A pane the
   * operator deliberately populated should not vanish because the search box
   * or a status pill now hides its session — only the sidebar cursor's own
   * navigation (`hjkl`, `Mod-<digit>`) is scoped to what is currently in
   * view.
   */
  const entriesById = useMemo(
    () => new Map(allEntries.map((entry) => [entry.session.id, entry])),
    [allEntries],
  );

  /**
   * Every session focus could land on.
   *
   * A remembered focus stores a session id under its source, never anything
   * derived from a graph: candidates are rebuilt whenever the model, the
   * filters or the fold state change, so a stored one goes stale rather than
   * pointing at a session that has since ended. This is where the two
   * vocabularies meet (`prefs/focus.ts`) — `nodeId` and `session` are the
   * same string now that there is no more per-decision node to distinguish a
   * session from, kept as two fields because `FocusCandidate`'s shape is
   * shared, project-wide, protected code this task does not touch.
   */
  const focusCandidates: readonly FocusCandidate[] = useMemo(
    () =>
      entries.map((e) => ({
        nodeId: e.session.id,
        source: sourceKeyOf(e),
        session: e.session.id,
      })),
    [entries],
  );

  /** The focused session's own entry, from the FILTERED set — `null` once a
   *  filter or a refresh has made the pointer unreachable, the same rule
   *  `sessionIds` above enforces for `hjkl`. */
  const focusedEntry: SessionEntry | null = useMemo(
    () => entries.find((e) => e.session.id === focusedSessionId) ?? null,
    [entries, focusedSessionId],
  );

  /**
   * Composer state, bound to whichever session is the ACTIVE TAB — kept as
   * zero-argument names for exactly the callers that only ever act on
   * "whichever session the keyboard is currently in": the chord switch's
   * `focusList`/`cancel`/`prompt` cases and `beginComposing`. A15.1 moved
   * every OTHER reader (`sendPromptFor`, `buildDetailProps`) onto the
   * `*BySession` records directly, parameterised by whichever pane's
   * session they are actually building for — `setComposing`/`setActionIndex`
   * are the two of this family that still have a caller of their own; `draft`,
   * `setDraft`, `composing`, `writing` and `setWriting` do not any more and
   * are deleted rather than kept as an alias nothing reads.
   */
  const setComposing = useCallback(
    (value: boolean) => {
      if (focusedSessionId !== null) {
        setComposingFor(focusedSessionId, value);
      }
    },
    [focusedSessionId, setComposingFor],
  );
  const actionIndex = focusedSessionId === null ? 0 : (actionIndexBySession[focusedSessionId] ?? 0);
  const setActionIndex = useCallback(
    (updater: number | ((current: number) => number)) => {
      if (focusedSessionId !== null) {
        setActionIndexFor(focusedSessionId, updater);
      }
    },
    [focusedSessionId, setActionIndexFor],
  );

  /**
   * A13.1: the tab strip shows one PROJECT's sessions, not every session vam
   * knows about — "every session is always a tab" (A11.1) is scoped to the
   * ACTIVE project. There is nothing to open, close (as a tab, independent
   * of the session) or persist: the strip is a pure projection of `entries`
   * and whichever project is active, recomputed on every render exactly the
   * way `entries` itself already is.
   *
   * "The active project" is DEFINED here as the focused session's project —
   * the derivation the epic itself calls obvious. The second case the epic
   * flags — a project selected in the sidebar with NO session focused — has
   * no live UI action to select a project independently of a session
   * (verified: `SessionList.tsx`'s `data-project-heading` binds a click only
   * to its icon, its collapse chevron and its own "add session" button, none
   * of which "select" the project), so that case cannot currently arise from
   * the UI. What CAN happen is genuinely no session focused at all — cold
   * start before "land focus on something real" resolves, or every session
   * filtered out — and there `activeProjectId` is `null` and the strip is
   * empty, reusing the same "no sessions open" copy `TabStrip` already draws
   * for an empty tab list. If a future surface lets the operator select a
   * project without a session, THIS is the one place that needs to learn it.
   */
  const activeProjectId = focusedEntry?.project.id ?? null;
  const projectTabs = useMemo(
    () => (activeProjectId === null ? [] : entries.filter((e) => e.project.id === activeProjectId)),
    [entries, activeProjectId],
  );
  const projectTabIds = useMemo(() => projectTabs.map((e) => e.session.id), [projectTabs]);

  // The render-phase half of the two mirrors declared beside `panes` above.
  entriesByIdRef.current = entriesById;
  activeProjectIdRef.current = activeProjectId;
  panesRef.current = panes;
  projectOfSessionRef.current = new Map(
    allEntries.map((entry) => [entry.session.id, entry.project.id]),
  );

  /**
   * A15.5 — a session that is no longer there leaves no tab behind. Sessions
   * end, are closed from the sidebar, or vanish with their project; a pane
   * holding the id would otherwise keep drawing a tab for something gone.
   * `pruneClosedTabs` returns the SAME tree when nothing is stale, so this
   * cannot churn the render, and it never closes the last pane. Skipped
   * entirely while the model is empty — that is the pre-load state, not
   * every session closing at once.
   */
  useEffect(() => {
    if (allEntries.length === 0) {
      return;
    }
    const open = new Set(allEntries.map((entry) => entry.session.id));
    setPanes((tree) => pruneClosedTabs(tree, (id) => open.has(id)));
  }, [allEntries]);

  /**
   * The other half of the per-pane `+`: the session it started, once it
   * shows up, opens in the pane that asked for it.
   *
   * The FIRST id that was not there when the button was pressed — vam has
   * nothing better to match on (the write reported no id), and anything else
   * appearing in the same poll is indistinguishable from it. Fires once and
   * disarms, so a session started elsewhere a minute later never lands in a
   * pane nobody pointed at. A pane closed in the meantime disarms too rather
   * than moving focus onto a leaf that is gone.
   */
  useEffect(() => {
    const pendingTab = pendingNewTab.current;
    if (pendingTab === null) {
      return;
    }
    const arrived = allEntries.find((entry) => !pendingTab.known.has(entry.session.id));
    if (arrived === undefined) {
      return;
    }
    pendingNewTab.current = null;
    if (findLeaf(panes, pendingTab.paneId) === null) {
      return;
    }
    setPanes((tree) => setPaneSession(tree, pendingTab.paneId, arrived.session.id));
    setFocusedPaneId(pendingTab.paneId);
  }, [allEntries, panes, setFocusedPaneId]);

  /**
   * What the detail panel expands: the focused session's newest decision.
   *
   * Before the 0.2 migration this could also be a specific STEP the cursor
   * had walked onto via `h`/`l` and the graph's own per-decision cards; with
   * the graph gone there is no finer cursor than the session itself, so the
   * newest decision is now the only answer there is. Focusing the session
   * head should still show you something — an empty panel next to a selected
   * session reads as broken.
   */
  const focusedDecision: Decision | null = useMemo(
    () => focusedEntry?.session.decisions[0] ?? null,
    [focusedEntry],
  );

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
    () => (jumping ? jumpLabels(sessionIds) : new Map<string, string>()),
    [jumping, sessionIds],
  );

  /**
   * Land focus on something real once there is something real.
   *
   * The first model arrives after mount, so the initial focus is null; and a
   * filter can strip the session under the cursor. Both end with nothing
   * pointed at, which makes the first keypress do nothing.
   */
  useEffect(() => {
    if (focusCandidates.length === 0) {
      return;
    }
    if (focusedSessionId === null || !sessionIds.includes(focusedSessionId)) {
      setFocusedSessionId(resolveFocusNodeId(prefs.lastFocus, focusCandidates));
    }
  }, [sessionIds, focusCandidates, focusedSessionId, prefs.lastFocus, setFocusedSessionId]);

  /**
   * The other half: record where focus is, so the next launch can ask.
   *
   * ONE EFFECT RATHER THAN A WRITE AT EVERY `setFocusedSessionId`. Focus is
   * moved from eight places -- the chords, a click on a card, a click on a
   * sidebar row, search landing and search escaping -- and a write bolted
   * onto each is seven chances to add a ninth that forgets. Watching the
   * resulting entry catches all of them, including the ones this file has
   * not grown yet.
   *
   * The equality guard is what stops it looping: `savePrefs` replaces `prefs`,
   * which re-runs this effect, which finds the stored pointer already says what
   * it was about to write and returns. A focus that lands on nothing keeps the
   * last pointer rather than clearing it -- an empty screen is a filter or a
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

  /** Move focus to a session by id — what the sidebar and the palette do.
   *  Opening a tab piggybacks on this (see the effect above): every one of
   *  this function's callers already means "look at this session now". */
  const focusSession = useCallback(
    (sessionId: string) => {
      setFocusedSessionId(sessionId);
    },
    [setFocusedSessionId],
  );

  /**
   * A15.1 — split the FOCUSED pane, showing the same session in both halves.
   * Vim's own `:split`/`:vsplit` do the same thing: the new window starts as
   * a mirror of the one it came from, not empty. Focus moves to the new
   * pane, again matching vim (and VSCode's "Split Editor") — the reason to
   * split is almost always to look at something new in the new spot.
   *
   * `orientation` is the CSS axis (`row` = side by side, `column` =
   * stacked); the EDGE handed to `splitPane` is the arbitrary-but-documented
   * choice of "the new pane lands after (right of / below) the one that was
   * focused" for the keyboard route — dragging (see `onPaneDrop` below)
   * lets the operator choose left/right/top/bottom directly instead.
   */
  const splitFocused = useCallback(
    (orientation: SplitOrientation) => {
      if (focusedSessionId === null) {
        setStatus('pick a session first');
        return;
      }
      const edge: Edge = orientation === 'row' ? 'right' : 'bottom';
      // Read the ref into a plain local BEFORE `setFocusedPaneId` below moves
      // it. `setFocusedPaneId` writes `focusedPaneIdRef.current` synchronously
      // (see its definition above), while a `setPanes` updater is only
      // guaranteed to run later, in the render phase — so a lazy
      // `focusedPaneIdRef.current` read INSIDE the updater can see the id this
      // very call is about to focus rather than the one being split.
      // `splitPane` then finds no leaf by that id yet and returns the tree
      // untouched: the split silently does nothing.
      //
      // React's eager-state path hides this whenever the fiber has no pending
      // update — it runs the updater on the spot, before the ref moves — which
      // is why no jsdom test in this repo reproduces it; every attempt passes
      // with this fix reverted. Measured in a real Chromium tab instead: with
      // this read inlined back into the updater, `e2e/split-panes-shots.mjs`
      // reports `after zv: 1 pane(s)` and then dies looking for the second
      // pane. That script is this fix's ONLY regression guard — keep its
      // pane-count assertions.
      const targetPaneId = focusedPaneIdRef.current;
      // `splitPane` is total: an id it cannot find returns the tree
      // UNCHANGED, which on screen is indistinguishable from a split that
      // had nothing to do. Said out loud instead — a pane operation that
      // fails silently is the one shape this shell refuses everywhere else.
      if (findLeaf(panes, targetPaneId) === null) {
        setStatus('that pane is gone — nothing to split');
        return;
      }
      paneSeq.current += 1;
      const newId = `pane-${paneSeq.current}`;
      setPanes((tree) => splitPane(tree, targetPaneId, edge, focusedSessionId, newId));
      setFocusedPaneId(newId);
    },
    [focusedSessionId, panes, setFocusedPaneId],
  );

  /**
   * Close the focused split. The SESSION keeps running — only the pane
   * goes, same distinction `x` already draws for the whole session against
   * `Mod-w`'s (pre-split) tab-only close. Refuses aloud with only one pane:
   * closing the last one would leave nothing to show, which `closePane`
   * itself makes unrepresentable by returning `null` for that case.
   */
  const closeFocusedSplit = useCallback(() => {
    if (leaves(panes).length <= 1) {
      setStatus('only one pane open — nothing to close');
      return;
    }
    const fallback = stepPane(panes, focusedPaneId, 1);
    const next = closePane(panes, focusedPaneId);
    if (next === null) {
      // Unreachable given the length check above; `closePane` stays total
      // rather than this call site trusting that guard alone.
      return;
    }
    setPanes(next);
    setFocusedPaneId(fallback);
  }, [panes, focusedPaneId, setFocusedPaneId]);

  /**
   * A15.5 — a tab's own `×` closes THE TAB, in the pane that drew it, and
   * the pane itself once its last tab goes (VSCode: an emptied editor group
   * is dropped, not left as a titled void).
   *
   * This REVERSES A11.3's "one action, two keys", and deliberately: that
   * decision was made when every session in the project was always a tab of
   * the one strip, so there was no tab to close that was not the session
   * itself. A pane's tab list is now a genuine choice — which sessions THIS
   * pane has open — so closing one is meaningful on its own, and the session
   * keeps running and keeps its sidebar row. Closing the session itself is
   * still one keystroke, `x`, and still the sidebar row's own `×`.
   *
   * Refuses aloud rather than emptying the shell when the tab is the last
   * tab of the last pane — `removeTab` returns `null` for exactly that case.
   */
  const closePaneTab = useCallback(
    (paneId: string, sessionId: string) => {
      const next = removeTab(panes, paneId, sessionId);
      if (next === null) {
        setStatus('that is the last tab — close the session with x');
        return;
      }
      setPanes(next);
      if (findLeaf(next, focusedPaneIdRef.current) === null) {
        setFocusedPaneId(stepPane(panes, paneId, 1));
      }
    },
    [panes, setFocusedPaneId],
  );

  /** Cycle the keyboard between splits, wrapping — vim's `Ctrl-w w`/`W`. */
  const stepFocusedSplit = useCallback(
    (delta: 1 | -1) => {
      if (leaves(panes).length <= 1) {
        setStatus('only one pane open');
        return;
      }
      setFocusedPaneId(stepPane(panes, focusedPaneId, delta));
    },
    [panes, focusedPaneId, setFocusedPaneId],
  );

  /**
   * A15.1 — dragging a tab is how a split is made.
   *
   * The payload travels in REACT STATE, not the browser's own
   * `DataTransfer`: happy-dom does not carry a `DataTransfer` through a
   * constructed `DragEvent` (verified by running it — the property comes
   * back `undefined` on the receiving end), so a design that read the
   * dragged session back OUT of the transfer object would be untestable by
   * construction. `event.dataTransfer` is still written to, defensively,
   * for a real browser's own drag affordance (the ghost image, the cursor),
   * but nothing here reads it back.
   */
  /** A15.5 — the dragged tab now carries the pane it came FROM as well:
   *  dropping it on another pane MOVES it (VSCode's own drag-a-tab-to-a-
   *  group), so the source pane has to be named to take it back out of. */
  const [dragging, setDragging] = useState<{
    readonly sessionId: string;
    readonly paneId: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    readonly paneId: string;
    readonly edge: Edge;
  } | null>(null);

  const onTabDragStart = useCallback(
    (paneId: string, sessionId: string) => (event: ReactDragEvent<HTMLButtonElement>) => {
      setDragging({ sessionId, paneId });
      try {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', sessionId);
      } catch {
        // Best-effort only — see the doc comment above. The drop handler
        // never reads this back.
      }
    },
    [],
  );

  const onTabDragEnd = useCallback(() => {
    setDragging(null);
    setDropTarget(null);
  }, []);

  const onPaneDragOver = useCallback(
    (paneId: string) => (event: ReactDragEvent<HTMLDivElement>) => {
      if (dragging === null) {
        return;
      }
      // Allowing the drop (`preventDefault`) is the browser's own contract
      // for `dragover` — without it, `drop` never fires at all.
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const edge = nearestEdge(
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
      );
      setDropTarget((current) =>
        current !== null && current.paneId === paneId && current.edge === edge
          ? current
          : { paneId, edge },
      );
    },
    [dragging],
  );

  const onPaneDragLeave = useCallback(
    (paneId: string) => () => {
      setDropTarget((current) => (current !== null && current.paneId === paneId ? null : current));
    },
    [],
  );

  /**
   * The refusal A15.1 asks for. Same project only, and refused ALOUD —
   * never a drop that just does nothing, which this codebase's standing
   * rule treats as indistinguishable from success. An empty target pane (no
   * session shown yet, or one filtered/closed out from under it) has no
   * project of its own to conflict with, so it always accepts.
   */
  const onPaneDrop = useCallback(
    (paneId: string) => (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const drag = dragging;
      setDragging(null);
      setDropTarget(null);
      if (drag === null) {
        return;
      }
      const draggedId = drag.sessionId;
      const targetLeaf = findLeaf(panes, paneId);
      if (targetLeaf === null) {
        // The same silent-no-op trap `splitFocused` guards above: a drop
        // that raced a close would hand `splitPane` an id it cannot find,
        // and get the tree back untouched with nothing said.
        setStatus('that pane is gone — nothing to split');
        return;
      }
      const draggedEntry = entriesById.get(draggedId) ?? null;
      const targetEntry =
        targetLeaf.sessionId === null ? null : (entriesById.get(targetLeaf.sessionId) ?? null);
      if (
        draggedEntry !== null &&
        targetEntry !== null &&
        draggedEntry.project.id !== targetEntry.project.id
      ) {
        setStatus(
          `can't split across projects — "${draggedEntry.project.name}" and "${targetEntry.project.name}" are different projects`,
        );
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const edge = nearestEdge(
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
      );
      paneSeq.current += 1;
      const newId = `pane-${paneSeq.current}`;
      setPanes((tree) => {
        // A15.5 — a drag MOVES the tab: it lands in the new pane and leaves
        // the one it came from, which is VSCode's own gesture and the only
        // reading under which "the tab sits on the split side" is true of
        // the tab that was dragged. `removeTab` closes a source pane it
        // empties, and is total over a source that has already gone.
        const split = splitPane(tree, paneId, edge, draggedId, newId);
        return removeTab(split, drag.paneId, draggedId) ?? split;
      });
      setFocusedPaneId(newId);
    },
    [dragging, panes, entriesById, setFocusedPaneId],
  );

  /**
   * Write what you typed into the focused session's log — or, for a `'session'`
   * source whose capabilities say so, into the running agent itself.
   *
   * The wording of every outcome here is load-bearing. The factory RECORDS a
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
   * into "error" throws away the one thing the factory just told us. A
   * `'session'` source whose `write` is absent (`recordPrompt: false`) is
   * refused before anything is called at all — `canWriteTo` is the only way in.
   */
  /**
   * A15.1 — parameterised over the entry rather than reading `focusedEntry`
   * from the closure, so every split pane's OWN composer can send without
   * first stealing the keyboard from whichever pane actually has it.
   * `buildDetailProps` (further down) wires each pane's own `onSubmit` to
   * `() => sendPromptFor(entry)` for that pane's own entry — the focused
   * pane's is `sendPromptFor(focusedEntry)`, the same call the single-pane
   * shell always made, just no longer needing a zero-argument wrapper of
   * its own now that its one caller passes the entry directly.
   */
  const sendPromptFor = useCallback(
    async (entry: SessionEntry | null) => {
      const entryDraft = entry === null ? '' : (draftsBySession[entry.session.id] ?? '');
      if (entry === null || entryDraft.trim() === '') {
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
      if (writingBySession[entry.session.id] ?? false) {
        return;
      }
      const text = entryDraft;
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
        setDraftFor(entry.session.id, '');
        setComposingFor(entry.session.id, false);
        setWritingFor(entry.session.id, true);
        return one;
      };
      // A refusal must leave no trace of a turn that never happened -- and give
      // the words back, so nothing has to be retyped.
      const rollBack = (one: PendingPrompt) => {
        setPending((current) => current.filter((other) => other.id !== one.id));
        setDraftFor(entry.session.id, text);
        setComposingFor(entry.session.id, true);
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
          setWritingFor(entry.session.id, false);
        }
        return;
      }
      const painted = beginPaint(false);
      try {
        await source.client.recordPrompt(entry.session.id, text);
        setStatus(
          `recorded in the log of ${entry.session.title} — recorded, not sent to the agent`,
        );
        source.onWrote();
      } catch (cause) {
        rollBack(painted);
        setStatus(noteFailure('send prompt', cause));
      } finally {
        setWritingFor(entry.session.id, false);
      }
    },
    [
      draftsBySession,
      source,
      writingBySession,
      sourceModel,
      setDraftFor,
      setComposingFor,
      setWritingFor,
    ],
  );

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
    async (sessionId: string, title: string, force = false): Promise<boolean> => {
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
        setStatus(`the factory has no close-session command — "${title}" is still here`);
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
      setStatus(force ? `force-closing "${title}"…` : `stopping "${title}"…`);
      try {
        await sessionSource.write.closeSession(sessionId, force);
        setStatus(
          force
            ? `killed "${title}" — vam could not confirm it was one of its own, and it is now gone`
            : `stopped "${title}" — the conversation is kept; resume it with \`claude attach\``,
        );
        source.onWrote();
        return true;
      } catch (cause) {
        setStatus(noteFailure('close session', cause));
        // A SECOND, DELIBERATE STEP -- never offered again on a force call
        // that itself failed, and never on anything but the source's own
        // `forcible: true`: the close key alone must never reach a kill.
        if (!force && isForcible(cause)) {
          setConfirmForceClose({ sessionId, title });
        }
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
  }, [setComposing]);

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
    async (projectId: string, projectName: string, paneId?: string) => {
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
      // Captured BEFORE the write, so "which session is new" is measured
      // against what existed when the operator pressed the button.
      const known = new Set(entriesByIdRef.current.keys());
      // The first half of one sentence: this and the success below are a
      // sequence -- "starting…" then "started … it may take a moment to
      // appear" -- rather than two unrelated remarks about the same click.
      setStatus(`starting a new session in ${projectName}…`);
      try {
        await route.write.createSession?.(projectId, projectName);
        if (paneId !== undefined) {
          pendingNewTab.current = { paneId, known };
        }
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
          setFocusedSessionId(hit[0]);
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
          // The cursor can be left on a session the filter has just made
          // unreachable. Land on the first survivor rather than navigating from
          // a session that is no longer in the set.
          if (focusedSessionId === null || !sessionIds.includes(focusedSessionId)) {
            const first = sessionIds[0] ?? null;
            if (first === null) {
              setStatus('no session matches');
              return;
            }
            setFocusedSessionId(first);
            return;
          }
          /**
           * Vertical is the LIST; horizontal is the TAB STRIP.
           *
           * `j`/`k` walk the sidebar's own order, one session at a time, and
           * land on that session's row. They used to walk canvas geometry,
           * which was a different order: with two projects side by side, `j`
           * from the first session went to the one physically below it — in
           * the other column — rather than to the next row in the list you are
           * reading. The sidebar is how sessions are enumerated, so it is what
           * "next session" has to mean.
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
          /**
           * `h`/`l` used to keep a spatial walk along a session's own row of
           * graph cards; the graph is gone, and this branch was re-homed to
           * the (then-global) open tab set in the same commit as the
           * deletion. A13.1 scopes it again: previous/next tab OF THE
           * ACTIVE PROJECT (`projectTabIds`), Select mode only (the `mode
           * === 'insert'` branches above already returned).
           *
           * WRAPPING FOLLOWS THE THING TRAVERSED, NOT THE KEY. `j`/`k`, just
           * above, walk an open-ended list where "the last one" is a real
           * place worth stopping at and announcing, so they do not wrap.
           * `h`/`l` walk a closed ring — the active project's tabs — the same
           * shape every tab strip's own arrow keys already have, so they do
           * — including the degenerate one-tab ring, which wraps to the tab
           * already focused rather than refusing. An EMPTY ring (nothing
           * focused, so no active project) is the one case with no ring to
           * wrap around, so that is what gets a status message.
           */
          if (projectTabIds.length === 0) {
            setStatus('no tabs open');
            return;
          }
          const at = focusedSessionId === null ? -1 : projectTabIds.indexOf(focusedSessionId);
          if (at === -1) {
            const first = projectTabIds[0] as string;
            focusSession(first);
            return;
          }
          const delta = action.direction === 'right' ? 1 : -1;
          const nextTab = projectTabIds[(at + delta + projectTabIds.length) % projectTabIds.length];
          if (nextTab !== undefined) {
            focusSession(nextTab);
          }
          return;
        }
        case 'first': {
          const first = entries[0];
          if (first !== undefined) {
            focusSession(first.session.id);
          }
          return;
        }
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
          searchOrigin.current = focusedSessionId;
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
          setSettingsSection('appearance');
          setSettingsOpen(true);
          return;
        case 'remote':
          setSettingsSection('remote');
          setSettingsOpen(true);
          return;
        case 'revealProject':
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          setRevealRequest({ projectId: focusedEntry.project.id });
          return;
        case 'moveToGroup':
          if (focusedEntry === null) {
            setStatus('pick a session first');
            return;
          }
          // Same refusal as the project icon picker: a project with no
          // source has no bucket a folder could be filed under either.
          if (focusedEntry.project.source === undefined) {
            setStatus('this project has no source — folders unavailable');
            return;
          }
          setPickingGroupFor({
            source: focusedEntry.project.source,
            projectId: focusedEntry.project.id,
            name: focusedEntry.project.name,
          });
          return;
        case 'resizePane': {
          // A12.1: the detail pane no longer has a width of its own to
          // drag — it fills everything to the sidebar's right (`panes.ts`)
          // — so the sidebar is the only real knob left, regardless of
          // which pane the keyboard is in. Writing to `prefs.panes.detail`
          // here, the way this case did before the canvas column left,
          // would be the exact "silence must not look like success" defect
          // this codebase keeps finding: a keypress that changes a stored
          // number nothing ever reads again.
          //
          // In Insert the seam is approached from the OTHER side: "widen
          // the pane I am in" (the detail pane) means "shrink the sidebar",
          // so the sign flips. In Select it is the sidebar's own edge, sign
          // unchanged — the same `pane` state `I`/`H` already set decides
          // which (epic.md §4.5).
          if (!visible.sidebar) {
            setStatus('the sidebar is hidden — z0 brings it back');
            return;
          }
          const sign = mode === 'insert' ? -1 : 1;
          const step = action.delta * sign * PANE_RESIZE_STEP;
          savePrefs(setPaneWidth(prefs, 'sidebar', prefs.panes.sidebar + step));
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
        case 'zoom':
          // The zoom controls left with the graph they scaled. Unlike `h`/`l`
          // just above, nothing in the tab strip needs a zoom-shaped meaning,
          // so this chord stays a binding with no home yet rather than being
          // re-homed here: it still fires, and reports the honest fact that
          // there is nothing left to zoom. Step 3 decides what, if anything,
          // it becomes.
          setStatus('nothing to zoom — the canvas view is gone');
          return;
        case 'fitView':
          setStatus('nothing to fit — the canvas view is gone');
          return;
        case 'splitPane':
          splitFocused(action.orientation);
          return;
        case 'closeSplit':
          closeFocusedSplit();
          return;
        case 'stepSplit':
          stepFocusedSplit(action.delta);
          return;
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
          setConfirmForceClose(null);
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
    focusedEntry,
    focusedSessionId,
    projectTabIds,
    sessionIds,
    entries,
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
    setActionIndex,
    setComposing,
    actions,
    prefs,
    savePrefs,
    terminalTab,
    visible,
    overlayOpen,
    openSessionIconPicker,
    splitFocused,
    closeFocusedSplit,
    stepFocusedSplit,
    setFocusedSessionId,
  ]);

  // `sidebarProps` feeds a `React.memo`-wrapped `SessionList`; a fresh
  // inline arrow on any one of its 40+ props defeats the whole shallow
  // compare, so every handler `sidebarProps` used to build inline is a
  // `useCallback` instead -- bodies unchanged, only the wrapping is new.
  const onSidebarOpenFilter = useCallback(() => {
    searchOrigin.current = focusedSessionId;
    setFiltering(true);
  }, [focusedSessionId]);

  const onSidebarFilterChange = useCallback(
    (next: string) => {
      setQuery(next);
      // incsearch: the answer arrives while you type, not after you
      // commit. Without it the list narrows under a focus ring that is
      // still pointing at a row the filter just removed.
      const first = searchMatches(allEntries, next)[0];
      if (first !== undefined) {
        focusSession(first);
      }
    },
    [allEntries, focusSession],
  );

  const onSidebarOriginFilters = useCallback(
    (next: SessionFilters) => savePrefs(setSessionFilters(prefs, next)),
    [savePrefs, prefs],
  );

  const onSidebarFilterCommit = useCallback(() => setFiltering(false), []);

  const onSidebarFilterCancel = useCallback(() => {
    setFiltering(false);
    setQuery('');
    setFocusedSessionId(searchOrigin.current);
  }, [setFocusedSessionId]);

  const onSidebarRenameCancel = useCallback(() => {
    setRenamingId(null);
    setRenameTarget(null);
  }, []);

  const onSidebarPick = useCallback(
    (sessionId: string) => {
      focusSession(sessionId);
      setMode('select');
    },
    [focusSession],
  );

  const onSidebarClose = useCallback(
    (sessionId: string) => {
      // The row's title, not the id: the same sentence the keyboard
      // path writes, about the same session.
      const entry = allEntries.find((e) => e.session.id === sessionId);
      void closeSession(sessionId, entry?.session.title ?? sessionId);
    },
    [allEntries, closeSession],
  );

  const onSidebarAdd = useCallback(() => {
    // The footer strip names no project, so it uses the focused
    // session's, exactly as `o` does — the two controls are one path.
    if (focusedEntry === null) {
      setStatus('pick a session first — a new one is started in its project');
      return;
    }
    void createSession(focusedEntry.project.id, focusedEntry.project.name);
  }, [focusedEntry, createSession]);

  const onSidebarAddInProject = useCallback(
    (project: Project) => void createSession(project.id, project.name),
    [createSession],
  );

  const onSidebarPickGroupIcon = useCallback(
    (group: Group) => {
      const source = groupSource(prefs.groups, group.id);
      if (source === null) return;
      setPickingGroupIconFor((current) =>
        current !== null && current.groupId === group.id
          ? null
          : { source, groupId: group.id, name: group.name },
      );
    },
    [prefs.groups],
  );

  const onSidebarAddToGroup = useCallback(
    (group: Group) => {
      const source = groupSource(prefs.groups, group.id);
      if (source === null) return;
      setPickingMembersFor({ source, groupId: group.id, name: group.name });
    },
    [prefs.groups],
  );

  const onSidebarRemoveProject = useCallback(
    (project: Project, plan: RemovalPlan) => void removeProject(project, plan),
    [removeProject],
  );

  const onSidebarNewProject = useCallback(() => void newProject(), [newProject]);

  const onSidebarPickIcon = useCallback((project: Project) => {
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
  }, []);

  /**
   * Keep the name the operator just typed on a project's heading -- the same
   * local override `commitRename` writes for a session, one field over. An
   * empty name clears it and the source's own name comes back.
   */
  const renameOneProject = useCallback(
    (project: Project, name: string) => {
      if (project.source === undefined) {
        setStatus('this project has no source — rename unavailable');
        return;
      }
      savePrefs(setProjectRename(prefs, project.source, project.id, name, new Date()));
      setStatus(
        name.trim() === ''
          ? `"${project.name}" goes back to the name its source gives it`
          : `renamed to "${name.trim()}" — vam's own name for it, kept on this machine`,
      );
    },
    [prefs, savePrefs],
  );

  const onSidebarSettings = useCallback(() => {
    setSettingsSection('appearance');
    setSettingsOpen(true);
  }, []);
  const onSidebarRemote = useCallback(() => {
    setSettingsSection('remote');
    setSettingsOpen(true);
  }, []);

  const onSidebarToggleTheme = useCallback(
    () => savePrefs(setTheme(prefs, effective === 'dark' ? 'light' : 'dark')),
    [savePrefs, prefs, effective],
  );

  // Memoised for the same reason as the callbacks above: a JSX element
  // literal is a fresh object every render, and `resizeHandle` is one of
  // `SessionListProps`' members. `visible` is `prefs.paneVisibility` itself
  // now that there is no viewport-dependent layout swap to give it a second
  // identity, so this stays stable across a re-render that changed nothing.
  const sidebarResizeHandle = useMemo(
    () => (
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
    [visible, storedSidebar, storedDetail, viewportWidth, onPaneChange, onPaneCommit],
  );

  /**
   * The two panels’ props, lifted out of the JSX.
   *
   * A mechanical extraction with no behaviour of its own: the phone shell
   * (`PhoneShell`) is handed the SAME two objects the columns are built from,
   * so there is one assembly of each panel’s props and not a second one that
   * could drift from it.
   */
  // Still asking for the FIRST answer, on whichever transport this canvas has:
  // 'connecting' and 'session' carry it from `useSourceModel`, 'live' has its
  // own `status`, 'demo' never loads.
  const sidebarLoading =
    source.kind === 'connecting'
      ? source.error === undefined || source.error === null
      : source.kind === 'session'
        ? source.loading === true
        : source.kind === 'live'
          ? source.status === 'loading'
          : false;

  const sidebarProps: ComponentProps<typeof SessionList> = {
    // The line at this column's top edge, off the SAME `mode` the status
    // bar's word reads. Select is the sidebar's mode and only the
    // sidebar's -- the canvas is a view, not a place the keyboard goes, so
    // no other column takes this. A hidden column is not rendered at all,
    // so it needs no second test against `visible` here either -- the slot
    // already is that test.
    keyboardHere: mode === 'select',
    entries: entries,
    loading: sidebarLoading,
    // The UNFILTERED set, for the two things about removing a project
    // that must not read a narrowed list -- see `allEntries` on
    // `SessionListProps`. `entries` above has already been through
    // search, the status pills and the origin rules.
    allEntries: allEntries,
    focusedSessionId: focusedEntry?.session.id ?? null,
    workspace: 'factory',
    theme: effective,
    onToggleTheme: onSidebarToggleTheme,
    onOpenFilter: onSidebarOpenFilter,
    filter: query,
    filtering: filtering,
    onFilterChange: onSidebarFilterChange,
    statusFilter: statusFilter,
    onStatusFilter: setStatusFilter,
    // `tally` is already `Record<StatusFilter, number>`; passed as-is
    // rather than rebuilt into a fresh object literal each render.
    statusTally: tally,
    filterMenuOpen: filterMenuOpen,
    onFilterMenuToggle: setFilterMenuOpen,
    originFilters: prefs.filters,
    onOriginFilters: onSidebarOriginFilters,
    hiddenCounts: hiddenCounts,
    onFilterCommit: onSidebarFilterCommit,
    onFilterCancel: onSidebarFilterCancel,
    renamingId: renamingId,
    renameDraft: renameDraft,
    onRenameChange: setRenameDraft,
    onRenameCommit: commitRename,
    onRenameCancel: onSidebarRenameCancel,
    onPick: onSidebarPick,
    onClose: onSidebarClose,
    onAdd: onSidebarAdd,
    onAddInProject: onSidebarAddInProject,
    pendingAction: pendingAction,
    // The group layer. `model.groups` rather than the filtered model's,
    // because the only thing this prop is for is a group holding no live
    // project -- see the prop -- and a filter cannot narrow one further.
    // `EMPTY_GROUPS`, not a fresh `[]`, for the same reason as `statusTally`.
    groups: model.groups ?? EMPTY_GROUPS,
    collapsedGroups: collapsedGroups,
    onToggleGroupCollapse: toggleGroupCollapse,
    onCreateGroup: createNewGroup,
    onRenameGroup: renameOneGroup,
    onPickGroupIcon: onSidebarPickGroupIcon,
    onUngroup: ungroup,
    onAddToGroup: onSidebarAddToGroup,
    hiddenProjects: hiddenProjects,
    // Restoring is the only thing the sidebar asks for by itself: it
    // ends nothing, so there is nothing to serialise or refuse.
    onHideProject: setProjectRemoved,
    onRemoveProject: onSidebarRemoveProject,
    revealRequest: revealRequest,
    onNewProject: onSidebarNewProject,
    newSessionDecline: newSessionDecline,
    onPickIcon: onSidebarPickIcon,
    onRenameProject: renameOneProject,
    onSettings: onSidebarSettings,
    onRemote: onSidebarRemote,
    width: sidebarWidth,
    resizeHandle: sidebarResizeHandle,
  };

  /**
   * A15.1 — one `DetailPanel` prop set per PANE, not one shared set.
   *
   * `DetailPanel.tsx` is fenced (owned by a concurrent agent), so the
   * isolation every split pane needs — `outIsLive`, the auto-follow
   * `stuckRef`, the sticky IN, the view icons — cannot be built inside it.
   * It comes instead from `Canvas.tsx` mounting one SEPARATE `DetailPanel`
   * element per leaf (see `renderLeaf` below): each gets its own React
   * component instance, so internal state one pane holds can never be read
   * or written by another. This function is what makes every OTHER prop —
   * the composer, the action cursor, whether this pane currently holds the
   * app's Insert-mode keyboard — agree with that isolation instead of all
   * pointing at whichever session happens to be globally focused.
   *
   * `isFocused` gates exactly three things: `tabRequest` (a one-shot ask
   * from `Mod-<digit>`, which only ever means "the pane the keyboard is in
   * right now"), `active` (whether this pane currently holds Insert), and
   * whether leaving the composer also drops the app back to Select — a
   * background pane's own Escape has no sidebar-focus fact to give back.
   * Everything else — the draft, whether it is composing, its action
   * cursor, whether it is mid-send — reads and writes the SAME per-session
   * `*BySession` records the single-pane shell already used, keyed by this
   * pane's own session rather than the globally-focused one, so two panes
   * showing two different sessions get two independent composers for free.
   * `onCompose`/`onDraftChange` on a pane that is not yet focused ALSO move
   * the keyboard there first — the same "clicking into it is how you focus
   * it" contract a real click already has everywhere else in this shell.
   */
  const buildDetailProps = useCallback(
    (
      entry: SessionEntry | null,
      sessionId: string | null,
      paneId: string,
      isFocused: boolean,
    ): ComponentProps<typeof DetailPanel> => {
      const paneDraft = sessionId === null ? '' : (draftsBySession[sessionId] ?? '');
      const paneComposing = sessionId === null ? false : (composingBySession[sessionId] ?? false);
      const paneWriting = sessionId === null ? false : (writingBySession[sessionId] ?? false);
      const paneActionIndex = sessionId === null ? 0 : (actionIndexBySession[sessionId] ?? 0);
      return {
        entry,
        decision: entry?.session.decisions[0] ?? null,
        // See `detailProps`'s own long-standing comment on this prop, still
        // true per pane: it is "which session THIS pane's cursor sits on".
        focusNodeId: sessionId,
        delivers: source.kind === 'session' && source.source.capabilities.deliverPrompt,
        pickImageAttachment:
          source.kind === 'session' ? source.source.write?.pickImageAttachment : undefined,
        answer: globalThis.window?.api?.terminal?.answer,
        prompt:
          source.kind === 'demo'
            ? async () => DEMO_PROMPT
            : globalThis.window?.api?.terminal?.prompt,
        terminal: terminalTab,
        // A15.4 — the GLOBAL "what a new session starts with"
        // preference, identical for every pane (it names nothing about
        // THIS session, only the next one created), the same reasoning
        // `delivers`/`terminal` above already read off `source` once for
        // every pane rather than per-session.
        defaultProvider: prefs.defaultProvider,
        onSetDefaultProvider: (id) => savePrefs(setDefaultProvider(prefs, id)),
        sending: paneWriting,
        // A one-shot ask only the FOCUSED pane may consume — see the doc
        // comment above.
        tabRequest: isFocused ? tabRequest : null,
        initialTab: prefs.detailTab,
        onTabChange: (next) => {
          if (next !== prefs.detailTab) {
            savePrefs(setDetailTab(prefs, next));
          }
        },
        draft: paneDraft,
        onDraftChange: (value: string) => {
          if (sessionId === null) return;
          if (!isFocused) setFocusedPaneId(paneId);
          setDraftFor(sessionId, value);
        },
        onSubmit: () => sendPromptFor(entry),
        active: isFocused && mode === 'insert',
        actionIndex: paneActionIndex,
        composing: paneComposing,
        onCompose: () => {
          if (sessionId === null) return;
          if (!isFocused) setFocusedPaneId(paneId);
          setMode('insert');
          setComposingFor(sessionId, true);
        },
        onStopComposing: () => {
          if (sessionId === null) return;
          setComposingFor(sessionId, false);
          setDraftFor(sessionId, '');
          // Only the focused pane's Escape hands the keyboard back to the
          // sidebar — a background pane was never where the keyboard was.
          if (isFocused) {
            setMode('select');
          }
        },
        width: undefined,
        resizeHandle: null,
      };
    },
    [
      draftsBySession,
      composingBySession,
      writingBySession,
      actionIndexBySession,
      source,
      terminalTab,
      tabRequest,
      prefs,
      savePrefs,
      setFocusedPaneId,
      setDraftFor,
      setComposingFor,
      sendPromptFor,
      mode,
    ],
  );

  /**
   * The FOCUSED pane's own props — the same object the pre-split shell
   * always built, and still what `PhoneShell` is handed (a phone has no
   * room for a split, and the chord grammar that would create one is
   * already off there — see the `onKeyDown` effect's own guard).
   */
  const detailProps = useMemo(
    () => buildDetailProps(focusedEntry, focusedSessionId, focusedPaneId, true),
    [buildDetailProps, focusedEntry, focusedSessionId, focusedPaneId],
  );

  /**
   * One `DetailPanel`, mounted for one leaf of `panes` — the render-side
   * half of the isolation `buildDetailProps` sets up. `key={leaf.id}` is
   * not decorative: two leaves are two DOM siblings regardless, but a leaf
   * that stays mounted while its OWN `sessionId` changes (the focused pane
   * switching which session it shows) must still be a fresh component
   * instance, or `DetailPanel`'s internal state for the session it used to
   * show would bleed into the one it shows now — the very bleed this whole
   * feature exists to prevent, just aimed at itself instead of at another
   * pane.
   */
  const renderLeaf = useCallback(
    (leaf: Leaf) => {
      const isFocused = leaf.id === focusedPaneId;
      // The focused leaf reuses `focusedEntry` (the FILTERED lookup,
      // `buildDetailProps`'s and `detailProps`'s own contract) rather than
      // a second lookup that could disagree with it about the one pane
      // every existing test already asserts against.
      const entry = isFocused
        ? focusedEntry
        : leaf.sessionId === null
          ? null
          : (entriesById.get(leaf.sessionId) ?? null);
      const splitCount = leaves(panes).length;
      /**
       * THIS PANE's own tabs, in the order it opened them — the leaf's list
       * resolved against the model, never `entries`' whole project. A id
       * whose session has gone draws nothing until the prune effect above
       * catches up, and A13.1's project scoping is kept here as well: a
       * strip only ever lists the ACTIVE project's sessions, so a pane left
       * over from another project cannot draw one.
       */
      const paneTabs = leaf.sessionIds.flatMap((sessionId) => {
        const tabEntry = entriesById.get(sessionId);
        if (tabEntry === undefined) {
          return [];
        }
        return activeProjectId !== null && tabEntry.project.id !== activeProjectId
          ? []
          : [tabEntry];
      });
      return (
        // Not a control and not a keyboard stop of its own -- the real
        // interactive content is the `DetailPanel` instance inside it,
        // reached by Tab like any other pane. `onMouseDownCapture` is
        // "clicking anywhere in here focuses this pane", a background fact
        // the same way a browser tab's own click-to-activate is; the drag
        // handlers are the drop target for A15.1's split gesture. Keyboard
        // split-switching (`zw`/`zW`) does not go through this element at all.
        // biome-ignore lint/a11y/noStaticElementInteractions: see above.
        <div
          key={leaf.id}
          data-split-pane={leaf.id}
          data-split-focused={isFocused ? 'true' : 'false'}
          // The ring only draws once a second pane exists — an unsplit shell
          // must render pixel-identical to before this feature, and a ring
          // around the one pane that always has the keyboard would be noise
          // nobody asked for.
          className={`relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas ${
            isFocused && splitCount > 1 ? 'ring-1 ring-inset ring-cursor-ring' : ''
          }`}
          onMouseDownCapture={() => {
            if (!isFocused) setFocusedPaneId(leaf.id);
          }}
          onDragOver={onPaneDragOver(leaf.id)}
          onDragLeave={onPaneDragLeave(leaf.id)}
          onDrop={onPaneDrop(leaf.id)}
        >
          <TabStripRow>
            <TabStrip
              orientation="horizontal"
              tabs={paneTabs}
              activeId={leaf.sessionId}
              onSelect={(sessionId) => {
                // The pane whose strip was clicked is the pane the keyboard
                // moves to FIRST: `setFocusedPaneId` writes its ref
                // synchronously, so the `setFocusedSessionId` below lands in
                // this pane rather than in whichever one held focus before.
                setFocusedPaneId(leaf.id);
                setFocusedSessionId(sessionId);
              }}
              onClose={(sessionId) => closePaneTab(leaf.id, sessionId)}
              onTabDragStart={(sessionId) => onTabDragStart(leaf.id, sessionId)}
              onTabDragEnd={onTabDragEnd}
            />
            <NewTabButton
              decline={newSessionDecline}
              onClick={() => {
                // This pane takes the keyboard first, exactly as clicking one
                // of its tabs does — pressing `+` in an unfocused pane must
                // not leave the caret in the pane the session did not land in.
                setFocusedPaneId(leaf.id);
                // WHICH PROJECT: this pane's own front tab, else the first tab
                // it holds — the same "a new session is born in the focused
                // one's project" rule `o` follows, read per pane rather than
                // globally. A pane holding nothing names no directory, and vam
                // will not pick one for it.
                const target = entry ?? paneTabs[0] ?? null;
                if (target === null) {
                  setStatus('pick a session first — a new one is started in its project');
                  return;
                }
                void createSession(target.project.id, target.project.name, leaf.id);
              }}
            />
          </TabStripRow>
          <DetailPanel {...buildDetailProps(entry, leaf.sessionId, leaf.id, isFocused)} />
          {dropTarget !== null && dropTarget.paneId === leaf.id && (
            <DropZoneOverlay edge={dropTarget.edge} />
          )}
        </div>
      );
    },
    [
      focusedPaneId,
      focusedEntry,
      entriesById,
      activeProjectId,
      panes,
      buildDetailProps,
      closePaneTab,
      setFocusedPaneId,
      setFocusedSessionId,
      onTabDragStart,
      onTabDragEnd,
      onPaneDragOver,
      onPaneDragLeave,
      onPaneDrop,
      createSession,
      newSessionDecline,
      dropTarget,
    ],
  );

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
      {/* Named none of them on a phone: the phone shell below takes their
          place entirely, so nothing here mounts a pane it also draws. */}
      {!phone && (
        <div className="flex min-h-0 flex-1">
          <SidebarSlot show={visible.sidebar} {...sidebarProps} />
          {/* A12.1: the tab strip is the top of the detail pane's OWN
              column, not a strip above a separate middle column — there is
              no middle column any more. The source readout that used to
              sit beside the strip is gone from here (A12.1 item 3): it
              moved to the status bar, the one place already on screen
              whether or not a session is focused, so "is vam connected" is
              never something the tab row alone had to say. */}
          <DetailColumn show={visible.detail} width={detailWidth}>
            <SplitLayout tree={panes} renderLeaf={renderLeaf} />
          </DetailColumn>
        </div>
      )}

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
          initialSection={settingsSection}
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

      {confirmForceClose !== null && (
        <ConfirmForceClose
          title={confirmForceClose.title}
          onConfirm={() => {
            const target = confirmForceClose;
            setConfirmForceClose(null);
            void closeSession(target.sessionId, target.title, true);
          }}
          onCancel={() => setConfirmForceClose(null)}
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
                  // session entries, which breaks the sidebar's own React
                  // keys and the id `j`/`k` navigates by (`to-canvas.ts:312`).
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

      {pickingGroupFor !== null && (
        <GroupPicker
          projectName={pickingGroupFor.name}
          choices={groupPickerChoices}
          onPick={(groupId) => {
            const name =
              groupPickerChoices.find((choice) => choice.id === groupId)?.name ?? groupId;
            savePrefs(
              addProjectToGroup(prefs, pickingGroupFor.source, groupId, pickingGroupFor.projectId),
            );
            setStatus(`${pickingGroupFor.name} → ${name}`);
            setPickingGroupFor(null);
          }}
          onRemove={() => {
            const current = groupPickerChoices.find((choice) => choice.current);
            if (current === undefined) return;
            savePrefs(
              removeProjectFromGroup(
                prefs,
                pickingGroupFor.source,
                current.id,
                pickingGroupFor.projectId,
              ),
            );
            setStatus(`${pickingGroupFor.name} is back at the top level`);
            setPickingGroupFor(null);
          }}
          onCreate={(name) => {
            // Minted the same way `createNewGroup` mints one: no cwd to
            // digest, and it must exist before it holds anything.
            const id = `group:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            savePrefs(
              addProjectToGroup(
                createGroup(prefs, pickingGroupFor.source, id, name),
                pickingGroupFor.source,
                id,
                pickingGroupFor.projectId,
              ),
            );
            setStatus(`${pickingGroupFor.name} → ${name}`);
            setPickingGroupFor(null);
          }}
          onClose={() => setPickingGroupFor(null)}
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
          {/* A12.1 item 3: relocated here from the tab row, which now draws
              only tabs. This is the one thing a dashboard must never do
              differently depending on whether it is connected (the
              component's own doc comment), so it needs a permanent home —
              and the status bar, unlike the tab row, is on screen whether or
              not a session is even focused. */}
          <SourceReadout source={source} />
          <span className="h-3 w-px bg-line" />
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
      <span className="text-ink-quiet">{label}</span>
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
  factory: Factory,
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

export function Canvas({
  model,
  source = READ_ONLY_SOURCE,
}: {
  readonly model: CanvasModel;
  readonly source?: CanvasSource;
}) {
  return (
    // One tooltip group for the whole chrome: once one is open, the button
    // beside it opens with no second delay. No more `ReactFlowProvider` —
    // `CanvasInner` no longer calls `useReactFlow()` for anything.
    <TipProvider>
      <CanvasInner model={model} source={source} />
    </TipProvider>
  );
}
