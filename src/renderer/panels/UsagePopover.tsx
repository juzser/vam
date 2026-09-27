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
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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
 * 12px, matching the width cap's own gutter (`calc(100vw-24px)` is 12px each
 * side) -- the panel never sits flush against a screen edge.
 */
const USAGE_PANEL_GUTTER = 12;

/**
 * Where the panel's `left` should sit, in pixels relative to its own
 * positioning context (the toggle's wrapping `<div>`, which is exactly as
 * wide as the toggle itself) -- 0 (directly under the toggle, `left-0`'s own
 * value) whenever that already fits, and pulled left just far enough to keep
 * the panel's right edge inside the gutter otherwise. See `UsagePopover`'s
 * own header for why this exists at all.
 */
export function usagePanelLeftOffset(
  buttonLeft: number,
  viewportWidth: number,
  panelWidth: number,
): number {
  const upperBound = viewportWidth - USAGE_PANEL_GUTTER - panelWidth - buttonLeft;
  const lowerBound = USAGE_PANEL_GUTTER - buttonLeft;
  return Math.max(lowerBound, Math.min(0, upperBound));
}

/**
 * NO `phone` PROP -- STILL. The panel's own WIDTH stays clamped in CSS
 * (`w-[min(320px,calc(100vw-24px))]`), and the 44px touch floor is opted into
 * by name now (`[data-usage-toggle]` under `data-phone-toolbar`,
 * `styles.css`) rather than inherited from `[data-avatar-bar]`, but neither
 * of those needed a branch here either.
 *
 * WHAT DOES, AND IS NOT PHONE-SPECIFIC: the panel's own LEFT edge. This
 * toggle used to open only from the avatar bar's own left corner (`left-0`
 * fit every time because the toggle was always the first thing in it). The
 * Orca one-row pass relocated it into the middle of the phone's toolbar row
 * (`SessionList.tsx`) -- and `left-0` there put the panel's right edge 172px
 * past a 390px viewport (`e2e/usage-popover-shots.mjs`'s own phone check
 * caught it: box `x:242, width:320` in a 390px window). The fix is not a
 * phone branch: ANY trigger far enough right on ANY viewport hits the same
 * wall, so `usagePanelLeftOffset` measures the toggle's own position and
 * pulls the panel back just far enough to keep it on screen, on both shells.
 */
export function UsagePopover() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const [leftOffset, setLeftOffset] = useState(0);

  // Measured, not merely computed once: a resize (a rotated phone, a
  // narrowed desktop window) can move the toggle without closing the panel
  // first. `useLayoutEffect`, not `useEffect`, so the first measurement lands
  // before the browser paints the still-unadjusted `left: 0` -- an `open`
  // that starts off-screen for one frame is the exact defect this fixes.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const button = buttonRef.current;
      if (button === null) return;
      const viewportWidth = window.innerWidth;
      const panelWidth = Math.min(320, viewportWidth - USAGE_PANEL_GUTTER * 2);
      setLeftOffset(
        usagePanelLeftOffset(button.getBoundingClientRect().left, viewportWidth, panelWidth),
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

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
          style={{ left: leftOffset }}
          className="absolute top-[32px] z-20 flex max-h-[min(480px,calc(100vh-96px))] w-[min(320px,calc(100vw-24px))] flex-col gap-3 overflow-y-auto rounded-[9px] border border-line-strong bg-card p-3 shadow-lg"
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
