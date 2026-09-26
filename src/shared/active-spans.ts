/**
 * "Time agents worked" — the sum of active spans per session, per the
 * operator's own definition: a gap longer than `GAP_THRESHOLD_MS` between two
 * consecutive timestamps ends a span; the gap itself is never counted as
 * active time, only the spans it separates are summed.
 *
 * Renderer-safe: no `electron`, no `node:` import.
 */

/** Five minutes — the operator's own number, named rather than repeated. */
export const GAP_THRESHOLD_MS = 5 * 60_000;

/**
 * The total active milliseconds across every span in one session's
 * timestamps, in any order and with any unparsable entries — both handled
 * here so a caller can hand this every timestamp a transcript actually wrote
 * without pre-filtering.
 */
export function activeMsOf(timestamps: readonly string[]): number {
  const at = timestamps
    .map((raw) => Date.parse(raw))
    .filter((ms): ms is number => Number.isFinite(ms))
    .sort((a, b) => a - b);
  return extendActiveMs(null, at).addedMs;
}

/** `extendActiveMs`'s own answer: how much active time the new timestamps
 *  added, and the newest timestamp seen — the two facts a cache entry needs
 *  to carry so the NEXT append can pick the span back up correctly. */
export type ExtendedActiveMs = {
  readonly addedMs: number;
  readonly lastAtMs: number | null;
};

/**
 * The incremental form of `activeMsOf`, for a file the incremental cache is
 * resuming rather than reading whole: `prevLastAtMs` is the newest timestamp
 * the PREVIOUS read of this file ended on (`null` for a file with no prior
 * read at all, or none of its timestamps parsed), and `timestampsMs` are the
 * new ones this read found, in any order.
 *
 * SPLIT OUT FROM `activeMsOf` RATHER THAN DUPLICATED, and `activeMsOf` is
 * defined in terms of this one: a session read in one pass and a session
 * whose read was resumed across a cache boundary must total the SAME active
 * time, and the way to guarantee that is for one to call the other rather
 * than for two gap-comparison loops to agree by construction.
 */
export function extendActiveMs(
  prevLastAtMs: number | null,
  timestampsMs: readonly number[],
): ExtendedActiveMs {
  const sorted = [...timestampsMs].sort((a, b) => a - b);
  let total = 0;
  let last = prevLastAtMs;
  for (const at of sorted) {
    if (last !== null) {
      const gap = at - last;
      if (gap >= 0 && gap <= GAP_THRESHOLD_MS) total += gap;
    }
    if (last === null || at > last) last = at;
  }
  return { addedMs: total, lastAtMs: last };
}
