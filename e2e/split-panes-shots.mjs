/**
 * Screenshots for A15.1 (split panes), A15.2 (shorter tab strip), A15.5
 * (one tab strip PER PANE), A15.7 (a remembered layout per project) and the
 * per-pane `+` that starts a session in the pane it belongs to, taken
 * off the WEB build with the demo fixture — the only thing safe to point a
 * public screenshot at (`?demo=1`, App.tsx's own rule). Modelled on
 * `pane-refinements-shots.mjs`.
 *
 * Run by hand; nothing runs it automatically:
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5511 --strictPort
 *   node e2e/split-panes-shots.mjs http://localhost:5511 docs/ui
 *
 * Every check here THROWS, naming what it expected: this script is the only
 * guard in the repo for the ordering React's eager-state path hides from
 * jsdom (see `splitFocused`'s own comment in `Canvas.tsx`), and a guard that
 * logged and carried on would be no guard at all.
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5511';
const outDir = process.argv[3] ?? 'docs/ui';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

async function paneCount() {
  return page.locator('[data-split-pane]').count();
}
async function stripCount() {
  return page.locator('[data-tab-strip]').count();
}
/**
 * A15.5 — the operator's report: "when a tab is split, its tab must sit on
 * the split side too — right now the tabs are still side by side". One strip
 * per pane is the fix, so the two counts must track each other, and every
 * strip must be INSIDE a pane rather than in a row above the layout.
 */
async function assertStripPerPane(label) {
  const panes = await paneCount();
  const stripsTotal = await stripCount();
  const stripsInPanes = await page.locator('[data-split-pane] [data-tab-strip]').count();
  console.log(`${label}: ${panes} pane(s), ${stripsTotal} strip(s), ${stripsInPanes} inside panes`);
  if (stripsTotal !== panes || stripsInPanes !== panes) {
    throw new Error(
      `${label}: ${panes} pane(s) but ${stripsTotal} tab strip(s) (${stripsInPanes} of them ` +
        'inside a pane). Every pane must draw its OWN strip, and no strip may sit outside one.',
    );
  }
}
/** The titles drawn by one pane's own strip, by pane index. */
async function tabsInPane(at) {
  return page.locator('[data-split-pane]').nth(at).locator('[data-tab-select]').allInnerTexts();
}
async function chord(a, b, label, expected) {
  await page.keyboard.press(a);
  await page.keyboard.press(b);
  await page.waitForTimeout(150);
  const n = await paneCount();
  console.log(`after ${a}${b} (${label}): ${n} pane(s)`);
  if (n !== expected) {
    throw new Error(
      `${a}${b} (${label}) left ${n} pane(s), expected ${expected}. This script is the only ` +
        'guard for the deferred-setState split bug — the jsdom suite cannot reproduce it ' +
        '(see the comment on splitFocused in Canvas.tsx).',
    );
  }
}

/** One pane's tab titles with the leading session glyph stripped. */
async function tabTitlesInPane(at) {
  const texts = await tabsInPane(at);
  return texts.map((text) => text.replace(/^[^\p{ASCII}]+\s*/u, '').trim());
}
/** The ids the sidebar lists, top to bottom — its canonical order. */
async function sidebarOrder() {
  return page.locator('[data-session-row]').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-session-row')),
  );
}

// --- The tab ORDER in a pane. The operator: "the way tabs are arranged in
// the pane still isn't right — when I focus a session in the sidebar, the
// tabs shown in the pane get jumbled." The strip drew the leaf's own
// `sessionIds`, which is the order the tabs were OPENED in, so the strip and
// the sidebar listed the same sessions two different ways.
//
// Opened here deliberately BACKWARDS — the done one first, the waiting one
// last — so insertion order and the sidebar's order are opposites and only
// one of them can be on screen. Asserted against the sidebar as it is
// actually drawn, never a hardcoded list: the point is that the two surfaces
// agree, not that either matches a sequence typed into this file.
await page.locator('[data-session-row="dogfood-4"]').click();
await page.waitForTimeout(150);
await page.locator('[data-session-row="crosscheck-2"]').click();
await page.waitForTimeout(150);
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForTimeout(150);
const stripOrder = await tabTitlesInPane(0);
const listOrder = (await sidebarOrder()).filter((id) => stripOrder.includes(id));
console.log('opened dogfood-4, crosscheck-2, factory-sse-1 — strip reads:', stripOrder);
console.log('the sidebar, narrowed to those three:', listOrder);
if (stripOrder.length !== 3) {
  throw new Error(
    `the pane should hold all three factory sessions as tabs, it holds ${stripOrder.length}: ` +
      `${stripOrder.join(', ')}.`,
  );
}
if (JSON.stringify(stripOrder) !== JSON.stringify(listOrder)) {
  throw new Error(
    `the pane's strip reads ${stripOrder.join(', ')} but the sidebar lists the same three as ` +
      `${listOrder.join(', ')}. A pane draws its tabs in the sidebar's order — two surfaces ` +
      'showing one set of sessions in two orders is the "jumbled" the operator reported.',
  );
}
await page.screenshot({ path: `${outDir}/pane-tab-order.png` });
console.log(`${outDir}/pane-tab-order.png`);

