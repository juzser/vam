/**
 * THE WHOLE SESSION IN ONE COLUMN, and the sticky `in` following the turn you
 * are inside.
 *
 * Operator request: "don't only show the last in/out — show the WHOLE session,
 * load more when scrolling up, and the sticky In should follow wherever you
 * scroll, like the Claude Code plugin". The pane already HAD the history:
 * `entry.session.decisions` is up to `MAX_DECISIONS` turns, newest first, and
 * `DetailPanel.tsx` rendered exactly one of them. This guard is about the
 * column that draws all of them.
 *
 * WHY A REAL BROWSER, and why every check here throws. Four of the five facts
 * below do not exist in happy-dom at all:
 *  - `position: sticky` resolves against the nearest scrolling ancestor and
 *    against layout nothing computes in a unit test;
 *  - which sticky header is CURRENTLY pinned is a scroll-position fact;
 *  - a percentage `max-height` resolves against a containing block, and
 *    wrapping each turn in its own box is exactly the change that can silently
 *    turn a `45%` cap into `none` (an auto-height containing block resolves
 *    percentage max-height to `none`, and the pinned prompt then covers the
 *    answer again -- audit F2, all over);
 *  - and how long 3,276 turns take to draw is a measurement or it is a guess.
 * A unit test can read a class name back, which is precisely the guard that
 * stays green while the answer sits off screen.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/transcript-column-shots.mjs http://localhost:5522 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5522';
const outDir = process.argv[3] ?? 'docs/ui';

/** The demo session's turns, oldest first — the order the column must draw. */
const OLDEST_INPUT = "What's the factory's status right now?";
const NEWEST_INPUT = 'Does cross-origin EventSource actually reach';
/** `factory-sse-1` in `src/renderer/fixtures/demo.ts`. */
const DEMO_TURNS = 7;
/** `MAX_DECISIONS` in `main/sources/claude-code/transcript.ts` — the worst case. */
const MAX_DECISIONS = 3276;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

const failures = [];
/** Collect rather than throw on the first: one run should report every fault. */
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForSelector('[data-detail-column]');

const column = page.locator('[data-detail-column]');
const turns = page.locator('[data-column-turn]');

// ---------------------------------------------------------------- 1. EVERY TURN
//
// The whole of the operator's first sentence. `decisions` already carried
// these; the pane drew one.
const drawn = await turns.count();
check(
  `all ${DEMO_TURNS} turns of the session are in the column`,
  drawn === DEMO_TURNS,
  `${drawn} drawn`,
);

const inputs = await page.locator('[data-column-turn] [data-detail-scroll="in"]').allInnerTexts();
check(
  'the oldest turn is at the TOP of the column',
  (inputs[0] ?? '').includes(OLDEST_INPUT),
  `first is ${JSON.stringify((inputs[0] ?? '').slice(0, 60))}`,
);
check(
  'the newest turn is at the BOTTOM of the column',
  (inputs.at(-1) ?? '').includes(NEWEST_INPUT),
  `last is ${JSON.stringify((inputs.at(-1) ?? '').slice(0, 60))}`,
);

// --------------------------------------------------------- 2. OPENS AT THE END
//
// A transcript opens where the conversation is, not at its beginning: the
// newest turn is the one an operator came to read.
const metrics = () =>
  column.evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
const opened = await metrics();
check(
  'the column overflows, so scrolling it proves something',
  opened.scrollHeight > opened.clientHeight + 8,
  JSON.stringify(opened),
);
check(
  'the column opens scrolled to the bottom',
  opened.scrollHeight - opened.clientHeight - opened.scrollTop <= 24,
  `resting at ${opened.scrollTop} of ${opened.scrollHeight - opened.clientHeight}`,
);

