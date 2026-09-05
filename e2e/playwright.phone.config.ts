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
 * `?demo=1` is the whole fixture: the built page's demo mode renders the §3
 * fixture with every write refused in the renderer. No black-smith, no proxy,
 * no port to keep free, and the same four sessions every run -- a layout
 * assertion against a live factory would measure whatever that factory
 * happened to be doing.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

export default defineConfig({
  testDir: '.',
  testMatch: 'phone-shell.pw.ts',
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
