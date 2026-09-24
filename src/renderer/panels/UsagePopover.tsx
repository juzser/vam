/**
 * The account icon that replaced the sidebar's "F" letter avatar
 * (`SessionList.tsx`'s avatar bar), and the popover it opens: usage for every
 * provider vam knows (`src/shared/providers.ts`, `PROVIDERS`), read through
 * `window.api.usage.get` (Claude, already read for the status bar cell) and
 * `window.api.usage.getCodex` (Codex, new). NEITHER call ever crosses a
 * token; both channels answer a bare snapshot the shared parsers
 * (`shared/usage.ts`, `shared/codex-usage.ts`) already keep token-free.
 *
 * SELF-CONTAINED ON PURPOSE. It owns its own open state, its own polling and
 * its own dismissal wiring rather than taking them as props, so wiring it
 * into the avatar bar is a one-line swap in `SessionList.tsx` -- a file two
 * other changes are touching this cycle (the phone empty state; Canvas.tsx's
 * tab filtering is a neighbour, not this file). The dismissal pattern below
 * -- open state local to the popover, a `pointerdown` listener attached only
 * while open, the toggle excluded from its own boundary, Escape handled on
 * the toggle and the panel -- mirrors the sidebar's OWN filter popover a few
 * hundred lines below in the same file (`useEffect`s on `filterMenuOpen`),
 * not reused as a shared hook because that popover's state lives in
 * `Canvas.tsx` and this one's does not; the SHAPE is copied, not the code.
 *
 * REFRESH ON OPEN, THROTTLED BY THE IPC FLOOR, NOT BY THIS COMPONENT. Opening
 * the popover polls both channels immediately and then every
 * `POLL_INTERVAL_MS` while it stays open (`useLiveSnapshot` below) --
 * independent of the status bar cell's own 5-minute poll in `Canvas.tsx`,
 * which keeps running unchanged whether this is open or not. Calling
 * `usage.get()`/`usage.getCodex()` repeatedly costs nothing extra: both IPC
 * handlers cache for `MIN_READ_INTERVAL_MS` (`usage/ipc.ts`), so opening the
 * popover twice in a row serves the second open from that cache rather than
 * reading the Keychain or `~/.codex` again.
 *
 * THE BROWSER BUILD HAS NO `window.api` AT ALL -- the same fact
 * `Canvas.tsx`'s `useUsageSnapshot` already states for the status bar cell.
 * This popover states it too, once, for both providers at once: "usage is
 * only available in the desktop app on macOS" is `shared/usage.ts`'s own
 * `reasonText` default-case sentence, repeated here rather than reinvented,
 * and no member of `window.api` is ever read to produce it -- see the
 * `window.api === undefined` guard below, checked before either provider
 * section is drawn.
 */

import { CircleUser } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import type { CodexUsageSnapshot, CodexWindowDisplay } from '../../shared/codex-usage.js';
import { clockTime, describeCodexUsage } from '../../shared/codex-usage.js';
import { PROVIDERS } from '../../shared/providers.js';
import {
  describeUsage,
  POLL_INTERVAL_MS,
  type UsageSnapshot,
  type UsageWindow,
} from '../../shared/usage.js';
import { ShortcutTip } from '../keyboard/ShortcutTip.js';
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
function useLiveSnapshot<T>(open: boolean, unknown: T, get?: () => Promise<T>): T {
  const [snapshot, setSnapshot] = useState<T>(unknown);
  useEffect(() => {
    if (!open || get === undefined) {
      if (!open) setSnapshot(unknown);
      return;
    }
    let cancelled = false;
    let issued = 0;
    const poll = () => {
      issued += 1;
      const seq = issued;
      const mine = () => !cancelled && seq === issued;
      get()
        .then((next) => {
          if (mine()) setSnapshot(next);
        })
        .catch(() => {
          if (mine()) setSnapshot(unknown);
        });
    };
    poll();
    const id = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // `unknown` is safe to depend on: both call sites hand this a
    // MODULE-LEVEL constant (`UNKNOWN_CLAUDE`/`UNKNOWN_CODEX`), never a
    // fresh literal, so its identity never changes across renders and this
    // effect does not restart on one.
  }, [open, get, unknown]);
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

/**
 * NO `phone` PROP. The panel's own width is clamped in CSS --
 * `w-[min(320px,calc(100vw-24px))]` -- so it fits a 390px screen the same way
 * it fits a desktop one, with no branch here; and the 44px touch floor is
 * already the avatar bar's own rule (`[data-avatar-bar] button` in
 * `styles.css`), inherited by the toggle just by living inside it. Both are
 * the responsive pattern the task brief asked this popover to match at
 * 390px, and neither needed a second code path.
 */
export function UsagePopover() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  const claude = useLiveSnapshot(open, UNKNOWN_CLAUDE, window.api?.usage?.get);
  const codex = useLiveSnapshot(open, UNKNOWN_CODEX, window.api?.usage?.getCodex);

  // Where the keyboard goes when the panel opens, and where it comes back to
  // when it closes -- the sidebar filter popover's own rule (`SessionList.tsx`).
  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    } else if (wasOpen.current) {
      buttonRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // A press anywhere outside the panel and its own toggle closes it.
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target) === true) return;
      if (buttonRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  const onEscape = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    setOpen(false);
  };

  const hasBridge = window.api !== undefined;

  return (
    <div className="relative flex-none">
      <ShortcutTip label="Usage">
        <button
          ref={buttonRef}
          type="button"
          data-usage-toggle
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="usage"
          onKeyDown={onEscape}
          onClick={() => setOpen((o) => !o)}
          className="flex h-[24px] w-[24px] flex-none cursor-pointer items-center justify-center rounded-full bg-line-strong text-ink-dim hover:text-ink"
        >
          <CircleUser size={14} strokeWidth={1.5} />
        </button>
      </ShortcutTip>
      {open && (
        <div
          ref={panelRef}
          data-usage-panel
          role="dialog"
          aria-label="usage details"
          // `role="dialog"` already makes this an interactive landmark, so
          // `tabIndex` here needs no suppression -- it is only what lets the
          // focus effect below hand the panel the keyboard on open.
          tabIndex={-1}
          onKeyDown={onEscape}
          className="absolute top-[32px] left-0 z-20 flex max-h-[min(480px,calc(100vh-96px))] w-[min(320px,calc(100vw-24px))] flex-col gap-3 overflow-y-auto rounded-[9px] border border-line-strong bg-card p-3 shadow-lg"
        >
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
        </div>
      )}
    </div>
  );
}
