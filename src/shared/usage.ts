/**
 * The types and pure formatting for the statusbar's usage cell (§4 of the
 * task brief). Everything here is renderer-safe — no `electron`, no `node:`
 * import — because `src/renderer` and `src/main` both build against it:
 * main uses `parseUsage` on the real HTTP body, the renderer uses
 * `describeUsage` on the snapshot IPC hands it. Neither the Keychain read
 * nor the HTTPS call lives here; see `src/main/usage/`.
 */

/** One of the two windows the mockup shows, or the honest absence of one. */
export type UsageWindow =
  | { readonly kind: 'known'; readonly percent: number; readonly resetsAt: string }
  | { readonly kind: 'unknown' };

export type UsageWindows = {
  readonly fiveHour: UsageWindow;
  readonly sevenDay: UsageWindow;
};

/**
 * Why the numbers are unavailable. Kept as a closed set of REASONS rather than
 * a message string so the renderer can pick distinguishable hover text without
 * ever touching whatever a failed request said — "no token" and "request
 * refused" are different facts an operator needs to be able to tell apart.
 */
export type UsageUnknownReason = 'unavailable' | 'no-token' | 'unauthorized' | 'request-failed';

/** What crosses the IPC boundary: main's whole answer to `usage.get()`. */
export type UsageSnapshot =
  | { readonly kind: 'ok'; readonly windows: UsageWindows; readonly observedAt: string }
  | { readonly kind: 'unknown'; readonly reason: UsageUnknownReason };

/**
 * Poll cadence: the 5-hour window can move by at most one utilization point
 * every few minutes even under continuous use, so polling faster than that
 * buys nothing. Five minutes keeps the cell close to live without hammering
 * the endpoint on every render.
 */
export const POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Staleness: a reading survives at most two missed polls (three intervals)
 * before the cell stops trusting it and falls back to the em-dash. Shorter
 * would flip to unknown on a single slow tick; longer would let a genuinely
 * stuck reader keep showing a number nobody refreshed in half an hour.
 */
export const STALE_AFTER_MS = POLL_INTERVAL_MS * 3;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseWindow(raw: unknown): UsageWindow {
  const obj = asRecord(raw);
  if (obj === null) return { kind: 'unknown' };
  const { utilization, resets_at: resetsAt } = obj;
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return { kind: 'unknown' };
  if (typeof resetsAt !== 'string' || resetsAt.length === 0) return { kind: 'unknown' };
  // A string is not a date. The endpoint is undocumented, so a format change
  // would hand us a non-empty string that passes the check above and then
  // reaches `formatCountdown`, where `new Date(...).getTime()` is NaN and the
  // status bar renders `NaNh NaNm`. Rejecting it here keeps the one promise
  // this module makes: unknown rather than a number nothing can support.
  if (Number.isNaN(new Date(resetsAt).getTime())) return { kind: 'unknown' };
  // Already a percentage (40.0 means 40%) — this is not divided or multiplied.
  return { kind: 'known', percent: utilization, resetsAt };
}

/**
 * Turns the real `/api/oauth/usage` body into the two windows the mockup
 * wants, tolerating every shape the brief calls out: `null` fields, an
 * empty object, a non-object body, and sibling keys this reader does not
 * know about. Never throws — a missing or malformed window is `unknown`,
 * never `0`.
 */
export function parseUsage(body: unknown): UsageWindows {
  const obj = asRecord(body);
  return {
    fiveHour: parseWindow(obj?.five_hour),
    sevenDay: parseWindow(obj?.seven_day),
  };
}

/**
 * `4h 19m` under a day, `2d 19h` at or past it. A `resetsAt` already in the
 * past — the window rolled over between polls — clamps to zero rather than
 * going negative.
 */
export function formatCountdown(resetsAt: string, now: Date): string {
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

function formatWindow(window: UsageWindow, now: Date): string {
  return window.kind === 'unknown'
    ? '—'
    : `${Math.round(window.percent)}% used · ${formatCountdown(window.resetsAt, now)}`;
}

/** True once either window is worth flagging in the "high usage" colour. */
export function isHighUsage(windows: UsageWindows): boolean {
  const high = (w: UsageWindow) => w.kind === 'known' && w.percent >= 90;
  return high(windows.fiveHour) || high(windows.sevenDay);
}

function reasonText(reason: UsageUnknownReason): string {
  switch (reason) {
    case 'no-token':
      return 'no Claude Code credentials found in the keychain';
    case 'unauthorized':
      return 'the stored token was refused — sign in again with the claude CLI';
    case 'request-failed':
      return 'the usage request failed';
    default:
      return 'usage is only available in the desktop app on macOS';
  }
}

export type UsageDisplay = {
  readonly text: string;
  readonly reason: string | null;
  readonly highUsage: boolean;
  /**
   * The numbers behind `text`, for the status bar's bars -- and `null` exactly
   * when `text` is the em-dash.
   *
   * A progress bar has no honest width for "unknown": drawn at zero it reads
   * as "0% used", which is a lie in the safe-looking direction. So the one
   * function that decides whether a reading can be shown at all decides it
   * once, here, rather than the renderer re-deriving staleness and the two
   * disagreeing.
   */
  readonly windows: UsageWindows | null;
};

/**
 * The one function the renderer cell calls: the formatted line (or the
 * em-dash), a hover reason when it cannot say more, and whether to reach for
 * the "high usage" colour. A snapshot older than `STALE_AFTER_MS` is treated
 * as unknown — a stale number must not read as current.
 */
export function describeUsage(snapshot: UsageSnapshot, now: Date): UsageDisplay {
  if (snapshot.kind !== 'ok') {
    return { text: '—', reason: reasonText(snapshot.reason), highUsage: false, windows: null };
  }
  const observedAt = new Date(snapshot.observedAt).getTime();
  if (Number.isNaN(observedAt) || now.getTime() - observedAt > STALE_AFTER_MS) {
    return {
      text: '—',
      reason: 'last reading is stale — no fresh data received',
      highUsage: false,
      windows: null,
    };
  }
  const { fiveHour, sevenDay } = snapshot.windows;
  return {
    text: `${formatWindow(fiveHour, now)} · ${formatWindow(sevenDay, now)}`,
    reason: null,
    highUsage: isHighUsage(snapshot.windows),
    windows: snapshot.windows,
  };
}
