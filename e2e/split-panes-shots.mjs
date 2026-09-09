/**
 * Screenshots for A15.1 (split panes), A15.2 (shorter tab strip), A15.5
 * (one tab strip PER PANE), A15.7 (a remembered layout per project), the
 * per-pane `+` that starts a session in the pane it belongs to, and the digit
 * row that selects a tab in the pane the operator is looking at, taken
 * off the WEB build with the demo fixture — the only thing safe to point a
 * public screenshot at (`?demo=1`, App.tsx's own rule). Modelled on
 * `pane-refinements-shots.mjs`.
 *
 * Run by hand; nothing runs it automatically:
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5511 --strictPort
 *   node e2e/split-panes-shots.mjs http://localhost:5511 docs/ui
 *
 * A15.8 note: `zv`/`zs` MOVE the active tab into the new pane rather than
 * mirroring it (the operator: "when I split a tab, I still see that tab
 * showing in both panes"), so every sequence below is written against a pane
 * that LOSES the tab it was split on. Where a step needs two tabs in one pane
 * it opens them from the sidebar first.
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
/** The title on the tab the FOCUSED pane has forward, or null. */
async function activeTabTitle() {
  const tab = page.locator(
    '[data-split-pane][data-split-focused="true"] [data-session-tab][data-active="true"] [data-tab-select]',
  );
  return (await tab.count()) === 0 ? null : (await tab.first().innerText()).replace(/^[^\p{ASCII}]+\s*/u, '').trim();
}
/** What the status bar is saying right now. */
async function statusSaid() {
  return (await page.locator('[data-status-bar]').innerText()) ?? '';
}
/** The mode cell: `Select` or `Insert`. */
async function modeCell() {
  return (await page.locator('[data-mode]').innerText()) ?? '';
}
/**
 * A Cmd/Ctrl chord. `Control` rather than `Meta` so this runs the same on a CI
 * runner as on the machine it was written on — `normalizeKey` folds the two,
 * and what matters here is `event.code`, which is `Digit<n>` either way.
 */
async function modChord(key) {
  await page.keyboard.press(`Control+${key}`);
  await page.waitForTimeout(150);
}

/** The ids the sidebar lists, top to bottom — its canonical order. */
async function sidebarOrder() {
  return page.locator('[data-session-row]').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-session-row')),
  );
}

// --- A11.1, THE OPENING STATE: every session of the active project is
// already a tab, with nothing opened by hand. The operator opened a project
// holding two sessions, saw one tab and asked "right from the start,
// shouldn't it show both tabs of a project at once?" — and had answered the
// same question earlier in this epic with "all of them, always". The demo's
// active project (factory) holds three, so three is what the first paint owes
// them. Asserted BEFORE any click, because "on load" is the whole claim.
const opening = await tabTitlesInPane(0);
console.log('the opening state draws:', opening);
if (opening.length !== 3) {
  throw new Error(
    `the shell opened with ${opening.length} tab(s) (${opening.join(', ')}) for a project that ` +
      'holds 3 sessions. Every session of the active project is a tab from the first paint.',
  );
}
await assertStripPerPane('opening');
await page.screenshot({ path: `${outDir}/every-session-is-a-tab.png` });
console.log(`${outDir}/every-session-is-a-tab.png`);

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