// ------------------------------------------------- 3. THE STICKY `in` FOLLOWS
//
// Not "an `in` is pinned" — THE RIGHT ONE. Scroll to the start of each turn in
// turn and ask which prompt is actually PAINTED at the column's top edge. Two
// failure modes are being separated here and a looser check catches neither:
// with no per-turn wrapper every `in` pins at `top: 0` for the whole scroll and
// they pile up (so the pinned prompt is the oldest turn's, forever), and with
// no `position: sticky` at all the prompt simply scrolls away.
//
// AT EACH TURN'S OWN OFFSET, not at fractions of the scroll height: a fraction
// lands in the hand-off between two turns as often as not, where the outgoing
// prompt is halfway out of the frame and BOTH answers are right.
//
// PAST ITS START, AND THAT IS THE WHOLE OF WHAT MAKES THIS A STICKY TEST.
// Measured by falsification: probing at a turn's own start, `position: sticky`
// could be deleted outright and every check below still passed -- at that
// offset the prompt is the article's first element and sits at the column's top
// edge because of ordinary flow, not because anything pinned it. `into` scrolls
// far enough that an unpinned prompt has left the frame and its answer owns the
// top edge, while the turn still owns it: a quarter of the turn, and never so
// far that the article has less left than the prompt is tall.
const turnOffsets = await column.evaluate((el) =>
  [...el.querySelectorAll('[data-column-turn]')].map((a) => {
    const box = a.getBoundingClientRect();
    const top = box.top - el.getBoundingClientRect().top + el.scrollTop;
    return {
      id: a.getAttribute('data-column-turn'),
      top,
      into: Math.max(12, Math.min(24, Math.floor(box.height * 0.25))),
    };
  }),
);
async function pinnedAt(scrollTop) {
  await column.evaluate((el, top) => {
    el.scrollTop = top;
  }, scrollTop);
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    const col = document.querySelector('[data-detail-column]');
    const colBox = col.getBoundingClientRect();
    const articles = [...col.querySelectorAll('[data-column-turn]')];
    // Which turn owns the top edge of the viewport: the one whose box has
    // started and not yet ended there.
    const probeY = colBox.top + 1;
    const owner = articles.find((el) => {
      const box = el.getBoundingClientRect();
      return box.top <= probeY + 1 && box.bottom > probeY;
    });
    // Which prompt is actually painted at the top edge — `elementFromPoint`,
    // because paint order is the question, not geometry: a prompt that is laid
    // out at the top and covered by the next one reads as pinned to a
    // rectangle intersection and is invisible to a human.
    const top = document.elementFromPoint(colBox.left + colBox.width / 2, probeY + 4);
    const pinned = top?.closest('[data-column-turn]') ?? null;
    const ownerIn = owner?.querySelector('[data-detail-block="in"]') ?? null;
    return {
      owner: owner?.getAttribute('data-column-turn') ?? null,
      pinned: pinned?.getAttribute('data-column-turn') ?? null,
      pinnedIsIn: top?.closest('[data-detail-block="in"]') !== null,
      ownerInTop: ownerIn === null ? null : ownerIn.getBoundingClientRect().top - colBox.top,
    };
  });
}

const full = await metrics();
const maxScroll = full.scrollHeight - full.clientHeight;
const seenPinned = new Set();
let walked = 0;
for (const turn of turnOffsets) {
  // A turn whose start is past the column's own maximum scroll can never own
  // the top edge, so it is not evidence either way.
  if (turn.top + turn.into > maxScroll) continue;
  walked += 1;
  const at = await pinnedAt(turn.top + turn.into);
  seenPinned.add(at.pinned);
  console.log(
    `  ${turn.into}px into turn ${turn.id} (scrollTop ${Math.round(turn.top + turn.into)}): ` +
      `pinned ${at.pinned}`,
  );
  check(
    `inside turn ${turn.id}, the pinned prompt is that turn's`,
    at.owner === turn.id && at.pinned === turn.id && at.pinnedIsIn,
    JSON.stringify(at),
  );
  check(
    `and turn ${turn.id}'s prompt is flush with the top of the column`,
    at.ownerInTop !== null && Math.abs(at.ownerInTop) <= 4,
    `offset ${at.ownerInTop}`,
  );
}
check('several turns were actually walked', walked >= 3, `${walked} reachable`);
check(
  'the pinned prompt is REPLACED as you scroll, not the same one throughout',
  seenPinned.size > 1,
  `only ${[...seenPinned].join(', ')} was ever pinned`,
);

