/**
 * Stats & Usage — everything this machine's own transcripts say about the
 * operator's agents, computed locally by `src/main/stats/scan.ts` (a real
 * `node:worker_threads` worker, never this process) and read through the
 * ONE channel `window.api.stats` exposes.
 *
 * SAME OVERLAY IDIOM AS `ErrorLogPanel.tsx`: a full-bleed scrim, `role=
 * "dialog"`, `aria-modal`, Escape and a scrim click both close it — copied
 * rather than reinvented, on that panel's own precedent for the identical
 * reason (`KeySheet`/`CommandPalette` before it).
 *
 * COMPUTES ONLY WHILE OPEN, on the operator's own instruction: mounting this
 * component IS the trigger — one `get()` call — and nothing here polls
 * while it stays on screen. The refresh button is the only other trigger,
 * and it calls the SAME channel (`stats.refresh`), because main does the
 * identical thing either way (`CHANNELS.statsScan`'s own header).
 */

import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StatsResult } from '../../preload/api.js';
import { formatCompactNumber, formatDuration } from '../../shared/format-number.js';
import type { ProviderStat, StatsSnapshot } from '../../shared/stats.js';
import { PROVIDER_MARKS } from '../sources/provider-marks.js';
import { Heatmap } from './Heatmap.js';

export type StatsScreenProps = {
  readonly onClose: () => void;
};

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

function costText(usd: number | null): string {
  return usd === null ? 'n/a' : USD.format(usd);
}

function updatedText(generatedAt: string, now: Date): string {
  const ms = now.getTime() - new Date(generatedAt).getTime();
  const minutes = Number.isNaN(ms) ? 0 : Math.max(0, Math.round(ms / 60_000));
  return minutes === 0 ? 'Updated just now' : `Updated ${minutes}m ago`;
}

/** One of the three headline cards — an icon tile, a big number and a
 *  label. `title` is a plain native tooltip: a definition worth stating
 *  (`agentsSpawned`'s own count) without building a second tooltip
 *  primitive for one card. */
function HeadlineCard({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}) {
  return (
    <div
      title={hint}
      className="flex flex-1 flex-col gap-1 rounded-[9px] border border-line bg-card p-3"
    >
      {/* `text-heading`, vam's own LARGEST named step (`test/renderer/
          type-scale.test.ts`) -- not a bigger literal size for Orca's own
          hero numbers: the scale's whole point is that a call site picks a
          ROLE, and this is the role that already outranks every label
          under it. */}
      <span className="font-semibold text-heading text-ink leading-none">{value}</span>
      <span className="text-control text-ink-dim">{label}</span>
    </div>
  );
}

function OverviewTile({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 rounded-[7px] border border-line-strong bg-raised p-2">
      <span className="font-semibold text-ink text-control">{value}</span>
      <span className="text-ink-faint text-meta">{label}</span>
    </div>
  );
}

/** The stacked bar, three segments proportional to token count, plus a pill
 *  for the reasoning-token subset (never a fourth segment — it is counted
 *  inside `outputTokens` already, see `shared/stats.ts`'s `TokenMix`). */
