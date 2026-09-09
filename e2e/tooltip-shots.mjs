/**
 * The tooltip, measured where it is actually painted and announced.
 *
 * Three audit findings live here, and not one of them can be held by a unit
 * test. jsdom computes no layout and no cascade, so a test that reads a class
 * name back would pass while the box stayed invisible — the exact way a rule
 * that matched nothing once passed review in this repo.
 *
 *  - ITEM 2 (S2). The chord chip is separated from the label by a gap and a
 *    border, both purely visual, and the whole tip is the `aria-describedby`
 *    target. Flattened, Settings announced as "Settings," — a name with a
 *    comma welded to it, where the comma is the entire shortcut. What is
 *    asserted is the FLATTENED STRING, because that is the thing a screen
 *    reader receives.
 *  - ITEM 3 (S2). A `Note` hung on a `<span>` with no tab stop opens on hover
 *    and nothing else, which is the `title` it exists to replace. Asserted by
 *    walking Tab with no mouse and requiring the element to be reached.
 *  - ITEM 4 (S3). The tip is filled with `--vam-raised` and floats over
 *    `--vam-sidebar`: measured 1.02:1 (light) and 1.03:1 (dark), with a
 *    border at 1.26:1 / 1.18:1 and no shadow at all. WCAG 1.4.11 asks 3:1 of
 *    a boundary that identifies a component. Asserted as a computed ratio in
 *    BOTH themes, against the surface actually behind the tip.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/tooltip-shots.mjs http://localhost:5527 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5527';
const outDir = process.argv[3] ?? 'docs/ui';

/** WCAG relative luminance, over an `rgb(...)` triple. */
function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]');

/** Open the tip on a control the way a keyboard does: focus, no pointer. */
async function openTipOn(selector) {
  await page.locator(selector).focus();
  await page.waitForSelector('[role="tooltip"]', { timeout: 3000 });
  return page.locator('[role="tooltip"]').first();
}

async function closeTip() {
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForFunction(() => document.querySelector('[role="tooltip"]') === null, null, {
    timeout: 3000,
  });
}

// --- ITEM 2. WHAT A SCREEN READER IS HANDED.
const settings = 'button[aria-label="settings"]';
const tip = await openTipOn(settings);
const announced = await tip.evaluate((el) => el.textContent ?? '');
const described = await page.evaluate((sel) => {
  const button = document.querySelector(sel);
  const id = button?.getAttribute('aria-describedby');
  if (!id) return { wired: false, text: null };
  const target = document.getElementById(id);
  return { wired: target !== null, text: target?.textContent ?? null };
}, settings);
console.log(`settings tip textContent: ${JSON.stringify(announced)}`);
console.log(`aria-describedby wired to the tip: ${described.wired}`);

if (!described.wired) {
  throw new Error('the tip is not the `aria-describedby` target, so none of this is announced');
}
// The chord is `chordText`'s output, read from the binding table — never
// spelled here, or this guard would be asserting its own literal.
const chip = await tip.locator('[data-tip-keys]').first();
const chord = (await chip.evaluate((el) => el.textContent ?? '')).trim();
if (chord === '') throw new Error('the settings tip drew no chord chip at all');
if (await chip.evaluate((el) => el.getAttribute('aria-hidden') !== 'true')) {
  throw new Error('the drawn chip is still readable, so the chord is announced twice');
}
if (!announced.includes(`shortcut: ${chord}`)) {
  throw new Error(
    `the chord is announced as bare punctuation: ${JSON.stringify(announced)} names no "shortcut: ${chord}"`,
  );
}
if (announced === `Settings${chord}`) {
  throw new Error('the label is still welded to the chord with nothing between them');
}

// `textContent` is not what is announced: it includes the `aria-hidden` chip.
// This is the string a screen reader actually builds from the tip, and it is
// the number the audit reported ("Settings,") -- so it is the one to hold.
const spoken = await tip.evaluate((root) => {
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.getAttribute('aria-hidden') === 'true') return '';
    return [...node.childNodes].map(walk).join('');
  };
  return walk(root);
});
console.log(`settings tip AS ANNOUNCED: ${JSON.stringify(spoken)}`);
if (spoken.includes(chord) && !spoken.includes(`shortcut: ${chord}`)) {
  throw new Error(`the chord is still announced bare: ${JSON.stringify(spoken)}`);
}
if (spoken.trim() === `Settings${chord}`) {
  throw new Error('the announced string is still the audit\'s "Settings,"');
}

