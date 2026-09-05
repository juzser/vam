/**
 * The before/after frames for issue 188, taken off the WEB build.
 *
 * A contrast change is one of the few things a still can actually show, so
 * these are real pixels rather than a description of them. Two frames per
 * build, one per theme, each carrying every token this change touches: the
 * cursor ring on the light canvas, `ink-faint` on the sidebar fill, and the
 * waiting amber as the node's own status word.
 *
 * Animations are paused at time 0 rather than left running. That is the frame
 * the ring's alpha lived in -- the resting `0%` keyframe painted it at 60%,
 * which is 1.59:1 in light -- so pausing there is what makes the pair
 * comparable instead of a race against a 2.4s cycle.
 *
 * Run by hand; nothing runs it automatically. Build and serve both revisions
 * first, one port each:
 *
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5411
 *   node e2e/issue-188-shots.mjs http://localhost:5411 docs/images after
 *
 * `?demo=1` is the committed fixture and the only thing safe to point a
 * screenshot at: live mode would put a real workspace on the page.
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5411';
const outDir = process.argv[3] ?? 'docs/images';
const label = process.argv[4] ?? 'after';

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript((t) => {
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ theme: t }));
  }, theme);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-canvas-pane]');
  // The heading controls are `opacity-0` until their row is hovered, so the
  // frame has to hover one for them to be in it at all.
  await page.locator('[data-project-collapse]').first().hover();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.currentTime = 0;
      a.pause();
    }
  });
  await page.screenshot({ path: `${outDir}/a11y-contrast-${theme}-${label}.png` });
  console.log(`${outDir}/a11y-contrast-${theme}-${label}.png`);
  await page.close();
}
await browser.close();