// ------------------------------------- 4. THE PIN IS BOUNDED, IN EVERY TURN
//
// Audit F2 again, per turn: an unbounded sticky block is a lid, not a pin.
// Wrapping each turn in its own box is the change that can turn a percentage
// cap into `none` without changing a class name, so the RESOLVED value is what
// is read, for a turn in the middle as well as the last one.
const caps = await page.evaluate(() => {
  const col = document.querySelector('[data-detail-column]');
  const colHeight = col.getBoundingClientRect().height;
  return [...col.querySelectorAll('[data-column-turn] [data-detail-block="in"]')].map((el) => ({
    max: getComputedStyle(el).maxHeight,
    px: Number.parseFloat(getComputedStyle(el).maxHeight),
    colHeight,
  }));
});
const colHeight = caps[0]?.colHeight ?? 0;
console.log(`  column ${Math.round(colHeight)}px, in caps: ${caps.map((c) => c.max).join(', ')}`);
check(
  'every turn caps what sticks, in RESOLVED PIXELS',
  caps.length === DEMO_TURNS &&
    // `px` is load-bearing: `getComputedStyle` reports an unresolvable
    // percentage max-height back verbatim as `45%`, which parses to a
    // perfectly plausible-looking 45 and would pass a numeric check while the
    // browser applies no cap at all.
    caps.every(
      (c) => c.max.endsWith('px') && Number.isFinite(c.px) && c.px > 0 && c.px <= colHeight * 0.55,
    ),
  caps.map((c) => c.max).join(', '),
);

// ------------------------------------------------ 5. THE TOP OF THE COLUMN
//
// The repo's dominant defect family, at the one place it bites hardest:
// `src/main/sources/claude-code/pull-requests.ts:12` — "'No PRs' and 'vam
// could not ask' must never look the same". A column that simply stops at its
// oldest loaded turn claims the session started there. It did not: the source
// reads the newest `TAIL_BYTES` of the transcript and no more.
await column.evaluate((el) => {
  el.scrollTop = 0;
});
await page.waitForTimeout(150);
const start = page.locator('[data-column-start]');
const hasStart = (await start.count()) === 1;
check('the column says what its top edge IS', hasStart);
if (!hasStart) {
  await browser.close();
  throw new Error(
    'the column draws no boundary at its top: it ends at its oldest loaded turn without ' +
      'saying so, which claims the session started there.',
  );
}
const startState = await start.getAttribute('data-column-start');
check(
  'and says it as READ-SO-FAR, not as the start of the session',
  startState === 'read-limit',
  `data-column-start=${JSON.stringify(startState)}`,
);
const startText = ((await start.innerText()) ?? '').toLowerCase();
console.log(`  boundary: ${JSON.stringify(await start.innerText())}`);
check(
  'in words a reader can act on, not only in an attribute',
  startText.includes('read'),
  startText,
);
check(
  'and it never claims the session begins there',
  !/beginning of|start of the session|no earlier|nothing before/.test(startText),
  startText,
);
// A control that cannot act must be absent, never dimmed: vam has no way to
// ask for older turns yet, so there is no button and no spinner to imply one.
const startControls = await start.locator('button, [role="button"], [aria-busy]').count();
check('and offers no control it cannot honour', startControls === 0, `${startControls} found`);

// ------------------------------------ 6. THE JUMPS FLOAT, AND COVER NOTHING
//
// The operator's report was the STRIP: a `bg-ground` band across the pane's
// full width holding the two scroll-to-edge buttons, drawn on every session
// whether or not either glyph in it was. It is gone, and the two controls
// float over the column's own edges instead.
//
// WHY A REAL BROWSER, again, and it is the whole of this section: "floats over
// the transcript without covering it" is a statement about PAINT AT A SCROLL
// OFFSET. jsdom has no layout, so a unit test can read the classes back and
// stay green while a chip sits on top of somebody's sentence -- which is
// exactly the shape of audit F1, where a `truncate` label was laid out,
// measured as visible, and then painted over by the view-icon pill.
//
// The column reserves a 44px strip on its right for these (`pr-11` in
// `DetailPanel.tsx`), so the claim being held here is not "no glyph happened
// to be there in this fixture" but "no glyph CAN be there": every text run in
// the column is measured against the buttons' own boxes, at every offset
// walked, and the reservation is measured as the gap it is.
const jumpTop = '[data-out-to-top]';
const jumpBottom = '[data-out-to-bottom]';

