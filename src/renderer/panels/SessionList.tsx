/**
 * The left sidebar: every session, grouped by project.
 *
 * FLAT, not a card (operator request, sidebar-flat): a project's heading is a
 * caption above its own rows, not a bordered box around them — orca's shape.
 * The grouping is still one pass over `entries`, which arrives project-major
 * from `orderedSessions`, building `[{ project, items }]` groups — no re-sort.
 * The heading is a plain `<div>` — not a control, not focusable, never a stop
 * for `j`. Grouping must not cost the one property this list has, which is
 * that `j` pressed N times lands N sessions further down no matter how many
 * project boundaries lie between, so `data-session-row` and
 * `data-project-heading` stay exactly where they were.
 *
 * The shape is the ADE mockup's: a workspace line, a search box, then project
 * headings with their rows beneath, with one loud "New session" strip at the
 * bottom — last, after the session rows, not first.
 *
 * Both PICKERS — the session's and the project's — live in `Canvas`, not
 * here. They are wider than this column, so `Canvas` floats them the way it
 * floats the command palette; the row only draws what came back.
 */

import {
  ChevronDown,
  ChevronRight,
  Filter,
  GitBranch,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { Project, SessionStatus } from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';
import type { SessionFilters, StatusFilter } from '../domain/session-filter.js';
import { DEFAULT_SESSION_FILTERS, STATUS_FILTERS } from '../domain/session-filter.js';
import type { EffectiveTheme } from '../prefs/prefs.js';
import { OverlayScroll } from './OverlayScroll.js';
import { revealScrollTop } from './reveal-row.js';

const STATUS_DOT: Readonly<Record<SessionStatus, string>> = {
  running: 'bg-running',
  waiting: 'bg-waiting',
  done: 'bg-done',
  failed: 'bg-failed',
};

/**
 * A branch name split so the END survives a narrow column.
 *
 * CSS `truncate` clips the tail, but the tail is the name: at the 200px
 * sidebar minimum, `smith/specs/vam-seam-plan` and
 * `smith/specs/vam-canvas-topology` both clip to `smith/specs/vam-...` —
 * identical, and cut exactly where they would have differed. So the leading
 * segments become the shrinkable part and the last segment is held at its
 * full width. A name with no slash is all tail; a trailing slash yields an
 * empty tail, which renders as nothing rather than as a crash.
 */
function splitBranch(branch: string): { head: string; tail: string } {
  const cut = branch.lastIndexOf('/');
  return cut === -1
    ? { head: '', tail: branch }
    : { head: branch.slice(0, cut + 1), tail: branch.slice(cut + 1) };
}

/**
 * How wide the filter popover opens when the sidebar has room for it.
 *
 * It replaces a fixed 212px, which was cramped enough that the two origin
 * rows truncated their own labels — and which, at the 200px sidebar minimum,
 * hung 36px off the LEFT EDGE OF THE WINDOW: the popover is anchored
 * `right-0` inside `data-projects-header`, whose padding box ends 12px short
 * of the sidebar's right edge, and the sidebar starts at the window's.
 *
 * So this is a ceiling, not a width. The floor is the column itself: the
 * drawn width is `min(this, sidebar - 24)` — a 12px gutter on each side —
 * which keeps the popover inside the sidebar, and therefore inside the
 * window, at every width the resizer allows (`SIDEBAR_MIN` = 200 gives 176,
 * the default 264 gives 240, and from 312 up it opens at its full 288).
 * Growing past the column would put it over the canvas, which is not a wider
 * popover so much as a popover somewhere else.
 */
export const FILTER_POPOVER_WIDTH = 288;

/** `px-3` on each side of `data-projects-header`, mirrored as a gutter. */
const FILTER_POPOVER_GUTTER = 24;

export type SessionListProps = {
  readonly entries: readonly SessionEntry[];
  readonly focusedSessionId: string | null;
  /** Which factory this is. The mockup calls it a workspace; vam has one. */
  readonly workspace: string;
  readonly filter: string;
  readonly filtering: boolean;
  readonly onFilterChange: (value: string) => void;
  readonly onFilterCommit: () => void;
  readonly onFilterCancel: () => void;
  /** Mouse route to what `/` does. */
  readonly onOpenFilter: () => void;
  /**
   * The status narrowing, and the popover that owns it.
   *
   * It used to be a `<Panel>` floating over the canvas. One piece of state
   * with two controls on two surfaces is a disagreement waiting to happen,
   * and the canvas was the wrong surface anyway: what the narrowing produces
   * is THIS list, so the control belongs beside it.
   */
  readonly statusFilter: StatusFilter;
  readonly onStatusFilter: (value: StatusFilter) => void;
  /** Counts over the UNFILTERED workspace — a count that moved when you
   * clicked it would be a count of your own click. */
  readonly statusTally: Readonly<Record<StatusFilter, number>>;
  readonly filterMenuOpen: boolean;
  readonly onFilterMenuToggle: (open: boolean) => void;
  /** The two origin toggles, and what each one costs you. */
  readonly originFilters: SessionFilters;
  readonly onOriginFilters: (next: SessionFilters) => void;
  /** How many sessions each rule matches, over the UNFILTERED workspace. A
   * toggle that hid things without saying how many would be a disappearance. */
  readonly hiddenCounts: { readonly agent: number; readonly unprompted: number };
  readonly renamingId: string | null;
  readonly renameDraft: string;
  readonly onRenameChange: (value: string) => void;
  readonly onRenameCommit: () => void;
  readonly onRenameCancel: () => void;
  readonly onPick: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
  readonly onAdd: () => void;
  /**
   * The `+` in a project's heading. Separate from `onAdd` because it can say
   * WHICH project the click was about, and the answer differs per project the
   * moment there is a route to create a session in one.
   */
  readonly onAddInProject: (project: Project) => void;
  /**
   * The `+` in the Projects header. A project here is a grouping of live
   * sessions on their cwd, so there is nothing to "create" — the only thing
   * this can mean is: choose a directory, start a session in it, and the
   * project exists because something is running there. The caller owns both
   * halves; this component owns the button.
   */
  readonly onNewProject: () => void;
  /**
   * Why a new session cannot be started, in the SOURCE's own words, or `null`
   * when it can. Both `+` controls caption themselves from this: a control
   * that claims it works when it does not is the defect this prop exists to
   * make impossible, and the component cannot ask a source anything itself.
   */
  readonly newSessionDecline: string | null;
  /**
   * The id of the one action currently in flight -- a project id for a create,
   * a session id for a close -- or `null`. Owned by `Canvas.tsx`, which is
   * also where the guard that stops a second press lives; this draws it. One
   * prop rather than one per control, because it is one fact.
   */
  readonly pendingAction: string | null;
  /** Opens the icon picker for a project's heading — the mouse route; there
   * is no keyboard shortcut for it, unlike the session picker's `s`. */
  readonly onPickIcon: (project: Project) => void;
  /**
   * The ids of the projects that are folded shut, and the ask to fold one.
   *
   * OPTIONAL, and that is a decision rather than an oversight: without them
   * this component keeps the fold in its own state, so folding works the day
   * it ships. Pass them — from `prefs.collapsedProjects` via
   * `isProjectCollapsed`/`setProjectCollapsed` — and the fold survives a
   * reload instead of a re-render.
   */
  readonly collapsedProjects?: readonly string[];
  readonly onToggleCollapse?: (project: Project) => void;
  /**
   * The project `p` has just asked to reveal, or null when nothing has been
   * asked. A fresh object each press, so pressing `p` twice reveals twice.
   *
   * The ask arrives as a prop because the KEY is not this component's: it is
   * `revealProject` in the chord table, resolved by the one window listener in
   * `Canvas.tsx`. See the effect below for what that bought.
   */
  readonly revealRequest?: { readonly projectId: string } | null;
  readonly onSettings: () => void;
  /**
   * The theme ON SCREEN, already resolved — never `prefs.theme`, which can be
   * `system`. The two-way ternary below is exactly why: a third value would
   * land in its `else` arm, label the wrong direction and typecheck anyway.
   */
  readonly theme: EffectiveTheme;
  readonly onToggleTheme: () => void;
  /** The current rendered width (task-1's `renderedWidth`), applied inline. */
  readonly width: number;
  /** `PaneResizer`, positioned by the caller — kept out of this file's own concerns. */
  readonly resizeHandle: ReactNode;
};

export function SessionList(props: SessionListProps) {
  const {
    entries,
    focusedSessionId,
    workspace,
    filter,
    filtering,
    onFilterChange,
    onFilterCommit,
    onFilterCancel,
    onOpenFilter,
    statusFilter,
    onStatusFilter,
    statusTally,
    filterMenuOpen,
    onFilterMenuToggle,
    originFilters,
    onOriginFilters,
    hiddenCounts,
    renamingId,
    renameDraft,
    onRenameChange,
    onRenameCommit,
    onRenameCancel,
    onPick,
    onClose,
    onAdd,
    onAddInProject,
    onNewProject,
    newSessionDecline,
    pendingAction,
    onPickIcon,
    revealRequest,
    collapsedProjects,
    onToggleCollapse,
    onSettings,
    theme,
    onToggleTheme,
    width,
    resizeHandle,
  } = props;

  /**
   * What a control wears while its own action is running: it cannot be pressed
   * again, it says so to a screen reader and on hover, and `data-pending`
   * carries the breathe in `styles.css` -- switched off under
   * `prefers-reduced-motion`, where these attributes and the caption are what
   * is left, and they are enough.
   */
  const pending = (id: string, busy: string) =>
    pendingAction === id
      ? ({ 'data-pending': 'true', 'aria-busy': true, disabled: true, title: busy } as const)
      : {};

  const filterRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuWasOpen = useRef(false);

  /**
   * Where the keyboard goes when the popover opens, and where it comes back
   * to when it closes.
   *
   * Written as one effect on the OPEN flag rather than in the click handler,
   * because there are two ways to close it — the control itself and the
   * global Escape — and a keyboard user stranded on `document.body` by one of
   * them would have no way back into the list. Nothing here traps Tab: the
   * popover is a plain run of buttons, so Tab walks out of it the way it
   * walks out of anything else.
   */
  useEffect(() => {
    if (filterMenuOpen) {
      menuRef.current?.querySelector('button')?.focus();
    } else if (menuWasOpen.current) {
      menuButtonRef.current?.focus();
    }
    menuWasOpen.current = filterMenuOpen;
  }, [filterMenuOpen]);

  /**
   * A press anywhere outside closes the popover.
   *
   * `pointerdown`, not `click`: a click only lands after the button is
   * released, so a press-drag-release that starts outside and ends inside
   * would never close it, and the menu would still be open under the pointer
   * that was trying to dismiss it. Pointerdown is also what every other
   * dismissible surface in a desktop app listens for.
   *
   * The toggle button is excluded explicitly. Without that, pressing it while
   * the menu is open runs BOTH this handler and the button's own `onClick`,
   * which closes and reopens in one press and looks like the button is dead.
   *
   * Listener attached only while open, so a closed sidebar costs nothing.
   */
  useEffect(() => {
    if (!filterMenuOpen) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target === null) {
        return;
      }
      if (menuRef.current?.contains(target) === true) {
        return;
      }
      if (menuButtonRef.current?.contains(target) === true) {
        return;
      }
      onFilterMenuToggle(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [filterMenuOpen, onFilterMenuToggle]);

  // Imperative focus in both cases, for the same reason: the keystroke that
  // opened the box is the request for it, so `autoFocus` would be claiming a
  // thing that was already granted, wherever the element happened to mount.
  useEffect(() => {
    if (filtering) {
      filterRef.current?.focus();
    }
  }, [filtering]);
  useEffect(() => {
    if (renamingId !== null) {
      renameRef.current?.select();
    }
  }, [renamingId]);

  /**
   * Which heading is showing its controls, from EITHER route.
   *
   * One piece of state for hover and for `p`, not two, so there is a single
   * answer to "is this heading revealed" — two would disagree the first time
   * the pointer left a heading the keyboard had just revealed.
   */
  const [revealed, setRevealed] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  /**
   * The fold, when no caller owns it. See `collapsedProjects` above: the
   * prop wins when it is passed, and this is what makes the control real
   * rather than inert while the wiring to prefs is someone else's file.
   */
  const [localCollapsed, setLocalCollapsed] = useState<readonly string[]>([]);
  const collapsed = collapsedProjects ?? localCollapsed;

  const projectMenuRefs = useRef(new Map<string, HTMLButtonElement>());
  const foldRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const projectPanelRef = useRef<HTMLDivElement>(null);
  const openMenuWas = useRef<string | null>(null);

  const toggleCollapse = useCallback(
    (project: Project) => {
      if (onToggleCollapse !== undefined) {
        onToggleCollapse(project);
        return;
      }
      setLocalCollapsed((current) =>
        current.includes(project.id)
          ? current.filter((id) => id !== project.id)
          : [...current, project.id],
      );
    },
    [onToggleCollapse],
  );

  /**
   * `p` — reveal the focused session's project and put the keyboard on its
   * fold.
   *
   * The reveal is the point: everything hover shows, `p` shows too, and it
   * lands on the first of the two controls so the next Tab reaches the menu.
   * Chosen over "toggle the fold directly" because a key that folds without
   * showing you the control teaches nothing about where the control is.
   *
   * IT USED TO OWN ITS OWN WINDOW LISTENER HERE, on the argument that a new
   * action kind would be a compile error in two files that task did not own.
   * Sound, and the price was two defects this project has fixed everywhere
   * else: the key was in no `buildKeySheet` row, because the sheet is derived
   * from the chord tables and this was not in one; and it fired while an
   * overlay was open, because the overlay guard lives in the one listener this
   * one bypassed. So the KEY moved into the table and only its EFFECT stayed —
   * the reveal and the focus are this component's own state and refs.
   */
  useEffect(() => {
    if (revealRequest === null || revealRequest === undefined) {
      return;
    }
    const { projectId } = revealRequest;
    if (!entries.some((candidate) => candidate.project.id === projectId)) {
      return;
    }
    setRevealed(projectId);
    foldRefs.current.get(projectId)?.focus();
  }, [entries, revealRequest]);

  /**
   * Bring the focused row into view when it is not.
   *
   * `j`/`k`, `Cmd+number`, `gg`/`G` and search all move focus, so the cursor
   * routinely lands on a row scrolled out of sight. `reveal-row.ts` decides
   * how far — minimum distance, and `null` for a row already visible, so
   * ordinary `j`/`k` movement inside the viewport never repositions anything.
   *
   * Keyed on `focusedSessionId` ALONE, deliberately. The entries re-arrive on
   * every poll, and depending on them would re-run this after a scroll the
   * operator performed themselves, dragging them back to a row they had
   * chosen to scroll away from. Focus moving is the only thing that earns a
   * scroll.
   *
   * A session inside a collapsed project has no row rendered at all: the map
   * misses, and nothing scrolls. That is the honest answer — the fold is what
   * hides it, and `p` (or the fold control) is what shows it again.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    const row = focusedSessionId === null ? undefined : rowRefs.current.get(focusedSessionId);
    if (scroller === null || row === undefined) {
      return;
    }
    const box = row.getBoundingClientRect();
    const top = revealScrollTop({
      // Into the scroller's content coordinates: both rects are viewport-
      // relative, and the difference plus the current scroll is where the row
      // sits in the list itself.
      rowTop: box.top - scroller.getBoundingClientRect().top + scroller.scrollTop,
      rowHeight: box.height,
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
    });
    if (top === null) {
      return;
    }
    // Smooth scrolling is motion; someone who asked for less of it gets the
    // jump, not the loss of the behaviour.
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    scroller.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  }, [focusedSessionId]);

  /** Same contract as the filter popover above: in on open, back out on close. */
  useEffect(() => {
    if (openMenu !== null) {
      projectPanelRef.current?.querySelector('button')?.focus();
    } else if (openMenuWas.current !== null) {
      projectMenuRefs.current.get(openMenuWas.current)?.focus();
    }
    openMenuWas.current = openMenu;
  }, [openMenu]);

  /**
   * How many rules are narrowing the list right now — the badge's number.
   *
   * Derived, never stored: the status choice counts once when it is not
   * `all`, and each origin toggle counts once when it is on. That is exactly
   * the set of things the popover can turn on, so the badge can never drift
   * from what the popover shows.
   */
  const applied = (key: keyof SessionFilters) =>
    originFilters[key] && !DEFAULT_SESSION_FILTERS[key] ? 1 : 0;
  const activeFilters =
    (statusFilter === 'all' ? 0 : 1) + applied('hideAgentStarted') + applied('onlyPrompted');

  /**
   * Whether ANY rule is narrowing the list, default or not — what the toggle's
   * own border says.
   *
   * The badge and the border answer two different questions on purpose. The
   * badge counts rules the OPERATOR applied, so a default never shows up as a
   * number they did not put there. The border reports the state of the list,
   * so a default that is holding rows back still lights the control that opens
   * the popover explaining it: hidden, uncounted AND unmarked would leave a
   * hidden session indistinguishable from one that does not exist.
   */
  const narrowing =
    activeFilters > 0 || originFilters.hideAgentStarted || originFilters.onlyPrompted;

  const popoverWidth = Math.min(FILTER_POPOVER_WIDTH, width - FILTER_POPOVER_GUTTER);

  // `entries` arrives project-major (see the file doc comment), so one pass
  // collapsing consecutive same-project runs is a grouping, not a sort.
  const groups: { readonly project: Project; readonly items: readonly SessionEntry[] }[] = [];
  for (const entry of entries) {
    const current = groups[groups.length - 1];
    if (current !== undefined && current.project.id === entry.project.id) {
      (current.items as SessionEntry[]).push(entry);
    } else {
      groups.push({ project: entry.project, items: [entry] });
    }
  }

  /** The same groups, each carrying the two flags its heading renders from. */
  const folded = groups.map((group) => ({
    ...group,
    isCollapsed: collapsed.includes(group.project.id),
    isRevealed: revealed === group.project.id,
  }));

  return (
    <aside
      data-sidebar-pane
      className="relative flex h-full shrink-0 flex-col border-line border-r bg-sidebar"
      style={{ width }}
    >
      {resizeHandle}
      <div className="flex flex-col gap-2.5 border-line border-b p-3">
        {/* The avatar bar, which used to be the sidebar's footer.
            It took the place of the workspace line -- avatar, name and the
            word "workspace" -- which is gone at the operator's request. vam
            has exactly one workspace, so a line naming it spent the widest
            row in the column restating something that never varies, and the
            avatar already carries its initial for anyone who wants it. */}
        <div data-avatar-bar className="flex items-center gap-[7px]">
          <span className="flex h-[24px] w-[24px] flex-none items-center justify-center rounded-full bg-line-strong font-mono text-[10px] text-ink-dim">
            {workspace.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onSettings}
            aria-label="settings"
            className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] text-ink-faint hover:text-ink"
          >
            <Settings size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'switch to light theme' : 'switch to dark theme'}
            className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] text-ink-faint hover:text-ink"
          >
            <Sun size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {filtering ? (
              <div className="flex h-[30px] items-center gap-2 rounded-[8px] border border-line bg-panel px-2.5">
                <span className="font-mono text-[11px] text-ink-faint">/</span>
                <input
                  ref={filterRef}
                  value={filter}
                  onChange={(event) => onFilterChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onFilterCommit();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      onFilterCancel();
                    }
                  }}
                  placeholder="Search sessions"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint"
                  aria-label="filter sessions"
                />
                <span className="font-mono text-[10px] text-ink-faint">{entries.length}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={onOpenFilter}
                aria-label="search sessions"
                className="flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-[8px] border border-line bg-panel px-2.5 text-ink-faint hover:border-line-strong"
              >
                <Search size={14} strokeWidth={1.6} />
                <span className="flex-1 text-left text-[12px]">Search sessions</span>
                <span className="rounded-[4px] border border-line-strong px-1 py-px font-mono text-[9.5px]">
                  /
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* The seam between the two blocks, at the operator's request: search
          is one thing, the projects are another, and this row says so.
          Orca's shape. The filter control MOVED here from beside the search
          box -- moved, not copied: two controls answering the same question
          in one column is how a sidebar stops being readable. It belongs to
          the project list rather than to search, because what it narrows is
          the list below it. */}
      <div
        data-projects-header
        className="relative flex items-center gap-1.5 border-line border-b px-3 py-2"
      >
        <span className="font-mono text-[9.5px] text-ink-dim uppercase tracking-[0.12em]">
          Projects
        </span>
        <span className="flex-1" />
        {/* Choose a directory, start a session in it. That is the ONLY thing
            "new project" can mean here: a project is derived from the cwd of
            a live session, so there is nothing to create and nothing to
            store. Same 26px square as the filter control beside it — two
            controls in one row that are the same kind of thing. No chord is
            bound to it and none is captioned. */}
        <button
          type="button"
          data-new-project
          aria-label="new project"
          onClick={onNewProject}
          title={newSessionDecline ?? 'Choose a directory and start a session in it'}
          className="flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[7px] border border-line bg-panel text-ink-faint hover:border-line-strong"
        >
          <Plus size={13} strokeWidth={1.6} />
        </button>
        {/* Search answers "the one called permalink"; this answers "the ones
            that stopped" — two different questions, so two controls. */}
        <button
          type="button"
          ref={menuButtonRef}
          data-filter-toggle
          aria-haspopup="dialog"
          aria-expanded={filterMenuOpen}
          aria-label="filter sessions"
          onClick={() => onFilterMenuToggle(!filterMenuOpen)}
          className={[
            'relative flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-[7px] border bg-panel',
            filterMenuOpen || narrowing
              ? 'border-line-loud text-ink'
              : 'border-line text-ink-faint hover:border-line-strong',
          ].join(' ')}
        >
          <Filter size={13} strokeWidth={1.6} />
          {/* Absent at zero, not a zero. A badge reading "0" is a badge
              claiming something is narrowed when nothing is, and the count
              this draws is the count of rules actually excluding sessions.
              A DEFAULT is not one of them: it is not a rule the operator
              applied, so a fresh install would open showing a "1" for a
              choice nobody made. The border above still reports it, and the
              popover names it. The colour is `filter-badge`, which carries
              waiting's amber under its own name — see `styles.css`. */}
          {activeFilters > 0 && (
            <span
              data-filter-badge
              className="-top-1 -right-1 absolute flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-filter-badge px-[3px] font-mono text-[8.5px] text-canvas"
            >
              {activeFilters}
            </span>
          )}
        </button>

        {filterMenuOpen && (
          <div
            ref={menuRef}
            data-filter-menu
            role="dialog"
            aria-label="session filters"
            style={{ width: popoverWidth }}
            className="absolute top-[36px] right-0 z-20 flex flex-col gap-2 rounded-[9px] border border-line-strong bg-panel p-2.5 shadow-lg"
          >
            <span className="font-mono text-[9.5px] text-ink-faint uppercase tracking-[0.12em]">
              Status
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map(([key, label]) => {
                const on = statusFilter === key;
                const count = statusTally[key];
                const loud = key === 'waiting' && count > 0;
                return (
                  <button
                    key={key}
                    type="button"
                    data-status-pill={key}
                    aria-pressed={on}
                    onClick={() => onStatusFilter(key)}
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
            </div>

            <span className="mt-0.5 font-mono text-[9.5px] text-ink-faint uppercase tracking-[0.12em]">
              Origin
            </span>
            {/* Each row says what it takes away. A count is the difference
                between narrowing a list and losing something out of it. */}
            {(
              [
                [
                  'agent',
                  'Hide agent/test sessions',
                  originFilters.hideAgentStarted,
                  hiddenCounts.agent,
                  DEFAULT_SESSION_FILTERS.hideAgentStarted,
                ],
                [
                  'prompted',
                  'Only ones I have prompted',
                  originFilters.onlyPrompted,
                  hiddenCounts.unprompted,
                  DEFAULT_SESSION_FILTERS.onlyPrompted,
                ],
              ] as const
            ).map(([key, label, on, hides, byDefault]) => (
              <button
                key={key}
                type="button"
                data-origin-toggle={key}
                aria-pressed={on}
                onClick={() =>
                  onOriginFilters(
                    key === 'agent'
                      ? { ...originFilters, hideAgentStarted: !on }
                      : { ...originFilters, onlyPrompted: !on },
                  )
                }
                className={[
                  'flex w-full cursor-pointer items-center gap-2 rounded-[7px] border px-2 py-1.5 text-left text-[11px]',
                  on
                    ? 'border-line-loud bg-raised text-ink'
                    : 'border-line text-ink-dim hover:border-line-strong',
                ].join(' ')}
              >
                <span
                  className={[
                    'h-[7px] w-[7px] flex-none rounded-full',
                    on ? 'bg-running' : 'bg-line-strong',
                  ].join(' ')}
                />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {/* The one place the operator can learn that a rule they
                    never chose is in force — the badge deliberately does not
                    count it. Only while it is ON and still at its shipped
                    value: once they turn it off and back on it is their
                    choice, and this stops claiming otherwise. */}
                {on && byDefault && (
                  <span
                    data-filter-default
                    className="flex-none rounded-full border border-line px-1.5 font-mono text-[8.5px] text-ink-faint uppercase tracking-[0.08em]"
                  >
                    default
                  </span>
                )}
                <span className="flex-none font-mono text-[9.5px] text-ink-faint">−{hides}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <OverlayScroll
        className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-2.5 py-2.5"
        scrollRef={(el) => {
          scrollerRef.current = el;
        }}
      >
        <ul className="flex flex-col gap-3.5">
          {folded.map(({ isCollapsed, isRevealed, ...group }) => (
            <li key={group.project.id} className="flex flex-col gap-[5px]">
              {/* A caption, not a stop. A plain <div>, so nothing can focus it
                and `j` never lands on a heading. */}
              {/* `min-h` reserves the add button's own height. The heading is
                  otherwise as tall as its tallest child, so the row -- and
                  every row under it -- would jump a few pixels each time focus
                  moved between projects and the add came or went. */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: the hover is
                  a pure reveal, and the keyboard has its own path to the same
                  controls -- `p`. The rule exists to catch mouse-ONLY
                  interaction; giving this heading a role or a tabindex to
                  satisfy it would put a stop in the list that `j` lands on,
                  which is the thing the comment above deliberately avoids. */}
              <div
                data-project-heading
                data-project-id={group.project.id}
                {...(isRevealed ? { 'data-project-revealed': 'true' } : {})}
                onMouseEnter={() => setRevealed(group.project.id)}
                onMouseLeave={() =>
                  setRevealed((current) => (current === group.project.id ? null : current))
                }
                className="relative flex min-h-[21px] items-center gap-[7px] px-1 pb-0.5"
              >
                <button
                  type="button"
                  data-project-icon={group.project.id}
                  onClick={() => onPickIcon(group.project)}
                  aria-label={`change icon for ${group.project.name}`}
                  title="change project icon"
                  className="flex h-[15px] w-[15px] flex-none cursor-pointer items-center justify-center text-[11px] leading-none text-ink-faint hover:text-ink-dim"
                >
                  {group.project.icon ?? (
                    /* A monitor, not a middot. The glyph has to read as "this
                       is a machine you can name" — the middot read as a bullet
                       and gave a clickable control no affordance at all. It is
                       a placeholder in the literal sense: the picker replaces
                       it with whatever emoji you choose, and choosing nothing
                       leaves something that still looks deliberate. */
                    <Monitor data-project-icon-placeholder size={11} strokeWidth={1.7} />
                  )}
                </button>
                <span className="truncate font-mono text-[9.5px] text-ink-dim uppercase tracking-[0.12em]">
                  {group.project.name}
                </span>
                <span className="font-mono text-[9.5px] text-ink-faint">{group.items.length}</span>
                <span className="flex-1" />

                {/* Revealed, never conditional. The row's close button is
                    removed from the DOM until hover, and that is right for a
                    control with a keyboard twin (`x`); these two have none, so
                    removing them would leave the fold reachable by pointer
                    only. Transparent-but-present keeps Tab working, and
                    `focus:opacity-100` means the tab stop you land on is a
                    thing you can see. */}
                <button
                  type="button"
                  ref={(node) => {
                    if (node === null) {
                      foldRefs.current.delete(group.project.id);
                    } else {
                      foldRefs.current.set(group.project.id, node);
                    }
                  }}
                  data-project-collapse={group.project.id}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? 'expand' : 'collapse'} ${group.project.name}`}
                  onClick={() => toggleCollapse(group.project)}
                  className={[
                    'flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-ink-faint hover:text-ink focus:opacity-100',
                    isRevealed || isCollapsed ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                >
                  {isCollapsed ? (
                    <ChevronRight size={12} strokeWidth={1.8} />
                  ) : (
                    <ChevronDown size={12} strokeWidth={1.8} />
                  )}
                </button>

                <button
                  type="button"
                  ref={(node) => {
                    if (node === null) {
                      projectMenuRefs.current.delete(group.project.id);
                    } else {
                      projectMenuRefs.current.set(group.project.id, node);
                    }
                  }}
                  data-project-menu={group.project.id}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === group.project.id}
                  aria-label={`more actions for ${group.project.name}`}
                  onClick={() =>
                    setOpenMenu((current) =>
                      current === group.project.id ? null : group.project.id,
                    )
                  }
                  className={[
                    'flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-full border border-transparent text-ink-faint hover:border-line-strong hover:text-ink focus:opacity-100',
                    isRevealed || openMenu === group.project.id ? 'opacity-100' : 'opacity-0',
                  ].join(' ')}
                >
                  <MoreHorizontal size={12} strokeWidth={1.8} />
                </button>

                {/* Real now: `createSession` starts a detached tmux session in
                  the project's own directory, so the caption says that. It
                  said "Sessions are created from the CLI" for a while after
                  that stopped being true, and carried `data-placeholder` on a
                  live control — a tooltip is a claim, and a wrong one costs
                  more than none. When a source genuinely cannot create, the
                  caption is that source's own refusal and the click still
                  answers on the status bar: refusing on click and saying why
                  is honest; refusing by being unclickable just reads as
                  broken. */}
                {/* This used to render only for the project holding focus, on
                  the reasoning that one `+` per heading meant a column of
                  boxes standing over the session names at all times, for a
                  control that "can only mean the project holding focus". Half
                  of that has expired: since the add genuinely creates a
                  session in the project it names, adding to a project you are
                  not currently in is an ordinary thing to want, and gating on
                  focus read to the operator as the button having disappeared.
                  So it follows the menu's idiom now -- always in the DOM,
                  revealed on hover of its own heading, and left opaque for the
                  project that holds focus. The column-of-boxes objection is
                  answered by the reveal, not by absence. The cost the old
                  comment was buying off is real and accepted: every heading is
                  a tab stop again, so Tab through a sidebar of N projects
                  passes 3N heading controls before the rows. `focus:opacity-100`
                  keeps each stop visible when you land on it, and the keyboard
                  path that matters -- `j`/`k` down the sessions, `p` to the
                  focused project's controls -- does not go through Tab at
                  all. */}
                {/* Last in the row, and last in tab order with it. The two
                  controls that act on the heading itself come first; the one
                  that adds something to the project comes after them. DOM
                  order is the only thing setting tab order here -- there is no
                  tabindex anywhere in this row -- so moving the markup moved
                  the keyboard path, and that is the intent, not a side
                  effect. */}
                <button
                  type="button"
                  data-new-session-in-project={group.project.id}
                  onClick={() => onAddInProject(group.project)}
                  title={newSessionDecline ?? `New session in ${group.project.name}`}
                  aria-label={`new session in ${group.project.name}`}
                  className={[
                    'flex h-[19px] w-[19px] flex-none cursor-pointer items-center justify-center rounded-[5px] border border-transparent text-ink-ghost hover:border-line-strong hover:text-ink-dim focus:opacity-100',
                    isRevealed || group.items.some((entry) => entry.session.id === focusedSessionId)
                      ? 'opacity-100'
                      : 'opacity-0',
                  ].join(' ')}
                  {...pending(group.project.id, `Starting a session in ${group.project.name}…`)}
                >
                  <Plus size={13} strokeWidth={1.7} />
                </button>

                {/* Two items, and both of them do something. There is no
                    "Project settings" because vam has no per-project setting
                    to open, and no "Remove project" because a project here is
                    a grouping of live sessions on their cwd -- there is
                    nothing to remove, and a menu item whose only behaviour is
                    to report that would be the fifth such control removed from
                    this app this week. */}
                {openMenu === group.project.id && (
                  <div
                    ref={projectPanelRef}
                    data-project-menu-panel={group.project.id}
                    role="menu"
                    aria-label={`${group.project.name} actions`}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setOpenMenu(null);
                      }
                    }}
                    className="absolute top-[19px] right-0 z-20 flex w-[168px] flex-col rounded-[9px] border border-line-strong bg-panel p-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-project-menu-item="collapse"
                      onClick={() => {
                        toggleCollapse(group.project);
                        setOpenMenu(null);
                      }}
                      className="cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-dim hover:bg-raised hover:text-ink"
                    >
                      {isCollapsed ? 'Expand project' : 'Collapse project'}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-project-menu-item="icon"
                      onClick={() => {
                        onPickIcon(group.project);
                        setOpenMenu(null);
                      }}
                      className="cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-dim hover:bg-raised hover:text-ink"
                    >
                      Change project icon
                    </button>
                  </div>
                )}
              </div>

              {/* The indent lives on ONE container per project, not on each
                  row. A margin per row would have to be repeated on the
                  rename editor too, and any row that missed it would sit a
                  few pixels out of line with its neighbours' hover and focus
                  backgrounds -- the failure mode that makes an indent look
                  like a bug. Here the rows keep their own padding contract
                  untouched, and the focused row's slab and its status stripe
                  move inward WITH the row: the stripe then lands exactly on
                  the indent line, which is the edge that says "these belong
                  to that heading". Full-bleed highlight was the alternative
                  and it is the wrong one -- a background wider than the row
                  it highlights re-erases the grouping the indent just drew.
                  Six pixels, because the sidebar is narrow: the rows already
                  carry 10px of their own left padding, so this is a visible
                  step without spending a tab stop of a column where the
                  title, the branch and the age all truncate. */}
              {!isCollapsed && (
                <div
                  data-project-rows={group.project.id}
                  className="flex flex-col gap-[5px] pl-1.5"
                >
                  {group.items.map((entry) => {
                    const { session } = entry;
                    const isFocused = session.id === focusedSessionId;
                    const needsYou = session.status === 'waiting';

                    return (
                      <div key={session.id}>
                        {renamingId === session.id ? (
                          <div className="flex items-center gap-1.5 rounded-[9px] border border-line-loud bg-raised px-2.5 py-2.5">
                            <span className="text-[11px] text-ink-faint">
                              {session.icon ?? '·'}
                            </span>
                            <input
                              ref={renameRef}
                              value={renameDraft}
                              onChange={(event) => onRenameChange(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  onRenameCommit();
                                } else if (event.key === 'Escape') {
                                  event.preventDefault();
                                  onRenameCancel();
                                }
                              }}
                              className="min-w-0 flex-1 rounded-[var(--radius-sm)] bg-panel px-1 font-mono text-[12px] text-ink outline-none ring-1 ring-waiting"
                              aria-label="rename session"
                            />
                          </div>
                        ) : (
                          <div
                            // A NAMED group. `group-hover:` matches ANY ancestor
                            // carrying `group`, and OverlayScroll wraps this whole
                            // list in one — so an unnamed group here meant hovering
                            // anywhere in the sidebar revealed every row's close
                            // button at once, the exact opposite of what the class
                            // was there to do.
                            className="group/row relative"
                          >
                            <button
                              type="button"
                              // Held by id, like `foldRefs` above: the reveal
                              // effect needs THIS session's row, and a
                              // querySelector on every focus change would go
                              // looking for it in the document instead.
                              ref={(node) => {
                                if (node === null) {
                                  rowRefs.current.delete(session.id);
                                } else {
                                  rowRefs.current.set(session.id, node);
                                }
                              }}
                              data-session-row={session.id}
                              onClick={() => onPick(session.id)}
                              className={[
                                'relative flex w-full cursor-pointer flex-col gap-[7px] overflow-hidden rounded-[9px] px-2.5 py-2.5 text-left',
                                isFocused
                                  ? 'border border-line-loud bg-raised'
                                  : 'border border-transparent',
                              ].join(' ')}
                            >
                              {isFocused && (
                                <span
                                  className={`absolute top-0 bottom-0 left-0 w-0.5 ${STATUS_DOT[session.status]}`}
                                />
                              )}

                              <span className="flex items-center gap-2">
                                <span
                                  className={[
                                    'h-[7px] w-[7px] flex-none rounded-full',
                                    STATUS_DOT[session.status],
                                    needsYou || session.status === 'running' ? 'vam-breathe' : '',
                                  ].join(' ')}
                                />
                                {session.icon !== null && (
                                  <span className="text-[11px] leading-none">{session.icon}</span>
                                )}
                                <span
                                  className={`truncate text-[13px] ${isFocused ? 'font-medium text-ink' : 'text-ink-dim'}`}
                                >
                                  {session.title}
                                </span>
                              </span>

                              {/* Branch on the left, time on the right, and nothing
                                between them. The step-verb pill and the progress
                                bar that used to sit here were removed at the
                                operator's request: both drew a per-status colour
                                channel over data no source supplies, so a row at
                                rest read as a dashboard reporting nothing. */}
                              <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-faint">
                                <span className="flex min-w-0 flex-1 items-center gap-1">
                                  <GitBranch size={10} strokeWidth={1.6} />
                                  <span
                                    data-session-branch
                                    title={
                                      session.branch === null
                                        ? 'this source cannot say which branch the session is on'
                                        : session.branch
                                    }
                                    className="flex min-w-0 items-center"
                                  >
                                    {session.branch === null ? (
                                      '—'
                                    ) : (
                                      <>
                                        <span data-branch-head className="truncate">
                                          {splitBranch(session.branch).head}
                                        </span>
                                        <span data-branch-tail className="flex-none">
                                          {splitBranch(session.branch).tail}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                </span>
                                <span
                                  data-session-age
                                  title={
                                    session.age === null
                                      ? 'this source cannot say when the session last did anything'
                                      : `last activity ${session.age} ago`
                                  }
                                  className="flex-none"
                                >
                                  {session.age ?? '—'}
                                </span>
                              </span>
                            </button>

                            {/* Mouse route to the same thing `x` does. Hidden until the
                            row is hovered, so a list at rest is a list of names
                            rather than a row of buttons. */}
                            <button
                              type="button"
                              onClick={() => onClose(session.id)}
                              aria-label={`close ${session.title}`}
                              {...pending(session.id, `Stopping ${session.title}…`)}
                              className={[
                                'absolute top-2 right-2 cursor-pointer rounded-[var(--radius-sm)] px-1 text-[11px] text-ink-faint',
                                'opacity-0 hover:bg-panel hover:text-failed group-hover/row:opacity-100',
                              ].join(' ')}
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          ))}

          {entries.length === 0 && (
            <li className="px-1 py-4 text-[11px] text-ink-faint">
              {filter.trim() === '' ? 'No sessions yet' : 'No match'}
            </li>
          )}
        </ul>
      </OverlayScroll>

      {/* The mockup's own footer strip: workspace line, search, session rows,
          then this — last, not first. It sits above the workspace/settings
          footer rather than merged into it, because those two rows answer
          different questions ("what am I in", not "what do I do next") and
          the mockup keeps New session as its own full-width strip. */}
      <div className="border-line border-t px-[11px] py-2.5">
        {/* Grey and small, at the operator's request. The fill and the medium
            weight were doing as much of the shouting as the colour: an
            ink-on-`line-strong` slab made the least urgent control in the
            sidebar its loudest. It is an outline now, a step down the ink
            ladder, and shorter and smaller in the same breath so the type
            still fits the box. Hover restores full ink, so it still reads as
            something you press. */}
        {/* The footer names no project: it starts one in the FOCUSED session's,
            exactly as `o` does, so it is pending for that same project id and
            for no other. */}
        <button
          type="button"
          onClick={onAdd}
          aria-label="new session"
          {...pending(
            entries.find((candidate) => candidate.session.id === focusedSessionId)?.project.id ??
              '',
            'Starting a session…',
          )}
          className="flex h-7 w-full cursor-pointer items-center justify-center gap-[7px] rounded-[8px] border border-ink-ghost text-[11.5px] text-ink-dim hover:border-ink-faint hover:text-ink"
        >
          <Plus size={13} strokeWidth={1.7} />
          New session
          <span className="ml-0.5 font-mono text-[10px] text-ink-faint">o</span>
        </button>
      </div>
    </aside>
  );
}