// --- THE DIGIT ROW, in a real browser. The operator: "Cmd+0 goes back to the
// sidebar, Cmd+number switches tab", plus "Cmd+T creates a new session/tab in
// the currently focused pane".
//
// Worth a browser rather than only jsdom for two reasons. A synthesised
// `KeyboardEvent` carries whatever `code` the test types into it; here Chromium
// supplies it, which is the whole basis of the digit row's layout-proof
// spelling (`normalizeKey`). And the chord has to survive the real event path —
// the window listener, the `defaultPrevented` yield to the question card, the
// typing guard — none of which jsdom exercises the same way.
const drawnHere = await tabTitlesInPane(0);
if (drawnHere.length !== 3) {
  throw new Error(
    `the digit checks need the 3-tab factory strip, the pane draws ${drawnHere.length}: ` +
      `${drawnHere.join(', ')}.`,
  );
}
// EVERY POSITION, not one. A middle position over three tabs is symmetric
// under a reversed strip, so pressing only `2` cannot tell a strip the
// keyboard agrees with from one it happens to match (measured by mutation).
for (const [index, title] of drawnHere.entries()) {
  await modChord(String(index + 1));
  const landed = await activeTabTitle();
  if (landed !== title) {
    throw new Error(
      `Cmd+${index + 1} brought "${landed}" forward; the tab DRAWN at position ${index + 1} is ` +
        `"${title}" (strip: ${drawnHere.join(', ')}). The digit indexes the strip on screen, ` +
        'never a list the handler keeps of its own.',
    );
  }
}
await modChord('2');
const onSecond = await activeTabTitle();
console.log('after Cmd+2:', onSecond, '| strip:', drawnHere);
if (onSecond !== drawnHere[1]) {
  throw new Error(
    `Cmd+2 brought "${onSecond}" forward; the second tab DRAWN is "${drawnHere[1]}" ` +
      `(strip: ${drawnHere.join(', ')}). The digit counts the strip on screen, never a list ` +
      'the handler keeps of its own.',
  );
}
await modChord('9');
const onLastTab = await activeTabTitle();
console.log('after Cmd+9:', onLastTab);
if (onLastTab !== drawnHere[drawnHere.length - 1]) {
  throw new Error(
    `Cmd+9 brought "${onLastTab}" forward; 9 is the LAST tab, which is ` +
      `"${drawnHere[drawnHere.length - 1]}".`,
  );
}
// PAST THE LAST TAB: refused out loud, and nothing moves. "Absent, not
// dimmed" — a keypress that does nothing and says nothing is the defect
// family this repo tracks.
await modChord('4');
const afterTooFar = await activeTabTitle();
const refusal = await statusSaid();
console.log('after Cmd+4 over a 3-tab strip:', afterTooFar, '| status:', refusal);
if (afterTooFar !== onLastTab) {
  throw new Error(`Cmd+4 over a 3-tab strip moved to "${afterTooFar}" — it must move nothing.`);
}
if (!refusal.includes('only 3 tabs')) {
  throw new Error(
    `Cmd+4 over a 3-tab strip said "${refusal}". A digit past the last tab must refuse ALOUD ` +
      'and name the count it counted, never fall through and never sit silent.',
  );
}
// CMD+0 — out of the tabs and back to the sidebar. Read off the mode cell,
// which is the same state `H` sets and the status bar already prints.
await page.keyboard.press('I');
await page.waitForTimeout(150);
const inThePane = await modeCell();
await modChord('0');
const backInTheList = await modeCell();
console.log('mode after I:', inThePane, '| after Cmd+0:', backInTheList);
if (!inThePane.includes('Insert') || !backInTheList.includes('Select')) {
  throw new Error(
    `Cmd+0 left the mode cell reading "${backInTheList}" (it read "${inThePane}" before) — ` +
      'zero is the way out of the tabs and back to the session list.',
  );
}
// CMD+T — the per-pane `+` on the keyboard. Under `?demo=1` there is no
// new-session route, so what this pins is the half a browser can pin: it
// refuses in the SOURCE's own words, exactly as the `+` button does further
// down this file, and no tab list moves.
const tabsBeforeModT = await tabTitlesInPane(0);
await modChord('t');
const tabsAfterModT = await tabTitlesInPane(0);
const modTSaid = await statusSaid();
console.log('after Cmd+T:', tabsAfterModT, '| status:', modTSaid);
if (JSON.stringify(tabsAfterModT) !== JSON.stringify(tabsBeforeModT)) {
  throw new Error(
    `the demo source cannot start a session, yet Cmd+T changed the tabs: ` +
      `${JSON.stringify(tabsAfterModT)} instead of ${JSON.stringify(tabsBeforeModT)}.`,
  );
}
if (!modTSaid.includes('no new-session command')) {
  throw new Error(
    `Cmd+T with no new-session route said "${modTSaid}" — it must refuse ALOUD, in the same ` +
      'words the `+` button gives, never silently do nothing and never imply a session started.',
  );
}
await page.screenshot({ path: `${outDir}/digit-row-selects-a-tab.png` });
console.log(`${outDir}/digit-row-selects-a-tab.png`);

