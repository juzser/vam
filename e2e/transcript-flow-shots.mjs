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
 *
 * RE-POINTED WHEN THE COLUMN GREW TO THE WHOLE SESSION. Every one of these
 * facts used to have exactly one instance on screen, because the pane drew one
 * turn; it now draws all of them, so each selector below names WHICH turn it
 * is about — the newest, the one the column opens on. What the checks assert
 * is unchanged. Which turn's prompt is pinned at a given scroll offset, and
 * whether it hands the pin over to the next, is a different question and has
 * its own guard: `e2e/transcript-column-shots.mjs`.
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
/** The NEWEST turn's prompt — the one pinned where the column opens. */
const inBlock = page.locator('[data-column-turn][data-turn-newest] [data-detail-block="in"]');

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
      .map((el) => el.getAttribute('data-detail-scroll') ?? el.tagName);
  });
const nested = await innerScrollers();
if (nested.length !== 0) {
  throw new Error(
    `${nested.join(', ')} scrolls inside the column — the turn reads as separate panels ` +
      'exactly when a region owns its own scrollbar.',
  );
}

/**
 * `in` STICKS: scroll the column to its bottom and read where a prompt ACTUALLY
 * is. The demo fixture's turns are short prose, so the column only overflows at
 * a small height or with more turns than the fixture's seven — both are
 * exercised below, because sticky failing in one state and not the other is
 * precisely the kind of thing a class-name assertion cannot see.
 *
 * A PROMPT, NOT *THE* PROMPT, since the column grew to the whole session. This
 * used to name the newest turn's `in` and require it at the column's top edge
 * at maximum scroll, which was sound while one turn filled the column by
 * itself: it does not now — the newest turn is ~215px of a 324px viewport, so
 * at the end of the scroll it sits below the top and the turn BEFORE it owns
 * that edge. What survives, and is what "the sticky In follows wherever you
 * scroll" actually promises, is that SOME turn's prompt is pinned there
 * whatever the offset. Which turn, at which offset, is
 * `e2e/transcript-column-shots.mjs`'s question, and it walks every one of them.
 */
async function assertSticksWhileScrolling(label) {
  const before = await metrics();
  if (before.scrollHeight <= before.clientHeight + 8) {
    throw new Error(
      `${label}: the column does not overflow (${before.scrollHeight} vs ` +
        `${before.clientHeight}), so scrolling it would prove nothing.`,
    );
  }
  /**
   * INTO THE THIRD TURN, not to the column's bottom.
   *
   * The offset is chosen so the answer is unambiguous: at a turn's own start
   * exactly one prompt can be pinned, and it is that turn's. The column's
   * bottom is not such an offset — the demo's turns are ~55px of prose, so the
   * end of the scroll lands in whatever happens to be up there, which has
   * already been measured landing in the 6px gap BETWEEN two turns, where
   * nothing paints and every answer is wrong.
   */
  const at = await column.evaluate((el) => {
    const article = el.querySelectorAll('[data-column-turn]')[2];
    const box = article.getBoundingClientRect();
    const top = box.top - el.getBoundingClientRect().top + el.scrollTop;
    // PAST ITS START. At a turn's exact start the prompt is at the column's top
    // edge by ordinary flow, so the check below passed with `position: sticky`
    // deleted -- falsified, and this is the fix. A quarter of the way in, only
    // a pinned prompt is still up there.
    const into = Math.max(12, Math.min(24, Math.floor(box.height * 0.25)));
    el.scrollTop = top + into;
    return { asked: Math.round(top + into), got: Math.round(el.scrollTop), into };
  });
  await page.waitForTimeout(200);
  // WHAT IS PAINTED at the column's top edge, not what merely overlaps it:
  // hit-testing is the only thing that can tell a pinned prompt from one lying
  // underneath the next turn's.
  const pinned = await column.evaluate((el) => {
    const colBox = el.getBoundingClientRect();
    const top = document.elementFromPoint(colBox.left + colBox.width / 2, colBox.top + 4);
    const block = top?.closest('[data-detail-block="in"]') ?? null;
    if (block === null) {
      // Name what WAS there: a failure that reports `null` says nothing about
      // which of the several ways this can go wrong actually happened.
      return {
        region: top?.closest('[data-detail-block]')?.dataset.detailBlock ?? null,
        tag: top?.tagName ?? null,
        cls: (top?.getAttribute('class') ?? '').slice(0, 70),
      };
    }
    const rect = block.getBoundingClientRect();
    return {
      region: 'in',
      turn: block.closest('[data-column-turn]')?.getAttribute('data-column-turn') ?? null,
      offset: rect.top - colBox.top,
      height: rect.height,
    };
  });
  console.log(`${label}: scrolled ${JSON.stringify(at)}, pinned ${JSON.stringify(pinned)}`);
  if (at.got <= 0) throw new Error(`${label}: the column did not scroll at all`);
  if (pinned.region !== 'in') {
    throw new Error(
      `${label}: a quarter of the way into the third turn the top of the column paints ` +
        `"${pinned.region}", not a prompt — nothing stuck, it all scrolled away.`,
    );
  }
  if (Math.abs(pinned.offset) > 4) {
    throw new Error(
      `${label}: the prompt painted at the top of the column sits ${pinned.offset.toFixed(1)}px ` +
        `from its edge — it is passing through, not pinned.`,
    );
  }
  if (pinned.height < 4) throw new Error(`${label}: the pinned prompt collapsed to nothing`);
  // The pinned prompt must still belong to a turn, not to some other block that
  // happens to sit at the top edge.
  if (pinned.turn === null) throw new Error(`${label}: the pinned prompt belongs to no turn`);
}