// Back to the two-tab shape the rest of this script is written against:
// drop dogfood-4's tab and leave crosscheck-2 in front.
await page.getByLabel('close dogfood-4 tab').click();
await page.waitForTimeout(150);
await page.locator('[data-session-row="crosscheck-2"]').click();
await page.waitForTimeout(150);
console.log('start panes:', await paneCount());
await assertStripPerPane('start');

// --- Shot 1: vertical split (zv) — a row, panes side by side.
await chord('z', 'v', 'split vertical', 2);
await assertStripPerPane('after zv');
// The new pane holds only the session it was split from; the source pane
// keeps its own two tabs. VSCode's "Split Right", and the whole of what the
// operator asked for made visible in one shot.
const [leftTabs, rightTabs] = [await tabsInPane(0), await tabsInPane(1)];
console.log('tabs per pane after zv:', leftTabs, rightTabs);
if (leftTabs.length !== 2 || rightTabs.length !== 1) {
  throw new Error(
    `after zv the source pane should keep its 2 tabs and the new pane hold 1, got ` +
      `${leftTabs.length} and ${rightTabs.length}.`,
  );
}
await page.screenshot({ path: `${outDir}/a15-5-split-vertical-tabs.png` });
console.log(`${outDir}/a15-5-split-vertical-tabs.png`);

// Back to one pane before the next shot, so each is the SAME starting shape.
await chord('z', 'c', 'close', 1);

// --- Shot 2: horizontal split (zs) — a column, panes stacked.
await chord('z', 's', 'split horizontal', 2);
await assertStripPerPane('after zs');
await page.screenshot({ path: `${outDir}/a15-5-split-horizontal-tabs.png` });
console.log(`${outDir}/a15-5-split-horizontal-tabs.png`);

// --- A15.5's invariant and A15.7's restore, in one gesture. Picking a
// session in a project this shell has NEVER opened gives a single pane
// holding it, and nothing of the previous project may be left on screen —
// the operator's first report. What the layout looked like before the switch
// is captured here, because the way back is what A15.7 has to reproduce.
const beforeSwitchPanes = await paneCount();
const beforeSwitchTabs = [await tabsInPane(0), await tabsInPane(1)];
await page.locator('[data-session-row="vam-build-1"]').click();
await page.waitForTimeout(150);
const afterSwitch = await paneCount();
const switchedTabs = await tabsInPane(0);
console.log('after switching project:', afterSwitch, 'pane(s), tabs:', switchedTabs);
if (afterSwitch !== 1) {
  throw new Error(
    `switching project left ${afterSwitch} pane(s), expected 1 — the split still holds the ` +
      'previous project’s sessions, which is the bug this reconciliation exists to stop.',
  );
}
await assertStripPerPane('after switching project');
if (switchedTabs.some((title) => title.includes('crosscheck') || title.includes('factory'))) {
  throw new Error(
    `after switching project the strip still lists ${switchedTabs.join(', ')} — a tab from the ` +
      'project that is no longer active.',
  );
}
// --- A15.7, the operator's second report: "when I split, switch to another
// project and then come back, the split state is lost." Coming back must
// bring the layout back — pane for pane and tab for tab. This is the
// assertion that counts: a project switch plus a tree reconciliation is
// exactly the ordering React's eager-state path hides from jsdom.
//
// Coming back by clicking `crosscheck-2` — the session the pane that had
// focus was already showing — so "the same tabs" can be asserted EXACTLY.
// Clicking any other session in the project restores the layout and then
// opens that session in the restored focused pane, which is VSCode's rule
// (a file you click opens in the active group) and would add a tab here.
await page.locator('[data-session-row="crosscheck-2"]').click();
await page.waitForTimeout(150);
const restoredPanes = await paneCount();
const restoredTabs = [await tabsInPane(0), await tabsInPane(1)];
console.log('after coming back:', restoredPanes, 'pane(s), tabs:', restoredTabs);
if (restoredPanes !== beforeSwitchPanes) {
  throw new Error(
    `coming back to the project left ${restoredPanes} pane(s), expected ` +
      `${beforeSwitchPanes} — the layout it was left in must be restored, not collapsed.`,
  );
}
if (JSON.stringify(restoredTabs) !== JSON.stringify(beforeSwitchTabs)) {
  throw new Error(
    `coming back restored the panes but not their tabs: ${JSON.stringify(restoredTabs)} ` +
      `instead of ${JSON.stringify(beforeSwitchTabs)}.`,
  );
}
await assertStripPerPane('after coming back');
await page.screenshot({ path: `${outDir}/a15-7-layout-restored.png` });
console.log(`${outDir}/a15-7-layout-restored.png`);

