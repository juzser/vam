/**
 * WHICH PANEL A SETTING IS IN, and whether it is ON SCREEN there.
 *
 * Operator, translated: "can you separate the appearance and colour settings
 * from the feature settings?" The split moved four controls out of Appearance
 * into a section of its own; `settings/sections.ts` carries the rule that
 * decides a row and `test/settings/behaviour-section.test.tsx` holds the shape
 * of the tree.
 *
 * SO WHAT IS LEFT FOR A BROWSER? Three claims the unit suite cannot make, and
 * they are the reason this file exists rather than a fourth assertion in
 * happy-dom:
 *
 *  1. EVERY PANEL IS MOUNTED, so `document.querySelector` finds a control in
 *     the settings overlay whether or not the operator can see it. A unit test
 *     that asserts "focus view is in Behaviour" passes identically when the
 *     Behaviour tab does not navigate, when its panel is 0px tall, and when
 *     the control is painted behind another panel. What is measured here is
 *     the RECTANGLE: on screen while its own section is open, and gone while
 *     a sibling is.
 *  2. THE NAV REALLY REACHES IT. Six destinations now; the sixth is worth
 *     nothing if clicking it leaves the operator on Appearance.
 *  3. THE PANEL FITS THE DIALOG THE PHONE-SIZED WINDOW DRAWS. The overlay is a
 *     fixed 600px box that scrolls, and a panel is only usable if its rows are
 *     inside the scrollport rather than clipped outside it. jsdom lays nothing
 *     out and reports 0 for every one of those numbers.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/settings-panels-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/**
 * The claim, as data: a control, the panel it belongs to, and the panel it
 * must be absent from.
 *
 * NAMED BY SELECTOR, NEVER BY CAPTION. A label is prose and gets reworded; the
 * `data-switch` a row's control carries is the row. And every entry is checked
 * in BOTH directions -- a control asserted only where it now lives would pass
 * while it was still drawn in its old panel too, which is exactly what a
 * half-finished move produces.
 */
const ROWS = [
  ['view width', '[data-switch="narrow-views"]', 'behaviour', 'appearance'],
  ['focus view', '[data-switch="focus-view"]', 'behaviour', 'appearance'],
  ['concise output', '[data-switch="concise-output"]', 'behaviour', 'appearance'],
  ['file editor indent', 'input[aria-label="editor indent"]', 'behaviour', 'appearance'],
  ['the colour templates', '[data-palette-template]', 'appearance', 'behaviour'],
  ['the colour swatches', '[data-palette-swatch]', 'appearance', 'behaviour'],
  ['out text', 'input[aria-label="out text size"]', 'appearance', 'behaviour'],
  ['terminal text', '[data-terminal-size-option]', 'appearance', 'behaviour'],
  ['the terminal colours', '[data-terminal-swatch]', 'appearance', 'behaviour'],
  ['file editor colours', '[data-switch="editor-highlight"]', 'appearance', 'behaviour'],
];

const browser = await chromium.launch();

/** A page with the demo fixture loaded and the settings overlay open. */
async function openSettings(width = 1100, height = 800) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  return page;
}

/**
 * Where a selector's matches ARE, measured rather than counted: how many are
 * in the document at all, and how many have a box a person could point at.
 *
 * `getBoundingClientRect` on an element inside a `hidden` subtree is all
 * zeroes, which is the whole distinction this file is about -- "in the tree"
 * and "on the screen" are two different facts and a unit environment can only
 * report the first.
 */
function painted(page, selector) {
  return page.evaluate((sel) => {
    const all = [...document.querySelectorAll(sel)];
    const boxes = all.map((el) => el.getBoundingClientRect());
    return {
      inTree: all.length,
      onScreen: boxes.filter((b) => b.width > 0 && b.height > 0).length,
    };
  }, selector);
}

