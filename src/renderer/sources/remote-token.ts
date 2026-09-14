/**
 * WHERE THE PHONE KEEPS ITS PAIRING TOKEN.
 *
 * Operator, holding the phone after the app shell was opened: "I still don't
 * see anywhere to enter the pairing code." Serving the page without a token
 * (PR 334) was necessary and not sufficient -- nothing in the repository posted
 * to `/api/pair`, and no request carried an `authorization` header, so the
 * browser build asked `/api/describe`, was refused, and drew the refusal as a
 * banner over an empty canvas.
 *
 * ── WHY `localStorage`, STATED RATHER THAN ASSUMED ────────────────────────
 * This is a bearer credential in a web origin, so script running on that
 * origin can read it. What runs there is vam's own bundle and nothing else:
 * the server answers `index.html` and `/assets/<one segment>` and refuses
 * every other path, the origin is a tailnet name behind `tailscale serve`
 * with `funnel` refused by name, and there is no upload path or third-party
 * script to become the thing that reads it.
 *
 * `sessionStorage` would be narrower AND would make the phone re-pair in every
 * new tab, which is the opposite of what a phone by the bed is for. The grant
 * is revocable from the desktop at any moment -- one device or all of them --
 * and revocation reaches inside open streams (`StreamRegistry.closeFor`), so
 * the recovery from a stolen token is a control the operator already holds.
 *
 * ── NOTHING HERE THROWS ───────────────────────────────────────────────────
 * iOS Safari in private mode throws from `setItem`, and iOS Safari is exactly
 * the browser this exists for. A phone that cannot persist pairs for the
 * session and is asked again next time: worse, and not broken. A page that
 * white-screens because storage was denied is broken.
 */

/** One key; `localStorage` is already per-origin, so it needs no qualifier. */
const KEY = 'vam.remote.token';

const store = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Access ITSELF throws in some privacy modes, before any method is called.
    return null;
  }
};

export function readRemoteToken(): string | null {
  try {
    const value = store()?.getItem(KEY) ?? null;
    // An empty string is not a token: `Bearer ` with nothing after it is a
    // malformed credential the server counts as a failed attempt, which would
    // turn "not paired yet" into "paired wrongly, forever".
    return value === null || value === '' ? null : value;
  } catch {
    return null;
  }
}

export function writeRemoteToken(token: string): void {
  if (token === '') return;
  try {
    store()?.setItem(KEY, token);
  } catch {
    // See the header: a phone that cannot persist is not a phone that breaks.
  }
}

export function clearRemoteToken(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    // Same.
  }
}