check(
  'the bar the jumps used to sit in is gone',
  (await page.locator('[data-column-bar]').count()) === 0,
);

/** Every painted text run inside the column, in the column's own coordinates. */
const textRuns = () =>
  page.evaluate(() => {
    const col = document.querySelector('[data-detail-column]');
    const cb = col.getBoundingClientRect();
    const runs = [];
    const walker = document.createTreeWalker(col, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if ((n.textContent ?? '').trim() === '') continue;
      const parent = n.parentElement;
      if (parent === null) continue;
      // `sr-only` is announced, not drawn, and it is laid out off in a 1px
      // box; counting it would report an occlusion nobody can see.
      if (parent.closest('.sr-only') !== null) continue;
      if (getComputedStyle(parent).visibility === 'hidden') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const box of range.getClientRects()) {
        if (box.width < 1 || box.height < 1) continue;
        if (box.bottom < cb.top || box.top > cb.bottom) continue;
        runs.push({
          x: box.left - cb.left,
          y: box.top - cb.top,
          right: box.right - cb.left,
          bottom: box.bottom - cb.top,
          text: (n.textContent ?? '').trim().slice(0, 32),
          // Which block it belongs to, so a failure names WHAT was covered --
          // the pinned prompt and the newest answer are the two the overlay
          // owes its clearance to by name.
          block: parent.closest('[data-detail-block]')?.getAttribute('data-detail-block') ?? 'column',
          pinned:
            parent.closest('[data-column-turn]') ===
            (document.elementFromPoint(cb.left + cb.width / 2, cb.top + 4)?.closest(
              '[data-column-turn]',
            ) ?? null),
          newest: parent.closest('[data-column-turn][data-turn-newest]') !== null,
        });
      }
    }
    return { runs, width: cb.width, height: cb.height };
  });

/** Each drawn jump: its hit box, its painted skin, and what is on top of it. */
const jumpBoxes = () =>
  page.evaluate(() => {
    const col = document.querySelector('[data-detail-column]');
    const cb = col.getBoundingClientRect();
    const read = (selector) => {
      const el = document.querySelector(selector);
      if (el === null) return null;
      const box = el.getBoundingClientRect();
      const skinEl = el.firstElementChild;
      const skin = skinEl?.getBoundingClientRect() ?? null;
      // The icon inside the skin: a skin that does not contain its own glyph
      // is the defect a hit-box assertion cannot see (a 44px box can clear
      // every touch rule while the visible chip clips the arrow inside it).
      const glyph = skinEl?.querySelector('svg')?.getBoundingClientRect() ?? null;
      const mid = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        x: box.left - cb.left,
        y: box.top - cb.top,
        right: box.right - cb.left,
        bottom: box.bottom - cb.top,
        w: box.width,
        h: box.height,
        skin:
          skin === null
            ? null
            : { w: skin.width, h: skin.height, x: skin.left - cb.left, y: skin.top - cb.top },
        glyph:
          glyph === null
            ? null
            : {
                fits:
                  glyph.left >= skin.left - 0.5 &&
                  glyph.right <= skin.right + 0.5 &&
                  glyph.top >= skin.top - 0.5 &&
                  glyph.bottom <= skin.bottom + 0.5,
              },
        // Hit-testable AND fully painted: a control that is present must be
        // neither a dimmed decoration nor an invisible click target.
        onTop: mid?.closest('[data-out-to-top], [data-out-to-bottom]') === el,
        opacity: Number(getComputedStyle(el).opacity) * Number(getComputedStyle(skinEl).opacity),
        // In the scroller's flow it would ride the transcript out of frame.
        insideScroller: el.closest('[data-detail-column]') !== null,
      };
    };
    const pill = document.querySelector('[data-view-overlay]')?.getBoundingClientRect() ?? null;
    return {
      top: read('[data-out-to-top]'),
      bottom: read('[data-out-to-bottom]'),
      pill:
        pill === null
          ? null
          : {
              x: pill.left - cb.left,
              y: pill.top - cb.top,
              right: pill.right - cb.left,
              bottom: pill.bottom - cb.top,
            },
      colWidth: cb.width,
    };
  });

