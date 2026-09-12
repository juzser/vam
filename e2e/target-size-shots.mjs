/**
 * WCAG 2.2 SC 2.5.8, measured by HITTING the controls rather than by reading
 * their class list.
 *
 * `test/renderer/target-size.test.ts` holds the rule in two halves: every
 * sized clickable control under 24px carries `vam-hit-24`, and the stylesheet
 * contains a `.vam-hit-24::after` that is 24px by 24px. Both halves are source
 * scans, and this repo has already shipped a defect of exactly that shape -- a
 * selector that matched NOTHING passed review because the guard proved the
 * rule had been TYPED, never that it painted.
 *
 * A hit area is even easier to lose silently than a colour. `::after` inherits
 * nothing that guarantees it can be hit: an ancestor with `overflow: hidden`
 * clips it, a later sibling with a stacking context covers it, `pointer-events:
 * none` anywhere above kills it, and a `content` declaration lost in a rebase
 * removes the box entirely. NONE of those touch the class attribute, so every
 * existing assertion stays green while the operator's pointer starts missing.
 *
 * So this asks the page the question the operator's finger asks:
 * `document.elementFromPoint` at the four extremes of the 24x24 box the helper
 * promises, and the answer has to be the control itself or something inside
 * it. A pseudo-element hit is attributed to its originating element, which is
 * what makes the probe legible: if the `::after` is gone, the point lands on
 * whatever is behind the button and the miss names it.
 *
 * WHAT THIS CANNOT REACH, stated so the next reader does not mistake a gap for
 * a guarantee: the PRs pane's repository footer carries two of these buttons
 * and is drawn only where a directory picker exists -- `window.api.dialog` is
 * a preload bridge, so `App.tsx` routes every browser to `DemoCanvas`. Its
 * hit areas are asserted by class in `test/panels/DetailPanel.pr-repo.test.tsx`
 * and the class's behaviour is measured HERE, on the twelve sidebar controls
 * that do reach a browser. That chain is the whole of the proof available
 * without an Electron harness.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/target-size-shots.mjs http://localhost:5527 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5527';
const outDir = process.argv[3] ?? 'docs/ui';

/** The AA floor, and the helper's own box. */
const FLOOR = 24;
/** One pixel inside each edge of that box, so a rounding error is not a fail. */
const REACH = FLOOR / 2 - 1;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]');

/**
 * Hit-test every visible `.vam-hit-24` on whatever is currently on screen.
 *
 * Returns one row per control: the box it actually paints, and every probe
 * that landed on something else -- named, because "a hit area is missing" and
 * "the neighbour above it is eating the hit" are different bugs with different
 * fixes.
 */
async function probe(within = ':root') {
  return page.evaluate(
    ({ floor, reach, within }) => {
      const rows = [];
      const root = document.querySelector(within);
      if (root === null) throw new Error(`no ${within} to probe inside`);
      for (const el of root.querySelectorAll('.vam-hit-24')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const misses = [];
        for (const [edge, x, y] of [
          ['top', cx, cy - reach],
          ['bottom', cx, cy + reach],
          ['left', cx - reach, cy],
          ['right', cx + reach, cy],
        ]) {
          const hit = document.elementFromPoint(x, y);
          if (hit === el || el.contains(hit)) continue;
          const named =
            hit === null
              ? 'nothing at all'
              : `${hit.tagName.toLowerCase()}` +
                `${hit.getAttribute('aria-label') ? `[${hit.getAttribute('aria-label')}]` : ''}`;
          misses.push(`${edge} -> ${named}`);
        }
        rows.push({
          label: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          undersized: rect.width < floor || rect.height < floor,
          misses,
        });
      }
      return rows;
    },
    { floor: FLOOR, reach: REACH, within },
  );
}

const onCanvas = await probe();

// THE CORPUS FIRST. Four guards in this repo have gone green having examined
// zero of anything; a probe that found no controls would "pass" every claim
// below it forever.
if (onCanvas.length < 6) {
  throw new Error(
    `only ${onCanvas.length} hit-area controls were found on the canvas -- ` +
      `the sidebar alone draws four per project, so this probe is measuring the wrong page`,
  );
}

