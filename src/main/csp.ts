/**
 * The response CSP for the window's own origin.
 *
 * Two policies, chosen by whether a dev server URL is present -- the same
 * `devServerUrl`/`ELECTRON_RENDERER_URL` signal `src/main/index.ts` already
 * branches on to decide `loadFile` vs `loadURL`. There is no second notion of
 * "dev" here; a build never sets that variable, so `contentSecurityPolicy`
 * called the way the packaged app calls it (with `undefined`) always returns
 * the strict policy below, byte for byte.
 *
 * BOTH policies: same-origin scripts and styles only, no `default-src`/
 * `frame-src` -- see the production policy's own comment for why. They differ
 * in exactly one clause:
 *
 * - `style-src 'self' 'unsafe-inline'` in both, for React's `style={{...}}`
 *   props, which render as inline style ATTRIBUTES -- there are 12 of them in
 *   `src/` today. Without it those components mount unstyled, and the launch
 *   harness's title/root assertions would NOT catch that: the window opens,
 *   the renderer mounts, the text is right, and only a human looking at it
 *   sees the problem. `style-src-attr 'unsafe-inline'` with a strict
 *   `style-src` is the real tightening, but it is only safe once someone has
 *   checked whether any dependency injects a `<style>` element at runtime --
 *   verify with a CSP violation report, do not guess.
 *
 * - `script-src` gains `'unsafe-inline'` ONLY in dev. `@vitejs/plugin-react`'s
 *   dev server injects its React Refresh preamble as an inline `<script
 *   type="module">` in the served HTML -- observed directly from this
 *   plugin's own `preambleCode` template, not merely from a rendered page --
 *   and `'self'` alone blocks it, which is the exact "can't detect preamble"
 *   failure this exists to fix. The built app never serves that script (Vite
 *   only injects the preamble via its dev middleware, `electron-vite build`
 *   never runs it), so the production `script-src` stays exactly `'self'`.
 *   No `'unsafe-eval'`: Vite's dev transform ships plain ES modules over
 *   HTTP, never `eval`.
 *   No widening of `connect-src` for the HMR WebSocket: per the CSP `'self'`
 *   scheme-matching algorithm, a `ws:`/`wss:` request is considered same-
 *   scheme as the document's `http:`/`https:` origin, so `connect-src 'self'`
 *   already covers the dev server's own-origin WebSocket without adding a
 *   token -- widen this only if a real CSP violation report shows otherwise.
 *
 * Whoever next tries to tighten either policy will go looking for whatever
 * needs each allowance, and if they find nothing they will delete it --
 * stated precisely so that search ends here instead of in a bug report.
 */
export function contentSecurityPolicy(devServerUrl: string | undefined): string {
  const scriptSrc = devServerUrl === undefined ? "'self'" : "'self' 'unsafe-inline'";
  return `script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`;
}