console.log('=== which panel each setting is in, measured as paint');
{
  const page = await openSettings();

  // THE NAV OFFERS THE SECTION AT ALL, and by the name a person reads. A
  // `data-settings-nav-item` that exists with no accessible name is the defect
  // `settings-chrome-shots.mjs` was written for; this is the smaller claim
  // that the destination is there to be named.
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-settings-nav-item]')].map((el) =>
      el.getAttribute('data-settings-nav-item'),
    ),
  );
  console.log(`  nav: ${ids.join(', ')}`);
  if (!ids.includes('behaviour')) {
    throw new Error(`the nav offers no Behaviour section: ${ids.join(', ')}`);
  }
  if (ids.indexOf('behaviour') !== ids.indexOf('appearance') + 1) {
    throw new Error(
      `Behaviour is at ${ids.indexOf('behaviour')} and Appearance at ${ids.indexOf('appearance')} — the two halves of one question are not adjacent`,
    );
  }
  const named = page.getByRole('tab', { name: 'Behaviour', exact: true });
  if ((await named.count()) !== 1) {
    throw new Error(`${await named.count()} tabs answer to the name "Behaviour"`);
  }

  for (const section of ['appearance', 'behaviour']) {
    await page.locator(`[data-settings-nav-item="${section}"]`).click();
    await page.waitForTimeout(150);

    // THE NAV REALLY NAVIGATED. Everything below is about which rows are on
    // screen, and all of it is vacuous if the click left the operator on the
    // panel they were already looking at.
    const open = await page.evaluate(() =>
      [...document.querySelectorAll('[data-settings-panel]')]
        .filter((el) => !el.hasAttribute('hidden'))
        .map((el) => el.getAttribute('data-settings-panel')),
    );
    if (open.join(',') !== section) {
      throw new Error(`clicking ${section} left ${open.join(',') || 'nothing'} on screen`);
    }

    // THE CORPUS, BEFORE THE CLAIMS. A panel that drew no rows at all would
    // satisfy every "is absent from" line below by being empty.
    const rows = await page.evaluate(
      (id) =>
        document.querySelectorAll(`[data-settings-panel="${id}"] [data-settings-rows] h4`).length,
      section,
    );
    console.log(`  [${section}] ${rows} labelled row(s)`);
    if (rows < 3) {
      throw new Error(`the ${section} panel drew ${rows} rows, so this sweep is about nothing`);
    }

    for (const [what, selector, home, away] of ROWS) {
      const seen = await painted(page, selector);
      if (seen.inTree === 0) {
        throw new Error(`${what} (${selector}) is nowhere in the overlay at all`);
      }
      if (section === home && seen.onScreen === 0) {
        throw new Error(
          `${what} is in the tree ${seen.inTree} time(s) but has no box on screen with ${home} open — mounted is not the same as reachable`,
        );
      }
      if (section === away && seen.onScreen > 0) {
        throw new Error(
          `${what} is painted while ${away} is the open panel — it belongs to ${home} and is drawn in both`,
        );
      }
    }
    console.log(
      `  [${section}] every row is where it belongs, and only there`,
    );
    await page.screenshot({ path: `${outDir}/settings-${section}-panel.png` });
    console.log(`${outDir}/settings-${section}-panel.png`);
  }

  // THE NAV ITSELF, for the before/after in the pull request. Cropped to the
  // rail so the six destinations are legible at the width GitHub renders an
  // image at.
  const rail = page.locator('[data-settings-nav]');
  await rail.screenshot({ path: `${outDir}/settings-nav-sections.png` });
  console.log(`${outDir}/settings-nav-sections.png`);
  await page.close();
}

// ---------------------------------------------------------------------------
// THE ONE ROW THAT TYPES INTO SOMEBODY ELSE'S AGENT, AND ITS DISCLOSURE.
//
// Operator, translated: "turn this ADHD skill into a setting that can be
// toggled on and off in vam... put it next to the focus view setting."
//
// The switch writes a preference main reads before it types a prompt into a
// pane (`main/terminal/concise.ts`). Before an operator throws it they are
// owed four facts they cannot guess -- that vam's own words will appear in
// their transcript, that they ride the FIRST prompt to each session, that a
// `/clear` empties them and vam cannot tell, and that turning the switch off
// cannot un-say them. `test/settings/concise-output.test.tsx` holds the
// SENTENCES. What is asserted here is that the paragraph is PAINTED next to
// the control, on the panel the operator is actually looking at -- a note
// mounted inside a hidden panel, or clipped outside the scrollport, is a
// disclosure nobody read, and no unit environment can tell the difference.
console.log('\n=== the concise-output row and what it discloses');
{
  const page = await openSettings();
  await page.locator('[data-settings-nav-item="behaviour"]').click();
  await page.waitForTimeout(150);

  const row = await page.evaluate(() => {
    const port = document.querySelector('[data-settings-scroll]');
    const control = document.querySelector('[data-switch="concise-output"]');
    const note = document.querySelector('[data-concise-output-note]');
    const focus = document.querySelector('[data-switch="focus-view"]');
    if (port === null || control === null || note === null || focus === null) return null;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    };
    return {
      control: box(control),
      note: box(note),
      focus: box(focus),
      words: (note.textContent ?? '').trim().length,
      // The scrollport's whole extent, not its visible window: a note below
      // the fold is reachable by scrolling, a note outside this is not.
      reach: port.scrollHeight,
      portTop: Math.round(port.getBoundingClientRect().top),
    };
  });
  if (row === null) {
    throw new Error('the behaviour panel draws no concise-output switch, or no note beside it');
  }
  console.log(`  ${JSON.stringify(row)}`);
  // PAINTED, not merely mounted.
  if (row.control.h === 0 || row.note.h === 0) {
    throw new Error(`the row or its note has no height: ${JSON.stringify(row)}`);
  }
  // UNDER FOCUS VIEW, which is where the operator asked for it. Measured as
  // the y of the two controls rather than as sibling order, because that is
  // the thing an operator can actually see.
  if (row.control.top <= row.focus.top) {
    throw new Error(
      `concise output is drawn at y=${row.control.top}, above focus view at y=${row.focus.top}`,
    );
  }
  // THE NOTE IS THE DISCLOSURE, so an empty one is the defect. A floor rather
  // than an exact length: it is prose and will be reworded.
  if (row.words < 200) {
    throw new Error(`the disclosure is ${row.words} characters, too short to carry four facts`);
  }
  // AND IT IS INSIDE THE BOX THAT SCROLLS. Beyond `scrollHeight` there is no
  // gesture in this dialog that reaches it.
  if (row.note.bottom - row.portTop > row.reach + 1) {
    throw new Error(
      `the disclosure ends ${row.note.bottom - row.portTop}px down a scrollport ${row.reach}px deep — it cannot be scrolled to`,
    );
  }
  await page.locator('[data-concise-output-note]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${outDir}/settings-concise-output.png` });
  console.log(`${outDir}/settings-concise-output.png`);
  await page.close();
}

