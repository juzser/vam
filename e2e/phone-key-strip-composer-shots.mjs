/**
 * Before/after frames for the phone session screen's composer and keystroke
 * strip -- the operator's own two reports: "the buttons in the prompt input
 * on mobile are big and cover most of the input box" and "I don't see the
 * quick buttons above the prompt input." Run by hand against a built and
 * served revision, one port per revision:
 *
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5912
 *   node e2e/phone-key-strip-composer-shots.mjs http://localhost:5912 /tmp/shots after 390
 *
 * `?demo=1` is the committed fixture -- the only thing safe to point a
 * screenshot at (a live workspace would put real paths into a screenshot).
 * Follows `phone-prompt-shots.mjs`'s own theme-toggle pattern exactly:
 * `vam.prefs.v1` in `localStorage`, set before navigation.
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5912';
const outDir = process.argv[3] ?? '/tmp/shots';
const label = process.argv[4] ?? 'after';
const width = Number(process.argv[5] ?? 390);

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.addInitScript((t) => {
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ theme: t }));
  }, theme);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-phone-shell="list"]');
  // `vamControlled: true`, no question open: the composer and (after the
  // fix) the keystroke strip are both on screen with nothing competing for
  // it -- `notes-1` is the demo fixture's own idle-but-typeable session
  // (`fixtures/demo.ts`), the shape `canSendKeysRemotely` actually gates on.
  await page
    .locator('[data-phone-shell] [data-session-row="notes-1"]')
    .first()
    .click();
  await page.waitForSelector('[data-phone-shell="session"]');
  await page.locator('[data-phone-shell] [data-composer-bar] textarea').click();
  // SINGLE LINE NOW (composer follow-up: "the mobile prompt input is single
  // line only") -- a draft this long no longer grows the box; it scrolls
  // horizontally inside the one line instead, which is the shape this shot
  // now exists to show.
  await page.locator('[data-phone-shell] [data-composer-bar] textarea').fill(
    'a reasonably long draft, long enough to scroll past the edge of one line',
  );
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.currentTime = 0;
      a.pause();
    }
  });
  await page.screenshot({ path: `${outDir}/phone-session-${theme}-${label}-${width}.png` });
  console.log(`${outDir}/phone-session-${theme}-${label}-${width}.png`);
  await page.close();
}
await browser.close();
