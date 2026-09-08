/**
 * Screenshots for A15.1 (split panes), A15.2 (shorter tab strip) and A15.5
 * (one tab strip PER PANE, and panes reconciled on a project switch), taken
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

// Focus factory-sse-1, then open crosscheck-2 in the same pane — A15.5 makes
// a strip list the tabs of ITS OWN pane, so a second tab has to be opened
// from the sidebar before there is one to drag or to leave behind.
await page.locator('[data-session-row="factory-sse-1"]').click();
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

// --- A15.5, the second report: "after splitting a tab, when I switch
// project, the old tab still shows and is still split". Picking a session in
// ANOTHER project collapses the layout to a single pane holding it — nothing
// of the previous project may be left on screen.
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
// Back to the factory project, and back to two tabs, for the drag below.
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForTimeout(150);
await page.locator('[data-session-row="crosscheck-2"]').click();
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
