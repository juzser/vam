/**
 * THE WATERMARK BEHIND THE SIDEBAR'S "N sessions hidden — vam did not start
 * them" NOTE.
 *
 * `SessionList.tsx`'s own note shows itself once `foreignHiddenCount` grows
 * past whatever it was last acknowledged at -- by an auto-hide 8s after it
 * appeared, or by the operator's own Dismiss -- and stays quiet at that same
 * count from then on. "That same count" has to survive a poll, a re-render,
 * AND a relaunch, or an operator who dismissed the note today would have it
 * back tomorrow for nothing new. So the one number is kept here, per viewer,
 * in `localStorage` -- the exact pattern `sources/remote-token.ts` already
 * uses for a value that must survive an absent or throwing storage without
 * taking the feature it backs down with it (Safari private mode throws from
 * `setItem`/`getItem`; a viewer there just gets asked again next launch,
 * which is worse than persisting and not broken).
 *
 * ONE KEY, no per-workspace or per-source qualifier: the note itself is a
 * fact about the WHOLE sidebar's count, not about any one project or source,
 * so there is nothing narrower to key it by.
 */

const KEY = 'vam.foreignHiddenNote.acknowledgedCount';

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Access ITSELF throws in some privacy modes, before any method runs.
    return null;
  }
}

/**
 * The count the note was last shown at and left (auto-hidden or dismissed),
 * or `0` if it never has been -- `0` is also the only honest answer to a
 * missing, corrupt, negative or non-finite stored value: none of those are a
 * count the operator ever actually saw.
 */
export function readAcknowledgedForeignHiddenCount(): number {
  try {
    const raw = store()?.getItem(KEY) ?? null;
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

/**
 * Records that the note has now been seen at `count`. Silently refuses a
 * negative or non-finite value -- there is no such count to acknowledge --
 * and silently swallows a storage that refuses the write, for
 * `readAcknowledgedForeignHiddenCount`'s own reason.
 */
export function writeAcknowledgedForeignHiddenCount(count: number): void {
  if (!Number.isFinite(count) || count < 0) return;
  try {
    store()?.setItem(KEY, String(count));
  } catch {
    // See this module's header: a viewer who cannot persist this is asked
    // again next launch, which is not a broken sidebar.
  }
}
