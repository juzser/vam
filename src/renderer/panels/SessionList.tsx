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

import { Filter, GitBranch, Monitor, Plus, Search, Settings, Sun } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import type { Project, SessionStatus } from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';
import type { SessionFilters, StatusFilter } from '../domain/session-filter.js';
import { STATUS_FILTERS } from '../domain/session-filter.js';
import type { Theme } from '../prefs/prefs.js';
import { OverlayScroll } from './OverlayScroll.js';

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
  /** Opens the icon picker for a project's heading — the mouse route; there
   * is no keyboard shortcut for it, unlike the session picker's `s`. */
  readonly onPickIcon: (project: Project) => void;
  readonly onSettings: () => void;
  readonly theme: Theme;
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
    onPickIcon,
    onSettings,
    theme,
    onToggleTheme,
    width,
    resizeHandle,
  } = props;

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

  return (
    <aside
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

        <div className="relative flex items-center gap-2">
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

          {/* The operator's ask: an icon beside the search box, toggling a
              popover that narrows this list. Search answers "the one called
              permalink"; this answers "the ones that stopped" — two different
              questions, so two controls, side by side. */}
          <button
            type="button"
            ref={menuButtonRef}
            data-filter-toggle
            aria-haspopup="dialog"
            aria-expanded={filterMenuOpen}
            aria-label="filter sessions"
            onClick={() => onFilterMenuToggle(!filterMenuOpen)}
            className={[
              'flex h-[30px] w-[30px] flex-none cursor-pointer items-center justify-center rounded-[8px] border bg-panel',
              filterMenuOpen || statusFilter !== 'all'
                ? 'border-line-loud text-ink'
                : 'border-line text-ink-faint hover:border-line-strong',
            ].join(' ')}
          >
            <Filter size={14} strokeWidth={1.6} />
          </button>

          {filterMenuOpen && (
            <div
              ref={menuRef}
              data-filter-menu
              role="dialog"
              aria-label="session filters"
              className="absolute top-[36px] right-0 z-20 flex w-[212px] flex-col gap-2 rounded-[9px] border border-line-strong bg-panel p-2.5 shadow-lg"
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
                  ],
                  [
                    'prompted',
                    'Only ones I have prompted',
                    originFilters.onlyPrompted,
                    hiddenCounts.unprompted,
                  ],
                ] as const
              ).map(([key, label, on, hides]) => (
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
                  <span className="flex-none font-mono text-[9.5px] text-ink-faint">−{hides}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <OverlayScroll className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-2.5 py-2.5">
        <ul className="flex flex-col gap-3.5">
          {groups.map((group) => (
            <li key={group.project.id} className="flex flex-col gap-[5px]">
              {/* A caption, not a stop. A plain <div>, so nothing can focus it
                and `j` never lands on a heading. */}
              {/* `min-h` reserves the add button's own height. The heading is
                  otherwise as tall as its tallest child, so the row -- and
                  every row under it -- would jump a few pixels each time focus
                  moved between projects and the add came or went. */}
              <div
                data-project-heading
                className="flex min-h-[21px] items-center gap-[7px] px-1 pb-0.5"
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
                {/* black-smith makes sessions from the CLI, so this cannot yet
                  create one. It is still a BUTTON, not an inert span: the
                  full-width "New session" control below is in exactly the same
                  position — it cannot create a session either — and it is
                  clickable, takes a pointer, and answers on the status bar.
                  Two controls that do the same thing should not look like
                  different kinds of thing. Refusing on click and saying why is
                  honest; refusing by being unclickable and unstyled just reads
                  as broken. */}
                {/* Only for the project you are actually in. One per heading
                  meant a column of `+` boxes standing over the session names
                  at all times, for a control that can only mean the project
                  holding focus. Removed from the DOM rather than hidden, so
                  there is nothing invisible left to click or tab into. */}
                {group.items.some((entry) => entry.session.id === focusedSessionId) && (
                  <button
                    type="button"
                    data-placeholder="new-session-in-project"
                    onClick={() => onAddInProject(group.project)}
                    title={`Sessions are created from the CLI — see the todo`}
                    aria-label={`new session in ${group.project.name}`}
                    className="flex h-[19px] w-[19px] cursor-pointer items-center justify-center rounded-[5px] border border-transparent text-ink-ghost hover:border-line-strong hover:text-ink-dim"
                  >
                    <Plus size={13} strokeWidth={1.7} />
                  </button>
                )}
              </div>

              {group.items.map((entry) => {
                const { session } = entry;
                const isFocused = session.id === focusedSessionId;
                const needsYou = session.status === 'waiting';

                return (
                  <div key={session.id}>
                    {renamingId === session.id ? (
                      <div className="flex items-center gap-1.5 rounded-[9px] border border-line-loud bg-raised px-2.5 py-2.5">
                        <span className="text-[11px] text-ink-faint">{session.icon ?? '·'}</span>
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
        <button
          type="button"
          onClick={onAdd}
          aria-label="new session"
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