// --- What A11.1 does to a tab's own `×`: it cannot leave a live session
// without a tab, so it refuses ALOUD rather than closing one the adoption
// would put straight back. (This step used to close dogfood-4's tab to get
// down to two; the refusal is what happens there now, so the same gesture
// pins the new rule instead.)
//
// HOVER THE TAB FIRST. The `×` on an inactive tab is `pointer-events: none`
// until its tab is hovered (audit F4: `opacity: 0` removed no pointer events,
// so every inactive tab carried an invisible close target for a pointer that
// cannot hover). A real mouse gets there by crossing the tab, which is what
// this now does; Playwright's own hit-target check runs before it moves, so
// clicking the button cold is the one route a person does not have.
await page
  .locator('[data-session-tab]')
  .filter({ has: page.getByLabel('close dogfood-4 tab') })
  .hover();
await page.getByLabel('close dogfood-4 tab').click();
await page.waitForTimeout(150);
const refused = (await page.locator('[data-status-bar]').innerText()) ?? '';
const afterRefusal = await tabTitlesInPane(0);
console.log('after pressing a tab’s ×:', afterRefusal, '| status:', refused);
if (afterRefusal.length !== 3) {
  throw new Error(
    `a tab’s × left ${afterRefusal.length} tab(s) (${afterRefusal.join(', ')}) — every session ` +
      'of the active project is a tab, so the × must change nothing.',
  );
}
if (!refused.includes('close the session with x')) {
  throw new Error(
    `pressing a tab’s × said "${refused}" — it must refuse aloud and name the key that does ` +
      'close a session, never silently do nothing.',
  );
}
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
// The split MOVES the active tab: the source pane held all three of the
// project's sessions (A11.1) and keeps two, the new pane holds the one it
// took. This is the operator's report made checkable — the old rule put
// `crosscheck-2` in BOTH lists here.
if (leftTabs.length !== 2 || rightTabs.length !== 1) {
  throw new Error(
    `after zv the source pane should be left with 2 tabs and the new pane hold the 1 it ` +
      `took, got ${leftTabs.length} and ${rightTabs.length}.`,
  );
}
const shared = leftTabs.filter((title) => rightTabs.includes(title));
if (shared.length > 0) {
  throw new Error(
    `after zv both panes draw ${shared.join(', ')}. A session lives in exactly ONE pane — ` +
      'the split moves the tab, it does not mirror it.',
  );
}
const everyTab = [...leftTabs, ...rightTabs];
const twice = everyTab.filter((title, at) => everyTab.indexOf(title) !== at);
if (twice.length > 0) {
  throw new Error(`${twice.join(', ')} appears in more than one pane after zv.`);
}
await page.screenshot({ path: `${outDir}/a15-5-split-vertical-tabs.png` });
console.log(`${outDir}/a15-5-split-vertical-tabs.png`);

// --- WHICH STRIP A DIGIT COUNTS WHEN THE SHELL IS SPLIT, measured here
// because this is the case jsdom is worst at: the answer depends on which pane
// holds the keyboard AT THE MOMENT OF THE EVENT, and React's eager-state path
// hides that ordering (the reason this whole script exists — see
// `splitFocused`'s comment in `Canvas.tsx`).
//
// `zv` left the keyboard in the new pane, which took ONE tab while the project
// has three open across the two. `Cmd+2` must therefore refuse: the operator's
// model is the strip in front of them, and reaching into the other pane would
// move a tab nobody is looking at.
const focusedStrip = await page
  .locator('[data-split-pane][data-split-focused="true"] [data-tab-select]')
  .allInnerTexts();