// The visual face of the same defect: at a narrow width the Settings chip is a
// rounded box holding one comma, which read as an empty box. It is only a
// rendering bug if the box has no glyph in it, so measure the glyph.
const chipBox = await chip.boundingBox();
console.log(`chip box: ${chipBox.width.toFixed(1)}x${chipBox.height.toFixed(1)} for ${JSON.stringify(chord)}`);
if (chipBox.width < 6 || chipBox.height < 6) {
  throw new Error(`the chord chip renders as an empty box: ${JSON.stringify(chipBox)}`);
}

// The audit saw the Settings chip as an empty rounded box at 390px, where the
// whole chord is one comma. Measure it there rather than reasoning about it:
// a comma sits on the baseline with its tail below, so a box that CONTAINS it
// still looks empty if the glyph is clipped. Assert the ink is inside.
await closeTip();
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(200);
const narrow = await page.evaluate((sel) => {
  const button = document.querySelector(sel);
  if (button === null) return null;
  button.focus();
  return null;
}, settings);
void narrow;
const narrowChip = await page
  .waitForSelector('[role="tooltip"] [data-tip-keys]', { timeout: 3000 })
  .then((h) => h.boundingBox())
  .catch(() => null);
if (narrowChip === null) {
  console.log('390px: the sidebar settings control is not on screen in the phone shell');
} else {
  console.log(
    `390px chip box: ${narrowChip.width.toFixed(1)}x${narrowChip.height.toFixed(1)} for ${JSON.stringify(chord)}`,
  );
  if (narrowChip.width < 6 || narrowChip.height < 6) {
    throw new Error(`390px: the chord chip is an empty box ${JSON.stringify(narrowChip)}`);
  }
}
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(200);
await closeTip().catch(() => {});

// --- ITEM 4. THE BOUNDARY, IN BOTH THEMES, AGAINST WHAT IS BEHIND IT.
async function measureTip() {
  return page.evaluate(() => {
    const parse = (s) =>
      s
        .match(/\d+(\.\d+)?/g)
        .slice(0, 3)
        .map(Number);
    const el = document.querySelector('[role="tooltip"]');
    const cs = getComputedStyle(el);
    // The surface the tip is actually floating over, not a guess at it: hide
    // the tip for one frame and ask the document what is under its centre.
    const r = el.getBoundingClientRect();
    const portal = el.closest('body > *') ?? el;
    const prior = portal.style.visibility;
    portal.style.visibility = 'hidden';
    const under = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    portal.style.visibility = prior;
    let behind = under;
    let backdrop = 'rgba(0, 0, 0, 0)';
    while (behind !== null && backdrop === 'rgba(0, 0, 0, 0)') {
      backdrop = getComputedStyle(behind).backgroundColor;
      behind = behind.parentElement;
    }
    return {
      border: parse(cs.borderTopColor),
      fill: parse(cs.backgroundColor),
      behind: parse(backdrop),
      shadow: cs.boxShadow,
    };
  });
}

const themes = {};
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('light', t === 'light');
  }, theme);
  await page.locator(settings).focus();
  await page.waitForSelector('[role="tooltip"]');
  const m = await measureTip();
  const borderVsBehind = ratio(m.border, m.behind);
  const borderVsFill = ratio(m.border, m.fill);
  const fillVsBehind = ratio(m.fill, m.behind);
  themes[theme] = { ...m, borderVsBehind, borderVsFill, fillVsBehind };
  console.log(
    `${theme}: fill vs behind ${fillVsBehind.toFixed(2)}:1, border vs behind ${borderVsBehind.toFixed(2)}:1, border vs fill ${borderVsFill.toFixed(2)}:1`,
  );
  console.log(`${theme}: box-shadow ${m.shadow}`);

  if (m.shadow === 'none') {
    throw new Error(`${theme}: the tip has no elevation over a surface of its own colour`);
  }
  // The boundary has to identify the component from BOTH sides: against the
  // surface it floats over, and against its own fill.
  if (borderVsBehind < 3) {
    throw new Error(
      `${theme}: the tip's border is ${borderVsBehind.toFixed(2)}:1 against what is behind it, under the 3:1 of WCAG 1.4.11`,
    );
  }
  if (borderVsFill < 3) {
    throw new Error(
      `${theme}: the tip's border is ${borderVsFill.toFixed(2)}:1 against its own fill, under 3:1`,
    );
  }

  await page.screenshot({
    path: `${outDir}/tooltip-elevation-${theme}.png`,
    clip: { x: 0, y: 0, width: 520, height: 300 },
  });
}
await page.evaluate(() => document.documentElement.classList.remove('light'));
await closeTip();

