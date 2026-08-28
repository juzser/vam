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
 * Feature set follows orca's sidebar (§4.1) — a filter, rename in place, an icon
 * per session, close, and settings plus "new" pinned at the bottom. What is not
 * borrowed is the keys: orca binds these to Cmd-chords, vam to single letters,
 * because vam's whole premise is that your hands do not leave the home row.
 *
 * The icon PICKER is not here. It is wider than this 248px column, so `Canvas`
 * floats it the way it floats the command palette; the row only ever draws the
 * glyph that came back.
 */

import { useEffect, useRef } from 'react';
import type { SessionStatus } from '../domain/model.js';
import { decisionAwaitingYou, type SessionEntry } from '../domain/selectors.js';

const STATUS_INK: Readonly<Record<SessionStatus, string>> = {
  running: 'text-running',
  waiting: 'text-waiting',
  done: 'text-done',
  failed: 'text-failed',
};

const STATUS_GLYPH: Readonly<Record<SessionStatus, string>> = {
  running: '◐',
  waiting: '⏸',
  done: '✓',
  failed: '✕',
};

export type SessionListProps = {
  readonly entries: readonly SessionEntry[];
  readonly focusedSessionId: string | null;
  /** Non-empty while the list is filtered — orca's sidebar search. */
  readonly filter: string;
  readonly filtering: boolean;
  readonly onFilterChange: (value: string) => void;
  readonly onFilterCommit: () => void;
  readonly onFilterCancel: () => void;
  /** Set while `r` has a row in rename mode. */
  readonly renamingId: string | null;
  readonly renameDraft: string;
  readonly onRenameChange: (value: string) => void;
  readonly onRenameCommit: () => void;
  readonly onRenameCancel: () => void;
  readonly onPick: (sessionId: string) => void;
  readonly onClose: (sessionId: string) => void;
  readonly onAdd: () => void;
  readonly onSettings: () => void;
};

