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

// `history=off` FOR EVERYTHING BELOW, AND IT IS NOT A CONVENIENCE.
//
// Two reasons, and both of them are about what a check can honestly claim.
//
// FIRST, THE FIFTH ANSWER. `SessionSource.history` is OPTIONAL (`port.ts`), and
// every source vam assembles has it -- so the state where it is ABSENT, which
// the column has to draw as a stated refusal rather than as "there is nothing
// older", is one no shipped source can put on a screen. `history=off` is the
// only way it is reachable at all, and section 5 below is the only place in
// this repo it is measured in a real browser.
//
// SECOND, THE GEOMETRY. With a pager the column GROWS whenever anything scrolls
// near its top -- which sections 3, 5, 6 and 8 all do -- so offsets measured
// once would be walking a different column by the time they were used. Off, the
// fixture is the fixed seven turns these checks were written against. The
// pager's own behaviour is section 11, on its own page, where that growth is
// the subject rather than the noise.
await page.goto(`${origin}/?demo=1&history=off`, { waitUntil: 'networkidle' });
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
// ---------------- 5b. A SOURCE WITH NO PAGER SAYS SO, AND OFFERS NOTHING
//
// THE FIFTH ANSWER, and the only place it is drawable. `history` is optional on
// the port and present on every source vam assembles, so without `history=off`
// this state cannot be reached in a browser at all -- it would ship undrawn.
//
// The rule the block was written under is unchanged now that a control exists:
// ABSENT, NOT DIMMED. What changed is that the reason has to be SAID. A column
// that simply had no button would be indistinguishable from one whose source
// can page and has nothing more to give, which is the same confusion one level
// down from the boundary itself.
const more = page.locator('[data-column-more]');
check(
  'a source that cannot page says so where the column ends',
  (await more.count()) === 1 && (await more.getAttribute('data-column-more')) === 'unsupported',
  `data-column-more=${JSON.stringify(await more.getAttribute('data-column-more'))}`,
);
const moreText = ((await more.innerText()) ?? '').toLowerCase();
console.log(`  no-pager note: ${JSON.stringify(await more.innerText())}`);
check(
  'in words, not only in an attribute',
  /cannot read further back/.test(moreText),
  moreText,
);
// A control that cannot act must be absent, never dimmed -- and neither may a
// spinner stand in for a fetch that will never happen.
const startControls = await start.locator('button, [role="button"], [aria-busy]').count();
check('and offers no control it cannot honour', startControls === 0, `${startControls} found`);
// AND THE ABSENCE IS MEASURED AS AN ABSENCE, not inferred from a selector that
// might simply be wrong: the same selector finds the control on the page that
// HAS a pager (section 11), so a typo here would fail there.
check(
  'no read-earlier control anywhere in the pane',
  (await page.locator('[data-column-more-ask]').count()) === 0,
);

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
        // EFFECTIVE opacity, walked up the ancestors -- found by falsification:
        // an `opacity-50` on the LAYER these two sit in left every one of them
        // reporting 1 for itself, and the check passed over a pair of chips
        // painted at half strength. Opacity composites down the tree; a guard
        // that reads one node's own value is measuring the wrong thing.
        opacity: (() => {
          let composed = 1;
          for (let node = el; node !== null && node !== document.body; node = node.parentElement) {
            composed *= Number(getComputedStyle(node).opacity);
          }
          return composed * Number(getComputedStyle(skinEl).opacity);
        })(),
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

