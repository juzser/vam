/**
 * Screenshots for the pane-refinements PR (A15.3/4/5/6), taken off the WEB
 * build with the demo fixture — the only thing safe to point a public
 * screenshot at (`?demo=1`, App.tsx's own rule).
 *
 * Run by hand; nothing runs it automatically:
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5511 --strictPort
 *   node e2e/pane-refinements-shots.mjs http://localhost:5511 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5511';
const outDir = process.argv[3] ?? 'docs/ui';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

// Focus the factory-sse-1 session.
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForTimeout(200);

// --- Shot 1: the icon overlay, cropped to the top-right corner of the pane.
const overlay = page.locator('[data-view-overlay]');
await overlay.screenshot({ path: `${outDir}/a15-5-view-overlay.png` });
console.log(`${outDir}/a15-5-view-overlay.png`);

// --- Shot 4: Alt+3 refusal, Terminal absent (every demo session lacks one).
await page.locator('[data-action-pane]').click({ position: { x: 400, y: 10 } });
await page.keyboard.down('Alt');
await page.keyboard.press('Digit3');
await page.keyboard.up('Alt');
await page.waitForTimeout(150);
const pane = page.locator('[data-action-pane]');
const box = await pane.boundingBox();
if (box !== null) {
  await page.screenshot({
    path: `${outDir}/a15-6-alt3-refusal.png`,
    clip: { x: box.x, y: box.y, width: box.width, height: 60 },
  });
  console.log(`${outDir}/a15-6-alt3-refusal.png`);
}

// --- Shot 2: the model control inside the prompt input.
// The question card blocks the plain composer on both demo sessions
// (deliberately, per demo.ts's own header) -- "Chat about this" is the real
// route past it, the same one an operator would use.
await page.locator('[data-question-chat]').click();
await page.waitForTimeout(200);
const composerRow = page.locator('[data-model-request]').locator('xpath=..');
await composerRow.screenshot({ path: `${outDir}/a15-4-model-control.png` });
console.log(`${outDir}/a15-4-model-control.png`);

// --- Shot 3: the restore strip with its right-aligned shortcut.
await page.locator('[data-project-menu="vam"]').click();
await page.waitForTimeout(150);
await page.locator('[data-project-menu-item="remove"]').click();
await page.waitForTimeout(150);
await page.locator('[data-confirm-remove-go]').click();
await page.waitForTimeout(200);
const strip = page.locator('[data-restore-strip]');
await strip.screenshot({ path: `${outDir}/a15-3-restore-strip.png` });
console.log(`${outDir}/a15-3-restore-strip.png`);

await browser.close();
