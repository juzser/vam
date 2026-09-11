/**
 * THE PR'S PICTURES: the dark theme before and after the lift, at two widths.
 *
 * Operator: "make the dark UI a bit lighter." That is a judgement they have to
 * make by eye, so the job of this file is to make the comparison easy and
 * honest rather than to argue the numbers -- `e2e/pane-colour-shots.mjs` is
 * the asserting guard and `test/renderer/dark-lift.test.ts` is the token one.
 * This is deliberately NOT in `e2e/run-web-guards.mjs`, for the reason that
 * driver gives about every screenshot script: it asserts nothing, so running
 * it in CI would turn a green tick into a broader claim than it is.
 *
 * HOW "BEFORE" IS PRODUCED, because it matters that this is not a mock-up.
 * The same build is photographed twice, a few hundred milliseconds apart; the
 * first time with all 23 lifted tokens pushed back to the exact values they
 * held at `ace5bd7`, as inline custom properties on <html> -- which is the
 * same mechanism the Appearance swatches use, so the "before" shot is the
 * shipped DOM painting the old palette rather than a rebuild of an old
 * branch. Only the palette moves between the two frames.
 *
 * IT PRINTS WHAT IT MEASURES IN BOTH STATES, so the reconstruction can be
 * checked rather than believed: the "before" ladder must come back at
 * L* 2.74 (ground) / 7.74 (pane) / 10.77 (card) and the "after" at
 * 5.88 / 10.77 / 13.71. If those do not appear, the pictures should not be
 * trusted.
 *
 * DARK ONLY. The light theme did not move -- that is asserted as paint in
 * `pane-colour-shots.mjs` and as tokens in `dark-lift.test.ts` -- so a light
 * pair here would be two identical pictures.
 *
 *   node e2e/dark-lift-shots.mjs http://localhost:5541 docs/ui
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5541';
const outDir = process.argv[3] ?? 'docs/ui';

/** Every token the lift moved, at the value it held before it. */
const BEFORE_THE_LIFT = {
  '--vam-ground': '#0a0a0a',
  '--vam-sunken': '#0f0f0f',
  '--vam-well': '#101010',
  '--vam-header': '#111111',
  '--vam-panel': '#141414',
  '--vam-sidebar': '#171717',
  '--vam-pane': '#171717',
  '--vam-raised': '#1a1a1a',
  '--vam-card': '#1d1d1d',
  '--vam-segment-on': '#262626',
  '--vam-line': '#1f1f1f',
  '--vam-line-strong': '#262626',
  '--vam-line-loud': '#2e2e2e',
  '--vam-line-loudest': '#4a4a4a',
  '--vam-line-tip': '#6b6b6b',
  '--vam-ink-dim': '#a1a1a1',
  '--vam-ink-faint': '#858585',
  '--vam-ink-quiet': '#858585',
  '--vam-ink-ghost': '#3f3f3f',
  '--vam-in-bubble': '#0f3b35',
  '--vam-waiting-tint': '#3f2f12',
  '--vam-waiting-wash': '#161208',
  '--vam-done-tint': '#24354d',
};

/** Two widths, because the pane and the sidebar divide the window differently. */
const WIDTHS = [
  { label: '1440', width: 1440, height: 900 },
  { label: '1100', width: 1100, height: 700 },
];

/** The session the shots are taken on: it has an open question and an In bubble. */
const SESSION = 'factory-sse-1';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: WIDTHS[0] });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

