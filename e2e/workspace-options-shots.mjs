/**
 * THE WORKSPACE-OPTIONS POPOVER, ON THE REAL PAINT -- desktop and 390px.
 *
 * `SessionList.view-options.test.tsx` proves the DOM shape in happy-dom,
 * which lays nothing out: whether the popover and its rows actually sit
 * inside the viewport, whether the Sort-by drill-in's back button and its
 * two radios are real rectangles a pointer or a screen reader could reach,
 * and whether a phone-width popover still clears the 44px `vam-tap` floor
 * are all questions only a browser answers. This file asks them, and takes
 * the two screenshots the task's own gate names.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/workspace-options-shots.mjs http://localhost:5529 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5529';
const outDir = process.argv[3] ?? 'docs/ui';

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

/** The BOX, not the text -- rounded, so a sub-pixel layout does not fail a
 *  strict `<=` by a fraction nobody would ever see. */
async function rectOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.width),
      h: Math.round(b.height),
    };
  }, selector);
}

function withinViewport(rect, viewport, label, detailPrefix) {
  check(
    label,
    rect !== null &&
      rect.x >= 0 &&
      rect.y >= 0 &&
      rect.x + rect.w <= viewport.width &&
      rect.y + rect.h <= viewport.height,
    `${detailPrefix}: ${JSON.stringify(rect)} in ${JSON.stringify(viewport)}`,
  );
}

/**
 * Does the Group-by control's OWN box actually hold its own pills -- not
 * merely "are the pills somewhere inside the viewport", which a pill can
 * satisfy while its immediate parent clips it to nothing.
 *
 * FALSIFIED, and what caught the falsification: `overflow-hidden` on
 * `[data-group-by]` (added so `divide-x`'s dividers respect the group's own
 * rounded corners) changes the CSS "automatic minimum size" a flex item
 * gets from its content to zero -- so on a phone, where the popover's own
 * height is capped and `overflow-y: auto`, the flex algorithm was free to
 * shrink this ONE child (every sibling row, with no `overflow-hidden` of
 * its own, refused to shrink below its content) to a 2px sliver while its
 * four pills kept reporting the same correct 44px rects they always had --
 * `getBoundingClientRect` does not know its own ancestor clipped it. The
 * existing per-control "inside the viewport" and "clears 44px" checks both
 * read the PILL's own rect and both passed throughout; only a rect-vs-rect
 * comparison against the pills' immediate parent catches it.
 */
async function groupByHoldsItsPills(page) {
  return page.evaluate(() => {
    const container = document.querySelector('[data-group-by]');
    if (container === null) return null;
    const cb = container.getBoundingClientRect();
    return [...document.querySelectorAll('[data-group-by-option]')].map((el) => {
      const b = el.getBoundingClientRect();
      return Math.round(b.top) >= Math.round(cb.top) - 1 && Math.round(b.bottom) <= Math.round(cb.bottom) + 1;
    });
  });
}

const browser = await chromium.launch();

