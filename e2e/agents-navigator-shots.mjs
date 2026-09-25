/**
 * THE AGENTS TAB AS A NAVIGATOR, MEASURED IN A REAL BROWSER.
 *
 * Operator: "show the agent list on the left as a secondary navigator inside
 * the agents pane, on the right the detail of what that subagent is doing,
 * with in/out/progress."
 *
 * ── WHY A GUARD AND NOT ONLY UNIT TESTS ───────────────────────────────────
 * `test/panels/DetailPanel.test.tsx` holds what is in the DOM: which rows
 * exist, which is selected, which sentence the detail shows. It cannot see the
 * one thing this layout IS, and the failure mode is specific and has already
 * shipped in this repo once -- a selector that was typed, matched nothing, and
 * stayed live through review and merge.
 *
 *  1. THE CONTAINER QUERY EITHER EXISTS OR IT DOES NOT. The split is
 *     `@min-[420px]:flex-row` inside an `@container`, and Tailwind generates a
 *     class only if it finds the literal string in the source. An interpolated
 *     class name, a variant on the container itself rather than a descendant,
 *     a missing `@container` -- each produces markup that reads correct in
 *     jsdom and paints one column at every width. Only geometry answers it.
 *  2. AND IT IS THE PANE'S WIDTH, NOT THE WINDOW'S. The detail pane is
 *     resizable between 320 and 520, so a desktop pane can be narrower than a
 *     phone. A viewport query would be right in the test and wrong in use;
 *     this drives the real resize handle and measures what moves.
 *  3. THE DRILL-IN HAS A WAY BACK. Below the split the detail takes the pane,
 *     so the list is off screen and `data-agent-back` is the only way to it.
 *     A control that is `display:none` at the width where it is needed is a
 *     dead end no unit test would notice.
 */

import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** `factory-sse-1` in `src/renderer/fixtures/demo.ts` — the only session a
 *  screenshot may show (`demo-history.ts` says why). */
const SESSION = 'factory-sse-1';
/** `AGENT_SPLIT_PX` in `src/renderer/panels/DetailPanel.tsx`. */
const SPLIT = 420;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

const failures = [];
/** Collect rather than throw on the first: one run reports every fault. */
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

// PINNED TO `needs-you`, DELIBERATELY. `factory-sse-1` must be the sidebar's
// first entry for the app to auto-select it with no explicit row click --
// true under `needs-you`, the order this file was measured against, but not
// under `Created` (the shipped default since the sort-by-created feature),
// which sorts the demo fixture's `createdAt`-less sessions alphabetically by
// id instead. Seeded before the only navigation, same seam
// `split-panes-shots.mjs` and `view-width-shots.mjs` pin it with.
await page.addInitScript(() => {
  globalThis.localStorage.setItem(
    'vam.prefs.v1',
    JSON.stringify({
      viewOptions: { groupBy: 'project', sortBy: 'needs-you' },
      sortByMigrated: true,
    }),
  );
});

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-column-turn]');

// Open the pane's Agents tab.
await page.click('[data-view="agents"]');
await page.waitForSelector('[data-agents]');

// ── THE CORPUS, FIRST ─────────────────────────────────────────────────────
// Every claim below is about elements this fixture produces. A guard that
// found none would report nothing wrong forever — the failure this repo has
// already shipped once, where four sweeps ran green having examined zero files.
const corpus = await page.evaluate(() => ({
  rows: document.querySelectorAll('[data-agent-row]').length,
  list: document.querySelectorAll('[data-agents-list]').length,
  detail: document.querySelectorAll('[data-agent-detail]').length,
  empty: document.querySelector('[data-agents-empty]')?.textContent ?? null,
}));
console.log(`  agents pane: ${corpus.rows} rows, ${corpus.list} list, ${corpus.detail} detail`);
check('the demo session has a roster at all', corpus.rows >= 2, `${corpus.rows} rows`);
check(
  'and the tab is not drawing the no-surface sentence over it',
  corpus.empty === null,
  corpus.empty ?? '',
);