export function SessionList(props: SessionListProps) {
  const {
    entries,
    focusedSessionId,
    filter,
    filtering,
    onFilterChange,
    onFilterCommit,
    onFilterCancel,
    renamingId,
    renameDraft,
    onRenameChange,
    onRenameCommit,
    onRenameCancel,
    onPick,
    onClose,
    onAdd,
    onSettings,
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

  const waiting = entries.filter((e) => e.session.status === 'waiting').length;

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-line border-r bg-sunken">
      <header className="flex items-center gap-2 border-line border-b px-3 py-2">
        <span className="font-mono font-semibold text-[12px] text-ink">sessions</span>
        <span className="text-[11px] text-ink-faint">{entries.length}</span>
        {waiting > 0 && (
          <span className="vam-breathe ml-auto font-semibold text-[11px] text-waiting">
            ⏸ {waiting}
          </span>
        )}
      </header>

      {/* The filter lives in the list, not over it — orca's shape. A list you
          are narrowing is a list you want to keep watching while you type. */}
      {filtering && (
        <div className="flex items-center gap-2 border-line border-b px-3 py-1.5">
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
            placeholder="lọc session…"
            className="flex-1 bg-transparent font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint"
            aria-label="lọc session"
          />
          <span className="font-mono text-[10px] text-ink-faint">{entries.length}</span>
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {entries.map((entry, index) => {
          const { session, project } = entry;
          const isFocused = session.id === focusedSessionId;
          const needsYou = session.status === 'waiting';
          const startsGroup = entries[index - 1]?.project.id !== project.id;
          const inProject = entries.filter((e) => e.project.id === project.id);
          const waitingHere = inProject.filter((e) => e.session.status === 'waiting').length;
          const pending = decisionAwaitingYou(session);

          return (
            <li key={session.id}>
              {/* A caption, not a stop. A plain <div>, so nothing can focus it
                  and `j` never lands on a heading. */}
              {startsGroup && (
                <div data-project-heading className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                  <span className="truncate font-mono font-semibold text-[10.5px] text-ink-dim uppercase tracking-wider">
                    {project.name}
                  </span>
                  <span className="text-[10px] text-ink-faint">{inProject.length}</span>
                  {waitingHere > 0 && (
                    <span className="vam-breathe ml-auto font-semibold text-[10px] text-waiting">
                      ⏸ {waitingHere}
                    </span>
                  )}
                </div>
              )}

              {/* No pulse on the row: the solid bar down its edge is the signal
                  here. In a list this dense a halo would smear into the rows
                  above and below, and what survives is a hard edge. */}
              <div className={`group relative ${isFocused ? 'bg-raised' : ''}`}>
                {needsYou && <span className="absolute top-0 bottom-0 left-0 w-[3px] bg-waiting" />}
                {isFocused && !needsYou && (
                  <span className="absolute top-0 bottom-0 left-0 w-[3px] bg-running" />
                )}

                {renamingId === session.id ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5">
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
                      className="flex-1 rounded-[var(--radius-sm)] bg-panel px-1 font-mono text-[12px] text-ink outline-none ring-1 ring-running"
                      aria-label="đổi tên session"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    data-session-row={session.id}
                    onClick={() => onPick(session.id)}
                    className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left"
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={[
                          STATUS_INK[session.status],
                          'text-[10px]',
                          session.status === 'running' ? 'vam-spin' : '',
                          needsYou ? 'vam-breathe' : '',
                        ].join(' ')}
                      >
                        {STATUS_GLYPH[session.status]}
                      </span>
                      {session.icon !== null && (
                        <span className="text-[11px] leading-none">{session.icon}</span>
                      )}
                      <span className="truncate font-mono text-[12px] text-ink">
                        {session.title}
                      </span>
                      {session.runningAgents > 0 && (
                        <span className="ml-auto text-[10px] text-running">
                          ●{session.runningAgents}
                        </span>
                      )}
                    </span>

                    <span className="flex items-baseline gap-2 pl-4">
                      {/* The repo is the group heading now; the epic is what the
                          row still has to say. */}
                      <span className="truncate text-[10.5px] text-ink-faint">
                        {session.epic ?? ''}
                      </span>
                      {needsYou && pending !== null && (
                        <span className="ml-auto shrink-0 font-semibold text-[10px] text-waiting">
                          {pending.label}
                        </span>
                      )}
                    </span>

                    {/* Orca puts a line of live detail under each workspace. Ours
                        is the heartbeat line when there is one — `null` means the
                        source cannot say yet (§5 epic B), and an invented string
                        would be worse than a blank. */}
                    {session.activity !== null && (
                      <span className="truncate pl-4 text-[10px] text-ink-faint">
                        {session.activity}
                      </span>
                    )}
                  </button>
                )}

                {/* Mouse route to the same thing `x` does. Hidden until the row
                    is hovered or focused, so a list at rest is a list of names
                    rather than a row of buttons. */}
                {renamingId !== session.id && (
                  <button
                    type="button"
                    onClick={() => onClose(session.id)}
                    aria-label={`đóng ${session.title}`}
                    className={[
                      'absolute top-1.5 right-1.5 rounded-[var(--radius-sm)] px-1 text-[11px] text-ink-faint',
                      'opacity-0 group-hover:opacity-100 hover:bg-panel hover:text-failed',
                      isFocused ? 'opacity-60' : '',
                    ].join(' ')}
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          );
        })}

        {entries.length === 0 && (
          <li className="px-3 py-4 text-[11px] text-ink-faint">
            {filter.trim() === '' ? 'chưa có session nào' : 'không khớp'}
          </li>
        )}
      </ul>

      <footer className="border-line border-t">
        <button
          type="button"
          onClick={onAdd}
          aria-label="session mới"
          className="flex w-full items-center gap-2 border-line border-b px-3 py-2 text-left text-[11px] text-ink-dim hover:bg-panel hover:text-ink"
        >
          <span className="text-[12px]">+</span>
          session mới
          <span className="ml-auto font-mono text-[10px] text-ink-faint">o</span>
        </button>
        <button
          type="button"
          onClick={onSettings}
          aria-label="settings"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-ink-dim hover:bg-panel hover:text-ink"
        >
          <span className="text-[12px]">⚙</span>
          settings
          <span className="ml-auto font-mono text-[10px] text-ink-faint">,</span>
        </button>
      </footer>
    </aside>
  );
}
