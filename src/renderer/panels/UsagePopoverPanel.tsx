/**
 * The usage popover's panel BODY, split out of `UsagePopover.tsx` so the
 * provider sections, the polling hook and their shared formatters ship in a
 * lazy chunk rather than the eager entry (`React.lazy` there). The toggle, the
 * shared open state, the dialog frame (focus, Escape, positioning) and the
 * dismissal wiring stay eager in `UsagePopover.tsx`; this file is mounted only
 * while the popover is open, so it polls from mount and its refresh state
 * dies with it on close.
 */

import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CodexUsageSnapshot, CodexWindowDisplay } from '../../shared/codex-usage.js';
import { clockTime, describeCodexUsage } from '../../shared/codex-usage.js';
import { PROVIDERS } from '../../shared/providers.js';
import {
  describeUsage,
  POLL_INTERVAL_MS,
  type UsageSnapshot,
  type UsageWindow,
} from '../../shared/usage.js';
import { PROVIDER_MARKS } from '../sources/provider-marks.js';

const UNKNOWN_CLAUDE: UsageSnapshot = { kind: 'unknown', reason: 'unavailable' };
const UNKNOWN_CODEX: CodexUsageSnapshot = { kind: 'unknown', reason: 'unavailable' };

/**
 * Polls `get` immediately and then on `POLL_INTERVAL_MS` while `open`,
 * clearing the interval the moment it is not -- the same newest-poll-wins
 * race guard `Canvas.tsx`'s `useUsageSnapshot` uses, so a slow answer from a
 * poll the operator has since closed the popover on cannot land after a
 * fresher one (or after `get` goes away because `window.api` never existed).
 */
