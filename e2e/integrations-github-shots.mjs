/**
 * Settings -> Integrations -> GitHub, painted in a real engine.
 *
 * Operator: "add an Integrations section in Settings, to connect a GitHub
 * account and select a repo." `GithubPanel.tsx` is unit-tested against
 * happy-dom (`test/settings/github-panel.test.tsx`); what jsdom/happy-dom
 * cannot answer, and this file does, is whether the section actually PAINTS:
 * a real box for the status line, the Connect/Disconnect controls and the
 * repo picker, in both themes, logged out and logged in.
 *
 * A DESKTOP-ONLY SECTION, WITH NO PRELOAD BRIDGE IN THE BROWSER BUILD --
 * `settings-chrome-shots.mjs`'s own Remote example is the template: `?demo=1`
 * with `window.api.github` supplied by `addInitScript`, never a real `gh`
 * spawn or a real Keychain read. Every account name and host below is
 * invented.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/integrations-github-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const LOGGED_OUT = { kind: 'logged-out' };
const LOGGED_IN = {
  kind: 'logged-in',
  accounts: [
    {
      host: 'github.com',
      login: 'octocat',
      active: true,
      tokenSource: 'keyring',
      scopes: ['gist', 'read:org', 'repo'],
      missingScopes: [],
    },
  ],
};

const browser = await chromium.launch();

/** A page with `window.api.github` answering `status`, and Settings open on
 *  the Integrations section. Mirrors `settings-chrome-shots.mjs`'s own
 *  `REMOTE_STUB` page: `window.api` holds ONLY what this section reads, so a
 *  missing member elsewhere in the app is exactly as absent as it is on a
 *  real browser build with no bridge at all.
 *
 * ONE MEASURED CONSEQUENCE OF THAT TECHNIQUE, shared with every other guard
 * in this file's family: `App.tsx`'s own top-level branch is
 * `window.api !== undefined ? DesktopCanvas : isDemo() ? DemoCanvas : ...`,
 * so setting ANY `window.api` before navigation -- exactly what this stub and
 * `REMOTE_STUB` both do -- makes the app render `DesktopCanvas` with this
 * incomplete stub, never `DemoCanvas` with its fixture projects. Verified:
 * the same page, with only `REMOTE_STUB` applied, shows "No sessions yet"
 * too. Every OTHER guard in this family draws a panel that does not need a
 * project (Remote, Update); this is the first one whose repo picker does, so
 * it can only ever observe the picker's own "no project" state here, never
 * "reading pull requests from {name}" -- that per-project rendering is
 * covered instead by `test/settings/github-panel.test.tsx`, which renders
 * `GithubPanel` directly with real project props, no `window.api` branch
 * involved at all. */
async function openIntegrations(status, theme) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((state) => {
    globalThis.window.api = {
      ...(globalThis.window.api ?? {}),
      github: {
        authStatus: async () => state,
        connectStart: async () => null,
        connectRead: async () => ({ kind: 'none' }),
        reposList: async () => ({ kind: 'ok', repos: [] }),
        orgsList: async () => ({ kind: 'ok', orgs: [] }),
        projectRemotes: async () => [],
      },
      clipboard: { writeText: async () => true },
    };
  }, status);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('light', t === 'light');
  }, theme);
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator('[data-settings-nav-item="integrations"]').click();
  await page.waitForSelector('[data-github-status]', { timeout: 5_000 });
  return page;
}

console.log('=== Settings -> Integrations -> GitHub, logged out and logged in, both themes');
for (const theme of ['dark', 'light']) {
  for (const [name, status] of [
    ['logged-out', LOGGED_OUT],
    ['logged-in', LOGGED_IN],
  ]) {
    const page = await openIntegrations(status, theme);

    const state = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        return el === null ? null : el.getBoundingClientRect();
      };
      const port = document.querySelector('[data-settings-scroll]');
      return {
        status: document.querySelector('[data-github-status]')?.textContent ?? null,
        connect: box('[data-github-connect]'),
        disconnect: box('[data-github-disconnect]'),
        repoCurrent: box('[data-github-repo-current]'),
        repoNoProject: box('[data-github-repo-noproject]'),
        overflowX: port === null ? null : port.scrollWidth - port.clientWidth,
      };
    });
    console.log(`  [${theme}/${name}] status="${state.status}"`);

    if (state.status === null || state.status === '') {
      throw new Error(`[${theme}/${name}] the Integrations panel drew no status line at all`);
    }
    if (name === 'logged-out' && (state.connect === null || state.connect.height === 0)) {
      throw new Error(`[${theme}/${name}] no painted Connect button while logged out`);
    }
    if (name === 'logged-in' && (state.disconnect === null || state.disconnect.height === 0)) {
      throw new Error(`[${theme}/${name}] no painted Disconnect button while logged in`);
    }
    // NO HORIZONTAL OVERFLOW, at the width this dialog actually opens at --
    // the operator's own rule for every surface in this app.
    if (state.overflowX !== null && state.overflowX > 1) {
      throw new Error(
        `[${theme}/${name}] the settings scrollport overflows sideways by ${state.overflowX}px`,
      );
    }
    // Never "reading pull requests from {name}" here -- see this file's own
    // header note on why this harness cannot reach a project -- but the
    // picker section itself must still paint its "no project" state rather
    // than nothing at all.
    const repoBox = state.repoCurrent ?? state.repoNoProject;
    if (repoBox === null || repoBox.height === 0) {
      throw new Error(`[${theme}/${name}] the repo picker drew neither its current-repo nor its no-project line`);
    }

    await page.screenshot({ path: `${outDir}/settings-integrations-github-${theme}-${name}.png` });
    console.log(`${outDir}/settings-integrations-github-${theme}-${name}.png`);
    await page.close();
  }
}

// AND AT THE NARROWEST DESKTOP WIDTH, NEVER SIDEWAYS. NOT 390PX: this is a
// DESKTOP-ONLY section (`sections.ts`'s own `PHONE_SECTIONS` leaves it out),
// and 390px never reaches the desktop settings shell at all -- measured, the
// same `window.api` stub every guard in this file's family uses puts the app
// on `DesktopCanvas` rather than `DemoCanvas` (see the header note above),
// and at 390px `DesktopCanvas` draws the phone shell, which has no
// `button[aria-label="settings"]` for this to click (`settings-chrome-shots
// .mjs`'s own comment: "390 is the phone shell, which draws no Keyboard
// section for this to measure" -- the same fact, for a different section).
// `NARROWEST_DESKTOP` (520px, `settings-chrome-shots.mjs`'s own constant) is
// the narrowest width the desktop shell actually draws itself at.
const NARROWEST_DESKTOP = 520;
console.log(`\n=== no horizontal overflow at ${NARROWEST_DESKTOP}px (narrowest desktop width)`);
{
  const page = await openIntegrations(LOGGED_IN, 'dark');
  await page.setViewportSize({ width: NARROWEST_DESKTOP, height: 844 });
  const overflowX = await page.evaluate(() => {
    const port = document.querySelector('[data-settings-scroll]');
    return port === null ? 0 : port.scrollWidth - port.clientWidth;
  });
  console.log(`  ${NARROWEST_DESKTOP}px overflowX=${overflowX}`);
  if (overflowX > 1) {
    throw new Error(
      `the Integrations panel overflows sideways by ${overflowX}px at ${NARROWEST_DESKTOP}px`,
    );
  }
  await page.close();
}

await browser.close();
console.log('\nSettings -> Integrations -> GitHub paints its status, its controls and its repo picker in both themes, with no sideways overflow.');
