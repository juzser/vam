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
const turnOffsets = await column.evaluate((el) =>
  [...el.querySelectorAll('[data-column-turn]')].map((a) => ({
    id: a.getAttribute('data-column-turn'),
    top: a.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop,
  })),
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
  if (turn.top > maxScroll) continue;
  walked += 1;
  const at = await pinnedAt(turn.top);
  seenPinned.add(at.pinned);
  console.log(`  at turn ${turn.id} (scrollTop ${Math.round(turn.top)}): pinned ${at.pinned}`);
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

// -------------------------------------------- 6. PICKING SCROLLS, NEVER HIDES
//
// `selectedId` used to swap WHICH turn was drawn. In a column that is the
// wrong verb: the others must stay, the column must move, and the picked turn
// must be marked or "where am I" has no answer.
await page.locator('[data-progress-expand]').click();
await page.waitForTimeout(150);
const rows = page.locator('[data-progress-turn]');
check(`the turn list opens with all ${DEMO_TURNS}`, (await rows.count()) === DEMO_TURNS);
await rows.first().click();
await page.waitForTimeout(250);
check(
  'picking the oldest turn hides nothing',
  (await turns.count()) === DEMO_TURNS,
  `${await turns.count()} left`,
);
const landed = await page.evaluate(() => {
  const col = document.querySelector('[data-detail-column]');
  const marked = col.querySelector('[data-column-turn][data-turn-current="true"]');
  if (marked === null) return { marked: null };
  return {
    marked: marked.getAttribute('data-column-turn'),
    offset:
      marked.getBoundingClientRect().top - col.getBoundingClientRect().top,
    input: marked.querySelector('[data-detail-scroll="in"]')?.textContent ?? '',
  };
});
console.log(`  picked: ${JSON.stringify({ ...landed, input: landed.input?.slice(0, 40) })}`);
check('the picked turn is MARKED in the column', landed.marked !== null, JSON.stringify(landed));
check(
  'and the column scrolled to it',
  landed.offset !== undefined && Math.abs(landed.offset) <= 6,
  `${landed.offset}px from the top of the column`,
);
check(
  'and it is the turn that was picked',
  (landed.input ?? '').includes(OLDEST_INPUT),
  JSON.stringify((landed.input ?? '').slice(0, 60)),
);

// ------------------------------------------------------------ 7. ONE SCROLLER
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

// ------------------------------------------------------------- 8. SCREENSHOTS
//
// With the turn list put back away: it is a control the checks above opened,
// not the resting state of the pane, and a screenshot of it says nothing about
// the column.
await page.locator('[data-progress-expand]').click();
await page.waitForTimeout(150);
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

// --------------------------------------------------------------- 9. AT VOLUME
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