await page.goto(`${origin}/?demo=1&turns=8`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

/** The ladder, in the unit the lift is specified in, off the painted nodes. */
const measure = () =>
  page.evaluate(() => {
    const chan = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lightness = (colour) => {
      const [r, g, b] = colour.match(/[\d.]+/g).map(Number).map(chan);
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      return Number((116 * f(y) - 16).toFixed(2));
    };
    const seen = {};
    for (const [name, sel] of [
      ['ground', 'body'],
      ['sidebar', '[data-sidebar-pane]'],
      ['pane', '[data-action-pane]'],
      ['card', '[data-question]'],
      ['In bubble', '[data-detail-scroll="in"]'],
    ]) {
      const el = document.querySelector(sel);
      if (el === null) {
        seen[name] = 'not drawn';
        continue;
      }
      const fill = getComputedStyle(el).backgroundColor;
      seen[name] = /^rgb\(\s*\d/.test(fill) ? `${fill} L* ${lightness(fill)}` : `${fill} (no fill)`;
    }
    return seen;
  });

for (const size of WIDTHS) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.locator(`[data-session-row="${SESSION}"]`).first().click();
  await page.waitForSelector('[data-detail-column]');
  await page.waitForTimeout(500);

  await page.evaluate((values) => {
    for (const [token, value] of Object.entries(values)) {
      document.documentElement.style.setProperty(token, value);
    }
  }, BEFORE_THE_LIFT);
  await page.waitForTimeout(300);
  console.log(`  BEFORE ${size.label}: ${JSON.stringify(await measure())}`);
  await page.screenshot({ path: `${outDir}/dark-lift-before-${size.label}.png` });

  await page.evaluate((values) => {
    for (const token of Object.keys(values)) {
      document.documentElement.style.removeProperty(token);
    }
  }, BEFORE_THE_LIFT);
  await page.waitForTimeout(300);
  console.log(`  AFTER  ${size.label}: ${JSON.stringify(await measure())}`);
  await page.screenshot({ path: `${outDir}/dark-lift-after-${size.label}.png` });
  console.log(
    `${outDir}/dark-lift-before-${size.label}.png  ${outDir}/dark-lift-after-${size.label}.png`,
  );
}

// AND THE PANE ON ITS OWN, where the card, the In bubble and the fence-deep
// `ground` all sit within a few hundred pixels of each other -- the crop that
// shows the lift as a RELATIONSHIP rather than as an overall brightness.
await page.setViewportSize(WIDTHS[0]);
await page.waitForTimeout(300);
for (const [state, apply] of [
  ['before', true],
  ['after', false],
]) {
  await page.evaluate(
    ([values, on]) => {
      for (const [token, value] of Object.entries(values)) {
        if (on) document.documentElement.style.setProperty(token, value);
        else document.documentElement.style.removeProperty(token);
      }
    },
    [BEFORE_THE_LIFT, apply],
  );
  await page.waitForTimeout(300);
  await page.locator('[data-action-pane]').last().screenshot({
    path: `${outDir}/dark-lift-pane-${state}.png`,
  });
  console.log(`${outDir}/dark-lift-pane-${state}.png`);
}

// AND THE TWO OF THEM IN ONE FRAME, which is the only form in which a 3 L*
// step can actually be judged: side by side with a hard seam, where the eye is
// very good at this, rather than in two files a scroll apart, where it is not.
//
// Composed in the browser's own canvas from the two PNGs just written -- no
// image dependency is added to this repo for a picture. Nothing is redrawn or
// recoloured: each half is the file on disk, blitted.
const composite = await page.evaluate(
  async ([leftSrc, rightSrc]) => {
    const load = (src) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    const [a, b] = await Promise.all([load(leftSrc), load(rightSrc)]);
    const pad = 28;
    const canvas = document.createElement('canvas');
    canvas.width = a.width + b.width + 2;
    canvas.height = Math.max(a.height, b.height) + pad;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(a, 0, pad);
    ctx.drawImage(b, a.width + 2, pad);
    ctx.fillStyle = '#ededed';
    ctx.font = '600 15px -apple-system, system-ui, sans-serif';
    ctx.fillText('before  ·  ground L* 2.74, pane 7.74, card 10.77', 10, 19);
    ctx.fillText('after  ·  +3 L*  ·  ground 5.88, pane 10.77, card 13.71', a.width + 12, 19);
    return canvas.toDataURL('image/png');
  },
  [
    `data:image/png;base64,${readFileSync(`${outDir}/dark-lift-pane-before.png`).toString('base64')}`,
    `data:image/png;base64,${readFileSync(`${outDir}/dark-lift-pane-after.png`).toString('base64')}`,
  ],
);
writeFileSync(
  `${outDir}/dark-lift-side-by-side.png`,
  Buffer.from(composite.split(',')[1], 'base64'),
);
console.log(`${outDir}/dark-lift-side-by-side.png`);

await browser.close();