const overlaps = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;

// AT THE TWO ENDS AND THROUGH THE MIDDLE. The rule each jump is drawn under is
// "only while it would actually move the column", so the ends are where that
// rule is provable and the middle is where both are drawn at once.
const ends = await metrics();
const endScroll = ends.scrollHeight - ends.clientHeight;
const offsets = [0, Math.round(endScroll * 0.25), Math.round(endScroll * 0.5),
  Math.round(endScroll * 0.75), endScroll];
let sawBoth = 0;
let sawGap = Number.POSITIVE_INFINITY;
for (const offset of offsets) {
  await column.evaluate((el, top) => {
    el.scrollTop = top;
  }, offset);
  await page.waitForTimeout(150);
  const boxes = await jumpBoxes();
  const drawn = [
    ['to-top', boxes.top],
    ['to-bottom', boxes.bottom],
  ].filter(([, box]) => box !== null);
  // A CONTROL THAT SCROLLS NOWHERE IS WORSE THAN NO CONTROL -- the rule the
  // deleted bar already got right, kept.
  check(
    `at scrollTop ${offset}, only the jumps that would move the column are drawn`,
    (boxes.top !== null) === offset > 24 &&
      (boxes.bottom !== null) === endScroll - offset > 24,
    `top=${boxes.top !== null} bottom=${boxes.bottom !== null} of ${endScroll}`,
  );
  if (drawn.length === 2) sawBoth += 1;

  for (const [name, box] of drawn) {
    // 44x44 is WCAG 2.2 SC 2.5.5 and this pane is the phone's session screen.
    check(
      `${name} at ${offset}: the hit box clears 44x44`,
      box.w >= 44 && box.h >= 44,
      `${Math.round(box.w)}x${Math.round(box.h)}`,
    );
    // AND THE PAINT IS ITS OWN, SMALLER BOX -- with the glyph inside it. Every
    // touch assertion in this repo checks the hit box; none checked whether
    // the visible skin fits what it draws, and that is how a chip ships with
    // its arrow clipped.
    check(
      `${name} at ${offset}: the painted skin is smaller than the hit box, and holds its glyph`,
      box.skin !== null &&
        box.skin.w >= 20 &&
        box.skin.w < box.w &&
        box.skin.h < box.h &&
        box.glyph?.fits === true,
      JSON.stringify({ skin: box.skin, glyph: box.glyph }),
    );
    // PRESENT MEANS FULLY VISIBLE AND FULLY CLICKABLE. There is no fade here
    // on purpose: mid-transition a control is either half-painted and live or
    // painted and inert, and both are states this pane must not have.
    check(
      `${name} at ${offset}: fully opaque and on top at its own centre`,
      box.onTop && box.opacity === 1,
      JSON.stringify({ onTop: box.onTop, opacity: box.opacity }),
    );
    check(`${name} at ${offset}: floats over the scroller rather than in it`, !box.insideScroller);
  }

  // THE RESERVED CORNER (audit F1), which the top jump inherits: the view-icon
  // pill is opaque and floats at the pane's top right, so a jump placed at the
  // column's own top right would sit under it.
  if (boxes.top !== null && boxes.pill !== null) {
    check(
      `at ${offset}, the top jump clears the view-icon pill`,
      !overlaps(boxes.top, boxes.pill),
      `jump ${JSON.stringify(boxes.top)} vs pill ${JSON.stringify(boxes.pill)}`,
    );
  }

  // AND NOW THE POINT: not one glyph under either of them.
  const { runs } = await textRuns();
  for (const [name, box] of drawn) {
    const covered = runs.filter((run) => overlaps(box, run));
    check(
      `at ${offset}, ${name} covers no text in the column`,
      covered.length === 0,
      covered
        .slice(0, 3)
        .map((c) => `${c.block}${c.pinned ? ' (PINNED)' : ''} ${JSON.stringify(c.text)}`)
        .join(' ; '),
    );
    // Named separately, because these two are the ones the overlay owes its
    // clearance to by name: the prompt pinned at the top of the column, and
    // the newest answer, which is what the operator came to read.
    const pinned = covered.filter((c) => c.pinned && c.block === 'in');
    const newestOut = covered.filter((c) => c.newest && c.block === 'out');
    check(
      `at ${offset}, ${name} covers neither the pinned prompt nor the newest answer`,
      pinned.length === 0 && newestOut.length === 0,
      `${pinned.length} pinned-prompt runs, ${newestOut.length} newest-answer runs`,
    );
    const gap = Math.min(...runs.map((run) => box.x - run.right));
    if (Number.isFinite(gap)) sawGap = Math.min(sawGap, gap);
  }
}
check('both jumps were on screen together at some offset', sawBoth >= 1, `${sawBoth} offsets`);
console.log(`  narrowest gap between a text run and a jump's hit box: ${Math.round(sawGap)}px`);
// THE GUTTER IS THE MECHANISM, and this is what makes the checks above a
// property rather than a coincidence of this fixture: the column reserves the
// strip, so the nearest a glyph can come to a jump is the reservation itself.
// A negative number here would mean text ran under a control; a large positive
// one would mean the reservation is wider than the control it is for.
check(
  'the reserved strip is what keeps them clear, not luck',
  sawGap >= 0 && sawGap < 32,
  `${Math.round(sawGap)}px`,
);

