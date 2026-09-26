/**
 * Daily-intensity bucketing — LOCAL DAYS, not UTC slices, and stable across a
 * daylight-saving transition. `bucketByLocalDay` takes the IANA zone as an
 * argument rather than reading `Intl.DateTimeFormat().resolvedOptions()`
 * itself, so a test can pin a zone regardless of which timezone the runner's
 * own machine is in.
 */
import { describe, expect, it } from 'vitest';
import { bucketByLocalDay, mergeDailyBuckets } from '../../src/shared/heatmap.js';

describe('bucketByLocalDay', () => {
  it('buckets by the LOCAL calendar day, not the UTC one', () => {
    // 2026-01-01T23:30:00-08:00 is 2026-01-02T07:30:00Z — the UTC day is
    // already the 2nd while Los Angeles is still on the 1st.
    const points = [{ at: '2026-01-02T07:30:00.000Z', tokens: 100 }];
    const buckets = bucketByLocalDay(points, 'America/Los_Angeles');
    expect(buckets).toEqual([{ day: '2026-01-01', tokens: 100 }]);
  });

  it('sums multiple points that land on the same local day', () => {
    const points = [
      { at: '2026-03-01T10:00:00.000Z', tokens: 40 },
      { at: '2026-03-01T20:00:00.000Z', tokens: 60 },
    ];
    const buckets = bucketByLocalDay(points, 'UTC');
    expect(buckets).toEqual([{ day: '2026-03-01', tokens: 100 }]);
  });

  it('keeps two instants either side of a spring-forward gap on their own local days', () => {
    // America/New_York springs forward on 2026-03-08: 02:00 local becomes
    // 03:00, so 01:30 local (06:30Z) and the next day's 01:30 local
    // (2026-03-09T06:30Z) must land on 2026-03-08 and 2026-03-09
    // respectively — never folded into one bucket by an offset mistake.
    const points = [
      { at: '2026-03-08T06:30:00.000Z', tokens: 5 },
      { at: '2026-03-09T06:30:00.000Z', tokens: 7 },
    ];
    const buckets = bucketByLocalDay(points, 'America/New_York');
    expect(buckets).toEqual([
      { day: '2026-03-08', tokens: 5 },
      { day: '2026-03-09', tokens: 7 },
    ]);
  });

  it('keeps the repeated hour of a fall-back transition on one local day', () => {
    // America/New_York falls back on 2026-11-01: 01:30 local occurs twice
    // (05:30Z EDT, then 06:30Z EST). Both must still read as 2026-11-01.
    const points = [
      { at: '2026-11-01T05:30:00.000Z', tokens: 3 },
      { at: '2026-11-01T06:30:00.000Z', tokens: 4 },
    ];
    const buckets = bucketByLocalDay(points, 'America/New_York');
    expect(buckets).toEqual([{ day: '2026-11-01', tokens: 7 }]);
  });

  it('sorts buckets chronologically regardless of input order', () => {
    const points = [
      { at: '2026-05-03T00:00:00.000Z', tokens: 1 },
      { at: '2026-05-01T00:00:00.000Z', tokens: 2 },
      { at: '2026-05-02T00:00:00.000Z', tokens: 3 },
    ];
    const buckets = bucketByLocalDay(points, 'UTC');
    expect(buckets.map((b) => b.day)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03']);
  });

  it('returns an empty list for no points', () => {
    expect(bucketByLocalDay([], 'UTC')).toEqual([]);
  });
});

describe('mergeDailyBuckets', () => {
  it('adds token counts for the same day across two bucket lists', () => {
    const merged = mergeDailyBuckets(
      [{ day: '2026-01-01', tokens: 10 }],
      [
        { day: '2026-01-01', tokens: 5 },
        { day: '2026-01-02', tokens: 8 },
      ],
    );
    expect(merged).toEqual([
      { day: '2026-01-01', tokens: 15 },
      { day: '2026-01-02', tokens: 8 },
    ]);
  });
});
