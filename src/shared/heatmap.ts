/**
 * Daily-intensity bucketing for the Stats screen's heatmap — LOCAL DAYS, on
 * the operator's own instruction, and DST-safe.
 *
 * `Intl.DateTimeFormat` with an explicit `timeZone` is what makes this DST-
 * safe without this module reasoning about offsets itself: the ICU tables
 * behind it already know when a zone's clock skips or repeats an hour, so
 * asking it "what calendar day is this instant, in this zone" is correct on
 * both sides of a transition for free. Re-deriving that with a fixed UTC
 * offset would get the fall-back hour (the one that occurs twice) right by
 * accident and the spring-forward gap wrong the first real month it ran.
 *
 * The zone is a PARAMETER, not read from `Intl.DateTimeFormat().
 * resolvedOptions().timeZone` inside this module — the caller (`scan.ts` in
 * production) passes the operator's own system zone, and a test pins
 * whichever zone its assertion is actually about, regardless of which zone
 * the machine running the test happens to be in.
 */

export type DailyPoint = {
  readonly at: string;
  readonly tokens: number;
};

export type DailyBucket = {
  readonly day: string;
  readonly tokens: number;
};

/**
 * `en-CA` formats as `YYYY-MM-DD` directly — no reassembly, no locale-
 * specific separator to get wrong.
 *
 * EXPORTED, AND MEANT TO BE BUILT ONCE PER SCAN, NOT ONCE PER LINE:
 * `Intl.DateTimeFormat` construction is the expensive part of this whole
 * module, and `scan.ts` calls `localDayOf` once per usage event across
 * every transcript on the machine — building a fresh formatter per event
 * would turn a bucketing pass over hundreds of thousands of lines into
 * hundreds of thousands of `Intl` constructions. `bucketByLocalDay` below
 * builds one locally for callers that only have a handful of points.
 */
export function makeLocalDayFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** The local calendar day (`YYYY-MM-DD`) an instant falls on, per an
 *  already-built formatter — see `makeLocalDayFormatter`'s own header. */
export function localDayOf(atMs: number, format: Intl.DateTimeFormat): string {
  return format.format(atMs);
}

/**
 * Sums `tokens` per LOCAL calendar day in `timeZone`, returned oldest first.
 * An unparsable `at` is skipped rather than thrown on — this reads data a
 * scan already validated shape-for-shape; a caller that wants "malformed
 * lines counted" does that counting at the line-parsing layer, not here.
 */
export function bucketByLocalDay(
  points: readonly DailyPoint[],
  timeZone: string,
): readonly DailyBucket[] {
  const format = makeLocalDayFormatter(timeZone);
  const totals = new Map<string, number>();
  for (const point of points) {
    const ms = Date.parse(point.at);
    if (Number.isNaN(ms)) continue;
    const day = localDayOf(ms, format);
    totals.set(day, (totals.get(day) ?? 0) + point.tokens);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, tokens]) => ({ day, tokens }));
}

/**
 * Adds two bucket lists together by day — how the incremental cache's
 * per-file totals (`scan.ts`) are combined into one machine-wide heatmap
 * without re-walking every file on every scan.
 */
export function mergeDailyBuckets(
  a: readonly DailyBucket[],
  b: readonly DailyBucket[],
): readonly DailyBucket[] {
  const totals = new Map<string, number>();
  for (const bucket of [...a, ...b]) {
    totals.set(bucket.day, (totals.get(bucket.day) ?? 0) + bucket.tokens);
  }
  return [...totals.entries()]
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    .map(([day, tokens]) => ({ day, tokens }));
}