// ---------------------------------------------------------------------------
// AND THE PANEL IS INSIDE THE BOX THAT SCROLLS.
//
// The overlay is `h-[min(600px,80vh)]` with one scrolling child
// (`[data-settings-scroll]`). A panel whose rows fall outside that child's own
// scroll extent is clipped rather than scrolled to -- and the two states are
// indistinguishable in any environment that does not lay out. Measured at the
// narrowest width the desktop shell draws a nav at, where the section strip
// takes three rows out of the same 600px.
console.log('\n=== the new panel fits the scrollport');
{
  const NARROWEST_DESKTOP = 520;
  const page = await openSettings(NARROWEST_DESKTOP, 844);
  await page.locator('[data-settings-nav-item="behaviour"]').click();
  await page.waitForTimeout(150);
  const fit = await page.evaluate(() => {
    const port = document.querySelector('[data-settings-scroll]');
    const panel = document.querySelector('[data-settings-panel="behaviour"]');
    if (port === null || panel === null) return null;
    const portBox = port.getBoundingClientRect();
    const rows = [...panel.querySelectorAll('[data-settings-rows] > *')].map((el) => {
      const box = el.getBoundingClientRect();
      return { top: Math.round(box.top), bottom: Math.round(box.bottom), h: Math.round(box.height) };
    });
    return {
      rows,
      portTop: Math.round(portBox.top),
      portBottom: Math.round(portBox.bottom),
      scrollH: port.scrollHeight,
      clientH: port.clientHeight,
      // What a row's left edge has to fit inside, since the strip's own width
      // is what the panel shares at this breakpoint.
      portWidth: Math.round(portBox.width),
      overflowX: port.scrollWidth - port.clientWidth,
    };
  });
  if (fit === null || fit.rows.length < 3) {
    throw new Error(`the behaviour panel drew ${fit?.rows.length ?? 0} rows at 520px`);
  }
  console.log(
    `  ${fit.rows.length} rows, ${fit.scrollH}px of content in a ${fit.clientH}px port (${fit.portWidth}px wide)`,
  );
  // ONE ROW OF EACH IS ENOUGH TO BE READ, which is the property a zero-height
  // row would fail while still being "present".
  const flat = fit.rows.filter((row) => row.h < 20);
  if (flat.length > 0) {
    throw new Error(`${flat.length} row(s) in the behaviour panel are under 20px tall`);
  }
  // SIDEWAYS IS THE FAILURE THAT HIDES. The port scrolls down on purpose --
  // that is what a settings panel does -- but a row wider than it is a row
  // whose right-hand half no scroll gesture in this dialog reaches.
  if (fit.overflowX > 1) {
    throw new Error(
      `the behaviour panel is ${fit.overflowX}px wider than the scrollport at 520px — its right edge cannot be reached`,
    );
  }
  await page.screenshot({ path: `${outDir}/settings-behaviour-narrow.png` });
  console.log(`${outDir}/settings-behaviour-narrow.png`);
  await page.close();
}

await browser.close();
console.log(
  'settings panels: Appearance keeps the colour and the type, Behaviour holds what vam does, and each row is painted in exactly one of them.',
);