// AT TWO WIDTHS, AND THAT SECOND ONE IS NOT DECORATION -- IT IS WHAT MAKES
// THE OCCLUSION CHECKS BELOW MEAN ANYTHING.
//
// FOUND BY FALSIFICATION, which is the only way it could have been: with the
// reserved strip deleted outright, every "covers no text" check below still
// passed at 1100x620. At that width the demo's longest line breaks 45px short
// of the column's content edge, so the jumps were clear by luck and the guard
// was reporting the fixture rather than the fix. At 700x520 the same prose
// wraps to the edge exactly, so a missing reservation puts a glyph under a
// control. `filledTheWidth` below refuses to let that go unnoticed again: a
// sweep that proves nothing has to say so.
//
// AT THE TWO ENDS AND THROUGH THE MIDDLE. The rule each jump is drawn under is
// "only while it would actually move the column", so the ends are where that
// rule is provable and the middle is where both are drawn at once.
let sawBoth = 0;
let sawGap = Number.POSITIVE_INFINITY;
let filledTheWidth = 0;
for (const size of [
  { width: 1100, height: 620 },
  { width: 700, height: 520 },
]) {
  await page.setViewportSize(size);
  await page.waitForTimeout(200);
  const ends = await metrics();
  const endScroll = ends.scrollHeight - ends.clientHeight;
  const offsets = [
    0,
    Math.round(endScroll * 0.25),
    Math.round(endScroll * 0.5),
    Math.round(endScroll * 0.75),
    endScroll,
  ];
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
    // DID THE SWEEP FIND A CORPUS? A line that reaches the column's own
    // content edge is the only kind that can be covered, so at least one has
    // to have been measured or every check above is vacuous. Within 8px of the
    // edge, not exactly on it: prose wraps at word boundaries, and "this line
    // used all the width there was" is the fact, not a coincidence of where
    // the last space fell.
    const contentEdge = await column.evaluate(
      (el) => el.clientWidth - Number.parseFloat(getComputedStyle(el).paddingRight),
    );
    if (runs.some((run) => run.right >= contentEdge - 8)) filledTheWidth += 1;
  }
}
await page.setViewportSize({ width: 1100, height: 620 });
await page.waitForTimeout(200);
check(
  'at least one line was measured actually filling the column, or the sweep proves nothing',
  filledTheWidth >= 1,
  `${filledTheWidth} of the offsets swept had a line reaching the content edge`,
);
check('both jumps were on screen together at some offset', sawBoth >= 1, `${sawBoth} offsets`);
console.log(`  narrowest gap between a text run and a jump's hit box: ${Math.round(sawGap)}px`);
check('no glyph came nearer a jump than its own edge', sawGap >= 0, `${Math.round(sawGap)}px`);
// AND THE GUTTER IS THE MECHANISM, measured as itself rather than inferred
// from where this fixture's lines happened to break. The column's right
// padding is what stops a line before the jumps, so it has to be EXACTLY one
// hit box: narrower and text runs under a control, wider and the transcript
// gives up reading width for a strip nothing stands in. Read as resolved
// pixels, because `pr-11` is a class name and a class name is the guard that
// stays green while the padding resolves to nothing.
const gutter = await page.evaluate(() => {
  const col = document.querySelector('[data-detail-column]');
  return { padding: Number.parseFloat(getComputedStyle(col).paddingRight) };
});
const hitWidth = (await jumpBoxes()).bottom?.w ?? (await jumpBoxes()).top?.w ?? 0;
console.log(`  column reserves ${gutter.padding}px on the right; a jump is ${hitWidth}px wide`);
check(
  'the strip the jumps stand in is exactly one hit box wide',
  gutter.padding > 0 && Math.abs(gutter.padding - hitWidth) <= 0.5,
  `${gutter.padding}px reserved for a ${hitWidth}px control`,
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
//
// THIS PAGE KEEPS ITS PAGER, deliberately, and the assertion below had to be
// re-derived because of it: reaching the top is now also the gesture that asks
// for more, so the column does NOT rest at scrollTop 0 -- a page lands and the
// anchoring puts the reader back where they were, which is several hundred
// pixels down a 340,000px transcript. "It answers" is therefore measured as
// "it left the bottom", which is what the check was always about, plus the
// separate fact that anchoring works at this size too.
const heightBefore = await volume
  .locator('[data-detail-column]')
  .evaluate((el) => el.scrollHeight);
const scrolledAt = Date.now();
await volume.locator('[data-detail-column]').evaluate((el) => {
  el.scrollTop = 0;
});
await volume.waitForTimeout(600);
const scrollMs = Date.now() - scrolledAt;
const volumeMetrics = await volume.locator('[data-detail-column]').evaluate((el) => ({
  scrollTop: el.scrollTop,
  scrollHeight: el.scrollHeight,
  clientHeight: el.clientHeight,
}));
console.log(`  scrolled to the top in ${scrollMs}ms: ${JSON.stringify(volumeMetrics)}`);
check(
  'and the column still answers a scroll at that size',
  volumeMetrics.scrollTop < volumeMetrics.scrollHeight - volumeMetrics.clientHeight - 1_000 &&
    scrollMs < 3_000,
  `${scrollMs}ms, ${JSON.stringify(volumeMetrics)}`,
);
// AND THE ARITHMETIC IS THE SAME AT 3,276 TURNS AS AT SEVEN: whatever the
// column grew by is what the offset moved by, to the pixel.
const volumeGrew = volumeMetrics.scrollHeight - heightBefore;
console.log(
  `  at volume: scrollHeight grew ${volumeGrew}px, offset restored to ${Math.round(volumeMetrics.scrollTop)}`,
);
check(
  'a page landing at volume moves the offset by exactly what it added',
  volumeGrew > 0 && Math.abs(volumeMetrics.scrollTop - volumeGrew) <= 2,
  `grew ${volumeGrew}, offset ${Math.round(volumeMetrics.scrollTop)}`,
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

// --------------------------------------------------- 11. READING FURTHER BACK
//
// The other half of the operator's sentence: "load more when scrolling up".
// PR 284 built the column and said at its top edge that this was as far back as
// vam had READ; PR 283 built the pager. This section is the join, and it is
// here rather than in a unit test because every fact it holds is a layout fact:
// what `scrollHeight` did, where an element ended up, whether the turn under
// the reader's eye moved.
//
// ITS OWN PAGE, and that is load-bearing twice over. The demo's pager is a
// scripted sequence held in a closure (`fixtures/demo-history.ts`), so it must
// start at step one; and the column above is measured at a fixed seven turns,
// which paging would break.
const back = await browser.newPage({ viewport: { width: 1100, height: 620 } });
back.on('pageerror', (err) => console.error('PAGE ERROR (read-back):', err));
back.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR (read-back):', msg.text());
});
await back.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await back.waitForSelector('[data-tab-strip]');
await back.locator('[data-session-row="factory-sse-1"]').click();
await back.waitForSelector('[data-detail-column]');