/** Where a selector's box is, or null. Read in the page, so it is real layout. */
const boxOf = (selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const visible = getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0;
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), visible };
  }, selector);

/** How wide the Agents pane itself is, right now. */
const paneWidth = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-agents]');
    return el === null ? null : Math.round(el.getBoundingClientRect().width);
  });

/**
 * Narrow the PANE while leaving the WINDOW wide, by dragging the sidebar.
 *
 * THIS IS THE WHOLE POINT OF THE GUARD. A viewport media query and a container
 * query behave identically when you resize the window, so a guard that only
 * resized the window could not tell them apart -- and the wrong one of the two
 * is wrong exactly here: the detail pane is resizable between 320 and 520, so
 * it can be narrower than a phone screen while the window is enormous. The
 * sidebar's own handle is what produces that state, and `SIDEBAR_MAX` (480) is
 * how far it goes.
 */
async function dragSidebar(byPx) {
  const handle = await page.$('[data-pane-resize-handle="sidebar"]');
  if (handle === null) throw new Error('no sidebar resize handle to drag');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + byPx, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(60);
}

// ── 1. WIDE: THE LIST AND THE DETAIL SIT SIDE BY SIDE ─────────────────────
const wide = await paneWidth();
console.log(`  pane at ${wide}px, window 1280px`);
check('the pane starts wider than the split', wide !== null && wide > SPLIT, `${wide}px`);
const wideList = await boxOf('[data-agents-list]');
const wideDetail = await boxOf('[data-agent-detail]');
check('the list is on screen at the wide pane', wideList?.visible === true);
check('and the detail is beside it, not under it', wideDetail?.visible === true);
check(
  'and they really are SIDE BY SIDE — the detail starts right of the list',
  wideList !== null && wideDetail !== null && wideDetail.x >= wideList.x + wideList.w - 2,
  wideList === null || wideDetail === null
    ? 'one of them is missing'
    : `list x=${wideList.x} w=${wideList.w}, detail x=${wideDetail.x}`,
);
check(
  'and neither has been squeezed to nothing',
  wideList !== null && wideDetail !== null && wideList.w >= 120 && wideDetail.w >= 200,
  wideList === null || wideDetail === null ? '' : `list ${wideList.w}px, detail ${wideDetail.w}px`,
);
await page.screenshot({ path: `${outDir}/agents-navigator-wide.png` });

// ── 2. NARROW: ONE COLUMN, AND THE LIST HAS THE PANE ──────────────────────
// The container query's whole claim. If it never fired, this is identical to
// the measurement above and the check below fails.
// Window stays 1280. Only the pane shrinks.
await page.setViewportSize({ width: 880, height: 820 });
await dragSidebar(240);
const narrow = await paneWidth();
const windowWidth = await page.evaluate(() => window.innerWidth);
console.log(`  pane at ${narrow}px inside a ${windowWidth}px window (split is ${SPLIT})`);
check(
  'the pane is now BELOW the split while the window is well above it',
  narrow !== null && narrow < SPLIT && windowWidth > SPLIT + 200,
  `pane ${narrow}px, window ${windowWidth}px`,
);
const narrowList = await boxOf('[data-agents-list]');
const narrowDetail = await boxOf('[data-agent-detail]');
check('the list still has the pane below the split', narrowList?.visible === true);
check(
  'and the detail is NOT drawn beside it — the query fired',
  narrowDetail === null || narrowDetail.visible === false,
  narrowDetail === null ? 'absent' : `visible at x=${narrowDetail.x} w=${narrowDetail.w}`,
);
await page.screenshot({ path: `${outDir}/agents-navigator-narrow.png` });

