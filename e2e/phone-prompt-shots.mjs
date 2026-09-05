/**
 * The before/after frames for the phone prompt screen, off the WEB build.
 *
 * What the pair has to show is chrome that is no longer there: the step rail
 * and the view tab strip used to take ~215px between the app bar and the
 * output, and the app bar itself was two rows. A still is the only honest way
 * to report that, so these are real pixels at 390x844 -- the phone the shell
 * is written for -- one frame per theme per build.
 *
 * Run by hand; nothing runs it automatically. Build and serve both revisions
 * first, one port each:
 *
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5431
 *   node e2e/phone-prompt-shots.mjs http://localhost:5431 docs/images after
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
  // The prompt screen is reachable only by tapping a row, which is the point
  // of the screen: it is one session, not a browser over all of them.
  await page.locator('[data-session-row]').first().click();
  await page.waitForSelector('[data-phone-shell="session"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.currentTime = 0;
      a.pause();
    }
  });
  await page.screenshot({ path: `${outDir}/phone-prompt-${theme}-${label}.png` });
  console.log(`${outDir}/phone-prompt-${theme}-${label}.png`);
  await page.close();
}
await browser.close();
