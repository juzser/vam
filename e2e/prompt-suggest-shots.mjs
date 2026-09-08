/**
 * Screenshots and a real-browser guard for the two detail-pane changes in
 * this PR, taken off the WEB build with the demo fixture -- the only thing
 * safe to point a public screenshot at (`?demo=1`, App.tsx's own rule).
 * Modelled on `split-panes-shots.mjs` and `transcript-flow-shots.mjs`.
 *
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5516 --strictPort
 *   node e2e/prompt-suggest-shots.mjs http://localhost:5516 docs/ui
 *
 * Every check THROWS, naming what it expected. The second half is the reason
 * this file has to exist at all: which pane is focused AT THE MOMENT OF AN
 * EVENT is exactly the family React's eager-state path hides from jsdom (see
 * `splitFocused`'s comment in `Canvas.tsx`), and "the icons are in the
 * focused pane and no other" is a claim about that instant.
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5516';
const outDir = process.argv[3] ?? 'docs/ui';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

function fail(message) {
  throw new Error(message);
}

// --- Part one: the suggestion in the prompt box, and Tab accepting it.
//
// `vam-build-1` is the fixture's asking session: one call, two questions, and
// vam did not start it -- so there is no Submit at all and filling the box IS
// the whole action. The composer stands down while a question is open, so
// "Chat about this" is the way to a box.
await page.locator('[data-session-row="vam-build-1"]').click();
await page.waitForSelector('[data-question]');
await page.locator('[data-question-chat]').click();
await page.waitForSelector('[data-prompt-box] textarea');

const boxEl = page.locator('[data-prompt-box] textarea');
const offered = await boxEl.getAttribute('data-prompt-suggestion');
const placeholder = await boxEl.getAttribute('placeholder');
const before = await boxEl.inputValue();
console.log('offered:', offered, '| placeholder:', placeholder, '| draft:', JSON.stringify(before));
if (offered !== 'Server-sent events') {
  fail(`the box offers "${offered}", expected the showing question's first option.`);
}
if (before !== '') fail(`the draft is "${before}" before Tab — the offer is a ghost, not a draft.`);
if (!(placeholder ?? '').includes('Tab')) {
  fail(`the placeholder is "${placeholder}" — it must name the key that accepts it.`);
}
await page.screenshot({ path: `${outDir}/prompt-suggestion-offered.png` });
console.log(`${outDir}/prompt-suggestion-offered.png`);

// The mark moves the offer: picking the third option must re-aim it.
await page.locator('[data-question-option]').nth(2).click();
await page.waitForTimeout(120);
const remarked = await boxEl.getAttribute('data-prompt-suggestion');
if (remarked !== 'Web socket') {
  fail(`after marking the third option the box offers "${remarked}", expected "Web socket".`);
}

// Back to the first option, then Tab. A real browser press, not a synthetic
// keydown: Tab is also the browser's own focus move, and the whole point of
// the binding is that it is intercepted HERE and only while an offer stands.
await page.locator('[data-question-option]').nth(0).click();
await page.waitForTimeout(120);
await boxEl.click();
await page.keyboard.press('Tab');
await page.waitForTimeout(150);
const after = await boxEl.inputValue();
console.log('draft after Tab:', JSON.stringify(after));
if (after !== 'Server-sent events') {
  fail(`Tab left the draft as "${after}", expected the accepted suggestion.`);
}
if ((await boxEl.getAttribute('data-prompt-suggestion')) !== null) {
  fail('the offer is still standing over a draft that already carries text.');
}
// AND NOTHING WAS DELIVERED: the card still says a pick is only a mark.
const note = await page.locator('[data-question-note]').innerText();
if (!note.includes('vam cannot answer this for you')) {
  fail(`the card's note now reads "${note}" — accepting must not imply a delivery.`);
}
await page.screenshot({ path: `${outDir}/prompt-suggestion-accepted.png` });
console.log(`${outDir}/prompt-suggestion-accepted.png`);

// A second Tab has nothing to accept, so it must be the exit again: focus
// leaves the textarea. This is the keyboard-trap check, in the only place a
// real Tab actually moves focus.
await page.keyboard.press('Tab');
await page.waitForTimeout(120);
const stillInBox = await page.evaluate(
  () => document.activeElement?.getAttribute('aria-label') === 'prompt to session',
);
if (stillInBox) {
  fail('a second Tab did not leave the box — with no offer standing, Tab must be the exit.');
}

// --- Part two: the view icons, in the focused pane and no other.
async function paneCount() {
  return page.locator('[data-split-pane]').count();
}
async function iconBars() {
  return page.locator('[data-view-tabs]').count();
}
async function iconsInPane(at) {
  return page.locator('[data-split-pane]').nth(at).locator('[data-view]').count();
}
async function focusedIndex() {
  const flags = await page.locator('[data-split-pane]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-split-focused')),
  );
  return flags.indexOf('true');
}

const singleIcons = await iconsInPane(0);
console.log('unsplit:', await paneCount(), 'pane(s),', singleIcons, 'icon(s)');
if ((await paneCount()) !== 1) fail('expected to start unsplit.');
if (singleIcons === 0) fail('the single pane IS the focused pane — its icons must be drawn.');

await page.keyboard.press('z');
await page.keyboard.press('v');
await page.waitForTimeout(200);
if ((await paneCount()) !== 2) fail(`zv left ${await paneCount()} pane(s), expected 2.`);
const focused = await focusedIndex();
const other = focused === 0 ? 1 : 0;
const bars = await iconBars();
console.log(
  `split: focused pane #${focused}, ${bars} icon bar(s), ` +
    `${await iconsInPane(focused)} icon(s) focused / ${await iconsInPane(other)} elsewhere`,
);
if (bars !== 1) fail(`${bars} icon bars across 2 panes — exactly the focused pane may draw one.`);
if ((await iconsInPane(focused)) !== singleIcons) {
  fail(
    `the focused pane draws ${await iconsInPane(focused)} icon(s), expected the whole set ` +
      `(${singleIcons}) — hiding them elsewhere must not thin them out here.`,
  );
}
if ((await iconsInPane(other)) !== 0) {
  fail(`the unfocused pane still draws ${await iconsInPane(other)} icon(s).`);
}
await page.screenshot({ path: `${outDir}/view-icons-focused-pane-only.png` });
console.log(`${outDir}/view-icons-focused-pane-only.png`);

// Focus moves, the icons move with it -- the eager-state family, checked in a
// real browser because jsdom cannot reproduce it.
await page.keyboard.press('z');
await page.keyboard.press('w');
await page.waitForTimeout(200);
const movedTo = await focusedIndex();
console.log('after zw: focused pane #', movedTo);
if (movedTo === focused) fail('zw did not move pane focus.');
if ((await iconBars()) !== 1) fail(`${await iconBars()} icon bars after zw, expected 1.`);
if ((await iconsInPane(movedTo)) !== singleIcons) {
  fail('the icons did not follow the keyboard to the newly focused pane.');
}
if ((await iconsInPane(focused)) !== 0) {
  fail('the pane that lost focus is still drawing its icons.');
}

await browser.close();
console.log('all checks passed');