// ── 3. NARROW + PICKED: THE DETAIL TAKES THE PANE, WITH A WAY BACK ────────
await page.click('[data-agent-pick]');
await page.waitForTimeout(60);
const pickedList = await boxOf('[data-agents-list]');
const pickedDetail = await boxOf('[data-agent-detail]');
const back = await boxOf('[data-agent-back]');
check(
  'picking an agent gives the detail the narrow pane',
  pickedDetail?.visible === true,
  pickedDetail === null ? 'absent' : `w=${pickedDetail.w}`,
);
check(
  'and the list yields it rather than sharing it',
  pickedList === null || pickedList.visible === false,
  pickedList === null ? 'absent' : `still visible w=${pickedList.w}`,
);
check(
  'and the way back is ON SCREEN, which is the whole of the way back',
  back?.visible === true,
  back === null ? 'absent' : `visible=${back.visible}`,
);
const backText = await page.evaluate(
  () => document.querySelector('[data-agent-back]')?.textContent?.trim() ?? '',
);
check(
  'and it is named for where it goes, not for its container',
  /agents/i.test(backText),
  JSON.stringify(backText),
);

// ── AND THE DETAIL SHOWS THE AGENT'S OWN WORK, NOT THE NO-SURFACE REFUSAL ──
// This is the defect a screenshot caught, not a failing gate: before
// `fixtures/demo-agent-work.ts` existed, EVERY pick drew "this source cannot
// report what a session's agents are doing" -- the sentence reserved for a
// source with no agent surface at all, which was never true of the demo. The
// checks above only ever asked where boxes sit; they passed while the pane
// was contradicting itself. This asks what is actually written inside one.
await page.waitForSelector('[data-agent-turn]', { timeout: 2000 }).catch(() => {});
const detailText = await page.evaluate(
  () => document.querySelector('[data-agent-detail]')?.textContent ?? '',
);
check(
  'the picked agent shows its OWN work, not the no-surface refusal',
  detailText.trim().length > 0 && !/cannot report/i.test(detailText),
  JSON.stringify(detailText).slice(0, 160),
);
const pickedTurns = await page.evaluate(
  () => document.querySelectorAll('[data-agent-detail] [data-agent-turn]').length,
);
check('and at least one turn of that work is actually drawn', pickedTurns > 0, `${pickedTurns} turns`);

await page.screenshot({ path: `${outDir}/agents-navigator-narrow-picked.png` });

// Pressing it returns to the list.
await page.click('[data-agent-back]');
await page.waitForTimeout(60);
const afterBack = await boxOf('[data-agents-list]');
check('and pressing it puts the list back', afterBack?.visible === true);

// ── 4. WIDE + PICKED: THE LIST STAYS, BECAUSE IT IS A NAVIGATOR ───────────
await page.setViewportSize({ width: 1280, height: 820 });
await dragSidebar(-240);
await page.click('[data-agent-pick]');
await page.waitForTimeout(60);
const stayList = await boxOf('[data-agents-list]');
const stayDetail = await boxOf('[data-agent-detail]');
const stayBack = await boxOf('[data-agent-back]');
check(
  'the list stays beside the detail once something is picked',
  stayList?.visible === true && stayDetail?.visible === true,
  `list=${stayList?.visible} detail=${stayDetail?.visible}`,
);
check(
  'and the way back is withdrawn where the list is already on screen',
  stayBack === null || stayBack.visible === false,
  stayBack === null ? 'absent' : 'still drawn',
);
const selected = await page.evaluate(
  () => document.querySelectorAll('[data-agent-row][data-agent-selected="true"]').length,
);
check('and exactly one row says the detail is about it', selected === 1, `${selected} marked`);
await page.screenshot({ path: `${outDir}/agents-navigator-wide-picked.png` });

await browser.close();

if (failures.length > 0) {
  console.error(`\nagents-navigator: ${failures.length} failed.`);
  process.exit(1);
}
console.log('\nagents-navigator: every assertion passed.');