// ------------------------------------------------------------------ desktop
{
  const viewport = { width: 1280, height: 860 };
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-session-row]');

  const rowsBefore = await page.locator('[data-session-row]').count();

  await page.click('[data-filter-toggle]');
  await page.waitForSelector('[data-filter-menu]');
  await page.waitForSelector('[data-group-by]');

  const menuRect = await rectOf(page, '[data-filter-menu]');
  withinViewport(menuRect, viewport, 'the popover itself sits inside the desktop viewport', 'menu');

  // EVERY PILL AND EVERY ROW ON THE MAIN VIEW, a rectangle each -- "rows and
  // toggles render inside the viewport" is a claim about every one of them,
  // not the container alone (a container can clip an overflowing child).
  const mainRects = await page.evaluate(() => {
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return [
      ...document.querySelectorAll(
        '[data-group-by-option], [data-sort-by-open], [data-status-pill], [data-origin-toggle]',
      ),
    ].map((el) => r(el));
  });
  check(
    'the main view drew its pills and rows, so the rectangle check below is about something',
    mainRects.length >= 4 + 1 + 4 + 5,
    `${mainRects.length} controls found`,
  );
  check(
    'every pill and row on the main view sits inside the desktop viewport',
    mainRects.every(
      (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= viewport.width && r.y + r.h <= viewport.height,
    ),
    JSON.stringify(mainRects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > viewport.width)),
  );

  const desktopGroupByHeld = await groupByHoldsItsPills(page);
  check(
    'the Group-by control is tall enough to actually show its own pills, not clipped by its own box',
    desktopGroupByHeld !== null && desktopGroupByHeld.every(Boolean),
    JSON.stringify(desktopGroupByHeld),
  );

  await page.screenshot({ path: `${outDir}/workspace-options-desktop.png` });
  console.log(`${outDir}/workspace-options-desktop.png`);

  // ---------------------------------------------------- Group by really changes the list
  await page.click('[data-group-by-option="status"]');
  await page.waitForSelector('[data-status-heading]');
  const afterStatus = await page.evaluate(() => ({
    projectHeadings: document.querySelectorAll('[data-project-heading]').length,
    statusHeadings: [...document.querySelectorAll('[data-status-heading]')].map((el) =>
      el.getAttribute('data-status-heading'),
    ),
    rows: document.querySelectorAll('[data-session-row]').length,
  }));
  console.log('after Group by: Status:', JSON.stringify(afterStatus));
  check(
    'Group by: Status draws status headings and no project headings',
    afterStatus.projectHeadings === 0 && afterStatus.statusHeadings.length > 0,
    JSON.stringify(afterStatus),
  );
  check(
    'and every session is still on screen -- grouping is not a filter',
    afterStatus.rows === rowsBefore,
    `${afterStatus.rows} vs ${rowsBefore}`,
  );

  // Back to Project, then None.
  await page.click('[data-group-by-option="project"]');
  await page.waitForSelector('[data-project-heading]');
  await page.click('[data-group-by-option="none"]');
  const flat = await page.evaluate(() => ({
    headings:
      document.querySelectorAll('[data-project-heading], [data-status-heading]').length,
    rows: document.querySelectorAll('[data-flat-rows] [data-session-row]').length,
  }));
  check(
    'Group by: None draws every row flat, no heading of either kind',
    flat.headings === 0 && flat.rows === rowsBefore,
    JSON.stringify(flat),
  );
  await page.click('[data-group-by-option="project"]');
  await page.waitForSelector('[data-project-heading]');

  // ---------------------------------------------------------- a filter really changes the list
  const idleToggle = page.locator('[data-origin-toggle="idle"]');
  const idleOn = (await idleToggle.getAttribute('aria-checked')) === 'true';
  check('Hide sleeping ships off — an upgrade changes nothing', idleOn === false);
  await idleToggle.click();
  await page.waitForFunction(
    (before) => document.querySelectorAll('[data-session-row]').length < before,
    rowsBefore,
  );
  const rowsAfterIdleHidden = await page.locator('[data-session-row]').count();
  check(
    'turning Hide sleeping on removes at least the one idle demo session',
    rowsAfterIdleHidden < rowsBefore,
    `${rowsAfterIdleHidden} vs ${rowsBefore}`,
  );
  await idleToggle.click();
  await page.waitForFunction(
    (before) => document.querySelectorAll('[data-session-row]').length === before,
    rowsBefore,
  );

  // ---------------------------------------------------------------- the Sort-by drill-in
  await page.click('[data-sort-by-open]');
  await page.waitForSelector('[data-sort-by-menu]');
  const drillIn = await page.evaluate(() => {
    const r = (el) => {
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      back: r(document.querySelector('[data-popover-back]')),
      needsYou: r(document.querySelector('[data-sort-by-option="needs-you"]')),
      name: r(document.querySelector('[data-sort-by-option="name"]')),
      focused: document.activeElement?.getAttribute('data-popover-back') !== null,
      groupByGone: document.querySelector('[data-group-by]') === null,
    };
  });
  console.log('sort-by drill-in:', JSON.stringify(drillIn));
  check('the drill-in replaces the main view entirely', drillIn.groupByGone);
  check('focus lands on the back button the moment it opens', drillIn.focused);
  withinViewport(drillIn.back, viewport, 'the back button is a real rectangle inside the viewport', 'back');
  withinViewport(
    drillIn.needsYou,
    viewport,
    'the first radio is a real rectangle inside the viewport',
    'needs-you',
  );
  withinViewport(drillIn.name, viewport, 'the second radio is a real rectangle inside the viewport', 'name');

  // Arrow-key roving focus, for real, on the real DOM -- Tab from the back
  // button to the first radio first, the way a keyboard operator actually
  // arrives there (focus opens on the back button, not on a radio).
  await page.keyboard.press('Tab');
  const onFirstRadio = await page.evaluate(
    () => document.activeElement?.getAttribute('data-sort-by-option'),
  );
  check('Tab from the back button lands on the first radio', onFirstRadio === 'needs-you', onFirstRadio ?? 'null');
  await page.keyboard.press('ArrowDown');
  const movedTo = await page.evaluate(() => document.activeElement?.getAttribute('data-sort-by-option'));
  check('ArrowDown moves focus to the second radio', movedTo === 'name', movedTo ?? 'null');

  await page.click('[data-sort-by-option="name"]');
  await page.waitForSelector('[data-group-by]');
  const afterSort = await page.evaluate(() => [
    ...document.querySelectorAll('[data-project-rows="factory"] [data-row-title]'),
  ].map((el) => el.textContent));
  console.log('factory rows after Sort by: Name:', JSON.stringify(afterSort));
  check(
    'Sort by: Name really reordered a project with more than one session',
    afterSort.length > 1 && [...afterSort].sort((a, b) => (a ?? '').localeCompare(b ?? '')).join('|') ===
      afterSort.join('|'),
    JSON.stringify(afterSort),
  );

  // Escape backs out of a submenu without closing the popover; a second
  // Escape (the global chord) then closes it.
  await page.click('[data-sort-by-open]');
  await page.waitForSelector('[data-sort-by-menu]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-group-by]');
  check('Escape from the submenu returns to the main view, popover still open', true);
  await page.keyboard.press('Escape');
  const closed = await page.locator('[data-filter-menu]').count();
  check('a second Escape closes the whole popover', closed === 0);

  await page.close();
}

