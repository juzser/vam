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
 * below are the ONLY way to reach a worktree's session from the sidebar in
 * `Group by: Project` mode -- see `docs/design/worktrees.md`'s identity
 * decision for the full rationale on why a worktree's session keeps its own,
 * different `Project.id` regardless.
 *
 * NESTED SESSIONS DRAW THROUGH `renderSessionRow`, `SessionList.tsx`'s OWN
 * row-rendering function, passed down whole rather than reimplemented here.
 * A second review found the first cut of UI1 drew its own small button
 * instead -- reachable by click, but outside `rowRefs`, the jump-label map
 * and the context menu, so a session that used to answer `j`/`k`, a jump
 * letter and right-click stopped answering all three the moment its
 * top-level row was suppressed. `renderSessionRow` is the literal same
 * function a top-level row calls: same `data-session-row`, same
 * `rowRefs` registration (so the reveal-scroll effect and Canvas.tsx's own
 * `j`/`k` walk over `entries` -- untouched by this suppression, since it
 * never looked at the DOM -- both keep working), same jump-label badge, same
 * context menu, same close button, same phone treatment. Nothing here knows
 * or needs to know what is inside that function.
 */

import { ArrowDown, ArrowUp, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { hasAgentWorktreeSegment, isAgentWorktreeBranch } from '../../../shared/agent-worktree.js';
import type { WorktreeInfo } from '../../../shared/worktree.js';
import type { Project } from '../../domain/model.js';
import type { SessionEntry } from '../../domain/selectors.js';
import { ShortcutTip } from '../../keyboard/ShortcutTip.js';
import { ConfirmDeleteWorktree } from './ConfirmDeleteWorktree.js';
import { useWorktreeStatuses } from './useWorktreeStatuses.js';
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

/**
 * Is this row a Claude Code AGENT worktree -- `<repo>/.claude/worktrees/
 * agent-<id>`, the Claude Agent SDK's own `isolation: "worktree"` mechanism,
 * unrelated to this feature -- rather than one an operator (or a CLI, or
 * Orca) actually asked vam to manage? The identical two-signal rule a
 * SESSION is already filtered by (`shared/agent-worktree.ts`'s own header),
 * applied here to a worktree ROW instead: `worktree.path` is already a
 * realpath (main mints it that way, `worktrees.ts`'s own `WorktreeInfo`
 * header), so no second `realpath` call is needed the way a session's own
 * check pays for one.
 */
function isAgentWorktreeRow(worktree: WorktreeInfo): boolean {
  return hasAgentWorktreeSegment(worktree.path) || isAgentWorktreeBranch(worktree.branch);
}

export type WorktreesSectionProps = {
  readonly project: Project;
  readonly allEntries: readonly SessionEntry[];
  readonly forceOpenCreate: boolean;
  readonly onCloseCreate: () => void;
  /**
   * `SessionList.tsx`'s own row-rendering function, handed down whole --
   * see this file's header. Every nested session in this section draws
   * through this, not through anything defined here.
   */
  readonly renderSessionRow: (entry: SessionEntry) => ReactNode;
  /**
   * The OPERATOR's OWN toggle, `SessionFilters.hideAgentWorktrees`
   * (`domain/session-filter.ts`), threaded down from `SessionList.tsx` --
   * this section respects the SAME preference a session row already does,
   * rather than growing a second, independent one. Defaults to `true`
   * (hidden) so every existing caller/test that predates phase 2a keeps its
   * current behaviour -- vam never surfaced an agent worktree ROW before
   * this feature existed to adopt worktrees at all, so "hidden" is the only
   * default that changes nothing for them.
   */
  readonly hideAgentWorktrees?: boolean;
};

export function WorktreesSection({
  project,
  allEntries,
  forceOpenCreate,
  onCloseCreate,
  renderSessionRow,
  hideAgentWorktrees = true,
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

  // FILTERED BEFORE ANYTHING BELOW READS `worktrees` -- the row count next
  // to "Worktrees", the empty-section early return, AND the status poll
  // below all have to agree with what actually gets a row, or the count
  // would name a worktree the section itself never draws.
  const rawWorktrees = state.kind === 'ok' ? state.worktrees : [];
  const worktrees = hideAgentWorktrees
    ? rawWorktrees.filter((worktree) => !isAgentWorktreeRow(worktree))
    : rawWorktrees;

  // PHASE 2A'S OWN BADGES -- called UNCONDITIONALLY (React's own rule: no
  // hook after an early return), `enabled` by "this section actually has
  // rows to draw" so a project with zero (or only filtered-out) worktrees
  // never polls at all -- see `useWorktreeStatuses.ts`'s own header.
  const statuses = useWorktreeStatuses({
    projectId: project.id,
    worktreeIds: worktrees.map((worktree) => worktree.worktreeId),
    statusFn: window.api?.worktrees?.status,
    enabled: worktrees.length > 0,
  });

  if (state.kind === 'unavailable') {
    return null;
  }
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
          const status = statuses.get(worktree.worktreeId);
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
                {/* NEVER OFFERED ON A LOCKED WORKTREE -- `removeWorktree`
                    refuses one unconditionally, force or not
                    (`worktrees.ts`'s own rule), so a clickable × here would
                    only ever open a dialog whose one button always fails.
                    Phase 2a's own fix: the row now says so up front instead
                    of after a click. */}
                {!worktree.locked && (
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
                )}
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
                {/* PHASE 2A'S OWN BADGES -- a dirty dot, then an ahead/behind
                    pair, drawn ONLY once `status.ts`'s own read answers
                    (never a placeholder while loading, the same "say
                    nothing rather than guess" rule `WorktreeInfo.branch:
                    null` already follows). `--color-diff-file` (a changed
                    FILE'S own colour in the diff renderer, `out-markdown.tsx`)
                    reused for "this worktree has changed files" -- the same
                    hue, not a new one, matching this app's own token
                    economy. Ahead/behind reuse `--color-diff-add`/`-del`,
                    the add/remove-line colours: green for commits ready to
                    push, red for commits not yet pulled. */}
                {status?.dirty === true && (
                  <span
                    data-worktree-dirty
                    title="uncommitted changes"
                    className="h-1.5 w-1.5 flex-none rounded-full bg-diff-file"
                  />
                )}
                {status !== undefined && status.ahead !== null && status.behind !== null && (
                  <span
                    className="flex flex-none items-center gap-0.5 font-mono text-meta"
                    title={`${status.ahead} to push, ${status.behind} to pull`}
                  >
                    <ArrowUp size={10} strokeWidth={2} className="text-diff-add" />
                    <span data-worktree-ahead className="text-diff-add">
                      {status.ahead}
                    </span>
                    <ArrowDown size={10} strokeWidth={2} className="text-diff-del" />
                    <span data-worktree-behind className="text-diff-del">
                      {status.behind}
                    </span>
                  </span>
                )}
                {worktree.detached && (
                  <span data-worktree-detached className="flex-none text-ink-faint text-meta">
                    detached
                  </span>
                )}
                {worktree.prunable && (
                  <span
                    data-worktree-prunable
                    title={worktree.prunableReason ?? undefined}
                    className="flex-none text-ink-faint text-meta"
                  >
                    prunable
                  </span>
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
                  of its sessions in `Group by: Project` mode. `renderSessionRow`
                  is `SessionList.tsx`'s own row-rendering function -- see this
                  file's header for why nothing here reimplements it. */}
              {worktreeSessions.length > 0 && (
                <div
                  data-worktree-sessions={worktree.worktreeId}
                  className="flex flex-col gap-0.5 pt-0.5"
                >
                  {worktreeSessions.map((entry) => renderSessionRow(entry))}
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