// --- The per-pane `+`: the operator's "there should be a `+` button to
// create a new tab in each pane, next to the tabs."
//
// Under the demo fixture there is NO new-session route (`?demo=1` is not a
// session source), so what this proves is the other half of the contract: a
// `+` that cannot create must not sit there doing nothing. It says why, out
// loud, and no pane's tab list moves. The creating path is asserted in
// `test/canvas/Canvas.pane-new-tab.test.tsx`, against a source that can.
const newTabButtons = await page.locator('[data-split-pane] [data-tab-new]').count();
console.log('per-pane + buttons:', newTabButtons, 'for', await paneCount(), 'pane(s)');
if (newTabButtons !== (await paneCount())) {
  throw new Error(
    `${newTabButtons} new-tab button(s) for ${await paneCount()} pane(s) — every pane's ` +
      'strip must carry its own.',
  );
}
const tabsBeforePlus = [await tabsInPane(0), await tabsInPane(1)];
await page.locator('[data-split-pane]').nth(1).locator('[data-tab-new]').click();
await page.waitForTimeout(200);
const tabsAfterPlus = [await tabsInPane(0), await tabsInPane(1)];
const said = (await page.locator('[data-status-bar]').innerText()) ?? '';
console.log('after pressing + in pane 2:', tabsAfterPlus, '| status:', said);
if (JSON.stringify(tabsAfterPlus) !== JSON.stringify(tabsBeforePlus)) {
  throw new Error(
    `the demo source cannot start a session, yet pressing + changed the tabs: ` +
      `${JSON.stringify(tabsAfterPlus)} instead of ${JSON.stringify(tabsBeforePlus)}.`,
  );
}
if (!said.includes('no new-session command')) {
  throw new Error(
    `pressing + with no new-session route said "${said}" — it must refuse ALOUD, in the ` +
      'same words the route itself gives, never silently do nothing.',
  );
}
await page.screenshot({ path: `${outDir}/a15-7-pane-new-tab.png` });
console.log(`${outDir}/a15-7-pane-new-tab.png`);

// Back to one pane, holding both tabs, for the drag below.
await chord('z', 'c', 'close', 1);
await page.waitForTimeout(150);

// --- Shot 3: the drag in progress, and the drop-zone highlight it draws.
// A real HTML5 drag needs a real browser -- happy-dom (the unit tests) has
// no `DragEvent` at all, which is exactly why this shot is worth taking:
// it is the one thing no test in this PR can stand in for.
await chord('z', 'v', 'split for drag demo', 2);
// Scoped to the FIRST pane's own strip: A15.5 means the same session can be
// a tab of more than one pane, so an unscoped locator now matches twice.
const draggedTab = page
  .locator('[data-split-pane]')
  .first()
  .locator('[data-tab-select]', { hasText: 'crosscheck-2' });
console.log('draggedTab count:', await draggedTab.count());
const targetPane = page.locator('[data-split-pane]').first();
console.log('targetPane count:', await page.locator('[data-split-pane]').count());
const sourceBox = await draggedTab.boundingBox();
console.log('sourceBox:', sourceBox);
const targetBox = await targetPane.boundingBox();
console.log('targetBox:', targetBox);
if (sourceBox === null || targetBox === null) {
  throw new Error(
    'could not measure the drag source or the drop target — the tab strip or the pane ' +
      'did not render, so the drag shot below would have been silently skipped.',
  );
}
await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
await page.mouse.down();
// A few intermediate steps: real drag detection in Chromium wants actual
// pointer travel before it treats the gesture as a drag rather than a click.
await page.mouse.move(
  targetBox.x + targetBox.width * 0.85,
  targetBox.y + targetBox.height / 2,
  { steps: 8 },
);
await page.waitForTimeout(150);
await page.screenshot({ path: `${outDir}/a15-1-split-drag-in-progress.png` });
console.log(`${outDir}/a15-1-split-drag-in-progress.png`);
await page.mouse.up();
await page.waitForTimeout(150);
const dropped = await paneCount();
console.log('after drop panes:', dropped);
if (dropped !== 3) {
  throw new Error(`dropping a tab on a pane edge left ${dropped} pane(s), expected 3.`);
}
await assertStripPerPane('after the drop');
// A15.5 — the drop MOVES the tab: it was dragged out of the first pane, onto
// that pane's own right edge, so the new pane lands between the two and the
// pane it came from must no longer draw it.
const sourceAfter = await tabsInPane(0);
const landedOn = await tabsInPane(1);
console.log('after the drop — source pane:', sourceAfter, 'new pane:', landedOn);
if (sourceAfter.some((title) => title.includes('crosscheck'))) {
  throw new Error(
    `the pane the tab was dragged OUT of still draws it (${sourceAfter.join(', ')}) — a drag ` +
      'moves a tab into the pane it lands on, it does not copy it.',
  );
}
if (!landedOn.some((title) => title.includes('crosscheck'))) {
  throw new Error(
    `the pane the tab was dropped on does not draw it (${landedOn.join(', ')}).`,
  );
}

await browser.close();
