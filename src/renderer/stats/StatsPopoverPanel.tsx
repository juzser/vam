/**
 * The stats popover's body, loaded lazily by `StatsPopover` so the contribution
 * graph stays out of the eager entry chunk. It reads the snapshot on mount, so
 * every open of the popover (which mounts it afresh) retries a failed read.
 */

import { useEffect, useState } from 'react';
import { formatCompactNumber } from '../../shared/format-number.js';
import type { StatsSnapshot } from '../../shared/stats.js';
import { Heatmap } from './Heatmap.js';

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly snapshot: StatsSnapshot };

function Headline({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-heading text-ink">{value}</span>
      <span className="text-control text-ink-faint">{label}</span>
    </div>
  );
}

export default function StatsPopoverPanel() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    const bridge = window.api?.stats;
    if (bridge === undefined) {
      setLoad({ state: 'failed' });
      return;
    }
    let cancelled = false;
    bridge
      .get()
      .then((result) => {
        if (cancelled) return;
        setLoad(
          result.kind === 'ok'
            ? { state: 'ready', snapshot: result.snapshot }
            : { state: 'failed' },
        );
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (load.state === 'loading') {
    return <p className="text-control text-ink-dim">loading…</p>;
  }
  if (load.state === 'failed') {
    return (
      <p data-stats-popover-error className="text-control text-ink-dim">
        Stats unavailable
      </p>
    );
  }
  const { snapshot } = load;
  return (
    <div data-stats-popover-panel className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <Headline label="agents" value={String(snapshot.agentsSpawned)} />
        <Headline label="tokens" value={formatCompactNumber(snapshot.usageOverview.totalTokens)} />
        <Headline label="active days" value={String(snapshot.usageOverview.activeDays)} />
      </div>
      <Heatmap buckets={snapshot.heatmap} />
    </div>
  );
}
