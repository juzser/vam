/**
 * "Daily intensity" — a GitHub-style heatmap of recent combined token
 * activity. Plain `<div>`s, per the operator's own instruction to prefer
 * that over a chart library: a grid of coloured squares has no axes, no
 * tooltips-on-a-canvas, nothing a dependency would buy over CSS.
 *
 * THE SCALE IS ONE HUE AT FOUR OPACITIES, `--color-running` — the same token
 * the canvas already uses for "an agent is actively working", which already
 * carries its own light/dark pair in `styles.css`, CHOSEN there for
 * legibility on each theme's own card fill. Reusing it means this heatmap
 * needs no new token and inherits a contrast pairing already tuned, rather
 * than picking colours Orca's own screenshot happens to use.
 */

import { formatCompactNumber } from '../../shared/format-number.js';
import type { DailyBucket } from '../../shared/stats.js';
import { buildHeatmapGrid } from './heatmap-grid.js';

const WEEKS = 20;

/** Four non-empty buckets, chosen by dividing the window's own busiest day
 *  into quarters — not fixed token thresholds, since "busy" for one operator
 *  is a fraction of another's. Empty (`0` tokens) is its own, fifth step. */
function levelOf(tokens: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (tokens <= 0 || max <= 0) return 0;
  const ratio = tokens / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-line',
  1: 'bg-running/25',
  2: 'bg-running/50',
  3: 'bg-running/75',
  4: 'bg-running',
};

export function Heatmap({
  buckets,
  now = new Date(),
}: {
  readonly buckets: readonly DailyBucket[];
  readonly now?: Date;
}) {
  const grid = buildHeatmapGrid(buckets, now, WEEKS);
  const max = grid.weeks.flat().reduce((m, d) => Math.max(m, d.tokens), 0);

  return (
    <div data-stats-heatmap className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex gap-[3px]">
          {grid.weeks.map((column) => (
            <div key={column[0]?.day ?? Math.random()} className="flex flex-col gap-[3px]">
              {column.map((d) => (
                <div
                  key={d.day}
                  title={`${d.day}: ${formatCompactNumber(d.tokens)} tokens`}
                  className={`h-[11px] w-[11px] rounded-[2px] ${LEVEL_CLASS[levelOf(d.tokens, max)]}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-ink-faint text-meta">
        <span>{grid.rangeStart}</span>
        <div className="flex items-center gap-1">
          <span>Less</span>
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <span key={level} className={`h-[10px] w-[10px] rounded-[2px] ${LEVEL_CLASS[level]}`} />
          ))}
          <span>More</span>
        </div>
        <span>{grid.rangeEnd}</span>
      </div>
      {grid.best !== null && (
        <span
          data-stats-heatmap-best
          className="self-start rounded-full border border-line-strong px-2 py-0.5 text-ink-dim text-meta"
        >
          Best: {grid.best.day} ({formatCompactNumber(grid.best.tokens)})
        </span>
      )}
    </div>
  );
}