function useLiveSnapshot<T>(
  open: boolean,
  unknown: T,
  get?: (opts?: { readonly force?: boolean }) => Promise<T>,
  refreshTick = 0,
  onForcedSettled?: () => void,
): T {
  const [snapshot, setSnapshot] = useState<T>(unknown);
  const settled = useRef(onForcedSettled);
  settled.current = onForcedSettled;
  useEffect(() => {
    if (!open || get === undefined) {
      if (!open) setSnapshot(unknown);
      return;
    }
    let cancelled = false;
    let issued = 0;
    const poll = (force = false) => {
      issued += 1;
      const seq = issued;
      const mine = () => !cancelled && seq === issued;
      (force ? get({ force: true }) : get())
        .then((next) => {
          if (mine()) setSnapshot(next);
        })
        .catch(() => {
          if (mine()) setSnapshot(unknown);
        })
        .finally(() => {
          if (force) settled.current?.();
        });
    };
    poll(refreshTick > 0);
    const id = window.setInterval(() => poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // `unknown` is safe to depend on: both call sites hand this a
    // MODULE-LEVEL constant (`UNKNOWN_CLAUDE`/`UNKNOWN_CODEX`), never a
    // fresh literal, so its identity never changes across renders and this
    // effect does not restart on one.
  }, [open, get, unknown, refreshTick]);
  return snapshot;
}

function WindowRow({
  label,
  window,
  now,
}: {
  readonly label: string;
  readonly window: UsageWindow;
  readonly now: Date;
}) {
  if (window.kind !== 'known') {
    return (
      <div
        data-usage-window={label}
        className="flex items-center justify-between gap-2 text-control"
      >
        <span className="text-ink-dim">{label}</span>
        <span className="text-ink-faint">—</span>
      </div>
    );
  }
  const percent = Math.min(100, Math.max(0, window.percent));
  return (
    <div data-usage-window={label} className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 text-control">
        <span className="text-ink-dim">{label}</span>
        <span className="text-ink">{Math.round(window.percent)}%</span>
      </div>
      <span className="h-1 w-full overflow-hidden rounded-sm bg-line-strong">
        <span className="block h-full bg-ink-dim" style={{ width: `${percent}%` }} />
      </span>
      <span className="text-meta text-ink-faint">
        resets in {formatCountdown(window.resetsAt, now)} ({clockTime(window.resetsAt)})
      </span>
    </div>
  );
}

/** `Hh Mm` / `Dd Hh` -- `shared/usage.ts` does not export this, so it is
 *  read off `describeUsage`'s own formatted windows instead where Claude's
 *  data is concerned; Codex's `describeCodexUsage` already returns a
 *  pre-formatted `countdown`, so only Claude's raw `UsageWindow` needs this
 *  small local copy. */
function formatCountdown(resetsAt: string, now: Date): string {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const diffMs = Math.max(0, new Date(resetsAt).getTime() - now.getTime());
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (diffMs >= ONE_DAY_MS) {
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    return `${days}d ${hours}h`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function minutesAgoText(observedAt: string, now: Date): string {
  const ms = now.getTime() - new Date(observedAt).getTime();
  const minutes = Number.isNaN(ms) ? 0 : Math.max(0, Math.round(ms / 60_000));
  return minutes === 0 ? 'updated just now' : `updated ${minutes}m ago`;
}

function ProviderHeader({ id, label }: { readonly id: string; readonly label: string }) {
  const mark = PROVIDER_MARKS[id];
  return (
    <div className="flex items-center gap-1.5 text-control text-ink">
      {mark !== undefined && <mark.Glyph size={12} />}
      <span className="font-medium">{label}</span>
    </div>
  );
}

function ClaudeSection({ snapshot }: { readonly snapshot: UsageSnapshot }) {
  const now = new Date();
  const display = describeUsage(snapshot, now);
  const scoped =
    snapshot.kind === 'ok' ? (snapshot.limits ?? []).filter((l) => l.id === 'weekly_scoped') : [];
  return (
    <section data-usage-provider="claude-code" className="flex flex-col gap-1.5">
      <ProviderHeader id="claude-code" label="Claude Code" />
      {display.reason !== null ? (
        <p data-usage-reason className="text-meta text-ink-dim">
          {display.reason}
        </p>
      ) : (
        <>
          {display.windows !== null && (
            <>
              <WindowRow label="5-hour" window={display.windows.fiveHour} now={now} />
              <WindowRow label="Weekly" window={display.windows.sevenDay} now={now} />
            </>
          )}
          {scoped.map((limit) => (
            <WindowRow
              key={limit.id + limit.label}
              label={limit.label}
              window={limit.window}
              now={now}
            />
          ))}
          {snapshot.kind === 'ok' && (
            <p data-usage-observed className="text-meta text-ink-faint">
              {minutesAgoText(snapshot.observedAt, now)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function CodexWindowRow({ display }: { readonly display: CodexWindowDisplay }) {
  if (display.state === 'unknown') {
    return (
      <div
        data-usage-window={display.label}
        className="flex items-center justify-between gap-2 text-control"
      >
        <span className="text-ink-dim">{display.label}</span>
        <span className="text-ink-faint">—</span>
      </div>
    );
  }
  if (display.state === 'reset') {
    return (
      <div
        data-usage-window={display.label}
        className="flex items-center justify-between gap-2 text-control"
      >
        <span className="text-ink-dim">{display.label}</span>
        <span className="text-ink-faint">reset since last reading</span>
      </div>
    );
  }
  const percent = Math.min(100, Math.max(0, display.percent));
  return (
    <div data-usage-window={display.label} className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 text-control">
        <span className="text-ink-dim">{display.label}</span>
        <span className="text-ink">{Math.round(display.percent)}%</span>
      </div>
      <span className="h-1 w-full overflow-hidden rounded-sm bg-line-strong">
        <span className="block h-full bg-ink-dim" style={{ width: `${percent}%` }} />
      </span>
      <span className="text-meta text-ink-faint">
        resets in {display.countdown} ({clockTime(display.resetsAt)})
      </span>
    </div>
  );
}

function CodexSection({ snapshot }: { readonly snapshot: CodexUsageSnapshot }) {
  const now = new Date();
  const display = describeCodexUsage(snapshot, now);
  return (
    <section data-usage-provider="codex" className="flex flex-col gap-1.5">
      <ProviderHeader id="codex" label="Codex" />
      {display.reason !== null ? (
        <p data-usage-reason className="text-meta text-ink-dim">
          {display.reason}
        </p>
      ) : (
        <>
          <CodexWindowRow display={display.primary} />
          <CodexWindowRow display={display.secondary} />
          {display.observedText !== null && (
            <p data-usage-observed className="text-meta text-ink-faint">
              {display.observedText}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default function UsagePopoverPanel() {
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pendingRefreshes = useRef(0);
  const onRefreshSettled = () => {
    pendingRefreshes.current -= 1;
    if (pendingRefreshes.current <= 0) setRefreshing(false);
  };
  const claude = useLiveSnapshot(
    true,
    UNKNOWN_CLAUDE,
    window.api?.usage?.get,
    refreshTick,
    onRefreshSettled,
  );
  const codex = useLiveSnapshot(
    true,
    UNKNOWN_CODEX,
    window.api?.usage?.getCodex,
    refreshTick,
    onRefreshSettled,
  );

  const hasBridge = window.api !== undefined;

  return (
    <>
      {hasBridge && (
        <div data-usage-header className="-mb-1 flex items-center justify-between">
          <h2 className="font-mono text-meta text-ink-dim uppercase tracking-[0.12em]">Account</h2>
          <button
            type="button"
            aria-label="Refresh"
            aria-busy={refreshing}
            aria-disabled={refreshing}
            onClick={() => {
              // `aria-disabled`, not `disabled`: a disabled button drops focus
              // to <body> and the panel stops receiving Escape.
              if (refreshing) return;
              pendingRefreshes.current = 2;
              setRefreshing(true);
              setRefreshTick((t) => t + 1);
            }}
            className="vam-hit-24 flex h-[20px] w-[20px] cursor-pointer items-center justify-center rounded-full text-ink-faint hover:bg-line-strong hover:text-ink aria-disabled:cursor-default aria-disabled:opacity-50"
          >
            <RefreshCw size={12} strokeWidth={1.5} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      )}
      {hasBridge ? (
        PROVIDERS.map((provider) =>
          provider.id === 'claude-code' ? (
            <ClaudeSection key={provider.id} snapshot={claude} />
          ) : (
            <CodexSection key={provider.id} snapshot={codex} />
          ),
        )
      ) : (
        <p data-usage-unavailable className="text-control text-ink-dim">
          usage is only available in the desktop app on macOS
        </p>
      )}
    </>
  );
}
