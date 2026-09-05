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
  Folder,
  FolderPlus,
  GitBranch,
  LoaderCircle,
  Monitor,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { Group, Project, SessionStatus } from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';
import type { SessionFilters, StatusFilter } from '../domain/session-filter.js';
import { DEFAULT_SESSION_FILTERS, STATUS_FILTERS } from '../domain/session-filter.js';
import type { KeyAction } from '../keyboard/chords.js';
import { InlineChord, ShortcutTip } from '../keyboard/ShortcutTip.js';
import type { EffectiveTheme } from '../prefs/prefs.js';
import { ConfirmRemoveProject } from './ConfirmRemoveProject.js';
import { FocusEdge } from './FocusEdge.js';
import { OverlayScroll } from './OverlayScroll.js';
import { type RemovalPlan, removalPlan } from './remove-project.js';
import { revealScrollTop } from './reveal-row.js';

/**
 * What `pendingAction` holds while "new project" is running.
 *
 * `pendingAction` is otherwise a project id, and "new project" has no project
 * yet -- that is the whole point of it -- so it needs a value of its own to
 * put in the same field. The `/` is what makes it collision-proof rather than
 * merely unlikely: a project id is derived from a directory's last segment,
 * and a POSIX basename cannot contain one, so no real project can ever answer
 * to this and wear another control's spinner.
 */
export const NEW_PROJECT_PENDING = 'vam/new-project';

/** The actions the sidebar's controls stand for — actions, never keys, so
 *  every hint below reads the chord in force rather than a shipped default. */
const SETTINGS_ACTION: KeyAction = { kind: 'settings' };
const SEARCH_ACTION: KeyAction = { kind: 'search' };
const FILTER_MENU_ACTION: KeyAction = { kind: 'filterMenu' };
const CLOSE_ACTION: KeyAction = { kind: 'close' };
const NEW_SESSION_ACTION: KeyAction = { kind: 'newSession' };

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
  /**
   * The same sessions BEFORE any narrowing -- `Canvas`'s `allEntries`.
   *
   * `entries` has been through search, the status pills and the two origin
   * rules, one of which (`hideAgentStarted`) is ON BY DEFAULT. Everything this
   * component DRAWS comes from `entries`, which is right: the list is the
   * filter's result. Two things must not, and both are about removing a
   * project, because removal acts on the whole project while a filter shows
   * part of it:
   *
   *   - the confirm's counts and the plan they describe, or the dialog states
   *     a number smaller than what it is about to do; and
   *   - the restore strip, or searching for another project unmounts the only
   *     control that brings this one back.
   *
   * Optional, defaulting to `entries`, so a caller that does not filter can
   * pass nothing and get identical behaviour.
   */
  readonly allEntries?: readonly SessionEntry[];
  readonly focusedSessionId: string | null;
  /**
   * Whether the keyboard is in this column -- the Select half of the cursor
   * mode, passed down rather than re-derived, so the line and the status bar's
   * word are two readings of ONE piece of state and cannot come apart.
   *
   * Optional and defaulting to false: every test that renders this pane
   * directly is about something else, and a required flag would have made this
   * change edit all of them to say "not focused".
   */
  readonly keyboardHere?: boolean;
  /**
   * Is this pane the whole screen, on a device with no keyboard and no canvas?
   *
   * Optional and defaulting to false for the same reason as `keyboardHere`.
   * It selects the row variant the UI spec's D1 describes -- not a second
   * component, the same one saying different things, because on a phone this
   * list IS the surface: nothing beside it repeats a status, answers a
   * question, or gives a cursor somewhere to be.
   */
  readonly phone?: boolean;
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
   * The groups to draw headings for -- UI "project", the layer ABOVE a
   * project; see the vocabulary table in `domain/model.ts`.
   *
   * PASSED RATHER THAN DERIVED FROM `entries`, and only for the empty case: a
   * group the operator has just made holds no project, so no entry mentions
   * it and a list built from the entries alone would draw nothing where they
   * are standing. Every non-empty group is placed by `entry.group`, in the
   * order `orderedSessions` ranked it.
   *
   * Optional and defaulting to none, like the fold below it: every test that
   * renders this pane is about something else, and the empty list is what
   * every store in existence holds.
   */
  readonly groups?: readonly Group[];
  /**
   * The ids of the groups folded shut, and the ask to fold one. Exactly
   * `collapsedProjects`/`onToggleCollapse` one level up, with the same
   * fallback-to-local-state decision and for the same reason: the control
   * works the day it ships, and persists once the caller passes
   * `prefs.collapsedGroups`.
   */
  readonly collapsedGroups?: readonly string[];
  readonly onToggleGroupCollapse?: (group: Group) => void;
  /**
   * The group lifecycle: make one, rename it, give it a glyph, dissolve it.
   *
   * Every one of them is a prefs write and nothing else -- no session ends, no
   * project is hidden, no source is asked anything -- which is why none of
   * them is serialised behind `pendingAction` and why `onUngroup` needs no
   * confirm. Optional, and a control whose handler is absent is not drawn: a
   * caller that has nowhere to store a group must not be given a button that
   * silently does nothing.
   */
  readonly onCreateGroup?: (name: string) => void;
  readonly onRenameGroup?: (group: Group, name: string) => void;
  readonly onPickGroupIcon?: (group: Group) => void;
  readonly onUngroup?: (group: Group) => void;
  /**
   * Open the list of repos to put in this group. The LIST lives in `Canvas`,
   * like both icon pickers, because it is wider than this column -- the row
   * only asks.
   */
  readonly onAddToGroup?: (group: Group) => void;
  /**
   * Removing a project, and bringing one back. ALL THREE ARE REQUIRED, and
   * that is the decision -- read on before making them optional again.
   *
   * The neighbours above (`collapsedProjects`, `onToggleCollapse`) are
   * optional, with an internal fallback, so folding works for a caller that
   * passes nothing. This trio deliberately does NOT follow them. A fallback
   * here would work -- the component can keep its own hidden list and call
   * `onClose` per session -- and that is precisely the problem: a caller that
   * dropped one of these props would go on removing projects, silently, into
   * state that dies with the component. The operator would see the project
   * disappear, and see it again on the next launch, which is the exact bug the
   * persisted list exists to prevent. Required means the compiler notices
   * instead of the operator.
   *
   * `hiddenProjects` is the ids removed under THIS source, from
   * `prefs.hiddenProjects` via `isProjectHidden`.
   *
   * `onRemoveProject` performs the whole act -- end, hide, report -- because
   * the caller can do things this component cannot: `Canvas` holds one
   * in-flight action at a time and returns early while one is running, so a
   * loop of `onClose` calls issued at the wrong moment would end nothing while
   * the project disappeared anyway. All this component owes it is a `plan` it
   * has already disclosed and had confirmed.
   *
   * `onHideProject` is the restore strip's route, and only that: bringing a
   * project back ends nothing, so there is nothing to serialise or refuse.
   */
  readonly hiddenProjects: readonly string[];
  readonly onHideProject: (project: Project, hidden: boolean) => void;
  readonly onRemoveProject: (project: Project, plan: RemovalPlan) => void;
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
  /**
   * The current rendered width (task-1's `renderedWidth`), applied inline.
   *
   * Optional, and ABSENT means full width: a missing width is already the true
   * statement "nobody is sizing me", which is the phone shell's case, and a
   * `'fill'` sentinel would be a second way to say it.
   */
  readonly width?: number;
  /** `PaneResizer`, positioned by the caller — kept out of this file's own concerns. */
  readonly resizeHandle: ReactNode;
};

