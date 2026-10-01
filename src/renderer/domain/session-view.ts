/**
 * THE ONE PIPELINE that decides which sessions the sidebar lists, and so the
 * one the filter popover's pill counts are drawn from. Pure, so the list and
 * its numbers cannot drift apart: a pill reading N is, by construction, the
 * number of rows the list shows when that pill is selected.
 *
 * It returns the set BEFORE `applyViewOrder`; ordering is a display choice and
 * never changes which sessions are in the set.
 */

import type { Prefs } from '../prefs/prefs.js';
import { isSessionDismissed } from '../prefs/prefs.js';
import type { SessionEntry } from './selectors.js';
import {
  isHiddenByAgentWorktreeFilter,
  isHiddenByEndedFilter,
  isHiddenByForeignFilter,
  isHiddenByIdleFilter,
  isHiddenByOriginFilters,
  type StatusFilter,
} from './session-filter.js';
import { isOutsideVamScope, type OwnershipScope } from './session-ownership.js';

export type SessionViewContext = {
  readonly ownershipScope: OwnershipScope;
  readonly query: string;
  /** Ids the text query matched; read only when `query` is not blank. */
  readonly matches: readonly string[];
  readonly statusFilter: StatusFilter;
  readonly prefs: Prefs;
  /** Why vam could not confirm its own ownership this load, or `null`. */
  readonly vamListingGap: string | null;
  /** False on the demo source, which never hides a foreign session. */
  readonly foreignFilterApplies: boolean;
};

/** Every key of `StatusFilter`, in one place so the tally cannot miss one. */
const STATUS_KEYS: readonly StatusFilter[] = [
  'all',
  'running',
  'waiting',
  'idle',
  'unstarted',
  'terminal',
  'done',
  'failed',
];

export function visibleSessions(
  entries: readonly SessionEntry[],
  ctx: SessionViewContext,
): SessionEntry[] {
  const { ownershipScope, query, matches, statusFilter, prefs, vamListingGap } = ctx;
  const byScope = entries.filter((e) => !isOutsideVamScope(e, ownershipScope));
  const byText =
    query.trim() === '' ? byScope : byScope.filter((e) => matches.includes(e.session.id));
  const byStatus =
    statusFilter === 'all' ? byText : byText.filter((e) => e.session.status === statusFilter);
  // Origin and dismissed always apply, even while a listing gap stands the
  // rest down: dismissal is the operator's own explicit act.
  const byOrigin = byStatus.filter((e) => !isHiddenByOriginFilters(e.session, prefs.filters));
  const byDismissed = byOrigin.filter(
    (e) =>
      !isSessionDismissed(
        prefs,
        e.session.source ?? e.project.source ?? 'unknown',
        e.session.id,
        e.session.activity,
      ),
  );
  // The listing-gap stand-down keeps the "show everything" rule.
  if (vamListingGap !== null) return byDismissed;
  return byDismissed.filter(
    (e) =>
      !isHiddenByEndedFilter(e.session, prefs.filters, statusFilter) &&
      !isHiddenByIdleFilter(e.session, prefs.filters, statusFilter) &&
      !isHiddenByAgentWorktreeFilter(e.session, prefs.filters) &&
      (!ctx.foreignFilterApplies || !isHiddenByForeignFilter(e.session, prefs.filters)),
  );
}

/**
 * The count each status pill shows: what selecting that pill would list. It
 * never reads `ctx.statusFilter`, so no count depends on the pill currently
 * selected and clicking a pill cannot move a number.
 */
export function statusTally(
  entries: readonly SessionEntry[],
  ctx: SessionViewContext,
): Record<StatusFilter, number> {
  const tally = {} as Record<StatusFilter, number>;
  for (const key of STATUS_KEYS) {
    tally[key] = visibleSessions(entries, { ...ctx, statusFilter: key }).length;
  }
  return tally;
}
