/**
 * The dirty-dot / ahead-behind half of a worktree row -- phase 2a's own
 * addition (`docs/design/worktrees.md`'s phase-2 list), fetched separately
 * from `useWorktrees`'s own `list()` and only for the ids a caller actually
 * asks about.
 *
 * PERFORMANCE IS THE WHOLE POINT OF THIS BEING ITS OWN HOOK, not a field on
 * `WorktreeInfo`: `status.ts`'s own header explains why a dirty check and an
 * ahead/behind count are each their own `git` spawn PER WORKTREE. This hook
 * is the renderer's own gate on when that is worth paying for at all:
 *
 *  - `enabled` composes with an empty `worktreeIds` and a missing `api` --
 *    any one of the three means no request, ever, the same "no gate here
 *    means no timer at all" contract `useVisibilityInterval` documents for
 *    its own `enabled` parameter. `WorktreesSection.tsx` passes `enabled`
 *    as "this project's Worktrees section actually has rows to draw" --
 *    that component already returns `null` for zero worktrees, so this hook
 *    is never even MOUNTED, let alone polling, for a project with none.
 *  - `WORKTREE_STATUS_POLL_MS` (20s) is an order of magnitude slower than
 *    `useSourceModel`'s own base poll (`SOURCE_POLL_INTERVAL_MS`, 10s): a
 *    dirty dot is advisory, never correctness-critical the way a session's
 *    own live status is, and every tick here is up to
 *    `STATUS_CONCURRENCY_LIMIT` real `git` child processes per worktree,
 *    not a single cheap read.
 *  - `hidden: 'pause'` -- a hidden window stops asking entirely, the same
 *    choice `useAgentWork`'s own detail-pane poll makes for the identical
 *    reason: nothing downstream depends on a badge nobody can see.
 *
 * A FAILED FETCH NEVER BLANKS THE MAP -- the last known statuses stay on
 * screen rather than a badge flickering out because one poll's `git` call
 * hiccuped; the next successful poll replaces them wholesale.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorktreesApi } from '../../../preload/api.js';
import type { WorktreeStatus } from '../../../shared/worktree.js';
import { useVisibilityInterval } from '../../useVisibilityInterval.js';

/** See this file's own header for why 20s, and why an order of magnitude
 *  slower than `SOURCE_POLL_INTERVAL_MS`. */
export const WORKTREE_STATUS_POLL_MS = 20_000;

export function useWorktreeStatuses(input: {
  readonly projectId: string;
  readonly worktreeIds: readonly string[];
  /**
   * THE FUNCTION ITSELF, not the `worktrees` object it lives on --
   * `WorktreesSection.tsx` reads it as `window.api?.worktrees?.status`, so a
   * bridge (or a test double) that has `worktrees` but predates `status`
   * hands this `undefined` too, the same "member may not exist yet" optional
   * chaining every other read of `window.api` in this feature already
   * tolerates, rather than this hook having to ask "does the object I was
   * handed actually have a `status` key" itself.
   */
  readonly statusFn: WorktreesApi['status'] | undefined;
  readonly enabled: boolean;
}): ReadonlyMap<string, WorktreeStatus> {
  const { projectId, worktreeIds, statusFn, enabled } = input;

  // REFS, NOT DEPENDENCIES -- `useWorktrees.ts`'s own `apiRef` makes the
  // identical argument: the poll below must see the LATEST ids/api without
  // re-running its own mount/interval effect on every render.
  const statusFnRef = useRef(statusFn);
  statusFnRef.current = statusFn;
  const idsRef = useRef(worktreeIds);
  idsRef.current = worktreeIds;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const [statuses, setStatuses] = useState<ReadonlyMap<string, WorktreeStatus>>(() => new Map());

  const refresh = useCallback(() => {
    const currentStatusFn = statusFnRef.current;
    const ids = idsRef.current;
    if (currentStatusFn === undefined || ids.length === 0) return;
    currentStatusFn({ projectId: projectIdRef.current, worktreeIds: [...ids] })
      .then((rows) => {
        setStatuses(new Map(rows.map((row) => [row.worktreeId, row] as const)));
      })
      .catch(() => {
        // Advisory data -- see this file's own header: a failed poll keeps
        // whatever the last successful one already painted.
      });
  }, []);

  const idsKey = [...worktreeIds].sort().join('\u0000');
  const gated = enabled && statusFn !== undefined && worktreeIds.length > 0;
  // THE MOUNT / VISIBILITY / CADENCE TRIGGER. Fires one immediate call
  // whenever `gated` turns true (mount included) and again on every tick and
  // visibility resume -- `useVisibilityInterval.ts`'s own header.
  useVisibilityInterval(gated, WORKTREE_STATUS_POLL_MS, 'pause', refresh);
  // THE ID-SET CHANGE TRIGGER, SEPARATE FROM THE ONE ABOVE -- a worktree
  // created or removed should not wait a full `WORKTREE_STATUS_POLL_MS` to
  // be reflected. `idsKey` is `useWorktreeParents.ts`'s own re-fetch-signal
  // idiom (`worktreeIds` is a fresh array reference on every caller render,
  // so depending on the array itself would re-fetch every render rather
  // than only when the actual SET changed). `sinceMountRef` skips this
  // effect's OWN first run, which would otherwise double the immediate call
  // `useVisibilityInterval` already made for the exact same mount.
  const sinceMountRef = useRef(idsKey);
  useEffect(() => {
    if (gated && sinceMountRef.current !== idsKey) refresh();
    sinceMountRef.current = idsKey;
  }, [idsKey, gated, refresh]);

  return statuses;
}