// --- Shot 1: the whole turn, straight through — no band headers, no boxes,
// and progress condensed to one line. ONE LINE PER TURN now, not one per pane:
// the count of turns was the pane's fact and moved to the column's boundary
// block, and what is left on a turn's line is that turn's own.
const turnsDrawn = await page.locator('[data-column-turn]').count();
const progressLine = page.locator('[data-progress-line]');
const lines = await progressLine.count();
if (lines !== turnsDrawn) {
  throw new Error(`${turnsDrawn} turns are drawn but ${lines} carry a condensed progress line`);
}
// THE CHROME THE OPERATOR HAD REMOVED, absent: the bar across the pane's
// bottom, and all three controls that lived in it (the turn-list chevron, the
// list itself, and the `<select>` that jumped to a turn). The column draws
// every turn, so a control listing them was a second way to reach what is
// already on screen -- and the band was drawn whether or not anything in it
// was. `e2e/transcript-column-shots.mjs` owns what replaced the two jumps.
for (const gone of [
  '[data-column-bar]',
  '[data-progress-turns]',
  '[data-progress-expand]',
  '[data-progress-jump]',
]) {
  const left = await page.locator(gone).count();
  if (left !== 0) throw new Error(`${gone} is still drawn (${left}) — the bar's chrome is back`);
}
console.log(
  'condensed progress line height:',
  (await progressLine.last().boundingBox()).height,
  `(${lines} of them, one per turn)`,
);
await page.screenshot({ path: `${outDir}/transcript-flow-condensed.png` });
console.log(`${outDir}/transcript-flow-condensed.png`);

// --- Shot 2: the same column at volume, which is the second state `in` has to
// stick in. It used to be "with the turn list open" -- that list was what made
// the demo's seven short turns overflow at this height, and it is gone; more
// turns is the same overflow without a control to open. Sticky failing in one
// state and not the other is exactly what one state cannot see.
await page.goto(`${origin}/?demo=1&turns=24`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForSelector('[data-column-turn]');
await page.waitForTimeout(200);
const atVolume = await page.locator('[data-column-turn]').count();
if (atVolume < 20) throw new Error(`?turns=24 drew ${atVolume} turns — the fixture did not take`);
await assertSticksWhileScrolling('at volume');
await page.screenshot({ path: `${outDir}/transcript-flow-volume.png` });
console.log(`${outDir}/transcript-flow-volume.png`);

// --- Shot 3: the pin itself. Back to the seven-turn fixture, a short window so
// the turn overflows, scrolled to the bottom — the prompt is still the first
// thing on screen, which is the whole of what the operator asked sticky for.
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForSelector('[data-detail-column]');
await page.setViewportSize({ width: 1100, height: 360 });
await page.waitForTimeout(200);
await assertSticksWhileScrolling('condensed, short window');
await page.screenshot({ path: `${outDir}/transcript-flow-sticky-in.png` });
console.log(`${outDir}/transcript-flow-sticky-in.png`);

await browser.close();
