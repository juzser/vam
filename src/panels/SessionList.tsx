/**
 * The left sidebar: every session, grouped by project.
 *
 * The grouping is captions over one flat order, not a second structure. That
 * distinction is the whole design: `entries` arrives project-major from
 * `orderedSessions`, a heading is drawn wherever the project changes, and the
 * heading is a plain `<div>` — not a control, not focusable, never a stop for
 * `j`. Grouping must not cost the one property this list has, which is that `j`
 * pressed N times lands N sessions further down no matter how many project
 * boundaries lie between.
 *
 * The shape is the ADE mockup's: a workspace line, a search box, then cards
 * rather than list rows, with one loud "New session" strip at the bottom —
 * last, after the session rows, not first. A card costs vertical space and
 * buys a second line — what the session is doing, how many steps in, how long
 * ago — which is the line you actually scan a sidebar for.
 *
 * The icon PICKER is not here. It is wider than this column, so `Canvas` floats
 * it the way it floats the command palette; the row only draws what came back.
 */

import { GitBranch, Plus, Search, Settings, Sun } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import type { SessionStatus } from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';
import type { Theme } from '../prefs/prefs.js';

const STATUS_DOT: Readonly<Record<SessionStatus, string>> = {
  running: 'bg-running',
  waiting: 'bg-waiting',
  done: 'bg-done',
  failed: 'bg-failed',
};

/** The verb pill's border and icon/text colour — its status channel. */
const STATUS_PILL: Readonly<Record<SessionStatus, string>> = {
  running: 'border-running text-running',
  waiting: 'border-waiting text-waiting',
  done: 'border-done text-done',
  failed: 'border-failed text-failed',
};

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
  readonly renamingId: string | null;
  readonly renameDraft: string;
  readonly onRenameChange: (value: string) => void;
  readonly onRenameCommit: () => void;
  readonly onRenameCancel: () => void;
  readonly onPick: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
  readonly onAdd: () => void;
  readonly onSettings: () => void;
  readonly theme: Theme;
  readonly onToggleTheme: () => void;
  /** The current rendered width (task-1's `renderedWidth`), applied inline. */
  readonly width: number;
  /** `PaneResizer`, positioned by the caller — kept out of this file's own concerns. */
  readonly resizeHandle: ReactNode;
};

function progressOf(entry: SessionEntry): number {
  const { session } = entry;
  if (session.status === 'done') {
    return 1;
  }
  if (session.decisions.length === 0) {
    return 0;
  }
  return session.decisions.filter((d) => d.output !== null).length / session.decisions.length;
}

/**
 * The step-verb pill's icon. Decorative filler for a placeholder pill that
 * already says out loud it has no data (`step-verb`, dash label) — no lucide
 * glyph carries "generic unlabelled step", so substituting one would dress a
 * known-empty slot in false precision. Kept bespoke.
 */
function VerbIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 2l5 12H3z" />
    </svg>
  );
}

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
    renamingId,
    renameDraft,
    onRenameChange,
    onRenameCommit,
    onRenameCancel,
    onPick,
    onClose,
    onAdd,
    onSettings,
    theme,
    onToggleTheme,
    width,
    resizeHandle,
  } = props;

  const filterRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

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

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-line border-r bg-sunken"
      style={{ width }}
    >
      {resizeHandle}
      <div className="flex flex-col gap-2.5 border-line border-b p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] bg-line-strong font-mono text-[11px] text-ink">
            {workspace.slice(0, 1)}
          </span>
          <span className="truncate font-medium text-[13px] text-ink">{workspace}</span>
          <span className="flex-none font-mono text-[9.5px] text-ink-faint">workspace</span>
        </div>

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
            className="flex h-[30px] items-center gap-2 rounded-[8px] border border-line bg-panel px-2.5 text-ink-faint hover:border-line-strong"
          >
            <Search size={14} strokeWidth={1.6} />
            <span className="flex-1 text-left text-[12px]">Search sessions</span>
            <span className="rounded-[4px] border border-line-strong px-1 py-px font-mono text-[9.5px]">
              /
            </span>
          </button>
        )}
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 py-2.5">
        {entries.map((entry, index) => {
          const { session, project } = entry;
          const isFocused = session.id === focusedSessionId;
          const needsYou = session.status === 'waiting';
          const startsGroup = entries[index - 1]?.project.id !== project.id;
          const inProject = entries.filter((e) => e.project.id === project.id);
          const pct = Math.round(progressOf(entry) * 100);

          return (
            <li key={session.id}>
              {/* A caption, not a stop. A plain <div>, so nothing can focus it
                  and `j` never lands on a heading. */}
              {startsGroup && (
                <div
                  data-project-heading
                  className={`flex items-center gap-[7px] px-1 pb-0.5 ${index === 0 ? '' : 'pt-3'}`}
                >
                  <span className="truncate font-mono text-[9.5px] text-ink-dim uppercase tracking-[0.12em]">
                    {project.name}
                  </span>
                  <span className="font-mono text-[9.5px] text-ink-faint">{inProject.length}</span>
                  <span className="flex-1" />
                  {/* black-smith makes sessions from the CLI; there is no route
                      to open one in a named project. The affordance stays, says
                      why, and refuses. */}
                  <span
                    data-placeholder="new-session-in-project"
                    title="Sessions are created from the CLI — see the todo"
                    aria-hidden="true"
                    className="flex h-[19px] w-[19px] items-center justify-center rounded-[5px] border border-line-strong text-ink-ghost"
                  >
                    <Plus size={13} strokeWidth={1.7} />
                  </span>
                </div>
              )}

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
                <div className="group relative">
                  <button
                    type="button"
                    data-session-row={session.id}
                    onClick={() => onPick(session.id)}
                    className={[
                      'relative flex w-full flex-col gap-[7px] overflow-hidden rounded-[9px] px-2.5 py-2.5 text-left',
                      isFocused ? 'border border-line-loud bg-raised' : 'border border-transparent',
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
                      {/* The mockup puts the agent that owns the session here
                          (CC / CX). black-smith reports providers per dispatch,
                          not per session, so this is the live agent count. */}
                      <span className="ml-auto flex-none rounded-[4px] border border-line-strong px-1 py-px font-mono text-[9px] text-ink-faint">
                        {session.runningAgents > 0 ? `●${session.runningAgents}` : '—'}
                      </span>
                    </span>

                    <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-faint">
                      <span className="flex min-w-0 flex-none items-center gap-1">
                        <GitBranch size={10} strokeWidth={1.6} />
                        <span
                          data-placeholder="worktree"
                          title="black-smith reports no worktree per session"
                          className="truncate"
                        >
                          —
                        </span>
                      </span>
                      <span className="flex-1" />
                      <span
                        data-placeholder="step-verb"
                        title={`black-smith reports no event kind on a timeline entry to derive a step verb from — this card's status is ${session.status}`}
                        className={[
                          'flex flex-none items-center gap-1 rounded-[999px] border pt-px pr-1.5 pb-px pl-1',
                          STATUS_PILL[session.status],
                        ].join(' ')}
                      >
                        <VerbIcon />—
                      </span>
                      <span
                        data-placeholder="step-duration"
                        title="black-smith times a session rather than a step"
                        className="flex-none"
                      >
                        —
                      </span>
                    </span>

                    <span className="block h-0.5 overflow-hidden rounded-sm bg-line">
                      <span
                        className={`block h-full ${STATUS_DOT[session.status]}`}
                        style={{ width: `${pct}%` }}
                      />
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
                      'absolute top-2 right-2 rounded-[var(--radius-sm)] px-1 text-[11px] text-ink-faint',
                      'opacity-0 hover:bg-panel hover:text-failed group-hover:opacity-100',
                    ].join(' ')}
                  >
                    ×
                  </button>
                </div>
              )}
            </li>
          );
        })}

        {entries.length === 0 && (
          <li className="px-1 py-4 text-[11px] text-ink-faint">
            {filter.trim() === '' ? 'No sessions yet' : 'No match'}
          </li>
        )}
      </ul>

      {/* The mockup's own footer strip: workspace line, search, session rows,
          then this — last, not first. It sits above the workspace/settings
          footer rather than merged into it, because those two rows answer
          different questions ("what am I in", not "what do I do next") and
          the mockup keeps New session as its own full-width strip. */}
      <div className="border-line border-t px-[11px] py-2.5">
        <button
          type="button"
          onClick={onAdd}
          aria-label="new session"
          className="flex h-9 w-full items-center justify-center gap-[7px] rounded-[9px] border border-ink-ghost bg-line-strong font-medium text-[12.5px] text-ink hover:border-ink-faint"
        >
          <Plus size={15} strokeWidth={1.7} />
          New session
          <span className="ml-0.5 font-mono text-[10px] text-ink-faint">Mod-t</span>
        </button>
      </div>

      <footer className="flex items-center gap-2 border-line border-t px-3 py-2.5">
        <span className="flex h-[19px] w-[19px] flex-none items-center justify-center rounded-full bg-line-strong font-mono text-[9.5px] text-ink-dim">
          {workspace.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate font-mono text-[11px] text-ink-dim">{workspace}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onSettings}
          aria-label="settings"
          className="flex items-center text-ink-faint hover:text-ink"
        >
          <Settings size={14} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'switch to light theme' : 'switch to dark theme'}
          className="flex items-center text-ink-faint hover:text-ink"
        >
          <Sun size={14} strokeWidth={1.5} />
        </button>
      </footer>
    </aside>
  );
}
