/**
 * THE PR'S PICTURES: the patches, before and after, in both themes.
 *
 * NOT AN ASSERTING GUARD -- `e2e/pane-colour-shots.mjs` is that, and this file
 * is deliberately kept out of `e2e/run-web-guards.mjs` for the reason that
 * driver already gives: a screenshot script asserts nothing, so running it in
 * CI would turn a green tick into a broader claim than it is.
 *
 * HOW "BEFORE" IS PRODUCED, because it matters that this is not a mock-up.
 * The same build is photographed twice; the first time with `--vam-card` and
 * `--vam-in-bubble` pushed back to the exact values those elements used to
 * paint (`#141414`, the old `panel`, and `#1a1a1a`, the old `raised`) in dark,
 * and their light equivalents. Every element in the shot is the shipped DOM;
 * only the two fills move. The script prints what it measures in both states
 * so the "before" numbers can be checked against the ones recorded on the real
 * pre-change build: 1.028:1 for the cards, 1.030:1 for the bubble in dark and
 * 1.015:1 in light. If those three do not come back, the reconstruction is
 * wrong and the pictures should not be believed.
 *
 *   node e2e/pane-patches-shots.mjs http://localhost:5561 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5526';
const outDir = process.argv[3] ?? 'docs/ui';

/** What the two repointed surfaces painted before this change, per theme. */
const BEFORE = {
  dark: { '--vam-card': '#141414', '--vam-in-bubble': '#1a1a1a' },
  light: { '--vam-card': '#ffffff', '--vam-in-bubble': '#f0f0ee' },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.goto(`${origin}/?demo=1&turns=8`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

const measure = () =>
  page.evaluate(() => {
    const chan = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const parts = (colour) => colour.match(/[\d.]+/g).map(Number);
    const lum = (colour) => {
      const [r, g, b] = parts(colour);
      return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)];
      const [hi, lo] = x > y ? [x, y] : [y, x];
      return Number(((hi + 0.05) / (lo + 0.05)).toFixed(3));
    };
    const fill = (sel) => {
      const el = document.querySelector(sel);
      return el === null ? null : getComputedStyle(el).backgroundColor;
    };
    const pane = fill('[data-action-pane]');
    const out = { pane };
    for (const [name, sel] of [
      ['card (question or prompt box)', '[data-question], [data-prompt-box]'],
      ['In bubble', '[data-detail-scroll="in"]'],
    ]) {
      const f = fill(sel);
      out[name] = f === null ? 'not drawn' : `${f} — ${ratio(f, pane)}:1 vs the pane`;
    }
    return out;
  });

for (const theme of ['dark', 'light']) {
  await page.evaluate(
    (t) => document.documentElement.classList.toggle('light', t === 'light'),
    theme,
  );
  for (const session of ['factory-sse-1', 'crosscheck-2']) {
    await page.locator(`[data-session-row="${session}"]`).first().click();
    await page.waitForSelector('[data-detail-column]');
    await page.waitForTimeout(400);

    await page.evaluate((values) => {
      for (const [token, value] of Object.entries(values)) {
        document.documentElement.style.setProperty(token, value);
      }
    }, BEFORE[theme]);
    await page.waitForTimeout(200);
    console.log(`  BEFORE ${theme}/${session}: ${JSON.stringify(await measure(), null, 0)}`);
    await page.screenshot({ path: `${outDir}/patches-before-${theme}-${session}.png` });

    await page.evaluate((values) => {
      for (const token of Object.keys(values)) {
        document.documentElement.style.removeProperty(token);
      }
    }, BEFORE[theme]);
    await page.waitForTimeout(200);
    console.log(`  AFTER  ${theme}/${session}: ${JSON.stringify(await measure(), null, 0)}`);
    await page.screenshot({ path: `${outDir}/patches-after-${theme}-${session}.png` });
    console.log(
      `${outDir}/patches-before-${theme}-${session}.png  ${outDir}/patches-after-${theme}-${session}.png`,
    );
  }
}

await browser.close();
