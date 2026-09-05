/**
 * The before/after frames for the phone LIST screen, off the WEB build.
 *
 * What the pair has to show is a paint size, not a layout: the three
 * project-header controls used to draw their border and ground ON the 44px
 * box that takes the tap, which is what made them the visually heaviest
 * objects on the screen. Nothing moves between the two frames -- the hit
 * boxes are the same 44 in both -- so a still is the only way to report it.
 * 390x844, one frame per theme per build.
 *
 * Run by hand; nothing runs it automatically. Build and serve first:
 *
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5431
 *   node e2e/phone-list-shots.mjs http://localhost:5431 docs/images after
 *
 * `?demo=1` is the committed fixture and the only thing safe to point a
 * screenshot at: live mode would put a real workspace, with real paths and
 * real session ids, into a public repo.
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5431';
const outDir = process.argv[3] ?? 'docs/images';
const label = process.argv[4] ?? 'after';

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript((t) => {
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ theme: t }));
  }, theme);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-phone-shell="list"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.currentTime = 0;
      a.pause();
    }
  });
  await page.screenshot({ path: `${outDir}/phone-controls-list-${theme}-${label}.png` });
  console.log(`${outDir}/phone-controls-list-${theme}-${label}.png`);
  await page.close();
}
await browser.close();
