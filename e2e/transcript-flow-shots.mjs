/**
 * Screenshots and browser-level guards for the transcript flow: the three
 * band separators (IN / PROGRESS / OUT) removed, the turn reading straight
 * through as ONE scrolling column, and `in` pinned to the top of that column
 * while you scroll — the shape the Claude Code plugin for VSCode has.
 *
 * Taken off the WEB build with the demo fixture — the only thing safe to
 * point a public screenshot at (`?demo=1`, App.tsx's own rule). Modelled on
 * `split-panes-shots.mjs`.
 *
 * Run by hand; nothing runs it automatically:
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5514 --strictPort
 *   node e2e/transcript-flow-shots.mjs http://localhost:5514 docs/ui
 *
 * WHY A REAL BROWSER, and why every check here throws: `position: sticky`
 * resolves against the nearest scrolling ancestor and against layout the unit
 * suite does not compute — happy-dom lays nothing out, so a jsdom-level test
 * can only assert the CLASS NAME, and a class name is exactly the kind of
 * guard that stays green while the element sits off screen. So the assertions
 * below MEASURE: they scroll the column and read where `in` actually is.
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5514';
const outDir = process.argv[3] ?? 'docs/ui';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 460 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForSelector('[data-detail-column]');

const column = page.locator('[data-detail-column]');
const inBlock = page.locator('[data-detail-block="in"]');

// --- The bands are gone, and gone from the PAINT, not only from the markup.
const metas = await page.locator('[data-rule-meta]').count();
if (metas !== 0) throw new Error(`the pane still draws ${metas} section rule meta slot(s)`);
for (const name of ['in', 'progress', 'out']) {
  // The region's name survives for a screen reader only. `sr-only` clips it
  // to a 1px box; anything taller is a visible band header again.
  const label = page.locator(`[data-detail-block="${name}"] span`, { hasText: name }).last();
  const box = await label.boundingBox();
  if (box !== null && box.height > 2) {
    throw new Error(
      `the "${name}" region label paints ${box.height}px tall — it must be announced, not drawn.`,
    );
  }
}

// --- ONE scroller: nothing inside the column may own a scrollbar of its
// own. That is what made `in`, `progress` and `out` read as three stacked
// panels, and removing the boxes without removing the scrollers would have
// left the operator's report unanswered.
const metrics = async () =>
  await column.evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
const innerScrollers = async () =>
  await page.evaluate(() => {
    const col = document.querySelector('[data-detail-column]');
    return [...col.querySelectorAll('*')]
      // A real scroller: overflowing AND actually scrollable. `sr-only` and
      // `truncate` overflow too, and they clip rather than scroll.
      .filter((el) => el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0)
      .filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      .filter((el) => el.closest('[data-progress-turns]') === null)
      .map((el) => el.getAttribute('data-detail-scroll') ?? el.tagName);
  });
const nested = await innerScrollers();
if (nested.length !== 0) {
  throw new Error(
    `${nested.join(', ')} scrolls inside the column — the turn reads as separate panels ` +
      'exactly when a region owns its own scrollbar. (The opened turn list is a control, not ' +
      'a region of the transcript, and is excluded above on purpose.)',
  );
}

/**
 * `in` STICKS: scroll the column to its bottom and read where the prompt
 * ACTUALLY is. The demo fixture's turns are short prose, so the column only
 * overflows at a small height or with the turn list open — both are exercised
 * below, because sticky failing in one state and not the other is precisely
 * the kind of thing a class-name assertion cannot see.
 */
async function assertSticksWhileScrolling(label) {
  const box = await column.boundingBox();
  const before = await metrics();
  if (before.scrollHeight <= before.clientHeight + 8) {
    throw new Error(
      `${label}: the column does not overflow (${before.scrollHeight} vs ` +
        `${before.clientHeight}), so scrolling it would prove nothing.`,
    );
  }
  await column.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(200);
  const after = await metrics();
  const inAfter = await inBlock.boundingBox();
  console.log(`${label}: scrolled to ${after.scrollTop}, in at y=${inAfter.y} (column ${box.y})`);
  if (after.scrollTop <= 0) throw new Error(`${label}: the column did not scroll at all`);
  if (Math.abs(inAfter.y - box.y) > 4) {
    throw new Error(
      `${label}: after scrolling ${after.scrollTop}px the prompt sits at y=${inAfter.y} while ` +
        `the column starts at y=${box.y} — it did not stick, it scrolled away.`,
    );
  }
  if (inAfter.height < 4) throw new Error(`${label}: the pinned prompt collapsed to nothing`);
}

// --- Shot 1: the whole turn, straight through — no band headers, no boxes,
// and progress condensed to one line.
const progressLine = page.locator('[data-progress-line]');
if ((await progressLine.count()) !== 1) throw new Error('no condensed progress line');
if ((await page.locator('[data-progress-turns]').count()) !== 0) {
  throw new Error('the turn list is open before anything asked it to be');
}
console.log('condensed progress line height:', (await progressLine.boundingBox()).height);
await page.screenshot({ path: `${outDir}/transcript-flow-condensed.png` });
console.log(`${outDir}/transcript-flow-condensed.png`);

// --- Shot 2: the same line opened into the turns it stands for, scrolled to
// the bottom so the pinned prompt is visible above them.
await page.locator('[data-progress-expand]').click();
await page.waitForTimeout(200);
const rows = await page.locator('[data-progress-turn]').count();
console.log('turn rows once expanded:', rows);
if (rows < 2) throw new Error(`expanding the progress line drew ${rows} turn(s)`);
if ((await page.locator('[data-progress-jump]').count()) !== 0) {
  throw new Error('both pickers are on screen at once — the select must stand down when open');
}
await assertSticksWhileScrolling('with the turn list open');
// Photographed from the top, so the line and the list it opened are both in
// the frame: the scrolled state is Shot 3's job.
await column.evaluate((el) => {
  el.scrollTop = 0;
});
await page.waitForTimeout(150);
await page.screenshot({ path: `${outDir}/transcript-flow-expanded.png` });
console.log(`${outDir}/transcript-flow-expanded.png`);

// --- Shot 3: the pin itself. List closed, a short window so the turn
// overflows, scrolled to the bottom — the prompt is still the first thing on
// screen, which is the whole of what the operator asked sticky for.
await page.locator('[data-progress-expand]').click();
await page.waitForTimeout(150);
await page.setViewportSize({ width: 1100, height: 360 });
await page.waitForTimeout(200);
await assertSticksWhileScrolling('condensed, short window');
await page.screenshot({ path: `${outDir}/transcript-flow-sticky-in.png` });
console.log(`${outDir}/transcript-flow-sticky-in.png`);

await browser.close();
