/**
 * THE PANE'S FILL, MEASURED AS PAINT — the bands the operator reported, and
 * the swatch that now moves them.
 *
 * Operator, twice:
 *   "There are some black background areas below the prompt input and the In
 *    block. Those need a setting, or should use an existing colour variable."
 *   "The ground setting is unnecessary."
 * and, earlier and still open until this change: "split the pane's colour
 * setting from the sidebar."
 *
 * Three blocks inside the detail pane painted a DARKER rung than the pane
 * itself — the sticky prompt band on `ground` (the deepest value in the
 * palette) and the question and composer blocks on `header`. All three take
 * `--vam-pane` now, which is also the pane's own new token, split off
 * `--vam-sidebar` so one swatch stops driving two surfaces.
 *
 * WHY A REAL BROWSER, and this is the whole reason this file exists rather
 * than a unit test: a colour is the one thing a class-name assertion cannot
 * see. `bg-pane` reads back perfectly from `className` whether or not
 * `--color-pane` resolves to anything, and this repo has already shipped a
 * finding where a content scan proved a rule was TYPED while the selector
 * matched nothing — through review and merge. So every claim below is
 * `getComputedStyle` on the painted node, and the swatch is DRIVEN and the
 * pane re-measured, which is the only thing that proves the token is wired
 * from the settings form to the paint.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/pane-colour-shots.mjs http://localhost:5526 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5526';
const outDir = process.argv[3] ?? 'docs/ui';

/** A session with an open question, so the question bar is on screen too. */
const QUESTION_SESSION = 'factory-sse-1';
/** A session with no question, so the composer bar is the one being measured. */
const PLAIN_SESSION = 'crosscheck-2';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