const everyStrip = await page.locator('[data-split-pane] [data-tab-select]').allInnerTexts();
console.log('focused pane strip:', focusedStrip, '| every pane:', everyStrip);
if (focusedStrip.length !== 1 || everyStrip.length !== 3) {
  throw new Error(
    `this check needs a focused pane holding 1 tab beside 3 in all; got ` +
      `${focusedStrip.length} and ${everyStrip.length}.`,
  );
}
const beforeReach = await activeTabTitle();
await modChord('2');
const afterReach = await activeTabTitle();
const reachSaid = await statusSaid();
console.log('after Cmd+2 in a 1-tab pane:', afterReach, '| status:', reachSaid);
if (afterReach !== beforeReach) {
  throw new Error(
    `Cmd+2 in a pane holding one tab moved to "${afterReach}". The digits count the FOCUSED ` +
      "pane's own strip — reaching across into the other pane is the failure every previous " +
      'arrangement of this row shipped in one form or another.',
  );
}
if (!reachSaid.includes('only 1 tab')) {
  throw new Error(
    `Cmd+2 in a pane holding one tab said "${reachSaid}" — it must refuse aloud, counting the ` +
      'strip in front of the operator.',
  );
}

// Back to one pane before the next shot, so each is the SAME starting shape.
// `zc` closes the focused pane, and the tab it took is ADOPTED back by the
// surviving pane rather than lost — A11.1 again, and the reason nothing has
// to be re-opened from the sidebar here. `crosscheck-2` is picked only to put
// it back in front, which is the tab `zs` will move.
await chord('z', 'c', 'close', 1);
await page.locator('[data-session-row="crosscheck-2"]').click();
await page.waitForTimeout(150);
const afterClosingAPane = await tabTitlesInPane(0);
if (afterClosingAPane.length !== 3) {
  throw new Error(
    `closing a pane left ${afterClosingAPane.length} tab(s) (${afterClosingAPane.join(', ')}) — ` +
      'the sessions it held belong to a pane, so the survivor must adopt them.',
  );
}

// --- Shot 2: horizontal split (zs) — a column, panes stacked. It moves the
// active tab exactly as zv does, leaving one tab in each half.
await chord('z', 's', 'split horizontal', 2);
await assertStripPerPane('after zs');
const stacked = [await tabsInPane(0), await tabsInPane(1)];
console.log('tabs per pane after zs:', stacked);
if (stacked[0].length !== 2 || stacked[1].length !== 1) {
  throw new Error(
    `zs should move the active tab too, leaving the source's other 2 above and 1 below, got ` +
      `${JSON.stringify(stacked)}.`,
  );
}
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

// Back to one pane for the drag below. `zc` takes the focused pane's tab with
// it, so the pane is refilled from the sidebar: the drag needs a pane holding
// MORE than the one tab `zv` will move out of it.
await chord('z', 'c', 'close', 1);
await page.waitForTimeout(150);
for (const id of ['factory-sse-1', 'crosscheck-2', 'dogfood-4']) {
  await page.locator(`[data-session-row="${id}"]`).click();
  await page.waitForTimeout(150);
}

// --- Shot 3: the drag in progress, and the drop-zone highlight it draws.
// A real HTML5 drag needs a real browser -- happy-dom (the unit tests) has
// no `DragEvent` at all, which is exactly why this shot is worth taking:
// it is the one thing no test in this PR can stand in for.
// Moves the front tab (dogfood-4) out, leaving factory-sse-1 and crosscheck-2
// in the first pane — which is the tab the drag below picks up.
await chord('z', 'v', 'split for drag demo', 2);
console.log('tabs before the drag:', await tabsInPane(0), await tabsInPane(1));
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