// And the corpus has to be the INTERESTING one: controls that already paint
// 24px would pass this probe with the helper deleted.
const undersized = onCanvas.filter((row) => row.undersized);
if (undersized.length < 6) {
  throw new Error(
    `only ${undersized.length} of ${onCanvas.length} controls paint under ${FLOOR}px, ` +
      `so this probe would pass with \`vam-hit-24\` removed -- it is proving nothing`,
  );
}

for (const row of onCanvas) {
  const box = `${row.width}x${row.height}`;
  if (row.misses.length > 0) {
    throw new Error(
      `${box} "${row.label}" does not answer across its ${FLOOR}px hit area: ` +
        `${row.misses.join(', ')}`,
    );
  }
  console.log(`  ok  ${box.padEnd(9)} "${row.label}" answers across ${FLOOR}x${FLOOR}`);
}
console.log(
  `canvas: ${onCanvas.length} controls, ${undersized.length} of them painted under ${FLOOR}px`,
);

// --- AND THE SAME RULE INSIDE SETTINGS, which is a different stacking context
// (a fixed overlay over the canvas) and therefore a different question.
//
// SCOPED TO THE DIALOG, and that scope is a finding rather than a convenience:
// probed page-wide with Settings open, every sidebar control answers with the
// overlay's own close button, because a modal is supposed to cover them. An
// unscoped probe would have failed on the app behaving correctly -- which is
// the shape of guard that gets disabled rather than fixed.
await page.keyboard.press(',');
await page.waitForSelector('[data-settings-rows]', { timeout: 3000 });
// The dialog's only undersized control is the per-colour reset, and it is
// drawn ONLY beside a colour the operator has overridden -- so a probe of the
// dialog as it opens examines nothing at all. Pressing a palette template
// overrides the whole ladder at once, which is how this corpus is made to
// exist rather than assumed into existence.
const templates = await page.evaluate(() =>
  [...document.querySelectorAll('[data-palette-template]')].map((el) =>
    el.getAttribute('data-palette-template'),
  ),
);
const painted = templates.filter((id) => id !== 'default');
if (painted.length === 0) {
  throw new Error('the appearance section offers no palette template to override a colour with');
}
await page.locator(`[data-palette-template="${painted[0]}"]`).click();
await page.waitForSelector('[data-settings-overlay] .vam-hit-24', { timeout: 3000 });
const inSettings = await probe('[data-settings-overlay]');
const settingsUndersized = inSettings.filter((row) => row.undersized);
if (settingsUndersized.length === 0) {
  throw new Error(
    `the dialog drew ${inSettings.length} hit-area controls and none of them is undersized, ` +
      `so this half of the probe is measuring nothing`,
  );
}
for (const row of inSettings) {
  if (row.misses.length === 0) continue;
  throw new Error(
    `settings: ${row.width}x${row.height} "${row.label}" does not answer across its ` +
      `${FLOOR}px hit area: ${row.misses.join(', ')}`,
  );
}
console.log(
  `settings: ${inSettings.length} controls, ${settingsUndersized.length} of them painted under ${FLOOR}px`,
);
// Put the palette back, so the evidence shot below is vam's own colours and
// the next guard in the run inherits the page it expects.
await page.locator('[data-palette-template="default"]').click();

// The evidence shot: the promised boxes drawn over the controls that need
// them, so the claim above is something a reader can look at.
await page.keyboard.press('Escape');
await page.waitForSelector('[data-settings-rows]', { state: 'detached', timeout: 3000 });
await page.evaluate((floor) => {
  for (const el of document.querySelectorAll('.vam-hit-24')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) continue;
    const mark = document.createElement('div');
    mark.dataset.hitMark = '';
    mark.style.cssText = [
      'position:fixed',
      `left:${rect.left + rect.width / 2 - floor / 2}px`,
      `top:${rect.top + rect.height / 2 - floor / 2}px`,
      `width:${floor}px`,
      `height:${floor}px`,
      'border:1px solid #22c55e',
      'border-radius:4px',
      'pointer-events:none',
      'z-index:9999',
    ].join(';');
    document.body.append(mark);
  }
}, FLOOR);
await page.screenshot({
  path: `${outDir}/target-size-hit-areas.png`,
  clip: { x: 0, y: 0, width: 380, height: 520 },
});
await page.evaluate(() => {
  for (const mark of document.querySelectorAll('[data-hit-mark]')) mark.remove();
});
console.log(`${outDir}/target-size-hit-areas.png`);

console.log('target-size: every assertion passed.');
await browser.close();