/** Everything the boundary block and the column are saying, in one read. */
const columnState = () =>
  back.evaluate(() => {
    const col = document.querySelector('[data-detail-column]');
    const boundary = document.querySelector('[data-column-start]');
    const offer = document.querySelector('[data-column-more]');
    const ids = [...col.querySelectorAll('[data-column-turn]')].map((el) =>
      el.getAttribute('data-column-turn'),
    );
    return {
      scrollTop: col.scrollTop,
      scrollHeight: col.scrollHeight,
      start: boundary?.getAttribute('data-column-start') ?? null,
      more: offer?.getAttribute('data-column-more') ?? null,
      moreText: (offer?.textContent ?? '').trim(),
      askLabel: document.querySelector('[data-column-more-ask]')?.textContent ?? null,
      counted: Number(
        /^\d+/.exec(document.querySelector('[data-progress-count]')?.textContent ?? '')?.[0] ?? -1,
      ),
      ids,
      duplicates: ids.length - new Set(ids).size,
    };
  });

/**
 * Take the column to its top AND, IN THE SAME TASK, record where the oldest
 * turn currently sits.
 *
 * ONE `evaluate`, and it is the whole of why this measurement means anything.
 * Setting `scrollTop` and reading the rect in separate round trips leaves a
 * window in which the fetch can resolve and the turns can land, so the "before"
 * would already be the "after" and a broken anchor would read as a perfect one.
 * A scroll handler cannot run between two statements of one synchronous block.
 */
const toTopAndMark = () =>
  back.evaluate(() => {
    const col = document.querySelector('[data-detail-column]');
    col.scrollTop = 0;
    const oldest = col.querySelector('[data-column-turn]');
    return {
      id: oldest?.getAttribute('data-column-turn') ?? null,
      top: oldest.getBoundingClientRect().top - col.getBoundingClientRect().top,
      scrollTop: col.scrollTop,
      scrollHeight: col.scrollHeight,
      turns: col.querySelectorAll('[data-column-turn]').length,
    };
  });

/** Where a turn sits now, in the column's own coordinates. */
const markNow = (id) =>
  back.evaluate((want) => {
    const col = document.querySelector('[data-detail-column]');
    const el = col.querySelector(`[data-column-turn="${want}"]`);
    return {
      top: el === null ? null : el.getBoundingClientRect().top - col.getBoundingClientRect().top,
      scrollTop: col.scrollTop,
      scrollHeight: col.scrollHeight,
      turns: col.querySelectorAll('[data-column-turn]').length,
    };
  }, id);

const opening = await columnState();
console.log(`  read-back opens: ${opening.ids.length} turns, boundary ${opening.start}/${opening.more}`);
check(
  'a source that CAN page offers a control at the top of the column',
  opening.more === 'available' && opening.askLabel !== null,
  JSON.stringify({ more: opening.more, ask: opening.askLabel }),
);
check(
  'and still refuses to claim the session began there',
  opening.start === 'read-limit',
  opening.start,
);