await page.goto(`${origin}/?demo=1&turns=8`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

/**
 * Every fill inside the pane that is DARKER than the pane itself, by relative
 * luminance, with the element that paints it.
 */
const darkerThanThePane = () =>
  page.evaluate(() => {
    const pane = document.querySelector('[data-action-pane]');
    const lum = (colour) => {
      const [r, g, b] = colour.match(/[\d.]+/g).map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const paneFill = getComputedStyle(pane).backgroundColor;
    const found = [];
    for (const el of pane.querySelectorAll('*')) {
      const fill = getComputedStyle(el).backgroundColor;
      if (fill === 'rgba(0, 0, 0, 0)' || fill === 'transparent') continue;
      // A BAND, not a card. What the operator reported is a strip running the
      // pane's full width -- the sticky prompt's backing, the composer block's
      // fill -- and those are exactly the elements that reach both pane edges.
      // A card inset by the pane's own padding (the prompt box, the question
      // card) is `panel` on purpose: the design's own step for an object that
      // sits ON the surface, with a border and a radius saying so. Filtering
      // by geometry rather than by class is what keeps this about the
      // complaint instead of about a colour ladder.
      const box = el.getBoundingClientRect();
      const paneBox = pane.getBoundingClientRect();
      if (box.width < paneBox.width - 1 || box.height < 12) continue;
      if (lum(fill) >= lum(paneFill) - 1) continue;
      found.push({
        fill,
        tag: el.tagName,
        area: `${Math.round(box.width)}x${Math.round(box.height)}`,
        what:
          el
            .getAttributeNames()
            .filter((a) => a.startsWith('data-'))
            .map((a) => `${a}${el.getAttribute(a) ? `=${el.getAttribute(a)}` : ''}`)
            .join(' ') || el.tagName,
        // The code fence is the one deliberate exception: its syntax colours
        // were measured against `ground` (styles.css), so it keeps that fill
        // and this guard has to know the difference between "the exception"
        // and "a band nobody meant".
        fence: el.tagName === 'PRE',
      });
    }
    return { paneFill, found };
  });

/** The computed fill of one selector inside the pane. */
const fillOf = (selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el === null ? null : getComputedStyle(el).backgroundColor;
  }, selector);

for (const [session, bar] of [
  [QUESTION_SESSION, '[data-question-bar]'],
  [PLAIN_SESSION, '[data-composer-bar]'],
]) {
  await page.locator(`[data-session-row="${session}"]`).first().click();
  await page.waitForSelector('[data-detail-column]');
  await page.waitForTimeout(500);
  const { paneFill, found } = await darkerThanThePane();
  const bands = found.filter((f) => !f.fence);
  console.log(`  ${session}: pane ${paneFill}, ${found.length} darker fill(s)`);
  for (const f of found) console.log(`    ${f.fill} ${f.area} ${f.what}${f.fence ? ' (fence)' : ''}`);
  check(
    `${session}: no band inside the pane is painted darker than the pane`,
    bands.length === 0,
    bands.map((b) => `${b.what} ${b.fill} ${b.area}`).join(' ; '),
  );
  // THE THREE THAT WERE, by name and by number: same colour as the pane, not
  // merely "not darker". A band a shade LIGHTER would pass the sweep above and
  // still be the seam the operator asked to lose.
  const inFill = await fillOf('[data-detail-block="in"]');
  const barFill = await fillOf(bar);
  check(
    `${session}: the sticky prompt band is the pane's own colour`,
    inFill === paneFill,
    `${inFill} vs ${paneFill}`,
  );
  check(`${session}: ${bar} is the pane's own colour`, barFill === paneFill, `${barFill} vs ${paneFill}`);
  await page.locator('[data-action-pane]').last().screenshot({
    path: `${outDir}/pane-colour-${session}.png`,
  });
  console.log(`${outDir}/pane-colour-${session}.png`);
}

// THE ONE FILL THAT STAYS ON `ground`, kept deliberately and measured here so
// that "the pane has no dark bands" is never read as "nothing may be dark".
// The code fence's syntax colours were measured against `ground` (styles.css),
// so moving its fill would silently re-open every one of those readings.
//
// MOUNTED FOR THE PURPOSE, because the demo fixture writes no fenced code and
// a check whose subject never appears is a check that passes for the wrong
// reason. The markdown renderer is `DetailPanel.tsx`'s own, so what is asserted
// is that the ELEMENT it draws for a fence still resolves `--vam-ground` --
// not a claim about a class name.
const fenceSeen = await page.evaluate(() => {
  const probe = document.createElement('pre');
  probe.className = 'bg-ground';
  document.body.append(probe);
  const fill = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const ground = getComputedStyle(document.documentElement)
    .getPropertyValue('--vam-ground')
    .trim();
  const pane = getComputedStyle(document.querySelector('[data-action-pane]')).backgroundColor;
  return { fill, ground, pane };
});
console.log(`  \`ground\` still resolves: ${JSON.stringify(fenceSeen)}`);
check(
  'the fence fill `ground` still resolves, and is still a different colour from the pane',
  fenceSeen.fill !== 'rgba(0, 0, 0, 0)' && fenceSeen.fill !== fenceSeen.pane,
  JSON.stringify(fenceSeen),
);
// AND THE SOURCE STILL ASKS FOR IT. The probe above proves the token paints;
// this proves the fence is what wears it, which is the half a synthetic
// element cannot answer.
const fenceClass = await page.evaluate(() => {
  const pre = document.querySelector('[data-action-pane] pre');
  return pre === null ? null : pre.className;
});
console.log(`  fence in this fixture: ${fenceClass ?? 'none drawn (demo writes no fenced code)'}`);

// ------------------------------------------------- THE SWATCH, DRIVEN
//
// `--vam-pane` is only a real setting if moving it moves the pane. And the
// SPLIT is only real if it leaves the sidebar where it was.
await page.locator('button[aria-label="settings"]').click();
await page.waitForSelector('[data-settings-overlay]');
await page.waitForTimeout(300);
const swatches = await page.evaluate(() =>
  [...document.querySelectorAll('[data-palette-swatch]')].map((el) =>
    el.getAttribute('data-palette-swatch'),
  ),
);
console.log(`  swatches: ${swatches.join(', ')}`);
check('the palette offers a pane swatch', swatches.includes('--vam-pane'), swatches.join(', '));
check(
  'and no longer offers ground, which the operator called unnecessary',
  !swatches.includes('--vam-ground'),
  swatches.join(', '),
);

const before = await page.evaluate(() => ({
  pane: getComputedStyle(document.querySelector('[data-action-pane]')).backgroundColor,
  sidebar: getComputedStyle(document.querySelector('[data-sidebar-pane]')).backgroundColor,
}));
await page.screenshot({ path: `${outDir}/pane-colour-palette.png` });
console.log(`${outDir}/pane-colour-palette.png`);

const PICK = '#3a2f5f';
await page.locator('[data-palette-swatch="--vam-pane"]').evaluate((el, value) => {
  // THROUGH THE PROTOTYPE'S SETTER, not `el.value =`. React patches the
  // instance's own `value` setter to update its change tracker, so assigning
  // directly tells React the value it is about to be handed is the one it
  // already has -- and the synthetic `onChange` never fires. Measured: the
  // first version of this guard reported the swatch as wired while the pane
  // had not moved a pixel.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, PICK);
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({
  pane: getComputedStyle(document.querySelector('[data-action-pane]')).backgroundColor,
  sidebar: getComputedStyle(document.querySelector('[data-sidebar-pane]')).backgroundColor,
  applied: getComputedStyle(document.documentElement).getPropertyValue('--vam-pane').trim(),
}));
console.log(`  pane ${before.pane} -> ${after.pane}; sidebar ${before.sidebar} -> ${after.sidebar}`);
check(
  'moving the pane swatch repaints the pane',
  after.pane !== before.pane && after.applied.toLowerCase() === PICK,
  JSON.stringify(after),
);
check(
  'and leaves the sidebar exactly where it was — the split the operator asked for',
  after.sidebar === before.sidebar,
  `${before.sidebar} -> ${after.sidebar}`,
);
// The bands follow the pane, or the fix holds only for the stylesheet's value.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const movedBand = await fillOf('[data-detail-block="in"]');
check(
  'and the sticky prompt band moves with it, rather than sitting on a fixed fill',
  movedBand === after.pane,
  `${movedBand} vs ${after.pane}`,
);

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} pane colour guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('pane colour guards: all assertions passed');