function TokenMixBar({ mix }: { readonly mix: StatsSnapshot['tokenMix'] }) {
  const total = mix.inputTokens + mix.outputTokens + mix.cacheWriteTokens + mix.cacheReadTokens;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const cache = mix.cacheWriteTokens + mix.cacheReadTokens;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-line">
        <span className="h-full bg-icon-teal" style={{ width: `${pct(mix.inputTokens)}%` }} />
        <span className="h-full bg-icon-purple" style={{ width: `${pct(mix.outputTokens)}%` }} />
        <span className="h-full bg-icon-yellow" style={{ width: `${pct(cache)}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-control text-ink-dim">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-icon-teal" /> new input{' '}
          {formatCompactNumber(mix.inputTokens)}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-icon-purple" /> output{' '}
          {formatCompactNumber(mix.outputTokens)}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-icon-yellow" /> cache{' '}
          {formatCompactNumber(cache)}
        </span>
        <span className="rounded-full border border-line-strong px-2 py-0.5 text-meta">
          +{formatCompactNumber(mix.reasoningTokens)} reasoning
        </span>
      </div>
    </div>
  );
}

function ProviderCard({ provider }: { readonly provider: ProviderStat }) {
  const mark = PROVIDER_MARKS[provider.id];
  return (
    <div
      data-stats-provider={provider.id}
      className="flex flex-col gap-1.5 rounded-[9px] border border-line bg-card p-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-ink">
          {mark !== undefined && <mark.Glyph size={14} />}
          <span className="font-medium text-control">{provider.label}</span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-meta ${
            provider.hasData ? 'bg-running/20 text-ink' : 'bg-line text-ink-faint'
          }`}
        >
          {provider.hasData ? 'Enabled' : 'Off'}
        </span>
      </div>
      <div className="text-ink-faint text-meta">{provider.model ?? 'no model read yet'}</div>
      <div className="grid grid-cols-3 gap-2 text-control">
        <span>{formatCompactNumber(provider.tokens)} tokens</span>
        <span>
          {provider.sessions} sessions · {provider.turns} turns
        </span>
        <span>{costText(provider.costUsd)}</span>
      </div>
      <span className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <span
          className="block h-full bg-running"
          style={{ width: `${Math.min(100, Math.max(0, provider.sharePercent))}%` }}
        />
      </span>
    </div>
  );
}

function ScreenBody({
  snapshot,
  onRefresh,
}: {
  readonly snapshot: StatsSnapshot;
  readonly onRefresh: () => void;
}) {
  const [now] = useState(() => new Date());
  const enabledCount = snapshot.providers.filter((p) => p.enabled).length;
  const dataCount = snapshot.providers.filter((p) => p.hasData).length;
  const sessionCount = snapshot.providers.reduce((sum, p) => sum + p.sessions, 0);

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <HeadlineCard
            label="Agents spawned"
            value={String(snapshot.agentsSpawned)}
            hint="Distinct session transcripts, plus subagent transcripts where they are their own file."
          />
          <HeadlineCard
            label="Time agents worked"
            value={formatDuration(snapshot.activeMs)}
            hint="Sum of active spans per session; a gap over 5 minutes between events ends a span."
          />
          <HeadlineCard
            label="PRs created"
            value={snapshot.prsCreated.kind === 'ok' ? String(snapshot.prsCreated.count) : '—'}
            hint={snapshot.prsCreated.kind === 'ok' ? undefined : snapshot.prsCreated.hint}
          />
        </div>
        {snapshot.prsCreated.kind === 'unavailable' && (
          <p className="text-ink-faint text-meta">{snapshot.prsCreated.hint}</p>
        )}
        <p className="text-ink-faint text-meta">
          Tracking since{' '}
          {snapshot.trackingSinceIso === null
            ? '—'
            : DATE.format(new Date(snapshot.trackingSinceIso))}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink text-heading">Usage Analytics</h3>
          <span className="rounded-full border border-line-strong px-2 py-0.5 text-control text-ink-dim">
            Overview
          </span>
        </div>
        <div className="flex flex-col gap-2 rounded-[9px] border border-line bg-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-ink-faint text-meta">
              {updatedText(snapshot.generatedAt, now)}
            </span>
            <button
              type="button"
              aria-label="refresh usage"
              onClick={onRefresh}
              className="flex cursor-pointer items-center gap-1 rounded border border-line px-2 py-0.5 text-control text-ink-dim hover:text-ink"
            >
              <RefreshCw size={12} strokeWidth={1.5} /> Refresh
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <OverviewTile
              label="Total tokens"
              value={formatCompactNumber(snapshot.usageOverview.totalTokens)}
            />
            <OverviewTile label="Est. cost" value={costText(snapshot.usageOverview.estCostUsd)} />
            <OverviewTile label="Active days" value={String(snapshot.usageOverview.activeDays)} />
            <OverviewTile
              label="Cache share"
              value={`${Math.round(snapshot.usageOverview.cacheSharePercent)}%`}
            />
          </div>
          <p className="text-ink-faint text-meta">
            est. — priced from a bundled table dated {snapshot.priceTableAsOf}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold text-ink text-heading">Daily intensity</h3>
        <Heatmap buckets={snapshot.heatmap} now={now} />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold text-ink text-heading">Token mix</h3>
        <TokenMixBar mix={snapshot.tokenMix} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-ink text-heading">
            Providers — {enabledCount} enabled, {dataCount} with data
          </h3>
          <span className="rounded-full border border-line-strong px-2 py-0.5 text-control text-ink-dim">
            {sessionCount} sessions
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {snapshot.providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      </div>
    </>
  );
}

