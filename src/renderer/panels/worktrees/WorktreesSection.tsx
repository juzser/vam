/**
 * The "Worktrees" sub-list under one project's own heading: rows for each
 * linked worktree (name, branch, a session count or "Start a session here"),
 * a "+" to add another, and delete with `ConfirmDeleteWorktree`.
 *
 * HIDDEN WHEN THE PROJECT HAS NONE -- the operator's own decision for this
 * feature -- UNLESS `forceOpenCreate` is set, which is how the FIRST
 * worktree ever gets created: SessionList's own "New worktree…" project-menu
 * item is the entry point when there is nothing here to draw a "+" on yet.
 *
 * SELF-CONTAINED BY DESIGN, NOT "PURE PROPS" LIKE THE REST OF `SessionList
 * .tsx`. It reads `window.api?.worktrees` (and `window.api?.createSessionIn`
 * for "Start a session here") directly rather than taking them as callback
 * props threaded through `SessionListProps` and `Canvas.tsx` -- a deliberate
 * v1 trade-off, made to keep this feature's footprint on those two very
 * large files to the few lines that render this component, rather than a
 * new prop on every call site either already has. `useWorktrees` still takes
 * its own `api` as a parameter (see that file), so the FETCH itself is
 * unit-testable without `window`; what is not decoupled is which bridge
 * member this component reaches for.
 *
 * `allEntries` is how a worktree with a LIVE session gets its count: a
 * worktree's session is created through the unmodified
 * `createSessionInDirectory`, which derives its OWN project id from the
 * worktree's cwd (`docs/design/worktrees.md` §4) -- so its sessions show up
 * in `allEntries` under a DIFFERENT `project.id` than this section's own
 * `project`, and the only way to find them is to look, the same way
 * `allEntries` is already the flat list every other selector in this file
 * reads from.
 *
 * A WORKTREE'S SESSIONS NO LONGER ALSO DRAW THEIR OWN TOP-LEVEL PROJECT
 * SECTION (UI1, closed after the v1 report disclosed it): `SessionList.tsx`'s
 * `useWorktreeParents` hook now suppresses that duplicate whenever this
 * section's own parent project is visible, so the rows this section draws
 * below (via `onPickSession`) are the ONLY way to reach a worktree's session
 * from the sidebar in `Group by: Project` mode -- see
 * `docs/design/worktrees.md`'s identity decision for the full rationale on
 * why a worktree's session keeps its own, different `Project.id` regardless.
 */

import { Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WorktreeInfo } from '../../../shared/worktree.js';
import type { Project } from '../../domain/model.js';
import type { SessionEntry } from '../../domain/selectors.js';
import { ShortcutTip } from '../../keyboard/ShortcutTip.js';
import { StatusMark } from '../status-mark.js';
import { ConfirmDeleteWorktree } from './ConfirmDeleteWorktree.js';
import { useWorktrees } from './useWorktrees.js';

/**
 * NOT IMPORTED FROM `SessionList.tsx`, which already exports its own
 * `SIDEBAR_STEP` -- doing so would make this module and `SessionList.tsx`
 * import each other (that file imports `WorktreesSection` to render it),
 * and an ES module cycle's evaluation order is not something to build a
 * layout constant's correctness on. Kept as a literal, one indent step,
 * matching that file's own value; `SessionList.tree.test.tsx`'s own indent
 * ladder is what would catch the two drifting apart.
 */
const SIDEBAR_STEP = 10;

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return error instanceof Error ? error.message : String(error);
}

/** The last path segment, browser-safe (no `node:path` in the web build). */
function displayName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

export type WorktreesSectionProps = {
  readonly project: Project;
  readonly allEntries: readonly SessionEntry[];
  readonly forceOpenCreate: boolean;
  readonly onCloseCreate: () => void;
  /**
   * `SessionList.tsx`'s own `onPick` prop, unchanged -- the SAME handler a
   * top-level `data-session-row` click already calls. UI1: since
   * `SessionList.tsx` now suppresses a worktree's own top-level project
   * section (`useWorktreeParents.ts`), this is the nested row's only route
   * back to "select this session" -- reusing the real handler rather than
   * re-deriving what "pick a session" means a second time.
   */
  readonly onPickSession: (sessionId: string) => void;
  readonly focusedSessionId: string | null;
};