export function SessionList(props: SessionListProps) {
  const {
    entries,
    allEntries: unfiltered,
    focusedSessionId,
    keyboardHere = false,
    phone = false,
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
    groups = [],
    collapsedGroups,
    onToggleGroupCollapse,
    onCreateGroup,
    onRenameGroup,
    onPickGroupIcon,
    onUngroup,
    onAddToGroup,
    hiddenProjects,
    onHideProject,
    onRemoveProject,
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
  /** The same fallback for the group fold. See `collapsedGroups` on the props. */
  const [localGroupCollapsed, setLocalGroupCollapsed] = useState<readonly string[]>([]);
  const groupCollapsed = collapsedGroups ?? localGroupCollapsed;
  /**
   * The one group name being typed, and what it is for: a group about to
   * exist, or one being renamed. ONE piece of state, because one editor is
   * open at a time and two would need a rule about which wins.
   *
   * The idiom is the session rename's, deliberately -- a row that turns into
   * a field, Enter commits, Escape cancels -- and NOT an overlay:
   * `ConfirmRemoveProject`'s header states vam's overlay idiom exists to make
   * a disclosure, and naming a group discloses nothing.
   */
  const [groupDraft, setGroupDraft] = useState<
    { readonly kind: 'new' } | { readonly kind: 'rename'; readonly group: Group } | null
  >(null);
  const [groupDraftName, setGroupDraftName] = useState('');
  const [openGroupMenu, setOpenGroupMenu] = useState<string | null>(null);
  /** Never `entries`. See `allEntries` on the props for what reads this. */
  const allEntries = unfiltered ?? entries;
  const hidden = hiddenProjects;
  /** The project whose removal is being confirmed, or null. One at a time. */
  const [confirming, setConfirming] = useState<Project | null>(null);

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

  const cancelGroupDraft = useCallback(() => {
    setGroupDraft(null);
    setGroupDraftName('');
  }, []);

  /** An empty name creates nothing and renames nothing -- it just closes. */
  const commitGroupDraft = useCallback(() => {
    const name = groupDraftName.trim();
    if (groupDraft !== null && name !== '') {
      if (groupDraft.kind === 'new') {
        onCreateGroup?.(name);
      } else {
        onRenameGroup?.(groupDraft.group, name);
      }
    }
    setGroupDraft(null);
    setGroupDraftName('');
  }, [groupDraft, groupDraftName, onCreateGroup, onRenameGroup]);

  const toggleGroupCollapse = useCallback(
    (group: Group) => {
      if (onToggleGroupCollapse !== undefined) {
        onToggleGroupCollapse(group);
        return;
      }
      setLocalGroupCollapsed((current) =>
        current.includes(group.id)
          ? current.filter((id) => id !== group.id)
          : [...current, group.id],
      );
    },
    [onToggleGroupCollapse],
  );

  /**
   * What removing this project would do, over the project's WHOLE membership.
   * The dialog and the click that confirms it call this, so the sentence the
   * operator read and the act they authorised cannot come apart.
   */
  const planFor = useCallback(
    (project: Project) =>
      removalPlan(
        allEntries.filter((e) => e.project.id === project.id).map((entry) => entry.session),
      ),
    [allEntries],
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
    } else if (openMenuWas.current !== null && confirming === null) {
      // Not when the menu closed BECAUSE it opened a dialog. A parent effect
      // runs after its child's, so without this the restore lands after the
      // confirm has taken focus and drags the keyboard back out of the modal.
      projectMenuRefs.current.get(openMenuWas.current)?.focus();
    }
    openMenuWas.current = openMenu;
  }, [openMenu, confirming]);

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

  // Sized against the column when there is one. With no width the pane fills
  // its host, and the popover opens at its full 288 -- which still clears the
  // gutter on the narrowest phone this shell is drawn on.
  const popoverWidth =
    width === undefined
      ? FILTER_POPOVER_WIDTH
      : Math.min(FILTER_POPOVER_WIDTH, width - FILTER_POPOVER_GUTTER);

  // `entries` arrives project-major (see the file doc comment), so one pass
  // collapsing consecutive same-project runs is a grouping, not a sort. Each
  // section also remembers the GROUP its entries came in under -- `null` for
  // the top level, which is every section until the operator makes a group.
  const sections: {
    readonly project: Project;
    readonly items: readonly SessionEntry[];
    readonly group: Group | null;
  }[] = [];
  for (const entry of entries) {
    const current = sections[sections.length - 1];
    if (current !== undefined && current.project.id === entry.project.id) {
      (current.items as SessionEntry[]).push(entry);
    } else {
      sections.push({ project: entry.project, items: [entry], group: entry.group ?? null });
    }
  }

  /**
   * A removed project is dropped from the list HERE rather than upstream, and
   * its group is kept so the restore strip below can name it. Its sessions are
   * still in `entries` -- most of them are still running -- and the count in
   * the header still includes them, which is honest: they exist, this list has
   * stopped drawing them.
   */
  const removed: Project[] = [];
  for (const entry of allEntries) {
    if (hidden.includes(entry.project.id) && !removed.some((p) => p.id === entry.project.id)) {
      removed.push(entry.project);
    }
  }

  /** The same sections, each carrying the two flags its heading renders from. */
  const folded = sections
    .filter((section) => !hidden.includes(section.project.id))
    .map((section) => ({
      ...section,
      isCollapsed: collapsed.includes(section.project.id),
      isRevealed: revealed === section.project.id,
    }));

  /**
   * What the list draws, top to bottom: group headings and project sections in
   * ONE flat sequence.
   *
   * Flat, not nested, and that is the point. The rows are unchanged and so is
   * every selector over them -- a grouped project keeps its own
   * `data-project-heading` and `data-project-rows` exactly where a dozen tests
   * expect them, and gains an indent and a `data-in-group` instead of a new
   * wrapper. Headings at BOTH levels stay captions: neither is focusable, so a
   * second caption level adds no stop for `j` to land on.
   *
   * Order comes from `entries`, which arrived from `orderedSessions` already
   * ranked across both levels -- so a group appears where its most urgent
   * session put it, and no re-sort happens here. A group holding no live
   * project has no entry to appear beside, so it is appended: an empty group
   * ranks last there too.
   */
  /**
   * The one name editor, used by both routes. Rendered at most once: a new
   * group's row sits at the top of the list, a rename replaces the heading's
   * own name, and `groupDraft` says which.
   */
  /** Nothing to open a menu for when the caller wired no group action. */
  const hasGroupMenu =
    onRenameGroup !== undefined || onPickGroupIcon !== undefined || onUngroup !== undefined;

  const groupEditor = (
    <input
      data-group-draft
      value={groupDraftName}
      placeholder="project name"
      aria-label="project name"
      ref={(node) => {
        if (node !== null && document.activeElement !== node) {
          node.focus();
        }
      }}
      onChange={(event) => setGroupDraftName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitGroupDraft();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelGroupDraft();
        }
      }}
      onBlur={cancelGroupDraft}
      className="min-w-0 flex-1 rounded-[5px] border border-line-strong bg-panel px-1 py-0.5 font-mono text-[10px] text-ink outline-none"
    />
  );

  const drawn: (
    | { readonly kind: 'group'; readonly group: Group; readonly count: number }
    | { readonly kind: 'section'; readonly section: (typeof folded)[number] }
  )[] = [];
  const drawnGroups = new Set<string>();
  const countIn = (groupId: string) =>
    folded
      .filter((section) => section.group?.id === groupId)
      .reduce((total, section) => total + section.items.length, 0);
  for (const section of folded) {
    const group = section.group;
    if (group !== null && !drawnGroups.has(group.id)) {
      drawnGroups.add(group.id);
      drawn.push({ kind: 'group', group, count: countIn(group.id) });
    }
    if (group === null || !groupCollapsed.includes(group.id)) {
      drawn.push({ kind: 'section', section });
    }
  }
  for (const group of groups) {
    // Only the genuinely EMPTY ones. A group whose members exist but were
    // narrowed away by search or removed from the sidebar has nothing under
    // it here, and a heading over nothing is not information -- while a group
    // the operator just made and has put nothing in yet is the one thing they
    // are looking for.
    if (!drawnGroups.has(group.id) && group.projects.length === 0) {
      drawn.push({ kind: 'group', group, count: 0 });
    }
  }

  return (
    <aside
      data-sidebar-pane
      // No width given means nobody is sizing this pane, so it takes the room
      // it is in rather than a number it was never handed -- and `shrink-0`
      // goes with the number, since a fixed column is the only thing that has
      // to refuse to shrink.
      className={`relative flex h-full min-w-0 flex-col border-line border-r bg-sidebar ${width === undefined ? 'w-full' : 'shrink-0'}`}
      style={width === undefined ? undefined : { width }}
    >
      {keyboardHere && <FocusEdge />}
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
          <ShortcutTip label="Settings" action={SETTINGS_ACTION}>
            <button
              type="button"
              onClick={onSettings}
              aria-label="settings"
              className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] text-ink-faint hover:text-ink"
            >
              <Settings size={14} strokeWidth={1.5} />
            </button>
          </ShortcutTip>
          {/* No chord reaches the theme toggle, so the tip is its label. */}
          <ShortcutTip label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'switch to light theme' : 'switch to dark theme'}
              className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] text-ink-faint hover:text-ink"
            >
              <Sun size={14} strokeWidth={1.5} />
            </button>
          </ShortcutTip>
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
              <ShortcutTip label="Search sessions" action={SEARCH_ACTION}>
                <button
                  type="button"
                  onClick={onOpenFilter}
                  aria-label="search sessions"
                  className="vam-tap flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-[8px] border border-line bg-panel px-2.5 text-ink-dim hover:border-line-strong"
                >
                  <Search size={14} strokeWidth={1.6} />
                  <span className="flex-1 text-left text-[12px]">Search sessions</span>
                  <InlineChord
                    action={SEARCH_ACTION}
                    className="rounded-[4px] border border-line-strong px-1 py-px font-mono text-[9.5px]"
                  />
                </button>
              </ShortcutTip>
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
        {/* The layer above: a group of the projects vam already knows, named
            "project" because that is the operator's word for it (see the
            vocabulary table in `domain/model.ts`). LEFT of the directory
            picker, which is untouched and unmoved: that one is the only route
            to a repository vam has never seen, and this one cannot reach a
            directory at all. Both are the same 26px square, in the row that
            already held two.

            THE ACCESSIBLE NAME IS QUALIFIED AND THE VISIBLE TITLE IS NOT.
            "new project" is the name the control beside this one has answered
            to since before the group layer existed, and two squares in one row
            answering to one name is worse for a screen reader than a longer
            phrase is for anyone. The tooltip a person reads is the operator's
            word, unqualified; see the note in the plan -- this pairing is the
            one open UI question and it is theirs to settle. */}
        {onCreateGroup !== undefined && (
          <button
            type="button"
            data-new-group
            aria-label="new project (a group of repos)"
            onClick={() => {
              setGroupDraftName('');
              setGroupDraft({ kind: 'new' });
            }}
            title="New project"
            className="vam-tap flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center text-ink-faint"
          >
            {/* THE HIT IS 44 ON A PHONE, THE PAINT IS 30. On the desktop this
                skin is the 26px square the button used to be and nothing
                moves. On a phone `.vam-phone .vam-tap` grows the BUTTON to 44
                and `styles.css` sizes the skin to 30 -- because what makes a
                phone control read as too big is not the 44, it is a
                `border-line` rectangle drawn AT 44 around a 13px glyph
                (UI spec `vam-phone-controls`, 2.1 and 3.1). The per-project
                `+` beside it is the same 44 box with no border and reads
                correctly sized, which is the whole finding. Not the desktop's
                `vam-hit-24` inversion: that hangs the hit area off an
                `::after`, and the phone guard reads
                `getBoundingClientRect()` on the element, which cannot see
                one. */}
            <span
              aria-hidden="true"
              data-tap-skin
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-line bg-panel hover:border-line-strong"
            >
              <FolderPlus size={13} strokeWidth={1.6} />
            </span>
          </button>
        )}
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
          className="vam-tap flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center text-ink-faint"
          {...pending(NEW_PROJECT_PENDING, 'Starting a session in the chosen directory…')}
        >
          <span
            aria-hidden="true"
            data-tap-skin
            className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-line bg-panel hover:border-line-strong"
          >
            <Plus size={13} strokeWidth={1.6} />
          </span>
        </button>
        {/* Search answers "the one called permalink"; this answers "the ones
            that stopped" — two different questions, so two controls. */}
        <ShortcutTip label="Filter sessions" action={FILTER_MENU_ACTION}>
          <button
            type="button"
            ref={menuButtonRef}
            data-filter-toggle
            aria-haspopup="dialog"
            aria-expanded={filterMenuOpen}
            aria-label="filter sessions"
            onClick={() => onFilterMenuToggle(!filterMenuOpen)}
            className={[
              'vam-tap flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center',
              filterMenuOpen || narrowing ? 'text-ink' : 'text-ink-faint',
            ].join(' ')}
          >
            {/* The badge rides INSIDE the skin, not on the button. On a phone
                the button is 44 and the skin 30, so a badge placed against
                the button's corner would float 7px clear of the chip it
                counts for. `aria-hidden` costs nothing here: the button carries
                `aria-label`, so its accessible name is "filter sessions"
                either way and the digit was never announced. */}
            <span
              aria-hidden="true"
              data-tap-skin
              className={[
                'relative flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border bg-panel',
                filterMenuOpen || narrowing
                  ? 'border-line-loud'
                  : 'border-line hover:border-line-strong',
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
            </span>
          </button>
        </ShortcutTip>

        {filterMenuOpen && (
          <div
            ref={menuRef}
            data-filter-menu
            role="dialog"
            aria-label="session filters"
            style={{ width: popoverWidth }}
            className="absolute top-[36px] right-0 z-20 flex flex-col gap-2 rounded-[9px] border border-line-strong bg-panel p-2.5 shadow-lg"
          >
            <span className="font-mono text-[9.5px] text-ink-dim uppercase tracking-[0.12em]">
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

            <span className="mt-0.5 font-mono text-[9.5px] text-ink-dim uppercase tracking-[0.12em]">
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
          {groupDraft?.kind === 'new' && (
            <li className="flex items-center gap-[7px] px-1 pb-0.5">
              <span className="flex h-[15px] w-[15px] flex-none items-center justify-center text-ink-faint">
                <Folder size={11} strokeWidth={1.7} />
              </span>
              {groupEditor}
            </li>
          )}
          {drawn.map((item) => {
            if (item.kind === 'group') {
              const { group, count } = item;
              const isGroupCollapsed = groupCollapsed.includes(group.id);
              return (
                <li key={group.id} className="flex flex-col gap-[5px]">
                  {/* A caption over captions. Same <div>, same reasons as the
                      project heading below: not a control, not focusable,
                      never a stop for `j`. A second caption level adds no
                      position, so `hjkl`, `Cmd+<digit>` and `gt`/`gT` count
                      exactly what they counted before. */}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: as the
                      project heading -- the hover is a pure reveal and giving
                      this a role would put a stop in the list. */}
                  <div
                    data-group-heading
                    data-group-id={group.id}
                    onMouseEnter={() => setRevealed(group.id)}
                    onMouseLeave={() =>
                      setRevealed((current) => (current === group.id ? null : current))
                    }
                    className="relative flex min-h-[21px] items-center gap-[7px] px-1 pb-0.5"
                  >
                    <span
                      data-group-icon={group.id}
                      className="flex h-[15px] w-[15px] flex-none items-center justify-center text-[11px] leading-none text-ink-faint"
                    >
                      {group.icon ?? <Folder size={11} strokeWidth={1.7} />}
                    </span>
                    {groupDraft?.kind === 'rename' && groupDraft.group.id === group.id ? (
                      groupEditor
                    ) : (
                      <span className="truncate font-mono text-[10px] text-ink uppercase tracking-[0.12em]">
                        {group.name}
                      </span>
                    )}
                    {/* Summed over every member, because that is what the
                        heading is over. A count of one member's sessions under
                        a caption naming several would be a number about
                        something else. */}
                    <span
                      data-group-count={group.id}
                      className="font-mono text-[9.5px] text-ink-faint"
                    >
                      {count}
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      data-group-collapse={group.id}
                      aria-expanded={!isGroupCollapsed}
                      aria-label={`${isGroupCollapsed ? 'expand' : 'collapse'} ${group.name}`}
                      onClick={() => toggleGroupCollapse(group)}
                      className={[
                        'vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-ink-faint hover:text-ink focus:opacity-100',
                        revealed === group.id || isGroupCollapsed ? 'opacity-100' : 'opacity-0',
                      ].join(' ')}
                    >
                      {isGroupCollapsed ? (
                        <ChevronRight size={12} strokeWidth={1.8} />
                      ) : (
                        <ChevronDown size={12} strokeWidth={1.8} />
                      )}
                    </button>

                    {hasGroupMenu && (
                      <button
                        type="button"
                        data-group-menu={group.id}
                        aria-haspopup="menu"
                        aria-expanded={openGroupMenu === group.id}
                        aria-label={`more actions for ${group.name}`}
                        onClick={() =>
                          setOpenGroupMenu((current) => (current === group.id ? null : group.id))
                        }
                        className={[
                          'vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-full border border-transparent text-ink-faint hover:border-line-strong hover:text-ink focus:opacity-100',
                          revealed === group.id || openGroupMenu === group.id
                            ? 'opacity-100'
                            : 'opacity-0',
                        ].join(' ')}
                      >
                        <MoreHorizontal size={12} strokeWidth={1.8} />
                      </button>
                    )}

                    {/* Last in the row and last in tab order, as the project
                        heading's own `+` is: the controls acting on the
                        heading come first, the one that adds something to it
                        comes after them. It offers what vam ALREADY KNOWS --
                        no directory dialog, no validation, no IPC; see
                        `ProjectPicker`. */}
                    {onAddToGroup !== undefined && (
                      <button
                        type="button"
                        data-add-to-group={group.id}
                        onClick={() => onAddToGroup(group)}
                        title={`Add a repo to ${group.name}`}
                        aria-label={`add a repo to ${group.name}`}
                        className={[
                          'vam-tap vam-hit-24 flex h-[19px] w-[19px] flex-none cursor-pointer items-center justify-center rounded-[5px] border border-transparent text-ink-ghost hover:border-line-strong hover:text-ink-dim focus:opacity-100',
                          revealed === group.id ? 'opacity-100' : 'opacity-0',
                        ].join(' ')}
                      >
                        <Plus size={13} strokeWidth={1.7} />
                      </button>
                    )}

                    {openGroupMenu === group.id && (
                      <div
                        data-group-menu-panel={group.id}
                        role="menu"
                        aria-label={`${group.name} actions`}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            setOpenGroupMenu(null);
                          }
                        }}
                        className="absolute top-[19px] right-0 z-20 flex w-[168px] flex-col rounded-[9px] border border-line-strong bg-panel p-1 shadow-lg"
                      >
                        {onRenameGroup !== undefined && (
                          <button
                            type="button"
                            role="menuitem"
                            data-group-menu-item="rename"
                            onClick={() => {
                              setGroupDraftName(group.name);
                              setGroupDraft({ kind: 'rename', group });
                              setOpenGroupMenu(null);
                            }}
                            className="cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-dim hover:bg-raised hover:text-ink"
                          >
                            Rename project
                          </button>
                        )}
                        {onPickGroupIcon !== undefined && (
                          <button
                            type="button"
                            role="menuitem"
                            data-group-menu-item="icon"
                            onClick={() => {
                              onPickGroupIcon(group);
                              setOpenGroupMenu(null);
                            }}
                            className="cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-dim hover:bg-raised hover:text-ink"
                          >
                            Change project icon
                          </button>
                        )}
                        {/* PLAIN, and last only because it is the one that
                            ends the group. It is not red and it opens no
                            modal: `ConfirmRemoveProject`'s own header says the
                            overlay idiom is there to make a disclosure rather
                            than to add a click, and its disclosure is two
                            session counts. Ungrouping has no counts -- no
                            session ends, nothing is hidden, `hiddenProjects`
                            is not touched -- and its entire outcome is on
                            screen the instant it happens: the heading goes and
                            its members reappear one level up. The red stays
                            where the consequence is, on the project heading's
                            "Remove project", so weight goes on keeping matching
                            consequence. */}
                        {onUngroup !== undefined && (
                          <button
                            type="button"
                            role="menuitem"
                            data-group-menu-item="ungroup"
                            onClick={() => {
                              onUngroup(group);
                              setOpenGroupMenu(null);
                            }}
                            className="cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-dim hover:bg-raised hover:text-ink"
                          >
                            Ungroup
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            }
            const { isCollapsed, isRevealed, ...section } = item.section;
            return (
              <li
                key={section.project.id}
                {...(section.group === null ? {} : { 'data-in-group': section.group.id })}
                className={[
                  'flex flex-col gap-[5px]',
                  // The indent the level above buys, on the container rather
                  // than per row -- the same decision `data-project-rows` already
                  // documents one level down, for the same reason.
                  section.group === null ? '' : 'pl-2',
                ].join(' ')}
              >
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
                  data-project-id={section.project.id}
                  {...(isRevealed ? { 'data-project-revealed': 'true' } : {})}
                  onMouseEnter={() => setRevealed(section.project.id)}
                  onMouseLeave={() =>
                    setRevealed((current) => (current === section.project.id ? null : current))
                  }
                  className="relative flex min-h-[21px] items-center gap-[7px] px-1 pb-0.5"
                >
                  {/* No chord picks a PROJECT icon — `icon` (`s`) picks the
                      focused SESSION's, which is a different subject — so the
                      tip is the label alone. It replaces a native `title`,
                      which no browser opens on keyboard focus. */}
                  <ShortcutTip label="Change project icon">
                    <button
                      type="button"
                      data-project-icon={section.project.id}
                      onClick={() => onPickIcon(section.project)}
                      aria-label={`change icon for ${section.project.name}`}
                      className="vam-tap vam-hit-24 flex h-[15px] w-[15px] flex-none cursor-pointer items-center justify-center text-[11px] leading-none text-ink-faint hover:text-ink-dim"
                    >
                      {section.project.icon ?? (
                        /* A monitor, not a middot. The glyph has to read as "this
                         is a machine you can name" — the middot read as a bullet
                         and gave a clickable control no affordance at all. It is
                         a placeholder in the literal sense: the picker replaces
                         it with whatever emoji you choose, and choosing nothing
                         leaves something that still looks deliberate. */
                        <Monitor data-project-icon-placeholder size={11} strokeWidth={1.7} />
                      )}
                    </button>
                  </ShortcutTip>
                  <span className="truncate font-mono text-[9.5px] text-ink-dim uppercase tracking-[0.12em]">
                    {section.project.name}
                  </span>
                  <span className="font-mono text-[9.5px] text-ink-faint">
                    {section.items.length}
                  </span>
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
                        foldRefs.current.delete(section.project.id);
                      } else {
                        foldRefs.current.set(section.project.id, node);
                      }
                    }}
                    data-project-collapse={section.project.id}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? 'expand' : 'collapse'} ${section.project.name}`}
                    onClick={() => toggleCollapse(section.project)}
                    className={[
                      'vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-ink-faint hover:text-ink focus:opacity-100',
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
                        projectMenuRefs.current.delete(section.project.id);
                      } else {
                        projectMenuRefs.current.set(section.project.id, node);
                      }
                    }}
                    data-project-menu={section.project.id}
                    aria-haspopup="menu"
                    aria-expanded={openMenu === section.project.id}
                    aria-label={`more actions for ${section.project.name}`}
                    onClick={() =>
                      setOpenMenu((current) =>
                        current === section.project.id ? null : section.project.id,
                      )
                    }
                    className={[
                      'vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-full border border-transparent text-ink-faint hover:border-line-strong hover:text-ink focus:opacity-100',
                      isRevealed || openMenu === section.project.id ? 'opacity-100' : 'opacity-0',
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
                    data-new-session-in-project={section.project.id}
                    onClick={() => onAddInProject(section.project)}
                    title={newSessionDecline ?? `New session in ${section.project.name}`}
                    aria-label={`new session in ${section.project.name}`}
                    className={[
                      'vam-tap vam-hit-24 flex h-[19px] w-[19px] flex-none cursor-pointer items-center justify-center rounded-[5px] border border-transparent text-ink-ghost hover:border-line-strong hover:text-ink-dim focus:opacity-100',
                      isRevealed ||
                      section.items.some((entry) => entry.session.id === focusedSessionId)
                        ? 'opacity-100'
                        : 'opacity-0',
                    ].join(' ')}
                    {...pending(
                      section.project.id,
                      `Starting a session in ${section.project.name}…`,
                    )}
                  >
                    <Plus size={13} strokeWidth={1.7} />
                  </button>

                  {/* There is still no "Project settings": vam has no
                    per-project setting to open.

                    "Remove project" USED TO BE ABSENT FOR A REASON THAT HAS
                    ONLY HALF EXPIRED, and the surviving half is what shapes
                    it. A project here is a grouping of live sessions on their
                    cwd, so there is nothing stored to delete and ending every
                    session vam can end still leaves the project on screen at
                    the next refresh. What changed is that `Session.
                    vamControlled` now says, per session, whether vam started
                    it -- so the item can end what it is entitled to end,
                    persist a removal for the remainder, and state both counts
                    instead of reporting its own inability. It is destructive
                    and it is last, behind a confirm. */}
                  {openMenu === section.project.id && (
                    <div
                      ref={projectPanelRef}
                      data-project-menu-panel={section.project.id}
                      role="menu"
                      aria-label={`${section.project.name} actions`}
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
                          toggleCollapse(section.project);
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
                          onPickIcon(section.project);
                          setOpenMenu(null);
                        }}
                        className="cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-dim hover:bg-raised hover:text-ink"
                      >
                        Change project icon
                      </button>
                      {/* Last, and the only red thing in the menu. The icon is
                        LEFT of the label, where the two items above have
                        nothing, because this is the one item you must not
                        press by mistake. */}
                      <button
                        type="button"
                        role="menuitem"
                        data-project-menu-item="remove"
                        onClick={() => {
                          setConfirming(section.project);
                          setOpenMenu(null);
                        }}
                        className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-danger hover:bg-raised"
                      >
                        <Trash2 size={12} strokeWidth={1.8} />
                        Remove project
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
                    data-project-rows={section.project.id}
                    className="flex flex-col gap-[5px] pl-1.5"
                  >
                    {section.items.map(({ session }) => {
                      const isFocused = session.id === focusedSessionId;
                      const needsYou = session.status === 'waiting';
                      // The newest step's own input: what the session asked,
                      // in the words the session screen's IN region shows.
                      // Newest first, which is the order `decisions` is in.
                      const newestAsk = session.decisions[0]?.input ?? null;
                      // The SAME notion the close button already wears, applied
                      // to the whole row: closing can take the full stop timeout,
                      // and for those fifteen seconds the row is not something
                      // the operator can act on. `pendingAction` stays the one
                      // source of truth -- there is no second pending state here.
                      const closing = pendingAction === session.id;
                      const closingLabel = `Stopping “${session.title}”…`;

                      return (
                        <div key={session.id}>
                          {renamingId === session.id ? (
                            <div className="flex items-center gap-1.5 rounded-[9px] border border-line-loud bg-raised px-2.5 py-2.5">
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
                              // `data-row-pending` carries the dim (styles.css)
                              // rather than an inline colour, so the row keeps
                              // its own tokens and the treatment is one rule.
                              {...(closing
                                ? { 'data-row-pending': session.id, 'aria-busy': true }
                                : {})}
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
                                // Not actionable and not a tab stop -- but still
                                // drawn, and still the row for THIS session: the
                                // operator has to be able to see which one is
                                // closing, which is the whole point of the state.
                                disabled={closing}
                                tabIndex={closing ? -1 : undefined}
                                {...(closing ? { title: closingLabel } : {})}
                                className={[
                                  // `vam-tap`: the row is the screen's primary
                                  // tap target, and it says so itself rather
                                  // than relying on its content to happen to
                                  // add up to 44px.
                                  'vam-tap relative flex w-full cursor-pointer flex-col gap-[7px] overflow-hidden rounded-[9px] px-2.5 py-2.5 text-left',
                                  // Over the 44 floor `vam-tap` sets, and the
                                  // extra is what makes a scrolling list
                                  // forgiving of a moving thumb.
                                  phone ? 'min-h-[56px]' : '',
                                  isFocused && !phone
                                    ? 'border border-line-loud bg-raised'
                                    : 'border border-transparent',
                                ].join(' ')}
                              >
                                {/* Not on a phone. `focusedId` does not move
                                    when the session screen closes, so one
                                    round trip leaves this bar marking a
                                    session the operator has already left --
                                    and the ring around it measures 2.15:1 on
                                    the light canvas, under even the 3:1
                                    non-text floor (issue 188). On a desktop it
                                    says where the next keystroke lands; here
                                    nothing lands anywhere. */}
                                {isFocused && !phone && (
                                  <span
                                    data-row-cursor
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
                                  {/* No session icon here. The row drew one --
                                    the shared chain, always occupying its slot
                                    -- and the operator removed it: an icon per
                                    project heading groups the list, and a
                                    second one on every row under it repeated
                                    the same mark down a narrow column and took
                                    width from the title. The canvas root node
                                    is now the only surface that draws it, and
                                    the `s` chord still picks it. */}
                                  <span
                                    data-row-title
                                    className={[
                                      'truncate text-[13px]',
                                      // The dim-unless-focused title is a
                                      // keyboard affordance: it exists so a
                                      // cursor row pops out of a column. With
                                      // no cursor it is only every row but one
                                      // being harder to read than it needs to be.
                                      phone
                                        ? 'text-ink'
                                        : isFocused
                                          ? 'font-medium text-ink'
                                          : 'text-ink-dim',
                                    ].join(' ')}
                                  >
                                    {session.title}
                                  </span>
                                </span>

                                {/* One line of real information where the
                                    desktop spends one on a placeholder. The
                                    status WORD is the second channel WCAG
                                    1.4.1 wants beside the dot; `needs you` is
                                    the `waiting` token on session state, which
                                    is what that token means and the only place
                                    a row borrows one. The branch is appended
                                    LAST so it is the segment that truncates
                                    first at 320px -- the age never is. */}
                                {phone && (
                                  <span
                                    data-row-meta
                                    className="flex min-w-0 items-center gap-1 truncate font-mono text-[10px] text-ink-dim"
                                  >
                                    {session.status === 'waiting' ? (
                                      <span data-row-needs-you className="flex-none text-waiting">
                                        needs you
                                      </span>
                                    ) : (
                                      <span className="flex-none">{session.status}</span>
                                    )}
                                    <span className="flex-none">·</span>
                                    <span
                                      data-session-age
                                      title={
                                        session.age === null
                                          ? 'this source cannot say when the session last did anything'
                                          : `last activity ${session.age} ago`
                                      }
                                      className="flex-none"
                                    >
                                      {session.age ?? 'no age'}
                                    </span>
                                    {session.branch !== null && (
                                      <>
                                        <span className="flex-none">·</span>
                                        <span data-session-branch className="truncate">
                                          {session.branch}
                                        </span>
                                      </>
                                    )}
                                  </span>
                                )}
                                {/* The waiting row's third line: what is being
                                    asked, rather than only that something is.
                                    The desktop sidebar sits beside a canvas and
                                    a detail pane that answer it; this list has
                                    nothing beside it. */}
                                {phone && needsYou && newestAsk !== null && (
                                  <span
                                    data-row-question
                                    className="line-clamp-2 text-[11px] text-ink-dim"
                                  >
                                    {newestAsk}
                                  </span>
                                )}
                                {/* Branch on the left, time on the right, and nothing
                                between them. The step-verb pill and the progress
                                bar that used to sit here were removed at the
                                operator's request: both drew a per-status colour
                                channel over data no source supplies, so a row at
                                rest read as a dashboard reporting nothing. */}
                                {!phone && (
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
                                )}
                              </button>

                              {/* Mouse route to the same thing `x` does. Hidden until the
                            row is hovered, so a list at rest is a list of names
                            rather than a row of buttons. */}
                              <ShortcutTip label="Close this session" action={CLOSE_ACTION}>
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
                              </ShortcutTip>

                              {/* The indicator, over the row rather than beside
                                it. Three channels for one fact, because one of
                                them is always missing for somebody: the turning
                                mark, the word, and `aria-busy` on the row. With
                                `prefers-reduced-motion` the mark parks upright
                                (styles.css) and the word carries it alone --
                                never "no indicator". `pointer-events-none` so
                                it cannot become a second thing to click on a
                                row that refuses clicks. */}
                              {closing && (
                                <span
                                  data-row-busy
                                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                                >
                                  <span className="flex items-center gap-1.5 rounded-[7px] border border-line bg-panel px-2 py-1 text-[11px] text-ink-dim">
                                    <LoaderCircle
                                      size={11}
                                      strokeWidth={1.8}
                                      className="vam-spin"
                                    />
                                    {closingLabel}
                                  </span>
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}

          {entries.length === 0 && (
            <li className="px-1 py-4 text-[11px] text-ink-dim">
              {filter.trim() === '' ? 'No sessions yet' : 'No match'}
            </li>
          )}
        </ul>
      </OverlayScroll>

      {/* Where a removed project comes back from.
          Present only while something is removed, and it names each one:
          a removal that left no visible trace would be indistinguishable from
          a project that stopped existing, which is the one thing this list
          must never be ambiguous about. */}
      {removed.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-line border-t px-[11px] py-2">
          <span className="w-full font-mono text-[9px] text-ink-dim uppercase tracking-[0.12em]">
            Removed
          </span>
          {removed.map((project) => (
            <button
              key={project.id}
              type="button"
              data-restore-project={project.id}
              aria-label={`restore ${project.name}`}
              onClick={() => onHideProject(project, false)}
              className="flex cursor-pointer items-center gap-1 rounded-[6px] border border-line px-1.5 py-0.5 text-[10.5px] text-ink-faint hover:border-line-strong hover:text-ink"
            >
              <RotateCcw size={10} strokeWidth={1.8} />
              {project.name}
            </button>
          ))}
        </div>
      )}

      {confirming !== null && (
        <ConfirmRemoveProject
          projectName={confirming.name}
          plan={planFor(confirming)}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            // The caller owns ending, hiding and reporting -- see the prop.
            // Everything this component owed the operator happened before the
            // click: the plan was computed over the whole project and stated,
            // count by count, in the dialog they are answering.
            onRemoveProject(confirming, planFor(confirming));
            setConfirming(null);
          }}
        />
      )}

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
        <ShortcutTip label="New session" action={NEW_SESSION_ACTION}>
          <button
            type="button"
            onClick={onAdd}
            aria-label="new session"
            {...pending(
              entries.find((candidate) => candidate.session.id === focusedSessionId)?.project.id ??
                '',
              'Starting a session…',
            )}
            className="vam-tap flex h-7 w-full cursor-pointer items-center justify-center gap-[7px] rounded-[8px] border border-ink-ghost text-[11.5px] text-ink-dim hover:border-ink-faint hover:text-ink"
          >
            <Plus size={13} strokeWidth={1.7} />
            New session
            {/* Read, not written: this cell used to spell `o`. */}
            <InlineChord
              action={NEW_SESSION_ACTION}
              className="ml-0.5 font-mono text-[10px] text-ink-faint"
            />
          </button>
        </ShortcutTip>
      </div>
    </aside>
  );
}
