/**
 * THE SIXTH PASS'S PICTURES: the dark theme before and after the room came
 * down, at two widths, off the same build.
 *
 * Operator: "cho màu background default của sidebar, pane, card tối hơn" --
 * make the default background colour of the sidebar, the pane and the card
 * darker. That is a judgement made by eye, so this file's job is to make
 * the comparison easy and honest rather than to argue the numbers --
 * `e2e/pane-colour-shots.mjs` is the asserting guard and
 * `test/renderer/dark-ladder.test.ts` is the token one. Deliberately NOT in
 * `e2e/run-web-guards.mjs`, for the reason that driver gives about every
 * screenshot script: it asserts nothing, so running it in CI would turn a
 * green tick into a broader claim than it is.
 *
 * THE PAIR IS RE-POINTED AT EVERY PASS, and it is the sixth's now. "Before"
 * is the palette the FIFTH pass shipped -- the one directly behind this ask --
 * and not the second pass's, which is what this file pictured until now. What
 * has to be judged is the step THIS pass takes: a pair spanning three passes
 * flatters it with somebody else's work, and the numbers printed below would
 * have gone on describing a ladder the app stopped painting two passes ago.
 *
 * HOW "BEFORE" IS PRODUCED, because it matters that this is not a mock-up.
 * The same build is photographed twice, a few hundred milliseconds apart:
 * first with every token this pass moved pushed back to the exact value it
 * held after the FIFTH pass, as inline custom properties on <html> -- the
 * same mechanism the Appearance swatches use, so the "before" shot is the
 * shipped DOM painting the old palette rather than a rebuild of an old
 * branch. Only the palette moves between the two frames.
 *
 * IT PRINTS WHAT IT MEASURES IN BOTH STATES, so the reconstruction can be
 * checked rather than believed: the "before" ladder must come back at
 * L* 6.32 (ground) / 16.11 (sidebar and pane) / 21.70 (card) / 27.53 (In
 * bubble), and the "after" at 3.64 / 13.71 / 19.40 / 25.32 -- every rung down
 * by about 2.3 L*, the ground with them, and not one of the gaps between them
 * spent to pay for it.
 *
 * DARK ONLY. The light theme did not move -- asserted as paint in
 * `pane-colour-shots.mjs` and as tokens in `dark-ladder.test.ts` -- so a
 * light pair here would be two identical pictures.
 *
 *   node e2e/dark-ladder-shots.mjs http://localhost:5541 e2e/test-results/web-guards
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5541';
const outDir = process.argv[3] ?? 'e2e/test-results/web-guards';

/**
 * Every token this pass moved, at the value it held after the FIFTH pass --
 * the same values `test/renderer/dark-ladder.test.ts` measures the step from
 * (`FIFTH_PASS_NAMED`, plus the rungs that came down with them), so the
 * pictures and the assertions cannot come to disagree about what "before" was.
 *
 * `--vam-ground` IS HERE THIS TIME, and that is the difference between this
 * pass and the third: the floor moved, because with it pinned the pane and the
 * panel were already at the darkest values the ladder allows. A "before" that
 * left the ground alone would show the new rungs over the old floor, which is
 * a palette that never existed.
 *
 * NOTHING ELSE MOVED, so nothing else is listed. The inks, the lines, the
 * tints and the status hues are all HELD across this pass -- `styles.css` says
 * why for each family -- and pushing a held token "back" would push it
 * nowhere while implying it had travelled.
 */
const BEFORE_THE_WIDEN = {
  '--vam-ground': '#141414',
  '--vam-sunken': '#191919',
  '--vam-well': '#1e1e1e',
  '--vam-header': '#232323',
  '--vam-panel': '#232323',
  '--vam-sidebar': '#282828',
  '--vam-pane': '#282828',
  '--vam-raised': '#2e2e2e',
  '--vam-card': '#343434',
  '--vam-segment-on': '#3a3a3a',
  '--vam-in-bubble': '#414141',
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

/** The ladder, in the unit the pass is specified in, off the painted nodes. */
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
  }, BEFORE_THE_WIDEN);
  await page.waitForTimeout(300);
  console.log(`  BEFORE ${size.label}: ${JSON.stringify(await measure())}`);
  await page.screenshot({ path: `${outDir}/dark-ladder-before-${size.label}.png` });

  await page.evaluate((values) => {
    for (const token of Object.keys(values)) {
      document.documentElement.style.removeProperty(token);
    }
  }, BEFORE_THE_WIDEN);
  await page.waitForTimeout(300);
  console.log(`  AFTER  ${size.label}: ${JSON.stringify(await measure())}`);
  await page.screenshot({ path: `${outDir}/dark-ladder-after-${size.label}.png` });
  console.log(
    `${outDir}/dark-ladder-before-${size.label}.png  ${outDir}/dark-ladder-after-${size.label}.png`,
  );
}

// AND THE PANE ON ITS OWN, where the card, the In bubble and the fence-deep
// `ground` all sit within a few hundred pixels of each other -- the crop that
// shows the widening as a RELATIONSHIP rather than as an overall brightness.
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
    [BEFORE_THE_WIDEN, apply],
  );
  await page.waitForTimeout(300);
  await page.locator('[data-action-pane]').last().screenshot({
    path: `${outDir}/dark-ladder-pane-${state}.png`,
  });
  console.log(`${outDir}/dark-ladder-pane-${state}.png`);
}

// AND THE TWO OF THEM IN ONE FRAME, which is the only form in which a step
// this size can actually be judged: side by side with a hard seam, where the
// eye is very good at this, rather than in two files a scroll apart, where it
// is not.
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
    ctx.fillText('before (5th pass)  ·  ground L* 6.32, pane 16.11, card 21.70', 10, 19);
    ctx.fillText('after (6th pass)  ·  ground 3.64, pane 13.71, card 19.40', a.width + 12, 19);
    return canvas.toDataURL('image/png');
  },
  [
    `data:image/png;base64,${readFileSync(`${outDir}/dark-ladder-pane-before.png`).toString('base64')}`,
    `data:image/png;base64,${readFileSync(`${outDir}/dark-ladder-pane-after.png`).toString('base64')}`,
  ],
);
writeFileSync(
  `${outDir}/dark-ladder-side-by-side.png`,
  Buffer.from(composite.split(',')[1], 'base64'),
);
console.log(`${outDir}/dark-ladder-side-by-side.png`);

await browser.close();
