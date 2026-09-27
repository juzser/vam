/**
 * Which project ids are actually a WORKTREE OF another visible project --
 * UI1's fix: before this hook, a worktree's session formed its own
 * top-level project section (`docs/design/worktrees.md`'s identity
 * decision: `projectIdOf(worktreeId)`, deliberately a DIFFERENT id than the
 * parent's) *and* still nested a session count under the parent's own
 * "Worktrees" row -- the exact duplicate listing that design doc's §4
 * disclosed rather than hid. `SessionList.tsx` reads this hook's result to
 * suppress the duplicate top-level section; `WorktreesSection.tsx` is
 * unaffected -- it already renders the nested view from `allEntries`.
 *
 * `api` IS A PARAMETER, the same dependency-injection idiom `useWorktrees`
 * already uses for the same bridge member, for the same reason: testable
 * with a fake, never touches `window` itself. `SessionList.tsx` is the one
 * place that reads `window.api?.worktrees` and hands it down (the same
 * self-contained deviation `WorktreesSection.tsx`'s own header already
 * documents and justifies).
 *
 * ONE `api.list(id)` PER KNOWN PROJECT ID, in parallel, every one of a
 * project vam has never heard of as a git repo simply rejecting and
 * contributing nothing -- `listWorktrees` itself already refuses a
 * non-repository project (`not-a-repository`) or one with no live
 * directory (`unknown-project`); neither is an error worth surfacing here,
 * both just mean "not a worktree parent". `WorktreesSection` re-fetches the
 * SAME list a second time, for the (fewer, git-backed) parents that remain
 * visible after this hook's own suppression runs -- an accepted v1
 * duplication over threading this result down as a prop through every
 * call site that would otherwise need it.
 */

import { useEffect, useRef, useState } from 'react';
import type { WorktreesApi } from '../../../preload/api.js';

/**
 * SECOND GUARD, defensive: `listWorktrees` (main process,
 * `main/worktrees/worktrees.ts`) is the actual fix for the parent/child
 * cycle a cross-provider review found (a linked worktree's own project
 * used to report the main checkout as one of ITS children, on top of the
 * main checkout correctly reporting the linked worktree as one of its own
 * -- a two-node cycle that hid both projects' sidebar sections at once,
 * neither having an unsuppressed ancestor to stop at). This hook has no way
 * to prove a future regression -- in this map-building code, or in a git
 * topology main's own fix does not yet cover -- can never produce one
 * again, so it never trusts a raw parent chain to be acyclic: ANY project
 * whose chain of parents leads back to itself has that chain's cyclic
 * members stripped of their own parent edge here, before `SessionList.tsx`
 * ever reads the map. A project on a broken cycle simply reads
 * `parentId: undefined` again and draws at the top level -- worst case an
 * extra top-level row, never a project's sessions becoming unreachable.
 */
function breakCycles(raw: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const result = new Map(raw);
  for (const start of raw.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined) {
      if (seen.has(current)) {
        // `current` is the first node this walk revisits -- everything
        // from here back around to itself is the cycle. Each cyclic node
        // loses its OWN parent edge, which resolves every node on the
        // cycle in one pass; a "tail" that merely leads INTO the cycle
        // (not part of it) keeps its own edge untouched.
        let node: string | undefined = current;
        do {
          result.delete(node);
          node = raw.get(node);
        } while (node !== undefined && node !== current);
        break;
      }
      seen.add(current);
      current = raw.get(current);
    }
  }
  return result;
}

export function useWorktreeParents(
  projectIds: readonly string[],
  api: WorktreesApi | undefined,
): ReadonlyMap<string, string> {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [parents, setParents] = useState<ReadonlyMap<string, string>>(() => new Map());
  // The STABLE re-fetch signal: `projectIds` is a fresh array reference on
  // every caller render (`allEntries.map(...)`), so depending on the array
  // itself would re-fetch every render regardless of whether the actual SET
  // of ids changed.
  const key = [...projectIds].sort().join(',');

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is `projectIds`' own re-fetch signal, already derived from it; `projectIds` itself is intentionally excluded (see above).
  useEffect(() => {
    const currentApi = apiRef.current;
    if (currentApi === undefined || projectIds.length === 0) {
      setParents(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(
      projectIds.map((parentId) =>
        currentApi
          .list(parentId)
          .then((worktrees) => worktrees.map((w) => [w.projectId, parentId] as const))
          .catch(() => [] as readonly (readonly [string, string])[]),
      ),
    ).then((lists) => {
      if (!cancelled) setParents(breakCycles(new Map(lists.flat())));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return parents;
}
