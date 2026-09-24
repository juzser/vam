/**
 * THE STREAMING TERMINAL SETTING, AS PAINT: the "Streaming terminal (beta)"
 * row in Settings -> Behaviour, in both app themes.
 *
 * ── WHY THIS IS THE MEANINGFUL SCREENSHOT FOR THIS FEATURE ────────────────
 * Requirement 4 ("Phone: unchanged -- remote server does not serve the
 * Terminal surface") holds for the streaming path exactly as it holds for
 * the polling one: the WEB/PHONE build this harness drives (`vite.web.
 * config.ts`) carries no `window.api` at all, so `TerminalStreamTab.tsx`
 * never mounts a working pane here regardless of the setting's value
 * (`?demo=1` stubs a read-only fixture, not a live stream). The one thing
 * this bundle CAN show honestly is the setting itself -- the row an
 * operator flips to opt in, drawn for real, in both themes -- which is what
 * this file captures. A real xterm-rendered pane needs the Electron app
 * harness instead (see the task report for whether that was also captured).
 *
 * Same `openSettings` shape `settings-panels-shots.mjs` uses (demo fixture,
 * click the settings gear, wait for the nav), and the same sun-click theme
 * toggle `terminal-scheme-shots.mjs` uses for its own dark/light pair.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/terminal-streaming-settings-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` -- ${detail}`}`);
  failures.push(label);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
await page.locator('button[aria-label="settings"]').first().click();
await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
await page.locator('[data-settings-nav-item="behaviour"]').click();
await page.waitForSelector('[data-switch="streaming-terminal"]', { timeout: 5_000 });

const row = page.locator('[data-switch="streaming-terminal"]').locator('xpath=ancestor::*[self::label or self::div][1]');

/* ── dark (the demo fixture's default theme) ────────────────────────────── */
const isLightDark = await page.evaluate(() => document.documentElement.classList.contains('light'));
check('starts in dark theme', isLightDark === false, `documentElement light class: ${isLightDark}`);

const switchLocator = page.locator('[data-switch="streaming-terminal"]');
check('the streaming-terminal switch is drawn in Behaviour', (await switchLocator.count()) === 1, `count ${await switchLocator.count()}`);
check('it starts off (default OFF, per the design doc)', (await switchLocator.getAttribute('aria-checked')) === 'false');

await page.locator('[data-settings-panel="behaviour"]').scrollIntoViewIfNeeded().catch(() => {});
await switchLocator.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${outDir}/terminal-streaming-settings-dark.png` });
console.log(`${outDir}/terminal-streaming-settings-dark.png`);

/* ── light, via the sidebar's own sun -- the settings dialog sits over it,
   so it has to close first, exactly like any other click on chrome behind
   the overlay would. */
await page.keyboard.press('Escape');
await page.waitForSelector('[data-settings-nav]', { state: 'detached', timeout: 5_000 });
await page.locator('button[aria-label="switch to light theme"]').first().click();
await page.waitForFunction(() => document.documentElement.classList.contains('light'));
await page.locator('button[aria-label="settings"]').first().click();
await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
await page.locator('[data-settings-nav-item="behaviour"]').click();
await page.waitForSelector('[data-switch="streaming-terminal"]', { timeout: 5_000 });
await switchLocator.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${outDir}/terminal-streaming-settings-light.png` });
console.log(`${outDir}/terminal-streaming-settings-light.png`);

// The default artifact this task asks for (docs/ui/terminal-streaming.png) --
// the same full-dialog shot as the light capture above, just copied to the
// name this task's own report expects; light was already captured last so
// this reuses that state rather than re-toggling the theme a third time.
await page.screenshot({ path: `${outDir}/terminal-streaming.png` });
console.log(`${outDir}/terminal-streaming.png`);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in terminal-streaming-settings-shots.mjs`);
  process.exit(1);
}
console.log('\nterminal-streaming-settings-shots.mjs: all checks passed.');