// ------------------------------------------------------------- 7. SCREENSHOTS
//
// TAKEN BEFORE THE PICKER IS TOUCHED. The checks below open the turn list and
// leave the column marking its OLDEST turn, which is a state a check asked for
// and not one the pane rests in -- a screenshot of it would be a picture of the
// test rather than of the feature.
await column.evaluate((el) => {
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/transcript-column-bottom.png` });
console.log(`${outDir}/transcript-column-bottom.png`);
await column.evaluate((el) => {
  el.scrollTop = Math.round(el.scrollHeight * 0.35);
});
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/transcript-column-scrolled.png` });
console.log(`${outDir}/transcript-column-scrolled.png`);
await column.evaluate((el) => {
  el.scrollTop = 0;
});
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/transcript-column-top.png` });
console.log(`${outDir}/transcript-column-top.png`);

// ------------------------------------- 8. A JUMP MOVES, AND HIDES NOTHING
//
// WAS: `'PICKING SCROLLS, NEVER HIDES'`, driven through the turn list the
// column's bar opened. `selectedId` used to swap WHICH turn was drawn, and
// that list was how you asked it to; both the list and the bar are gone, and
// the fact they were protecting is the column's, not the control's -- moving
// to a turn must move the column and hide nothing.
//
// So it is driven through the control that is left, which is the same claim
// with one fewer indirection: the top jump takes the column to the oldest turn
// vam read, and every turn is still there when it arrives.
await column.evaluate((el) => {
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(200);
check('at the bottom, only the jump that would move is offered', {
  top: (await page.locator(jumpTop).count()) === 1,
  bottom: (await page.locator(jumpBottom).count()) === 0,
}.top);
await page.locator(jumpTop).click();
await page.waitForTimeout(250);
const jumped = await metrics();
check('the top jump takes the column to its own top', jumped.scrollTop === 0, `${jumped.scrollTop}`);
check(
  'and hides nothing on the way',
  (await turns.count()) === DEMO_TURNS,
  `${await turns.count()} left`,
);
check(
  'and the boundary that says what the top IS is what is on screen there',
  (await page.locator('[data-column-start]').boundingBox()).y >= 0,
);
// AND BACK, which is the half the old sticky bar existed for: a reader far up
// must not have to scroll down to find the control that scrolls them down.
check(
  'at the top, the other jump is the one offered',
  (await page.locator(jumpTop).count()) === 0 &&
    (await page.locator(jumpBottom).count()) === 1,
);
await page.locator(jumpBottom).click();
await page.waitForTimeout(250);
const returned = await metrics();
check(
  'the bottom jump takes it back to the newest turn',
  returned.scrollHeight - returned.clientHeight - returned.scrollTop <= 24,
  `resting at ${returned.scrollTop} of ${returned.scrollHeight - returned.clientHeight}`,
);

// ------------------------------------------------------------ 9. ONE SCROLLER
//
// #266's property, kept: nothing inside the column may own a scrollbar except
// the prompt bubbles, which is the bound that makes the pin a pin.
const nested = await page.evaluate(() =>
  [...document.querySelector('[data-detail-column]').querySelectorAll('*')]
    .filter((el) => el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0)
    .filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
    .filter((el) => el.closest('[data-progress-turns]') === null)
    .map((el) => el.getAttribute('data-detail-scroll') ?? el.tagName),
);
check(
  'the only scrollers inside the column are the prompt bubbles',
  nested.every((name) => name === 'in'),
  nested.join(', '),
);

// -------------------------------------------------------------- 10. AT VOLUME
//
// 3,276 turns is not a hypothetical: it is `MAX_DECISIONS`, what the source
// hands over for a long-running session. The claim being held is that the pane
// still answers — it opens, and a scroll moves it — not that it is instant.
const volume = await browser.newPage({ viewport: { width: 1100, height: 620 } });
volume.on('pageerror', (err) => console.error('PAGE ERROR (volume):', err));
await volume.goto(`${origin}/?demo=1&turns=${MAX_DECISIONS}`, { waitUntil: 'networkidle' });
await volume.waitForSelector('[data-tab-strip]');
const openedAt = Date.now();
await volume.locator('[data-session-row="factory-sse-1"]').click();
await volume.waitForSelector('[data-column-turn]');
await volume.waitForFunction(
  (want) => document.querySelectorAll('[data-column-turn]').length >= want,
  Math.min(MAX_DECISIONS, 400),
  { timeout: 30_000 },
);
const openMs = Date.now() - openedAt;
const mounted = await volume.locator('[data-column-turn]').count();
console.log(`  ${MAX_DECISIONS} turns: ${mounted} mounted, first paint in ${openMs}ms`);
check(
  `opening a ${MAX_DECISIONS}-turn session takes under 5s`,
  openMs < 5_000,
  `${openMs}ms`,
);

// Still answering: a scroll moves it, and the frame after it is not a freeze.
const scrolledAt = Date.now();
await volume.locator('[data-detail-column]').evaluate((el) => {
  el.scrollTop = 0;
});
await volume.waitForTimeout(300);
const scrollMs = Date.now() - scrolledAt;
const volumeMetrics = await volume.locator('[data-detail-column]').evaluate((el) => ({
  scrollTop: el.scrollTop,
  scrollHeight: el.scrollHeight,
}));
console.log(`  scrolled to the top in ${scrollMs}ms: ${JSON.stringify(volumeMetrics)}`);
check(
  'and the column still answers a scroll at that size',
  volumeMetrics.scrollTop === 0 && scrollMs < 3_000,
  `${scrollMs}ms, ${JSON.stringify(volumeMetrics)}`,
);
// WHATEVER IS MOUNTED, THE COUNT IS HONEST. If the column caps what it mounts,
// the boundary at the top has to say so — a cap that silently drops turns is
// the same lie as a column that ends without saying why.
const volumeStart = volume.locator('[data-column-start]');
const volumeState = await volumeStart.getAttribute('data-column-start');
const volumeText = await volumeStart.innerText();
console.log(`  boundary at volume: ${volumeState} — ${JSON.stringify(volumeText)}`);
check(
  'the boundary names what is missing whenever anything is',
  mounted >= MAX_DECISIONS
    ? volumeState === 'read-limit'
    : volumeState === 'more-read' && /\d/.test(volumeText),
  `${mounted} of ${MAX_DECISIONS} mounted, boundary says ${volumeState}`,
);
await volume.screenshot({ path: `${outDir}/transcript-column-volume.png` });
console.log(`${outDir}/transcript-column-volume.png`);

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} column guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('transcript column guards: all assertions passed');