// ------------------ 11a. ANSWER ONE: A PAGE OF TURNS, AND NOBODY MOVED
//
// THE DEFECT EVERY INFINITE SCROLL SHIPS, measured rather than asserted. A
// scroll offset is measured from the top of the content, so anything inserted
// ABOVE the viewport moves what the reader is looking at down by exactly its
// own height. The browser's own CSS scroll anchoring does not save this: it is
// suppressed while a scroller sits at its top, which is the one place this
// feature is ever used from.
//
// TWO NUMBERS, because either alone can be satisfied by doing nothing:
//   - the column GREW, so turns really did land above the viewport;
//   - the turn that was at the top edge is still at the same pixel.
const beforeFirst = await toTopAndMark();
await back.waitForFunction(
  (had) => document.querySelectorAll('[data-column-turn]').length > had,
  beforeFirst.turns,
  { timeout: 10_000 },
);
await back.waitForTimeout(150);
const afterFirst = await markNow(beforeFirst.id);
const grewFirst = afterFirst.scrollHeight - beforeFirst.scrollHeight;
const driftFirst = afterFirst.top - beforeFirst.top;
console.log(
  `  scrolling to the top read back ${afterFirst.turns - beforeFirst.turns} turns: ` +
    `scrollHeight ${Math.round(beforeFirst.scrollHeight)} -> ${Math.round(afterFirst.scrollHeight)} ` +
    `(+${Math.round(grewFirst)}px), offset ${Math.round(beforeFirst.scrollTop)} -> ${Math.round(afterFirst.scrollTop)}, ` +
    `turn ${beforeFirst.id} drifted ${driftFirst.toFixed(2)}px`,
);
check(
  'scrolling to the top of the column reads earlier turns in',
  afterFirst.turns > beforeFirst.turns && grewFirst > 100,
  `${beforeFirst.turns} -> ${afterFirst.turns} turns, +${Math.round(grewFirst)}px`,
);
check(
  'and the turn the reader was looking at did not move',
  Math.abs(driftFirst) <= 2,
  `drifted ${driftFirst.toFixed(2)}px while the column grew ${Math.round(grewFirst)}px`,
);
check(
  'because the offset was moved by exactly what was added',
  Math.abs(afterFirst.scrollTop - (beforeFirst.scrollTop + grewFirst)) <= 2,
  `offset ${Math.round(afterFirst.scrollTop)}, expected ${Math.round(beforeFirst.scrollTop + grewFirst)}`,
);
const afterFirstState = await columnState();
check(
  'the turns read back are ABOVE the ones already drawn, oldest at the top',
  afterFirstState.ids.slice(-opening.ids.length).join('|') === opening.ids.join('|'),
  `${afterFirstState.ids.slice(0, 4).join(', ')} … `,
);
check('and no turn is drawn twice', afterFirstState.duplicates === 0, `${afterFirstState.duplicates}`);
check(
  'and the count says how many were read, not how many the tail holds',
  afterFirstState.counted === afterFirstState.ids.length,
  `${afterFirstState.counted} counted, ${afterFirstState.ids.length} drawn`,
);
check(
  'the boundary still says READ-SO-FAR while there is more',
  afterFirstState.start === 'read-limit' && afterFirstState.more === 'available',
  `${afterFirstState.start}/${afterFirstState.more}`,
);

// ---------------- 11b. ANSWER FOUR: A READ THAT FAILED, IN THE SOURCE'S WORDS
//
// The demo's second gesture walks a blank window and then meets a refusal
// (`fixtures/demo-history.ts` writes the sequence out). Both halves matter:
// the blank window must not have ended the column, and the refusal must not
// look like an ending either.
//
// `pull-requests.ts:12` is the rule being held: "'No PRs' and 'vam could not
// ask' must never look the same."
const beforeRefusal = await toTopAndMark();
// WAIT FOR THE STATE UNDER TEST, not for "not reading". Found by falsification:
// "not reading" is TRUE for the first frame after the scroll, before React has
// even rendered the in-flight state, so the check ran against the state the
// gesture started from and passed or failed on the wrong screen entirely.
await back.waitForFunction(
  () => document.querySelector('[data-column-more]')?.getAttribute('data-column-more') === 'unavailable',
  undefined,
  { timeout: 10_000 },
);
const refused = await columnState();
console.log(`  refusal: ${refused.start}/${refused.more} — ${JSON.stringify(refused.moreText)}`);
check(
  'a read that failed is drawn as a failure, not as an ending',
  refused.more === 'unavailable' && refused.start === 'read-limit',
  `${refused.start}/${refused.more}`,
);
check(
  "and it carries the SOURCE's own words, code and all",
  refused.moreText.includes('demo-read-refused') && refused.moreText.includes('ask again'),
  refused.moreText,
);
check(
  'it does not say the session begins here, in any words',
  !/begins here|beginning of|nothing before|no earlier/i.test(refused.moreText),
  refused.moreText,
);
check(
  'the turns already read back are still there after a failure',
  refused.ids.length === afterFirstState.ids.length,
  `${refused.ids.length} vs ${afterFirstState.ids.length}`,
);
check(
  'and a retry is offered, because the cursor did not move',
  refused.askLabel !== null,
  `${refused.askLabel}`,
);
void beforeRefusal;