export function WorktreesSection({
  project,
  allEntries,
  forceOpenCreate,
  onCloseCreate,
  onPickSession,
  focusedSessionId,
}: WorktreesSectionProps) {
  const api = window.api?.worktrees;
  const { state, reload } = useWorktrees({ projectId: project.id, api });
  const [creating, setCreating] = useState(forceOpenCreate);
  const [name, setName] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<WorktreeInfo | null>(null);
  const [deleteDirty, setDeleteDirty] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (forceOpenCreate) setCreating(true);
  }, [forceOpenCreate]);

  if (state.kind === 'unavailable') {
    return null;
  }
  const worktrees = state.kind === 'ok' ? state.worktrees : [];
  if (worktrees.length === 0 && !creating) {
    return null;
  }

  const closeCreate = () => {
    setCreating(false);
    setName('');
    setBaseRef('');
    setCreateError(null);
    onCloseCreate();
  };

  const submitCreate = async () => {
    if (api === undefined || busy) return;
    setBusy(true);
    setCreateError(null);
    try {
      await api.create({
        projectId: project.id,
        name,
        baseRef: baseRef === '' ? undefined : baseRef,
      });
      closeCreate();
      reload();
    } catch (error) {
      setCreateError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (confirmName?: string) => {
    if (api === undefined || pendingDelete === null) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.remove({
        projectId: project.id,
        worktreeId: pendingDelete.worktreeId,
        force: confirmName !== undefined,
        confirmName,
      });
      setPendingDelete(null);
      setDeleteDirty(false);
      reload();
    } catch (error) {
      if (errorCode(error) === 'dirty' && confirmName === undefined) {
        // The plain attempt found uncommitted changes -- switch the SAME
        // dialog to the typed-name path rather than closing it.
        setDeleteDirty(true);
        return;
      }
      setDeleteError(errorMessage(error));
      setPendingDelete(null);
      setDeleteDirty(false);
    } finally {
      setBusy(false);
    }
  };

  const startHere = async (worktree: WorktreeInfo) => {
    if (window.api === undefined) return;
    setDeleteError(null);
    try {
      await window.api.createSessionIn(
        worktree.path,
        worktree.branch ?? displayName(worktree.path),
      );
    } catch (error) {
      setDeleteError(errorMessage(error));
    }
  };

  return (
    <div data-worktrees-section={project.id} style={{ paddingLeft: SIDEBAR_STEP }}>
      <div className="relative flex min-h-[21px] items-center gap-[7px] px-1 pb-0.5">
        {/* `text-control` (12px/16px), NOT the project heading's own 13px
            `text-body`-sized exception (`type-scale.test.ts`'s own named
            list): this is a THIRD level, nested one step deeper than the
            project heading it sits under, and the named scale's role for a
            "secondary line under a title" is exactly that relationship --
            no new exception needed. */}
        <span className="truncate font-semibold text-control text-ink-faint">Worktrees</span>
        <span className="font-mono text-meta text-ink-faint">{worktrees.length}</span>
        <span className="flex-1" />
        {!creating && (
          <button
            type="button"
            data-worktrees-add={project.id}
            aria-label={`new worktree of ${project.name}`}
            onClick={() => setCreating(true)}
            className="vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-ink-faint hover:text-ink"
          >
            +
          </button>
        )}
      </div>

      {creating && (
        <div
          data-worktrees-create-form
          className="mb-1 flex flex-col gap-1.5 rounded-[9px] border border-line-strong bg-card px-2 py-2"
        >
          <input
            data-worktrees-create-name
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeCreate();
              }
            }}
            placeholder="worktree name"
            // biome-ignore lint/a11y/noAutofocus: the form opens because the operator just asked for it (the "+" or the project menu); focusing its first field is the point.
            autoFocus
            className="min-w-0 rounded-[5px] border border-line-strong bg-panel px-1.5 py-1 font-mono text-control text-ink outline-none focus:border-line-loud"
          />
          <input
            data-worktrees-create-base
            value={baseRef}
            onChange={(event) => setBaseRef(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeCreate();
              }
            }}
            placeholder="base ref (current branch)"
            className="min-w-0 rounded-[5px] border border-line-strong bg-panel px-1.5 py-1 font-mono text-control text-ink outline-none focus:border-line-loud"
          />
          {createError !== null && (
            <p data-worktrees-create-error className="text-control text-danger">
              {createError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-worktrees-create-cancel
              onClick={closeCreate}
              className="cursor-pointer rounded-[var(--radius-sm)] border border-line px-2 py-1 text-control text-ink-dim hover:border-line-strong hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              data-worktrees-create-submit
              disabled={name.trim() === '' || busy}
              onClick={() => void submitCreate()}
              className="cursor-pointer rounded-[var(--radius-sm)] border border-line-strong px-2 py-1 text-control text-ink-dim hover:border-line-loud hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {deleteError !== null && (
        <p data-worktrees-error className="px-1 pb-1 text-control text-danger">
          {deleteError}
        </p>
      )}

      <div className="flex flex-col gap-1">
        {worktrees.map((worktree) => {
          const worktreeSessions = allEntries.filter(
            (entry) => entry.project.id === worktree.projectId,
          );
          return (
            <div
              key={worktree.worktreeId}
              data-worktree-row={worktree.worktreeId}
              className="flex flex-col gap-0.5 rounded-[7px] px-1.5 py-1 text-control hover:bg-line"
            >
              {/* Line 1: the name gets the row's FULL width, same idiom as
                  `data-row-title` on a session row -- the delete button is
                  the only thing sharing this line, so `min-w-0 truncate`
                  here actually has room to matter instead of collapsing to
                  a couple of characters (the bug a real screenshot caught:
                  packing name, branch, "Start a session here" and delete
                  onto ONE line left name/branch a couple of px wide each). */}
              <div className="flex items-center gap-[7px]">
                <span data-worktree-name className="min-w-0 flex-1 truncate text-ink-dim">
                  {displayName(worktree.path)}
                </span>
                <button
                  type="button"
                  data-worktree-delete={worktree.worktreeId}
                  aria-label={`delete worktree ${displayName(worktree.path)}`}
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteDirty(false);
                    setPendingDelete(worktree);
                  }}
                  className="vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-ink-faint hover:text-danger"
                >
                  ×
                </button>
              </div>
              {/* Line 2: branch is the FLEXIBLE one here, `flex-1`, and
                  truncates LAST -- a real screenshot (`docs/ui/worktrees-
                  sidebar-dark.png`) caught it losing that fight to "Start a
                  session here"'s own fixed-width text and truncating to
                  "fix-t…" first. `locked` stays `flex-none`, and the
                  start-here control is now a compact icon (below) rather
                  than a text label competing for the same line's width. */}
              <div className="flex items-center gap-[7px]">
                {worktree.branch !== null ? (
                  <span
                    data-worktree-branch
                    className="min-w-0 flex-1 truncate font-mono text-ink-faint text-meta"
                  >
                    {worktree.branch}
                  </span>
                ) : (
                  <span className="flex-1" />
                )}
                {worktree.locked && (
                  <span data-worktree-locked className="flex-none text-ink-faint text-meta">
                    locked
                  </span>
                )}
                {worktreeSessions.length === 0 && (
                  <ShortcutTip label={`Start a session in ${displayName(worktree.path)}`}>
                    <button
                      type="button"
                      data-worktree-start-here={worktree.worktreeId}
                      aria-label={`start a session in ${displayName(worktree.path)}`}
                      onClick={() => void startHere(worktree)}
                      className="vam-tap vam-hit-24 flex h-[17px] w-[17px] flex-none cursor-pointer items-center justify-center rounded-[5px] text-ink-faint hover:text-ink"
                    >
                      <Play size={11} strokeWidth={1.8} />
                    </button>
                  </ShortcutTip>
                )}
              </div>
              {/* UI1: the nested rows a worktree's sessions used to only get
                  a COUNT for -- `SessionList.tsx` now suppresses this
                  worktree's own top-level project section whenever it is
                  visible here, so this is the only route left to reach one
                  of its sessions in `Group by: Project` mode. `onPickSession`
                  is `SessionList.tsx`'s own `onPick`, the exact handler a
                  top-level row's click already calls -- reused, not
                  re-derived. */}
              {worktreeSessions.length > 0 && (
                <div
                  data-worktree-sessions={worktree.worktreeId}
                  className="flex flex-col gap-0.5 pt-0.5"
                >
                  {worktreeSessions.map((entry) => (
                    <button
                      key={entry.session.id}
                      type="button"
                      data-worktree-session-row={entry.session.id}
                      onClick={() => onPickSession(entry.session.id)}
                      className={[
                        'vam-tap flex w-full items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-left text-control',
                        entry.session.id === focusedSessionId
                          ? 'bg-raised text-ink'
                          : 'text-ink-dim hover:bg-line hover:text-ink',
                      ].join(' ')}
                    >
                      <StatusMark status={entry.session.status} lane={11} glyph={9} />
                      <span className="min-w-0 flex-1 truncate">{entry.session.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pendingDelete !== null && (
        <ConfirmDeleteWorktree
          name={displayName(pendingDelete.path)}
          branch={pendingDelete.branch}
          dirty={deleteDirty}
          onConfirm={(confirmName) => void confirmDelete(confirmName)}
          onCancel={() => {
            setPendingDelete(null);
            setDeleteDirty(false);
          }}
        />
      )}
    </div>
  );
}
