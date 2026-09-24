/**
 * Codex's own usage: the two windows carried on a `token_count` event's
 * `rate_limits` field, in the shape verified live on this machine --
 *
 *   {"rate_limits":{"limit_id":"codex",
 *     "primary":{"used_percent":11.0,"window_minutes":300,"resets_at":<unix seconds>},
 *     "secondary":{"used_percent":2.0,"window_minutes":10080,"resets_at":<unix>},
 *     "credits":{...}}}
 *
 * -- read from the newest Codex rollout file in `src/main/usage/codex-
 * reader.ts`. Everything HERE is renderer-safe and pure, the same split
 * `src/shared/usage.ts` makes for Claude: main parses the real event with
 * `parseCodexRateLimits`, the popover formats the snapshot it is handed with
 * `describeCodexUsage`. Neither the filesystem read nor the rollout scan
 * lives here.
 *
 * TWO THINGS CODEX'S READING IS NOT, AND BOTH SHAPE THIS MODULE:
 *
 *  1. NOT CONTINUOUSLY POLLED. Claude's reading is at most `STALE_AFTER_MS`
 *     old because main re-fetches it on a timer; Codex's is whatever the last
 *     rollout event said, which can be hours old if no Codex session has run
 *     since. So there is no staleness cutoff here -- the popover always shows
 *     the number it has, dated with `describeCodexUsage(...).observedText`
 *     ("as of 17:14 from the last Codex session") rather than hiding it.
 *  2. NOT SAFE TO EXTRAPOLATE PAST `resets_at`. A window whose reset time has
 *     already passed (by the time the popover is opened, not necessarily by
 *     the time the event was read) rolled over with nobody watching, and its
 *     last known percentage is not the CURRENT one -- showing it, or showing
 *     0%, would both be a number nothing measured. `describeCodexUsage`
 *     answers that window `{ state: 'reset' }` instead.
 */

export type CodexRawWindow =
  | {
      readonly kind: 'known';
      readonly percent: number;
      readonly windowMinutes: number;
      readonly resetsAt: string;
    }
  | { readonly kind: 'unknown' };

export type CodexLimits = {
  readonly primary: CodexRawWindow;
  readonly secondary: CodexRawWindow;
};

/**
 * Why the numbers are unavailable, mirroring `UsageUnknownReason`'s reasoning
 * (`shared/usage.ts`): a closed set the renderer can give distinguishable
 * words to, never a message string the reader happened to produce.
 */
export type CodexUsageUnknownReason = 'no-session' | 'unavailable';