// -------------------------- 11c. THE RETRY RECOVERS, AND STILL DOES NOT MOVE
//
// A retry that asks the same thing again is the whole reason the control is
// legitimate rather than decorative. The anchoring is measured across it too:
// this is the path where the block's own height changes as well (the failure
// message goes away), so it is the one most likely to jump.
const beforeRetry = await back.evaluate(() => {
  const col = document.querySelector('[data-detail-column]');
  const oldest = col.querySelector('[data-column-turn]');
  return {
    id: oldest.getAttribute('data-column-turn'),
    turns: col.querySelectorAll('[data-column-turn]').length,
  };
});
await back.locator('[data-column-more-ask]').click();
// THE IN-FLIGHT STATE, and it is only observable because the demo pager takes
// 150ms per ask on purpose (`fixtures/demo-history.ts` says why). A status
// line, and NO control: mid-flight a button is either painted and inert or
// half-painted and live, and both are states this pane must not have.
const inFlight = await back.evaluate(() => ({
  more: document.querySelector('[data-column-more]')?.getAttribute('data-column-more') ?? null,
  ask: document.querySelector('[data-column-more-ask]') === null ? 'absent' : 'present',
  said: document.querySelector('[data-column-more]')?.textContent?.trim() ?? '',
}));
console.log(`  in flight: ${JSON.stringify(inFlight)}`);
check(
  'while a read is in flight the column says so',
  inFlight.more === 'reading' && /reading/i.test(inFlight.said),
  JSON.stringify(inFlight),
);
check(
  'and the control is ABSENT rather than dimmed',
  inFlight.ask === 'absent',
  inFlight.ask,
);
// AND A SECOND ASK CANNOT BE STARTED: scrolling hard at the top while one is
// running must neither fire a duplicate nor lose the gesture. Measured by the
// answer, which is the only honest place: exactly one page lands.
const markMid = await markNow(beforeRetry.id);
for (let i = 0; i < 6; i += 1) {
  await back.evaluate(() => {
    const col = document.querySelector('[data-detail-column]');
    col.scrollTop = 4;
    col.scrollTop = 0;
  });
}
await back.waitForFunction(
  (had) => document.querySelectorAll('[data-column-turn]').length > had,
  beforeRetry.turns,
  { timeout: 10_000 },
);
await back.waitForTimeout(400);
const afterRetry = await markNow(beforeRetry.id);
const retriedState = await columnState();
const grewRetry = afterRetry.scrollHeight - markMid.scrollHeight;
const driftRetry = afterRetry.top - markMid.top;
console.log(
  `  retry read back ${afterRetry.turns - beforeRetry.turns} turns while 6 scrolls were fired at it: ` +
    `scrollHeight ${Math.round(markMid.scrollHeight)} -> ${Math.round(afterRetry.scrollHeight)} ` +
    `(+${Math.round(grewRetry)}px), turn ${beforeRetry.id} drifted ${driftRetry.toFixed(2)}px`,
);
check(
  'the retry reads back exactly one page, however hard it is scrolled at',
  afterRetry.turns - beforeRetry.turns === 3,
  `${afterRetry.turns - beforeRetry.turns} turns arrived`,
);
check(
  'and the reader is still looking at the same pixel',
  Math.abs(driftRetry) <= 2,
  `drifted ${driftRetry.toFixed(2)}px while the column grew ${Math.round(grewRetry)}px`,
);
check('and still no turn is drawn twice', retriedState.duplicates === 0, `${retriedState.duplicates}`);

