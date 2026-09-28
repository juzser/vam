/**
 * Per-project collapse state for the "external/locked worktrees" tree
 * `WorktreesSection` draws once the operator turns "Show external worktrees"
 * on -- whether THAT project's own tree is folded shut.
 *
 * KEPT DIRECTLY IN `localStorage`, NOT THREADED THROUGH THE BIG `Prefs` BLOB
 * `prefs.ts` OWNS: `WorktreesSection.tsx`'s own header already states its
 * self-containment principle -- it reads `window.api?.worktrees` directly
 * rather than growing `SessionListProps`/`Canvas.tsx` -- and this is the
 * identical trade-off `prefs/local-storage.ts` exists to share: direct
 * `localStorage`, wrapped in that one fail-open policy, rather than a new
 * prop threaded through every call site between here and the top of the
 * tree.
 *
 * KEYED BY THE BARE PROJECT ID, unlike `Prefs.collapsedProjects`'s own
 * `source -> [id]` two-level shape: `Project.id` already embeds its source
 * (`domain/model.ts`'s own vocabulary), and this module owns no OTHER field
 * a bare id could collide with the way a two-level shape protects `prefs.ts`'s
 * multi-field store from.
 */

import { readItem, writeItem } from '../../prefs/local-storage.js';

const KEY = 'vam.worktrees.externalTreeCollapsed';

function readMap(): Record<string, boolean> {
  return readItem(KEY, {}, (raw) => {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[id] = value;
    }
    return out;
  });
}

/** Has this project's own external-worktree tree been folded shut? Absent is
 *  "no", the same direction `Prefs.collapsedProjects`'s own list-membership
 *  takes: an expanded project is an ABSENT entry, never a stored `false`. */
export function isWorktreeTreeCollapsed(projectId: string): boolean {
  return readMap()[projectId] === true;
}

/**
 * Fold or unfold one project's own tree. Removing the last-folded entry for
 * a project removes its KEY entirely rather than storing `false` -- exactly
 * `prefs.ts`'s own `withIdBySource` rule -- so "expand everything" leaves no
 * residue behind for a later reader to trip on.
 */
export function setWorktreeTreeCollapsed(projectId: string, collapsed: boolean): void {
  const map = readMap();
  if (collapsed) {
    map[projectId] = true;
  } else {
    delete map[projectId];
  }
  writeItem(KEY, JSON.stringify(map));
}
