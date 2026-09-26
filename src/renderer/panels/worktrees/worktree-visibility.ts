/**
 * `WorktreesSection`'s own "Show external worktrees" rule -- the operator's
 * own report, translated: opening a project with many worktrees a CLI, Orca,
 * or `claude --worktree` made (or a locked one, vam's own or not) buried the
 * few the operator actually cares about. `hideAgentWorktrees`
 * (`domain/session-filter.ts`) already exists for ONE narrow shape of that
 * (Claude Code's own `.claude/worktrees/agent-*`); this is the general rule,
 * kept in its own small, pure module -- the same shape `WorktreesSection.tsx`'s
 * own local `isAgentWorktreeRow` already established for a worktree-ROW
 * predicate (never `session-filter.ts`, which only ever reads a `Session`) --
 * so both toggles compose as two independent, ORed hide rules over the same
 * row list, neither aware the other exists.
 *
 * DEFAULT HIDDEN, THE OPPOSITE OF EVERY OTHER `Session` FILTER'S NAME BUT NOT
 * ITS SHAPE: `SessionFilters.hideExternalWorktrees` is a `hide`-shaped
 * boolean like its five neighbours (`session-filter.ts`'s own toggles),
 * default `true` -- only the popover's OWN label reads "Show external
 * worktrees", the operator's own words for the same rule stated the other
 * way round.
 */

import type { WorktreeInfo } from '../../../shared/worktree.js';

/** The one thing this whole module reads off `SessionFilters` -- kept as its
 *  own narrow type here rather than importing the full `SessionFilters`
 *  shape, so this module (which knows about `WorktreeInfo`, never `Session`)
 *  and `domain/session-filter.ts` (which knows about `Session`, never
 *  `WorktreeInfo`) do not have to import each other's unrelated vocabulary
 *  just to share one boolean. */
export type WorktreeVisibilityFilters = {
  readonly hideExternalWorktrees: boolean;
};

/**
 * "Not vam's, or locked" -- the operator's own two examples in one predicate,
 * ORed exactly the way they described them: a worktree vam did not make
 * (`WorktreeInfo.external`) OR one that is locked, REGARDLESS of which vam
 * made -- a locked worktree offers no delete button already (`WorktreesSection
 * .tsx`'s own rule), so grouping it with the rows the operator is unlikely to
 * act on is the same call, restated for visibility rather than for the
 * delete button.
 *
 * Also what decides which rows draw in the dimmed, nested tree once the
 * toggle is off (shown) -- one predicate for both "is this hidden by
 * default" and "does this belong in the tree, once shown" is deliberate: the
 * two questions have the same answer everywhere in this feature.
 */
export function isExternalOrLockedWorktree(worktree: WorktreeInfo): boolean {
  return worktree.external || worktree.locked;
}

/** Does the external/locked rule remove this worktree ROW from the plain
 *  list right now? Same shape as `session-filter.ts`'s own `isHiddenByXFilter`
 *  functions: the toggle stands the whole rule down when off, an ordinary
 *  worktree is never touched by it either way. */
export function isHiddenByExternalWorktreeFilter(
  worktree: WorktreeInfo,
  filters: WorktreeVisibilityFilters,
): boolean {
  return filters.hideExternalWorktrees && isExternalOrLockedWorktree(worktree);
}
