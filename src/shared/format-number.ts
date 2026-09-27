/**
 * Number formatting for the Stats & Usage screen — the one place the operator
 * asked for a CONSISTENT helper rather than an ad hoc `toLocaleString()` per
 * card. Two shapes, matched against the mockup's own examples:
 *
 *  - under a million, GROUPED: `115,117` — a token count or a session count in
 *    this range reads better with its digits than compacted to `0.1M`.
 *  - a million and over, COMPACT: `18.2B`, one decimal, trailing `.0` dropped
 *    (`3M`, not `3.0M`).
 *
 * Renderer-safe: no `electron`, no `node:` import, so both processes can
 * import it without pulling the other's runtime in.
 */

const GROUPED = new Intl.NumberFormat('en-US');

const SUFFIXES: readonly { readonly value: number; readonly suffix: string }[] = [
  { value: 1e12, suffix: 'T' },
  { value: 1e9, suffix: 'B' },
  { value: 1e6, suffix: 'M' },
];

/** The boundary between grouped and compact — see the header. */
const COMPACT_FLOOR = 1_000_000;

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  if (magnitude < COMPACT_FLOOR) {
    return `${sign}${GROUPED.format(magnitude)}`;
  }
  for (const { value: threshold, suffix } of SUFFIXES) {
    // Rounded at ONE decimal before the comparison, not truncated: 999.95M
    // rounds to 1000.0M, which belongs to the NEXT suffix up (`1B`), not to a
    // three-digit `1000M`.
    const rounded = Math.round((magnitude / threshold) * 10) / 10;
    if (rounded >= 1) {
      const text =
        rounded >= 1000 ? `${rounded / 1000}${nextSuffix(suffix)}` : `${rounded}${suffix}`;
      return `${sign}${text}`;
    }
  }
  return `${sign}${GROUPED.format(magnitude)}`;
}

function nextSuffix(suffix: string): string {
  const order = ['M', 'B', 'T'];
  const at = order.indexOf(suffix);
  return order[at + 1] ?? suffix;
}

/**
 * `49d 12h`, `5h 30m`, `42m` — the "time agents worked" card's own duration
 * shape. Two units at a time, the coarser one omitted below its own scale
 * (no "0d 5h"), and never negative: a duration this screen computes is a
 * SUM of non-negative spans (`active-spans.ts`), so a caller handing this a
 * negative number has already gone wrong upstream, and the honest floor is
 * zero rather than a sign this card never draws.
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
