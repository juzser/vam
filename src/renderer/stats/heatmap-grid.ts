/**
 * Turns the snapshot's flat `DailyBucket[]` into the GitHub-style grid the
 * Stats screen draws: a fixed trailing window of LOCAL calendar days ending
 * today, gaps filled at zero rather than omitted (an omitted day would
 * silently shrink the grid's own reported date range). Days are chunked into
 * columns of 7, oldest-first, which reads as "weeks" without this needing to
 * align each column to a real Sunday — a simplification stated rather than
 * hidden, since vam's design system has no existing heatmap to match.
 *
 * `today` is a parameter, never `new Date()` read inside this module,
 * for the reason every pure function in this tree takes its clock as an
 * argument: a test pins a date regardless of when it runs.
 */

import { localDayOf, makeLocalDayFormatter } from '../../shared/heatmap.js';
import type { DailyBucket } from '../../shared/stats.js';

export type HeatmapGrid = {
  /** Columns of exactly 7 days each, oldest column first, oldest day first
   *  within a column. */
  readonly weeks: readonly { readonly day: string; readonly tokens: number }[][];
  /** The day with the most tokens WITHIN the displayed window — `null` when
   *  every displayed day is zero. */
  readonly best: { readonly day: string; readonly tokens: number } | null;
  readonly rangeStart: string;
  readonly rangeEnd: string;
};

export function buildHeatmapGrid(
  buckets: readonly DailyBucket[],
  today: Date,
  weeks: number,
): HeatmapGrid {
  const format = makeLocalDayFormatter(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const totals = new Map(buckets.map((b) => [b.day, b.tokens] as const));
  const days: { day: string; tokens: number }[] = [];
  const totalDays = weeks * 7;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const todayKey = localDayOf(today.getTime(), format);
  // Walk back from TODAY's own local day, one calendar day at a time, using
  // the SAME instant-in-time step (`ONE_DAY_MS`) rather than a UTC-date
  // subtraction that would drift a day around a DST transition -- `today`'s
  // millisecond instant is what `localDayOf` is asked about each step, and
  // only the last step's answer (`todayKey`) is trusted directly for the
  // window's own end.
  for (let i = totalDays - 1; i >= 0; i -= 1) {
    const at = today.getTime() - i * ONE_DAY_MS;
    const day = i === 0 ? todayKey : localDayOf(at, format);
    days.push({ day, tokens: totals.get(day) ?? 0 });
  }

  const weekColumns: { day: string; tokens: number }[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weekColumns.push(days.slice(i, i + 7));
  }

  let best: { day: string; tokens: number } | null = null;
  for (const d of days) {
    if (d.tokens > 0 && (best === null || d.tokens > best.tokens)) best = d;
  }

  return {
    weeks: weekColumns,
    best,
    rangeStart: days[0]?.day ?? todayKey,
    rangeEnd: days[days.length - 1]?.day ?? todayKey,
  };
}
