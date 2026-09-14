/**
 * THE THIRD PASS'S PICTURES: the dark theme before and after the ladder
 * widened, at two widths, off the same build.
 *
 * Operator: "make the dark UI a bit lighter, and you may re-pick the default
 * colours." That is a judgement made by eye, so this file's job is to make
 * the comparison easy and honest rather than to argue the numbers --
 * `e2e/pane-colour-shots.mjs` is the asserting guard and
 * `test/renderer/dark-ladder.test.ts` is the token one. Deliberately NOT in
 * `e2e/run-web-guards.mjs`, for the reason that driver gives about every
 * screenshot script: it asserts nothing, so running it in CI would turn a
 * green tick into a broader claim than it is.
 *
 * THE PAIR IS THE THIRD PASS, not the first or second. "Before" here is the
 * palette the SECOND pass shipped -- the one that answered "too dark" and
 * still left the operator looking at a flat ladder -- rather than the
 * artboard, or the first pass's own output. What has to be judged is the
 * separation this pass adds, not two earlier passes of brightening it did
 * not do.
 *
 * HOW "BEFORE" IS PRODUCED, because it matters that this is not a mock-up.
 * The same build is photographed twice, a few hundred milliseconds apart:
 * first with every token this pass moved pushed back to the exact value it
 * held after the SECOND pass, as inline custom properties on <html> -- the
 * same mechanism the Appearance swatches use, so the "before" shot is the
 * shipped DOM painting the old palette rather than a rebuild of an old
 * branch. Only the palette moves between the two frames.
 *
 * IT PRINTS WHAT IT MEASURES IN BOTH STATES, so the reconstruction can be
 * checked rather than believed: the "before" ladder must come back at
 * L* 10.27 (ground) / 15.64 (pane) / 18.94 (card) and the "after" at
 * 10.27 / 22.62 / 27.97 -- ground UNCHANGED, pane and card widened.
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
 * Every token this pass moved, at the value it held after the SECOND pass --
 * the same table `test/renderer/dark-ladder.test.ts` measures the step from,
 * so the pictures and the assertions cannot come to disagree about what
 * "before" was. `--vam-ground` is deliberately NOT here: it did not move
 * this pass, so pushing it "back" would push it nowhere and the print-out
 * would say so.
 */
const BEFORE_THE_WIDEN = {
  '--vam-sunken': '#1e1e1e',
  '--vam-well': '#1f1f1f',
  '--vam-header': '#202020',
  '--vam-panel': '#242424',
  '--vam-sidebar': '#272727',
  '--vam-pane': '#272727',
  '--vam-raised': '#2c2c2c',
  '--vam-card': '#2e2e2e',
  '--vam-segment-on': '#383838',
  '--vam-in-bubble': '#354646',
  '--vam-line': '#303030',
  '--vam-line-strong': '#383838',
  '--vam-line-loud': '#3d3d3d',
  '--vam-line-loudest': '#595959',
  '--vam-line-tip': '#7d7d7d',
  '--vam-ink-dim': '#b4b4b4',
  '--vam-ink-faint': '#969696',
  '--vam-ink-quiet': '#969696',
  '--vam-ink-ghost': '#4e4e4e',
  '--vam-ansi-black': '#737373',
  '--vam-idle': '#a1a1aa',
  '--vam-done': '#60a5fa',
  '--vam-failed': '#f87171',
  '--vam-danger': '#fb7185',
  '--vam-waiting-tint': '#4e3e1f',
  '--vam-waiting-wash': '#27231c',
  '--vam-done-tint': '#33445c',
  '--vam-rule-progress': '#a78bfa',
  '--vam-rule-out': '#f472b6',
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
    ctx.fillText('before (2nd pass)  ·  ground L* 10.27, pane 15.64, card 18.94', 10, 19);
    ctx.fillText('after (3rd pass)  ·  ground 10.27, pane 22.62, card 27.97', a.width + 12, 19);
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