// -------------------------------------------------------------------- phone
{
  const viewport = { width: 390, height: 844 };
  const page = await browser.newPage({ viewport, hasTouch: true, isMobile: true });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-phone-shell="list"]');

  await page.click('[data-filter-toggle]');
  await page.waitForSelector('[data-filter-menu]');
  await page.waitForSelector('[data-group-by]');

  const menuRect = await rectOf(page, '[data-filter-menu]');
  withinViewport(menuRect, viewport, 'the popover fits the 390px phone viewport', 'menu');

  const phoneRects = await page.evaluate(() => {
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      controls: [
        ...document.querySelectorAll(
          '[data-group-by-option], [data-sort-by-open], [data-origin-toggle]',
        ),
      ].map((el) => r(el)),
    };
  });
  check(
    'the phone popover drew its controls, so the floor check below is about something',
    phoneRects.controls.length >= 4 + 1 + 5,
    `${phoneRects.controls.length} controls found`,
  );
  check(
    'every control sits inside the 390px viewport',
    phoneRects.controls.every(
      (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= viewport.width && r.y + r.h <= viewport.height,
    ),
    JSON.stringify(phoneRects.controls.filter((r) => r.x < 0 || r.x + r.w > viewport.width)),
  );
  // `.vam-phone .vam-tap` -- the same 44px floor every other tappable row in
  // the app carries once it sits under the phone shell's own class.
  const short = phoneRects.controls.filter((r) => r.h < 44);
  check('every control clears the 44px phone tap floor', short.length === 0, JSON.stringify(short));

  // THE CHECK ABOVE READS EACH PILL'S OWN RECT, WHICH IS EXACTLY WHAT MISSED
  // THE REAL BUG HERE: the phone popover's capped, scrolling height is what
  // shrank `[data-group-by]` to a sliver (`groupByHoldsItsPills`'s own
  // header) -- the pills inside it kept the correct 44px rects `short`
  // above checks throughout.
  const phoneGroupByHeld = await groupByHoldsItsPills(page);
  check(
    'the Group-by control is tall enough to actually show its own pills, not clipped by its own box',
    phoneGroupByHeld !== null && phoneGroupByHeld.every(Boolean),
    JSON.stringify(phoneGroupByHeld),
  );

  await page.screenshot({ path: `${outDir}/workspace-options-phone.png` });
  console.log(`${outDir}/workspace-options-phone.png`);

  await page.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nworkspace options: all checks passed.');
