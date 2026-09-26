/**
 * `buildHeatmapGrid` — turns the snapshot's flat `DailyBucket[]` into the
 * GitHub-style grid the Stats screen draws: a fixed trailing window of
 * calendar days ending today, laid out 7-per-column, with gaps (a day that
 * carried no usage at all) filled at zero rather than omitted — an omitted
 * day would silently compress the grid's own date range.
 */
import { describe, expect, it } from 'vitest';
import { buildHeatmapGrid } from '../../../src/renderer/stats/heatmap-grid.js';

describe('buildHeatmapGrid', () => {
  it('builds a grid spanning exactly WEEKS*7 days ending today, gaps included', () => {
    const today = new Date('2026-09-27T12:00:00.000Z');
    const grid = buildHeatmapGrid([{ day: '2026-09-27', tokens: 500 }], today, 2);
    const allDays = grid.weeks.flat();
    expect(allDays).toHaveLength(14);
    expect(allDays[allDays.length - 1]).toEqual({ day: '2026-09-27', tokens: 500 });
    // A day nothing was written for is present, at zero.
    expect(allDays.find((d) => d.day === '2026-09-20')).toEqual({ day: '2026-09-20', tokens: 0 });
  });

  it('lays out 7 rows per column, oldest-first within each column', () => {
    const today = new Date('2026-09-27T00:00:00.000Z');
    const grid = buildHeatmapGrid([], today, 3);
    expect(grid.weeks).toHaveLength(3);
    for (const column of grid.weeks) expect(column).toHaveLength(7);
    // Each column's days are consecutive and increasing.
    for (const column of grid.weeks) {
      for (let i = 1; i < column.length; i += 1) {
        const previous = column[i - 1];
        const current = column[i];
        expect(previous).toBeDefined();
        expect(current).toBeDefined();
        expect(Date.parse(current?.day ?? '')).toBeGreaterThan(Date.parse(previous?.day ?? ''));
      }
    }
  });

  it('finds the BEST day within the displayed window only', () => {
    const today = new Date('2026-09-27T00:00:00.000Z');
    const grid = buildHeatmapGrid(
      [
        { day: '2026-09-25', tokens: 900 },
        { day: '2026-01-01', tokens: 999_999 }, // outside the window — must not win
      ],
      today,
      2,
    );
    expect(grid.best).toEqual({ day: '2026-09-25', tokens: 900 });
  });

  it('reports the exact date range drawn', () => {
    const today = new Date('2026-09-27T00:00:00.000Z');
    const grid = buildHeatmapGrid([], today, 2);
    expect(grid.rangeStart).toBe('2026-09-14');
    expect(grid.rangeEnd).toBe('2026-09-27');
  });

  it('reports null for best when every day in the window is zero', () => {
    const today = new Date('2026-09-27T00:00:00.000Z');
    const grid = buildHeatmapGrid([], today, 1);
    expect(grid.best).toBeNull();
  });
});
