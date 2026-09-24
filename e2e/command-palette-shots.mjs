/**
 * WHAT THE COMMAND PALETTE PAINTS, measured as pixels.
 *
 * The panel wore `bg-surface`, and `styles.css` declares no `--color-surface`:
 * Tailwind emitted no rule, the panel had NO background, and the canvas read
 * straight through the command list. The operator found it, not a test --
 * every unit test that reads `className` was green, because the class was
 * there; it simply meant nothing.
 *
 * `test/renderer/colour-tokens.test.ts` now refuses a class that names no
 * token, which is the general rule. THIS is the specific one, and the two are
 * not the same check: a token can exist and still be transparent, a rule can
 * be emitted and still be overridden by a later one, and only a screenshot
 * knows what a pixel behind a floating panel actually is. So this reads the
 * PIXEL at the centre of the panel, over text it is covering, and asserts it
 * is the panel's own ground rather than whatever is underneath.
 */

import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'e2e/test-results/command-palette';

const failures = [];
const check = (what, ok, detail) => {
  console.log(`${ok ? '  ok ' : 'FAIL'}  ${what}${ok || detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(what);
};

const decodePng = (await import('node:zlib')).default;
const { inflateSync } = decodePng;

/** One pixel out of a PNG Playwright wrote: 8-bit RGBA, no interlace. */
function pixelOf(buffer, x, y) {
  let at = 8;
  let width = 0;
  let bpp = 4;
  const idat = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(at + 8);
      const colour = buffer[at + 17];
      bpp = colour === 6 ? 4 : 3;
    }
    if (type === 'IDAT') idat.push(buffer.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  let previous = Buffer.alloc(stride);
  let row = Buffer.alloc(stride);
  let offset = 0;
  for (let line = 0; line <= y; line += 1) {
    const filter = raw[offset];
    offset += 1;
    row = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = previous[i];
      const c = i >= bpp ? previous[i - bpp] : 0;
      if (filter === 1) row[i] = (row[i] + a) & 255;
      else if (filter === 2) row[i] = (row[i] + b) & 255;
      else if (filter === 3) row[i] = (row[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        row[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    previous = row;
  }
  const i = x * bpp;
  return `rgb(${row[i]}, ${row[i + 1]}, ${row[i + 2]})`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => document.documentElement.classList.toggle('light', t === 'light'), theme);
  await page.keyboard.press('Meta+k');
  const panel = page.locator('[data-command-palette]');
  await panel.waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForTimeout(150);

  const box = await panel.boundingBox();
  const declared = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
  check(
    `${theme}: the panel declares a background rather than leaving it transparent`,
    declared !== 'rgba(0, 0, 0, 0)' && declared !== 'transparent',
    declared,
  );

  // The pixel a fifth of the way down the panel, at its centre: inside the
  // list, over the canvas it covers.
  const shot = await page.screenshot({ clip: box });
  const painted = pixelOf(shot, Math.round(box.width / 2), Math.round(box.height * 0.8));
  const expected = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--vam-panel').trim(),
  );
  const hex = `#${painted.match(/\d+/g).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  // `#fff` and `#ffffff` are the same colour, and the stylesheet is free to
  // write either: the light panel is `#fff`. Expanded before comparing, so a
  // shorthand in `styles.css` cannot fail a check about pixels.
  const expanded =
    /^#[0-9a-f]{3}$/i.test(expected) ? `#${[...expected.slice(1)].map((c) => c + c).join('')}` : expected;
  check(
    `${theme}: and PAINTS it -- the pixel inside the panel is the panel's own ground, not the canvas behind`,
    hex.toLowerCase() === expanded.toLowerCase(),
    `painted ${hex}, --vam-panel ${expected}`,
  );

  await page.screenshot({ path: `${outDir}/command-palette-${theme}.png`, clip: box });
  console.log(`${outDir}/command-palette-${theme}.png`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
}

/**
 * THE ACTIONS HALF, VS CODE'S OWN SPLIT — the operator, translated: "searching
 * sessions has no prefix; searching actions starts with `/`". Every claim
 * this makes is the same shape as the pixel check above: a rectangle, or a
 * real keystroke's effect, neither of which `test/panels/CommandPalette.test.tsx`
 * (jsdom's `getBoundingClientRect` is always zero) can ask.
 */
await page.evaluate(() => document.documentElement.classList.remove('light'));
// A session focused first, so the session-scoped rows (`close this session`,
// the five views, both splits…) paint ENABLED in the screenshot rather than
// every one of them showing the disabled sentence — the more informative
// picture, and the one an operator who just picked a session actually sees.
await page.locator('[data-session-row]').first().click();
await page.keyboard.press('Meta+k');
const panel = page.locator('[data-command-palette]');
await panel.waitFor({ state: 'visible', timeout: 5_000 });
await page.waitForTimeout(150);

{
  const box = await panel.boundingBox();
  await page.screenshot({ path: `${outDir}/command-palette-sessions.png`, clip: box });
  console.log(`${outDir}/command-palette-sessions.png`);
}

await page.keyboard.type('/');
await page.waitForSelector('[data-command-palette][data-palette-mode="actions"]', {
  timeout: 2_000,
});
await page.waitForTimeout(100);

const actionGeometry = await page.evaluate(() => {
  const panelEl = document.querySelector('[data-command-palette]');
  const hint = document.querySelector('[data-palette-hint]');
  const rows = [...document.querySelectorAll('[data-command-palette] [cmdk-item]')];
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  return {
    panel: panelEl ? rect(panelEl) : null,
    hint: hint
      ? { ...rect(hint), text: hint.textContent, scrollWidth: hint.scrollWidth, clientWidth: hint.clientWidth }
      : null,
    rowCount: rows.length,
    rowTexts: rows.map((el) => el.textContent ?? ''),
  };
});

check('action mode: at least one action row renders', actionGeometry.rowCount > 0, String(actionGeometry.rowCount));
// Every row in the curated list has a bound chord (`buildPaletteActions`
// drops any candidate with none), so the settings row — always bound to `,`
// and never disabled — is a stand-in for "chords render at all".
const settingsRow = actionGeometry.rowTexts.find((text) => /^settings/i.test(text));
check('action mode: the settings row renders with its bound chord (,) beside it', settingsRow?.includes(',') ?? false, settingsRow);
// A disabled row prints its reason -- with a session focused, that sentence
// should not appear anywhere in the list.
check(
  'action mode: nothing reads disabled with a session focused',
  !actionGeometry.rowTexts.some((text) => /pick a session first/i.test(text)),
  actionGeometry.rowTexts.find((text) => /pick a session first/i.test(text)),
);

check('action mode: the hint line is on screen', (actionGeometry.hint?.width ?? 0) > 0 && (actionGeometry.hint?.height ?? 0) > 0, JSON.stringify(actionGeometry.hint));
check(
  'action mode: the hint names the way back to sessions',
  /back to sessions/i.test(actionGeometry.hint?.text ?? ''),
  actionGeometry.hint?.text,
);
check(
  'action mode: the hint sits inside the panel, not clipped by its rounded-md overflow-hidden edge',
  actionGeometry.panel !== null &&
    actionGeometry.hint !== null &&
    actionGeometry.hint.left >= actionGeometry.panel.left - 1 &&
    actionGeometry.hint.right <= actionGeometry.panel.right + 1 &&
    actionGeometry.hint.bottom <= actionGeometry.panel.bottom + 1,
  JSON.stringify({ panel: actionGeometry.panel, hint: actionGeometry.hint }),
);
check(
  'action mode: the hint text is not truncated -- it fits the width it is given',
  (actionGeometry.hint?.scrollWidth ?? 1) <= (actionGeometry.hint?.clientWidth ?? 0) + 1,
  `scrollWidth ${actionGeometry.hint?.scrollWidth}, clientWidth ${actionGeometry.hint?.clientWidth}`,
);

{
  const box = await panel.boundingBox();
  await page.screenshot({ path: `${outDir}/command-palette-actions.png`, clip: box });
  console.log(`${outDir}/command-palette-actions.png`);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(100);

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\ncommand palette: it paints its own ground in both themes.');