/** What crosses the IPC boundary: main's whole answer to `usage.getCodex()`. */
export type CodexUsageSnapshot =
  | { readonly kind: 'ok'; readonly limits: CodexLimits; readonly observedAt: string }
  | { readonly kind: 'unknown'; readonly reason: CodexUsageUnknownReason };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * One of `primary`/`secondary`. `resets_at` arrives as unix SECONDS (the
 * brief's own verified shape), converted here to the ISO string every other
 * window in this codebase already carries -- so `formatCountdown` (`shared/
 * usage.ts`) works on this one unchanged, with no second countdown
 * implementation to drift from the first.
 */
function parseWindow(raw: unknown): CodexRawWindow {
  const obj = asRecord(raw);
  if (obj === null) return { kind: 'unknown' };
  const { used_percent: percent, window_minutes: windowMinutes, resets_at: resetsAtSeconds } = obj;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return { kind: 'unknown' };
  if (typeof windowMinutes !== 'number' || !Number.isFinite(windowMinutes)) {
    return { kind: 'unknown' };
  }
  if (typeof resetsAtSeconds !== 'number' || !Number.isFinite(resetsAtSeconds)) {
    return { kind: 'unknown' };
  }
  const ms = resetsAtSeconds * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return { kind: 'unknown' };
  return { kind: 'known', percent, windowMinutes, resetsAt: date.toISOString() };
}

/**
 * The raw `rate_limits` object off a `token_count` event -- never throws, a
 * missing or malformed window is `unknown`, never `0`, for the same reason
 * `parseUsage` gives.
 */
export function parseCodexRateLimits(raw: unknown): CodexLimits {
  const obj = asRecord(raw);
  return {
    primary: parseWindow(obj?.primary),
    secondary: parseWindow(obj?.secondary),
  };
}

/**
 * What a popover calls a window of N minutes. 300 -> "5-hour" and 10080 (7
 * days) -> "Weekly" are the two REAL values this machine has ever produced;
 * anything else gets a generic reading rather than a name this module has
 * never seen invented for it.
 */
export function codexWindowLabel(minutes: number): string {
  if (minutes === 300) return '5-hour';
  if (minutes === 10_080) return 'Weekly';
  if (minutes < 60) return `${minutes}-minute`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}-hour`;
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  return `${Math.round(minutes / 60)}-hour`;
}

export type CodexWindowDisplay =
  | {
      readonly state: 'known';
      readonly label: string;
      readonly percent: number;
      readonly countdown: string;
    }
  | { readonly state: 'reset'; readonly label: string }
  | { readonly state: 'unknown'; readonly label: string };

/** `Hh Mm` / `Dd Hh`, the same table `formatCountdown` (`shared/usage.ts`)
 *  already draws for Claude's windows -- duplicated rather than imported
 *  because that module is Claude-shaped (percent already clamped, `resetsAt`
 *  ISO from the start) and this one converts from unix seconds first; the
 *  four-line body is cheaper to keep in step than a cross-import would be to
 *  keep decoupled. */
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

function describeWindow(window: CodexRawWindow, label: string, now: Date): CodexWindowDisplay {
  if (window.kind !== 'known') return { state: 'unknown', label };
  if (new Date(window.resetsAt).getTime() <= now.getTime()) {
    return { state: 'reset', label };
  }
  return {
    state: 'known',
    label,
    percent: window.percent,
    countdown: formatCountdown(window.resetsAt, now),
  };
}

function codexReasonText(reason: CodexUsageUnknownReason): string {
  switch (reason) {
    case 'no-session':
      return 'no Codex session yet';
    default:
      return "could not read Codex's session files";
  }
}

/** `HH:MM`, local wall clock -- built with `getHours`/`getMinutes` (local, not
 *  UTC) rather than `toLocaleTimeString`, so the format is fixed 24-hour and
 *  does not depend on ICU locale data being present in the runtime. */
function clockTime(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export type CodexUsageDisplay = {
  readonly primary: CodexWindowDisplay;
  readonly secondary: CodexWindowDisplay;
  /** `null` exactly when `reason` is not, mirroring `UsageDisplay.windows`'s
   *  either/or in `shared/usage.ts`. */
  readonly observedText: string | null;
  readonly reason: string | null;
};

/**
 * The one function the popover calls for Codex's section: both windows,
 * labelled and dated, or a reason when there is nothing to show at all.
 */
export function describeCodexUsage(snapshot: CodexUsageSnapshot, now: Date): CodexUsageDisplay {
  if (snapshot.kind !== 'ok') {
    return {
      primary: { state: 'unknown', label: codexWindowLabel(300) },
      secondary: { state: 'unknown', label: codexWindowLabel(10_080) },
      observedText: null,
      reason: codexReasonText(snapshot.reason),
    };
  }
  const primaryLabel =
    snapshot.limits.primary.kind === 'known'
      ? codexWindowLabel(snapshot.limits.primary.windowMinutes)
      : codexWindowLabel(300);
  const secondaryLabel =
    snapshot.limits.secondary.kind === 'known'
      ? codexWindowLabel(snapshot.limits.secondary.windowMinutes)
      : codexWindowLabel(10_080);
  return {
    primary: describeWindow(snapshot.limits.primary, primaryLabel, now),
    secondary: describeWindow(snapshot.limits.secondary, secondaryLabel, now),
    observedText: `as of ${clockTime(snapshot.observedAt)} from the last Codex session`,
    reason: null,
  };
}
