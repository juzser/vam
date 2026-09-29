/**
 * Which sessions are vam's to show: the one predicate the sidebar's `entries`
 * memo and the notifier's `notifiable` memo both apply first. Pure, and reads
 * no status and no view narrowing (hideEnded, hideIdle, the pill, the query).
 * Its own module because `prefs.ts` already imports `session-filter.ts`.
 */

import { isSessionDismissed, type Prefs } from '../prefs/prefs.js';
import type { SessionEntry } from './selectors.js';
import { isHiddenByForeignFilter } from './session-filter.js';

export type OwnershipScope = {
  readonly prefs: Prefs;
  readonly hiddenProjectIds: readonly string[];
  readonly vamListingGap: string | null;
  readonly demo: boolean;
};

/** True when the entry is NOT vam's to show: its project is hidden or removed,
 *  the operator dismissed it (applied even during a listing gap), or the
 *  foreign rule holds and neither the gap nor the demo stands it down. */
export function isOutsideVamScope(entry: SessionEntry, scope: OwnershipScope): boolean {
  if (scope.hiddenProjectIds.includes(entry.project.id)) return true;
  if (
    isSessionDismissed(
      scope.prefs,
      entry.session.source ?? entry.project.source ?? 'unknown',
      entry.session.id,
      entry.session.activity,
    )
  ) {
    return true;
  }
  if (scope.vamListingGap !== null || scope.demo) return false;
  return isHiddenByForeignFilter(entry.session, scope.prefs.filters);
}