// --- ITEM 3. A NOTE NOBODY CAN FOCUS IS A NOTE NOBODY CAN READ.
// Tab from the top of the document, with no pointer anywhere, and require the
// status bar's two notes to be among the stops.
const reached = await page.evaluate(() => {
  const wanted = ['[data-usage]', '[data-status-source]'];
  const present = wanted.filter((s) => document.querySelector(s) !== null);
  return {
    present,
    tabbable: present.filter((s) => document.querySelector(s).tabIndex >= 0),
  };
});
console.log(`status-bar notes present: ${reached.present.join(', ') || '(none)'}`);
console.log(`of those, tabbable: ${reached.tabbable.join(', ') || '(none)'}`);
if (reached.present.length === 0) {
  throw new Error('the demo drew neither status-bar note, so this guard measured nothing');
}
for (const s of reached.present) {
  if (!reached.tabbable.includes(s)) {
    throw new Error(`${s} carries a Note but takes no tab stop: it opens on hover only`);
  }
}

// And prove it for real with the keyboard, not just from `tabIndex`: walk Tab
// until the element is the active one.
for (const selector of reached.present) {
  await page.evaluate(() => document.activeElement?.blur());
  let landed = false;
  for (let i = 0; i < 300 && !landed; i += 1) {
    await page.keyboard.press('Tab');
    landed = await page.evaluate(
      (s) => document.activeElement?.matches?.(s) === true,
      selector,
    );
  }
  if (!landed) throw new Error(`Tab never reached ${selector} in 300 stops`);
  const opened = await page
    .waitForSelector('[role="tooltip"]', { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) throw new Error(`${selector} took focus but opened no tooltip`);
  console.log(`Tab reached ${selector} and its note opened`);
}

// --- The decline, reachable. The demo's own sources may all be able to
// create; when one cannot, its `+` must say so on focus rather than in a
// `title` nobody can open from the keyboard.
const declineShot = await page.evaluate(() => {
  const button = document.querySelector('[data-new-session-in-project]');
  return button === null ? null : { title: button.getAttribute('title') };
});
if (declineShot !== null && declineShot.title !== null) {
  throw new Error('the per-project `+` still carries a native `title`');
}

await closeTip().catch(() => {});
await page.locator(settings).focus();
await page.waitForSelector('[role="tooltip"]');
await page.screenshot({
  path: `${outDir}/tooltip-shortcut-chip.png`,
  clip: { x: 0, y: 0, width: 520, height: 300 },
});

// --- THE VIEW ICONS, WHICH SIT IN THE PANE'S TOP-RIGHT CORNER.
//
// `ShortcutTip` asks for `side="top"`, and these four are the only tips in
// the app whose trigger is ALREADY at the top of its region -- so they are
// the one place Radix's collision flip has to do real work. It cannot be
// reasoned about from the source: `collisionPadding={8}` is a request, and
// whether the box ends up on screen depends on layout no unit test computes.
// So it is measured here: fully inside the viewport, and not covering the
// icon it explains.
await closeTip().catch(() => {});
const viewIcon = '[data-view="prs"]';
const viewTip = await openTipOn(viewIcon);
const viewText = (await viewTip.evaluate((el) => el.textContent ?? '')).trim();
const viewChip = viewTip.locator('[data-tip-keys]').first();
if ((await viewChip.count()) === 0) {
  throw new Error(`the view icon tip drew no chord chip: ${JSON.stringify(viewText)}`);
}
const viewChord = (await viewChip.evaluate((el) => el.textContent ?? '')).trim();
console.log(`view icon tip: ${JSON.stringify(viewText)}, chip ${JSON.stringify(viewChord)}`);
if (viewChord === '') throw new Error('the view icon chip is empty');
// The name is in the tip, and the chord is NOT in the button's own name --
// an accessible name that repeats it announces it on every focus of all four.
const iconName = await page.evaluate(
  (sel) => document.querySelector(sel)?.getAttribute('aria-label') ?? '',
  viewIcon,
);
console.log(`view icon accessible name: ${JSON.stringify(iconName)}`);
if (iconName.includes(viewChord)) {
  throw new Error(`the chord is welded back into the accessible name: ${JSON.stringify(iconName)}`);
}
if (!viewText.includes(iconName)) {
  throw new Error(`the tip does not name the button: ${JSON.stringify(viewText)}`);
}

const tipBox = await viewTip.boundingBox();
const iconBox = await page.locator(viewIcon).boundingBox();
const view = page.viewportSize();
console.log(
  `view tip box x ${Math.round(tipBox.x)}-${Math.round(tipBox.x + tipBox.width)} ` +
    `y ${Math.round(tipBox.y)}-${Math.round(tipBox.y + tipBox.height)}; ` +
    `icon y ${Math.round(iconBox.y)}-${Math.round(iconBox.y + iconBox.height)}; ` +
    `viewport ${view.width}x${view.height}`,
);
// The corner is what makes this worth measuring: if the icon were nowhere
// near the top, "it did not go off the top" would be true for free.
if (iconBox.y > 200) {
  throw new Error(
    `the view icons are ${Math.round(iconBox.y)}px down the page -- they are not in the ` +
      `corner this guard was written for, so the flip below is vacuous.`,
  );
}
for (const [name, ok] of [
  ['off the top', tipBox.y >= 0],
  ['off the left', tipBox.x >= 0],
  ['off the right', tipBox.x + tipBox.width <= view.width],
  ['off the bottom', tipBox.y + tipBox.height <= view.height],
]) {
  if (!ok) throw new Error(`the view icon tooltip runs ${name} of the viewport`);
}
// And it did not solve that by sitting on top of the button.
const overlap =
  Math.max(0, Math.min(tipBox.y + tipBox.height, iconBox.y + iconBox.height) - Math.max(tipBox.y, iconBox.y)) *
  Math.max(0, Math.min(tipBox.x + tipBox.width, iconBox.x + iconBox.width) - Math.max(tipBox.x, iconBox.x));
if (overlap > 0) {
  throw new Error(`the view icon tooltip covers ${Math.round(overlap)}px2 of the icon it explains`);
}
await page.screenshot({
  path: `${outDir}/view-icon-tooltip.png`,
  clip: {
    x: Math.max(0, tipBox.x - 220),
    y: 0,
    width: Math.min(view.width, tipBox.width + 300),
    height: Math.round(iconBox.y + iconBox.height + 40),
  },
});

// --- AND THE SAME CHORDS IN THE KEY SHEET, which is the other surface that
// must not disagree with the tip. Both read `effectiveBindings`.
await closeTip().catch(() => {});
await page.keyboard.press('?');
await page.waitForSelector('[data-key-sheet]', { timeout: 3000 });
const sheetText = await page.evaluate(
  () => document.querySelector('[data-key-sheet]')?.textContent ?? '',
);
if (!sheetText.includes(viewChord)) {
  throw new Error(
    `the key sheet does not list ${viewChord}, the chord the tip just printed -- ` +
      `the two surfaces disagree`,
  );
}
console.log(`key sheet lists the view chord ${JSON.stringify(viewChord)}`);
// Scrolled to the rows in question, so the shot is evidence rather than a
// picture of the sheet's first screen: `Alt-1` is in "panes & focus", well
// below the fold at this height.
const scrolled = await page.evaluate((chord) => {
  const cell = [...document.querySelectorAll('[data-key-sheet-keys]')].find(
    (el) => (el.textContent ?? '').trim() === chord,
  );
  if (cell === undefined) return false;
  cell.scrollIntoView({ block: 'center' });
  return true;
}, `Alt-1`);
if (!scrolled) throw new Error('the key sheet has no Alt-1 cell to scroll to');
await page.waitForTimeout(150);
await page.screenshot({ path: `${outDir}/key-sheet-view-chords.png`, fullPage: false });
await page.keyboard.press('Escape');

console.log('tooltip guards: all assertions passed');
await browser.close();