export function StatsScreen({ onClose }: StatsScreenProps) {
  const [result, setResult] = useState<StatsResult | null>(null);
  const bridge = window.api?.stats;
  const dialogRef = useRef<HTMLDivElement>(null);

  // THE KEYBOARD, MOVED ONTO THE DIALOG ON OPEN — not a nicety, a
  // requirement for `onEscape` below to ever fire. This is reached by a
  // CLICK on the sidebar's entry icon, which is OUTSIDE this subtree; a real
  // browser delivers a keydown to whatever element actually holds focus
  // (`document.activeElement`), and without this a real Escape press keeps
  // landing on that button and never reaches this dialog's own handler at
  // all — measured with a real keypress in `e2e/stats-usage-shots.mjs`,
  // which a synthetic `fireEvent.keyDown(dialog, ...)` unit test cannot see
  // (it dispatches directly on the node, bypassing focus entirely).
  // `SettingsOverlay.tsx` documents the identical fix for the identical
  // reason.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    if (bridge === undefined) return;
    let cancelled = false;
    bridge
      .get()
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch(() => {
        if (!cancelled) setResult({ kind: 'error', message: 'the stats scan failed unexpectedly' });
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const onRefresh = (): void => {
    bridge
      ?.refresh()
      .then(setResult)
      .catch(() => setResult({ kind: 'error', message: 'the stats scan failed unexpectedly' }));
  };

  const onEscape = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') onClose();
  };

  return (
    <div
      ref={dialogRef}
      data-stats-screen
      data-overlay-host
      role="dialog"
      // NOT "stats and usage" -- see the entry button's own comment
      // (`SessionList.tsx`): any accessible name containing "usage"
      // collides with `e2e/usage-popover-shots.mjs`'s substring
      // `getByLabel('usage')` query for the account icon's popover toggle.
      aria-label="stats"
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={onEscape}
      className="absolute inset-0 z-50 flex items-start justify-center pt-10 focus:outline-none"
    >
      <button
        type="button"
        aria-label="close stats"
        className="absolute inset-0 cursor-default bg-ground/70"
        onMouseDown={onClose}
      />
      <div className="relative flex max-h-[85vh] w-[min(920px,94vw)] flex-col gap-4 overflow-y-auto rounded-md border border-line bg-panel p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="font-semibold text-heading text-ink">Stats & Usage</h2>
            <p className="text-control text-ink-dim">
              What this machine's own agent transcripts say — computed locally, nothing leaves it.
            </p>
          </div>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            className="rounded border border-line px-2 py-0.5 text-control text-ink-dim hover:text-ink"
          >
            Esc
          </button>
        </div>

        {bridge === undefined ? (
          <p data-stats-unavailable className="text-control text-ink-dim">
            stats are only available in the desktop app on macOS
          </p>
        ) : result === null ? (
          <p className="text-control text-ink-dim">reading this machine's transcripts…</p>
        ) : result.kind === 'error' ? (
          <p className="text-control text-failed">{result.message}</p>
        ) : (
          <ScreenBody snapshot={result.snapshot} onRefresh={onRefresh} />
        )}
      </div>
    </div>
  );
}