// --- The pane a split EMPTIES. Splitting a pane that holds one tab moves
// that tab out and leaves the source pane standing with nothing — the
// operator asked for two panes, and an empty one saying what to do about it
// is the honest answer to that. (`removeTab`, what a drag and a close use,
// would have closed it; `detachTab` is the difference.)
await chord('z', 'c', 'close', 2);
await chord('z', 'c', 'close', 1);
await page.waitForTimeout(150);
// IN THE OTHER PROJECT, because A11.1 makes a single-tab pane in `factory`
// impossible — it holds three sessions and every one of them is a tab. `vam`
// has exactly one session, which is the only shape this case can be built
// from now, and it is also the sharpest form of the question: an "every
// session is a tab" rule and an "empty pane is a legitimate state" rule could
// contradict each other here, and do not, because the split MOVES the tab and
// leaves nothing without a pane to adopt.
await page.locator('[data-session-row="vam-build-1"]').click();
await page.waitForTimeout(200);
const beforeEmptying = await tabsInPane(0);
console.log('one pane, before emptying it:', beforeEmptying);
if (beforeEmptying.length !== 1) {
  throw new Error(
    `this step needs a single pane holding exactly 1 tab, it holds ${beforeEmptying.length}: ` +
      `${beforeEmptying.join(', ')}.`,
  );
}
await chord('z', 'v', 'split a single-tab pane', 2);
const [emptied, took] = [await tabsInPane(0), await tabsInPane(1)];
const emptiedText = await page.locator('[data-split-pane]').nth(0).locator('[data-tab-strip]').innerText();
console.log('after splitting a single-tab pane:', emptied, took, '|', emptiedText);
if (emptied.length !== 0 || took.length !== 1) {
  throw new Error(
    `splitting a pane holding one tab should MOVE it, leaving the source empty — got ` +
      `${JSON.stringify(emptied)} and ${JSON.stringify(took)}.`,
  );
}
if (!emptiedText.includes('no sessions open')) {
  throw new Error(
    `the emptied pane draws "${emptiedText}" — it must stay on screen and say what to do, ` +
      'not sit blank and not be closed.',
  );
}
// And it STAYS empty with the keyboard in it: `zw` back into the pane the
// split emptied must not be a cue to refill it, or the split would undo
// itself under whoever made it.
await chord('z', 'w', 'back into the emptied pane', 2);
const stillEmpty = await tabsInPane(0);
const acrossPanes = [...(await tabsInPane(0)), ...(await tabsInPane(1))];
console.log('with the keyboard back in the emptied pane:', stillEmpty, '| all:', acrossPanes);
if (stillEmpty.length !== 0 || acrossPanes.length !== 1) {
  throw new Error(
    `the pane a split emptied was refilled once the keyboard returned to it ` +
      `(${JSON.stringify(stillEmpty)}, ${acrossPanes.length} tab(s) in all). An empty pane is a ` +
      'legitimate state; the invariant only adopts sessions NO pane holds.',
  );
}
await page.screenshot({ path: `${outDir}/split-empties-source-pane.png` });
console.log(`${outDir}/split-empties-source-pane.png`);

// ===========================================================================
// PANE RESIZING WHEN SPLIT.
//
// This section is the load-bearing evidence for that feature: jsdom has no
// layout engine, no pointer capture and no computed styles, so everything
// below — that a drag MOVES a boundary, that the minimum holds, that nothing
// is left behind eating clicks, that the pane's real BOX is what changed —
// can only be measured here.
// ===========================================================================

/** `MIN_PANE_PX` from `src/renderer/canvas/split.ts`, which is `DETAIL_MIN`.
 *  Written out because this file cannot import TypeScript; if the constant
 *  moves, this guard goes red rather than quietly measuring the wrong floor. */
const MIN_PANE_PX = 320;
/** `PANE_RESIZE_STEP` from `src/renderer/prefs/panes.ts`, same bargain. */
const PANE_RESIZE_STEP = 24;

/** Every sized slot's real width, in the order they are drawn. */
async function slotWidths() {
  return page
    .locator('[data-split-slot]')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
}

