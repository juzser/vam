/**
 * The phone shell at 390px, in a browser that lays things out.
 *
 * Two properties of PR #191's phone shell are asserted in the unit suite by
 * CONTENT SCAN -- `test/phone/touch-targets.test.tsx` reads `styles.css` as
 * bytes, and `test/phone/overlay-sheets.test.ts` does the same for the sheet
 * rules -- because jsdom lays nothing out and applies no stylesheet. Both
 * files say so in their own headers and both name this pass as the thing that
 * would settle them. This is that pass.
 *
 * The WEB build, never Electron: the phone shell is for a phone browser, and
 * `vite build` is what produces the page a phone loads. `vite preview` serves
 * it (like `playwright.reconnect.config.ts`, and for the same reason: the dev
 * client's HMR reload is noise a layout measurement does not need).
 *
 * Port 5277, distinct from AC-G1's 5273 and the reconnect spec's 5274, so all
 * three can be present on one machine without either config's `webServer`
 * deciding it has found the other's server.
 *
 * `?demo=1` is `phone-shell.pw.ts`'s whole fixture: the built page's demo mode
 * renders the fixture with every write refused in the renderer. No live
 * factory, no proxy, no port to keep free, and the same four sessions every
 * run -- a layout assertion against a live factory would measure whatever that
 * factory happened to be doing.
 *
 * `phone-core-loop.pw.ts` runs here too and DOES NOT use it, for the reason
 * written at the top of that file: demo declines nothing, and the phone vam is
 * used from is the web build over Tailscale Serve, where the remote server
 * turns four capabilities off for every client. Both fixtures serve from the
 * same build on the same port; what differs is only who answers `/api/*`.
 *
 * `phone-overflow.pw.ts` runs here too, on its own third stub -- see that
 * file's own header for why (it needs `terminal: true`, several sessions in
 * one project, and an open question with long unbroken text all at once,
 * which neither `?demo=1` nor `phone-core-loop.pw.ts`'s `STUB` states).
 *
 * `phone-cache-timer.pw.ts` runs here too, on its own FOURTH stub -- see that
 * file's own header for why: seeding the cache-timer countdown's three
 * phases onto `?demo=1`'s shared `DEMO_MODEL` was tried first and reverted,
 * after it broke two unrelated desktop guards that generically iterate
 * "every project" in the sidebar.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

export default defineConfig({
  testDir: '.',
  testMatch: [
    'phone-shell.pw.ts',
    'phone-core-loop.pw.ts',
    'phone-overflow.pw.ts',
    'phone-cache-timer.pw.ts',
  ],
  outputDir: path.join(here, 'test-results'),
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5277',
    // A 390x844 CSS viewport is the iPhone 12/13/14/15 portrait figure the
    // spec names. `isMobile`/`hasTouch` are what make `touchscreen.tap()` a
    // real touch rather than a synthesised mouse click -- which matters here:
    // the hover-only close control this suite measures is unreachable to a
    // COARSE pointer and perfectly reachable to a fine one.
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node_modules/.bin/vite build && node_modules/.bin/vite preview --port 5277 --strictPort',
    cwd: repoRoot,
    url: 'http://127.0.0.1:5277',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
