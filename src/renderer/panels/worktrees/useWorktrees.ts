/**
 * The data half of the "Worktrees" sub-list: fetch, and refetch after a
 * create or a remove.
 *
 * `api` IS A PARAMETER, NOT READ FROM `window.api` IN HERE -- the same
 * dependency-injection idiom `useWaitingNotifications` already uses for its
 * own bridge member, so this hook is testable with a fake and never touches
 * `window` itself. `WorktreesSection.tsx` is the one place that reads
 * `window.api?.worktrees` and hands it down.
 *
 * `projectId === null` (no git-backed project focused, or the browser build,
 * which has no `api` at all) answers `{kind:'unavailable'}` at once, with no
 * request made -- "hidden when there are none" extends to "hidden when vam
 * cannot ask", the same reading `dictationAvailable` gives a control that
 * cannot act: it is not drawn, rather than drawn disabled or drawn wrong.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorktreesApi } from '../../../preload/api.js';
import type { WorktreeInfo } from '../../../shared/worktree.js';

export type WorktreesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ok'; readonly worktrees: readonly WorktreeInfo[] }
  | { readonly kind: 'error'; readonly message: string };

export function useWorktrees(input: {
  readonly projectId: string | null;
  readonly api: WorktreesApi | undefined;
}): { readonly state: WorktreesState; readonly reload: () => void } {
  const { projectId, api } = input;
  // A REF, NOT A DEPENDENCY: `WorktreesSection` reads a stable `window.api`
  // reference in real use, but nothing here should assume every caller does
  // -- a fresh object literal handed in on each render must re-fetch only
  // when `projectId` or `generation` actually changes, never merely because
  // `api`'s own identity did (that direction is an infinite render loop:
  // fetch -> `setState` -> re-render -> a fresh `api` object -> fetch again).
  const apiRef = useRef(api);
  apiRef.current = api;
  const [state, setState] = useState<WorktreesState>({ kind: 'loading' });
  const [generation, setGeneration] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is `reload`'s re-fetch signal, not a value read inside the effect.
  useEffect(() => {
    const currentApi = apiRef.current;
    if (projectId === null || currentApi === undefined) {
      setState({ kind: 'unavailable' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    currentApi
      .list(projectId)
      .then((worktrees) => {
        if (!cancelled) setState({ kind: 'ok', worktrees });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { state, reload };
}