/** Drag the first divider by `dx` pixels, through a real mouse. */
async function dragDivider(dx) {
  const box = await page.locator('[data-split-resize-handle]').first().boundingBox();
  if (box === null) {
    throw new Error(
      'the divider has no box — it is not laid out, so nothing below would be measuring a resize.',
    );
  }
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

// Back to one pane, then into the project with three sessions, so both halves
// of the split have something in them to look at.
//
// `dogfood-4` and not `factory-sse-1`: the split MOVES the focused tab into
// the new pane, and the minimum-size check below asks whether that pane still
// draws its composer. `factory-sse-1` is mid permission-prompt in the demo
// fixture, so it draws a question CARD instead of a composer whatever its
// width — a pane that would have failed that check at any size, which is a
// guard measuring the fixture rather than the layout.
await chord('z', 'c', 'close', 1);
await page.locator('[data-session-row="dogfood-4"]').click();
await page.waitForTimeout(200);
await chord('z', 'v', 'split for the resize checks', 2);

// --- A FRESH SPLIT IS EVEN. The equal-share layout every pane had before
// sizes existed, now produced by `flex-grow: 0.5` on both slots rather than
// by `flex-1` — asserted so the migration cannot silently change the default.
const even = await slotWidths();
console.log('a fresh split measures:', even);
if (even.length !== 2) {
  throw new Error(`expected 2 sized slots, found ${even.length}: ${even.join(', ')}.`);
}
if (Math.abs(even[0] - even[1]) > 2) {
  throw new Error(
    `a fresh split is uneven (${even[0]}px vs ${even[1]}px). Sizes default to equal shares, ` +
      'which is exactly what the layout was before sizes existed.',
  );
}

// --- THE HANDLE ITSELF: invisible until you go near it, and shaped like the
// axis it moves. `PaneResizer`'s own rule, followed rather than reinvented.
// Tailwind is compiled in this bundle, so these are what actually paint.
const dividerAt = () => page.locator('[data-split-resize-handle]').first();
const restPaint = await dividerAt().evaluate((el) => getComputedStyle(el).backgroundColor);
const restCursor = await dividerAt().evaluate((el) => getComputedStyle(el).cursor);
await dividerAt().hover();
await page.waitForTimeout(120);
const hoverPaint = await dividerAt().evaluate((el) => getComputedStyle(el).backgroundColor);
console.log(
  `the divider paints "${restPaint}" at rest, "${hoverPaint}" hovered, cursor ${restCursor}`,
);
if (!/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(restPaint)) {
  throw new Error(`the divider paints "${restPaint}" at rest — it must be invisible until hovered.`);
}
if (restPaint === hoverPaint) {
  throw new Error(
    `hovering the divider changed nothing (still "${hoverPaint}"). A drag target that never ` +
      'shows itself cannot be found by the person who needs it.',
  );
}
if (restCursor !== 'col-resize') {
  throw new Error(
    `the divider of a side-by-side split shows the "${restCursor}" cursor, not col-resize.`,
  );
}

// --- A DRAG MOVES THE BOUNDARY, and the two panes exchange exactly what the
// pointer travelled. The split they sit in does not change size.
// LEFT, so the screenshot this section takes is unmistakably a non-default
// ratio and unmistakably not the minimum-size shot taken further down.
await dragDivider(-160);
const dragged = await slotWidths();
console.log('after dragging the divider 160px left:', dragged);
if (Math.abs(dragged[0] - (even[0] - 160)) > 4) {
  throw new Error(
    `dragging 160px left left the leading pane at ${dragged[0]}px, expected about ` +
      `${even[0] - 160}px. The pane must follow the pointer.`,
  );
}
if (Math.abs(dragged[0] + dragged[1] - (even[0] + even[1])) > 4) {
  throw new Error(
    `the pair grew from ${even[0] + even[1]}px to ${dragged[0] + dragged[1]}px. A drag moves a ` +
      'boundary between two panes; it does not resize the split they are in.',
  );
}

/**
 * WHAT TMUX WILL BE TOLD. `TerminalTab` learns a pane's new size from a
 * `ResizeObserver` on its own element, and an observer sees a changed BOX,
 * never a transform. A resize faked with a `scale()` would look right on
 * screen and leave every terminal drawing text wrapped for the width it used
 * to have, because `capture-pane` returns a screen tmux has already composed.
 */
const painted = await page
  .locator('[data-split-pane]')
  .first()
  .evaluate((el) => ({
    transform: getComputedStyle(el).transform,
    width: Math.round(el.getBoundingClientRect().width),
  }));
console.log('the resized pane itself:', painted);
if (painted.transform !== 'none') {
  throw new Error(
    `the resized pane carries transform "${painted.transform}". A ResizeObserver does not fire ` +
      'for a transform, so tmux would never be told the new column count and every terminal in ' +
      'that pane would keep drawing text wrapped for its old width.',
  );
}
if (Math.abs(painted.width - dragged[0]) > 4) {
  throw new Error(
    `the pane measures ${painted.width}px inside a ${dragged[0]}px slot — the box a ` +
      'ResizeObserver watches is not the box the drag moved.',
  );
}
await page.screenshot({ path: `${outDir}/split-resize-ratio.png` });
console.log(`${outDir}/split-resize-ratio.png`);

// --- NOTHING SURVIVES THE DRAG. An overlay held across a pointer-capture
// gesture is the classic way this feature breaks the whole app: it outlives
// its drag and silently eats every click. Proven by clicking, not by counting
// elements — a click that lands is the only evidence that settles it.
await page.locator('[data-split-pane]').nth(1).locator('[data-tab-select]').first().click({
  timeout: 3000,
});
await page.waitForTimeout(150);
const focusedAfterDrag = await page
  .locator('[data-split-pane][data-split-focused="true"]')
  .evaluateAll((els) => els.map((el) => el.getAttribute('data-split-pane')));
const paneIds = await page
  .locator('[data-split-pane]')
  .evaluateAll((els) => els.map((el) => el.getAttribute('data-split-pane')));
console.log('after the drag, a click landed in:', focusedAfterDrag, 'of', paneIds);
if (focusedAfterDrag.length !== 1 || focusedAfterDrag[0] !== paneIds[1]) {
  throw new Error(
    `clicking a tab in the second pane did not move the keyboard there (focused: ` +
      `${focusedAfterDrag.join(', ')}). Something is still intercepting clicks after the drag ` +
      'ended — the overlay failure this handle has no overlay in order to avoid.',
  );
}

// --- THE MINIMUM. A drag can never make a pane unusable: it stops at
// `MIN_PANE_PX`, and a pane pinned there still draws its strip, its tabs and
// its composer, and the divider that pinned it is still there to drag back.
await dragDivider(4000);
const pinned = await slotWidths();
console.log('after dragging far past the right edge:', pinned);
if (Math.abs(pinned[1] - MIN_PANE_PX) > 2) {
  throw new Error(
    `the squeezed pane stopped at ${pinned[1]}px, not the ${MIN_PANE_PX}px minimum. A pane that ` +
      'can be dragged down to nothing is a pane the operator cannot get back.',
  );
}
const survives = await page
  .locator('[data-split-pane]')
  .nth(1)
  .evaluate((el) => ({
    strip: el.querySelector('[data-tab-strip]') !== null,
    composer: el.querySelector('textarea[aria-label="prompt to session"]') !== null,
    tabs: el.querySelectorAll('[data-tab-select]').length,
  }));
console.log('the pane pinned at the minimum still draws:', survives);
if (!survives.strip || !survives.composer || survives.tabs === 0) {
  throw new Error(
    `a pane at the ${MIN_PANE_PX}px minimum lost part of itself (${JSON.stringify(survives)}). ` +
      'The minimum exists so a pane stays USABLE, not merely so it stays present.',
  );
}
const escapeHatch = await dividerAt().boundingBox();
if (escapeHatch === null || escapeHatch.width < 3) {
  throw new Error(
    `the divider is ${escapeHatch === null ? 'gone' : `${escapeHatch.width}px wide`} once a pane ` +
      'is pinned at the minimum — there would be no way to drag it back out.',
  );
}
await page.screenshot({ path: `${outDir}/split-resize-minimum.png` });
console.log(`${outDir}/split-resize-minimum.png`);

// --- THE KEYBOARD. vam is keyboard-first: a resize reachable only by mouse
// is half a feature. The divider is a focusable slider, and one arrow press
// moves it by the same constant the sidebar handle already uses.
await dragDivider(-4000);
const beforeKeys = await slotWidths();
await dividerAt().focus();
const focusedHandle = await page.evaluate(
  () => document.activeElement?.getAttribute('data-split-resize-handle') ?? null,
);
if (focusedHandle === null) {
  throw new Error('the divider cannot take focus, so no key could ever reach it.');
}
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(150);
const afterOneStep = await slotWidths();
console.log(`ArrowRight moved the divider ${afterOneStep[0] - beforeKeys[0]}px`);
if (Math.abs(afterOneStep[0] - beforeKeys[0] - PANE_RESIZE_STEP) > 2) {
  throw new Error(
    `one ArrowRight moved the divider ${afterOneStep[0] - beforeKeys[0]}px, expected ` +
      `${PANE_RESIZE_STEP}px — one step size, not two keyboard routes disagreeing.`,
  );
}
await page.keyboard.press('Shift+ArrowRight');
await page.waitForTimeout(150);
const afterJump = await slotWidths();
if (Math.abs(afterJump[0] - afterOneStep[0] - PANE_RESIZE_STEP * 4) > 2) {
  throw new Error(
    `Shift+ArrowRight moved ${afterJump[0] - afterOneStep[0]}px, expected ` +
      `${PANE_RESIZE_STEP * 4}px — the jump multiplier the sidebar handle uses.`,
  );
}
// TAB REACHES IT. A control only `.focus()` can reach is not keyboard
// reachable; this walks the real tab order until it lands on one.
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForTimeout(150);
await page.evaluate(() => document.activeElement?.blur());
let reachedByTab = false;
for (let attempt = 0; attempt < 160 && !reachedByTab; attempt += 1) {
  await page.keyboard.press('Tab');
  reachedByTab = await page.evaluate(
    () => document.activeElement?.hasAttribute('data-split-resize-handle') === true,
  );
}
console.log(`Tab reached the divider: ${reachedByTab}`);
if (!reachedByTab) {
  throw new Error(
    'walking the tab order never landed on a divider. vam is keyboard-first; a resize handle ' +
      'only a mouse can reach is half the feature.',
  );
}

// --- THE ARRANGEMENT IS REMEMBERED. Layouts are per project (A15.7); a ratio
// is part of a layout, so it has to survive the same round trip the split
// itself does — the operator's "when I come back, the split state is lost"
// asked once about the split and now also about how it was divided.
await dividerAt().focus();
for (let attempt = 0; attempt < 4; attempt += 1) {
  await page.keyboard.press('Shift+ArrowLeft');
}
await page.waitForTimeout(200);
const arranged = await slotWidths();
console.log('arranged before leaving the project:', arranged);
if (Math.abs(arranged[0] - arranged[1]) < 40) {
  throw new Error(
    `the arrangement to be remembered is ${arranged.join(' / ')}, too close to even to tell a ` +
      'restored ratio from a fresh default. This check would prove nothing.',
  );
}
await page.locator('[data-session-row="vam-build-1"]').click();
await page.waitForTimeout(250);
const away = await paneCount();
if (away !== 1) {
  throw new Error(`the other project should open with its own layout (1 pane), it has ${away}.`);
}
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForTimeout(250);
const restored = await slotWidths();
console.log('and coming back:', restored);
if (restored.length !== 2) {
  throw new Error(`coming back gave ${restored.length} slot(s) — the split itself was lost.`);
}
if (Math.abs(restored[0] - arranged[0]) > 4) {
  throw new Error(
    `the divider came back at ${restored[0]}px, it was left at ${arranged[0]}px. Sizes travel ` +
      'with the layout they belong to, or the arrangement is lost on every project switch.',
  );
}

await browser.close();