// ---------- 11d. ANSWER THREE: A WINDOW WITH NO WHOLE TURN IN IT IS NOT AN END
//
// The ORDINARY answer on a large session: at ~2.5 MB of transcript per turn,
// most 128 KiB windows hold no complete turn. The demo's fourth gesture is
// three of those in a row, which is `MAX_BLANK_STEPS`, so the walk stops with
// nothing to show — and the one thing it must not do is call that the end.
const beforeBlank = await columnState();
await back.locator('[data-column-more-ask]').click();
// IN, THEN OUT. Waiting only for "not reading" would pass on the frame before
// the walk had even started -- see 11b's own note.
await back.waitForFunction(
  () => document.querySelector('[data-column-more]')?.getAttribute('data-column-more') === 'reading',
  undefined,
  { timeout: 10_000 },
);
await back.waitForFunction(
  () => document.querySelector('[data-column-more]')?.getAttribute('data-column-more') !== 'reading',
  undefined,
  { timeout: 10_000 },
);
await back.waitForTimeout(200);
const blanked = await columnState();
console.log(
  `  three blank windows: ${blanked.ids.length} turns (was ${beforeBlank.ids.length}), ` +
    `boundary ${blanked.start}/${blanked.more}`,
);
check(
  'a gesture that found no whole turn adds none',
  blanked.ids.length === beforeBlank.ids.length,
  `${beforeBlank.ids.length} -> ${blanked.ids.length}`,
);
check(
  'and is NOT reported as the start of the session',
  blanked.start === 'read-limit',
  blanked.start,
);
check(
  'and still offers to go on, because there is more',
  blanked.more === 'available' && blanked.askLabel !== null,
  `${blanked.more} / ${blanked.askLabel}`,
);
check(
  'and does not spin: nothing is left in flight',
  blanked.more !== 'reading',
  blanked.more,
);

// ------------------- 11e. ANSWER TWO: THE START, DRAWN FOR THE FIRST TIME
//
// `session-start` was defined by PR 284 and deliberately never drawn: nothing
// vam read could prove it. `TranscriptPage.reachedStart` is that proof, read
// off a window that really began at byte 0 — never inferred from a short page.
await back.locator('[data-column-more-ask]').click();
await back.waitForFunction(
  () => document.querySelector('[data-column-start]')?.getAttribute('data-column-start') === 'session-start',
  undefined,
  { timeout: 10_000 },
);
await back.waitForTimeout(200);
const atStart = await columnState();
console.log(`  at the start: ${atStart.ids.length} turns, boundary ${JSON.stringify(atStart.moreText)}`);
console.log(`  boundary text: ${JSON.stringify(await back.locator('[data-column-start]').innerText())}`);
check(
  'reaching the beginning is drawn as the beginning',
  atStart.start === 'session-start',
  atStart.start,
);
const startedText = (await back.locator('[data-column-start]').innerText()).toLowerCase();
check(
  'in words, not only in an attribute',
  /begins here/.test(startedText),
  startedText,
);
check(
  'and it no longer says "as far back as vam has read", which is now the wrong sentence',
  !/as far back as/.test(startedText),
  startedText,
);
// NOTHING LEFT TO ASK FOR MEANS NOTHING TO ASK WITH. Not a dimmed button, not
// a button that answers "no more" — absent.
check(
  'the control is gone once there is nothing left to read',
  (await back.locator('[data-column-more-ask]').count()) === 0 &&
    (await back.locator('[data-column-more]').count()) === 0,
);
check(
  'every turn the source had is on screen, exactly once',
  atStart.duplicates === 0 && atStart.ids.length === DEMO_TURNS + 8,
  `${atStart.ids.length} turns, ${atStart.duplicates} duplicated`,
);
check(
  'and the count agrees with the column',
  atStart.counted === atStart.ids.length,
  `${atStart.counted} counted, ${atStart.ids.length} drawn`,
);
// AND IT STAYS. A source at its start must not be asked again on the next
// scroll, which would be a request loop nobody can see.
await back.evaluate(() => {
  const col = document.querySelector('[data-detail-column]');
  col.scrollTop = 40;
  col.scrollTop = 0;
});
await back.waitForTimeout(400);
const settled = await columnState();
check(
  'scrolling at a column that has reached its start asks for nothing',
  settled.start === 'session-start' && settled.ids.length === atStart.ids.length,
  `${settled.start}, ${settled.ids.length} turns`,
);

await back.evaluate(() => {
  const col = document.querySelector('[data-detail-column]');
  col.scrollTop = 0;
});
await back.waitForTimeout(200);
await back.screenshot({ path: `${outDir}/transcript-column-read-back.png` });
console.log(`${outDir}/transcript-column-read-back.png`);

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} column guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('transcript column guards: all assertions passed');
