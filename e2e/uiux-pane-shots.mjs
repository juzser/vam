/**
 * The six states this pass changed, photographed before and after.
 *
 * SCREENSHOTS ONLY — no assertions, which is why it is NOT in
 * `e2e/run-web-guards.mjs` and must not be added there: running a script that
 * asserts nothing would turn a green tick into a broader claim than it is.
 * Every claim these pictures illustrate is measured by a guard that does
 * throw: `pane-colour-shots` (the option fill, its ink, the Agents badge),
 * `tooltip-shots` and `narrow-pane-overlay-shots` (the failed banner's note,
 * reached by Tab and not painted over), and `composer-bar-shots` (the
 * submit's word, and the model field's ring).
 *
 * The `before` half is taken with `src/renderer/panels/DetailPanel.tsx` and
 * `src/renderer/styles.css` restored to the branch point and the demo fixture
 * left as it is -- the fixture is what puts a failed session on screen at all,
 * and a "before" that could not draw the element would be a picture of the
 * wrong thing rather than of the defect.
 *
 *   node e2e/uiux-pane-shots.mjs http://localhost:5599 docs/ui before
 *   node e2e/uiux-pane-shots.mjs http://localhost:5599 docs/ui after
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5599';
const outDir = process.argv[3] ?? 'docs/ui';
const tag = process.argv[4] ?? 'after';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

const theme = async (name) => {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('light', t === 'light');
  }, name);
  await page.waitForTimeout(150);
};

/** A shot of one element, with room around it for anything it paints outside
 *  its own box — a focus ring, a tooltip, the pill it sits under. */
const shotOf = async (selector, file, pad = { top: 10, side: 10, bottom: 10 }) => {
  const box = await page.locator(selector).first().boundingBox();
  const view = page.viewportSize();
  await page.screenshot({
    path: `${outDir}/${file}`,
    clip: {
      x: Math.max(0, box.x - pad.side),
      y: Math.max(0, box.y - pad.top),
      width: Math.min(view.width - Math.max(0, box.x - pad.side), box.width + pad.side * 2),
      height: Math.min(view.height - Math.max(0, box.y - pad.top), box.height + pad.top + pad.bottom),
    },
  });
  console.log(`${outDir}/${file}`);
};

/** Walk the real tab order to an element, so `:focus-visible` is satisfied. */
const tabTo = async (selector, stops = 300) => {
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < stops; i += 1) {
    await page.keyboard.press('Tab');
    const landed = await page.evaluate(
      (s) => document.activeElement?.matches?.(s) === true,
      selector,
    );
    if (landed) return true;
  }
  return false;
};

// 1. THE ANSWER OPTIONS, with the pointer on the first one — the state that
//    punched a hole in the card.
for (const name of ['dark', 'light']) {
  await theme(name);
  await page.locator('[data-session-row="vam-build-1"]').first().click();
  await page.waitForSelector('[data-question-option]');
  await page.waitForTimeout(250);
  await page.locator('[data-question-option]').first().hover();
  await page.waitForTimeout(200);
  await shotOf('[data-question]', `uiux-${tag}-question-options-${name}.png`);
}

// 2. THE AGENTS BADGE, in both themes.
for (const name of ['dark', 'light']) {
  await theme(name);
  await page.locator('[data-session-row="factory-sse-1"]').first().click();
  await page.waitForSelector('[data-view-badge]');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  await shotOf('[data-view-tabs]', `uiux-${tag}-agents-badge-${name}.png`, {
    top: 14,
    side: 14,
    bottom: 14,
  });
}

// 3. THE FAILED BANNER: the pill over its right end, and whatever the
//    keyboard can reach on it.
await theme('dark');
await page.locator('[data-session-row="notes-3"]').first().click();
await page.waitForSelector('[data-session-failed]');
await page.waitForTimeout(300);
const reached = await tabTo('[data-session-failed] [data-note]');
console.log(`Tab reached the failed banner's note: ${reached}`);
await page.waitForTimeout(400);
await shotOf('[data-session-failed]', `uiux-${tag}-failed-banner.png`, {
  top: 10,
  side: 10,
  bottom: 120,
});

// 4. THE COMPOSER, with the keyboard in the model field: the ring, and the
//    submit control beside it.
await page.locator('[data-session-row="crosscheck-2"]').first().click();
await page.waitForSelector('[data-prompt-record]');
await page.waitForTimeout(300);
await tabTo('[data-model-request]');
await page.waitForTimeout(400);
await shotOf('[data-composer-bar]', `uiux-${tag}-composer-dark.png`, {
  top: 130,
  side: 8,
  bottom: 8,
});

await browser.close();
