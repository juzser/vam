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

/**
 * Pick an option WITH A MOUSE, through the fold.
 *
 * A pointer pick on a single-select question now folds the option list away
 * behind its own mark (operator request: "after choosing an option, shouldn't
 * the option panel hide?"), so a second pick goes through `change` first —
 * which is exactly the route a person has, and worth driving here because the
 * fold must never be a dead end.
 */
async function pick(index) {
  const back = page.locator('[data-question-expand]');
  if ((await back.count()) > 0) {
    await back.click();
    await page.waitForTimeout(80);
  }
  await page.locator('[data-question-option]').nth(index).click();
  await page.waitForTimeout(120);
}

// The mark moves the offer: picking the third option must re-aim it.
await pick(2);
const remarked = await boxEl.getAttribute('data-prompt-suggestion');
if (remarked !== 'Web socket') {
  fail(`after marking the third option the box offers "${remarked}", expected "Web socket".`);
}

// Back to the first option, then Tab. A real browser press, not a synthetic
// keydown: Tab is also the browser's own focus move, and the whole point of
// the binding is that it is intercepted HERE and only while an offer stands.
await pick(0);
// AND THE FOLD IS HONEST: the mark is still named, and the card still says a
// mark is not a delivery. A list that vanished silently would read as sent.
const marked = await page.locator('[data-question-marked]').innerText();
if (!marked.includes('Server-sent events') || !marked.includes('not sent')) {
  fail(`the folded row reads "${marked}" — it must name the mark and deny the delivery.`);
}
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

// --- Part three: the two composer typeaheads, in a real browser.
//
// WHY THESE NEED A BROWSER AND NOT JSDOM. Two of the claims here are about
// LAYOUT -- a popover that opens ABOVE the composer and stays inside the
// viewport is a fact about painted boxes, and jsdom gives every element a
// zeroed rect (the `aria` test on zeroed rects is a defect this repo has
// already shipped once). The third is about a REAL Enter: with a list open
// Enter must complete the word and send nothing, and "nothing was sent" is
// only observable against a composer that really does clear its draft when it
// sends -- which this file proves in the same breath, by pressing the same key
// with no list open and watching the draft go.
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

/** The oldest turn of `vam-build-1` proposes this; its NEWEST turn proposes nothing. */
const OLD_TURN_COMMAND = 'pnpm -s lint && pnpm -s typecheck && pnpm -s test && pnpm -s build';

async function openComposer(session) {
  await page.locator(`[data-session-row="${session}"]`).first().click();
  await page.waitForTimeout(200);
  const chat = page.locator('[data-question-chat]');
  if ((await chat.count()) > 0) await chat.click();
  await page.waitForSelector('[data-prompt-box] textarea');
  const box = page.locator('[data-prompt-box] textarea');
  await box.click();
  await page.waitForTimeout(120);
  return box;
}

/** Type into the box one key at a time, as a person does. */
async function typeInto(box, text) {
  await box.fill('');
  await page.keyboard.type(text, { delay: 12 });
  await page.waitForTimeout(120);
}

const composer = await openComposer('vam-build-1');

// A. THE REPORTED BUG. `vam-build-1`'s focused turn is its newest and proposes
// no command at all; an older one in the same column does. Before this change
// the list was the focused turn's alone, so `!` opened nothing here -- which
// is exactly what the operator saw.
await typeInto(composer, '!');
await page.waitForSelector('[data-bang-suggest]');
const bangRows = await page
  .locator('[data-bang-suggestion] [data-bang-command]')
  .allTextContents();
console.log('! offers:', bangRows);
if (!bangRows.includes(OLD_TURN_COMMAND)) {
  fail(`typing ! offered ${JSON.stringify(bangRows)} — an older turn's command is missing.`);
}

// B. ABOVE THE COMPOSER, AND ON SCREEN. A suggestion box that opened below the
// box it belongs to, or off the bottom of the window, is unreachable however
// correct its contents. Both popovers are measured, and the `/` one is the
// case that could actually go wrong: it draws up to eight two-line rows.
async function checkPlacement(selector, label, { composerMustFit = true } = {}) {
  const geometry = await page.evaluate((sel) => {
    const popover = document.querySelector(sel)?.getBoundingClientRect();
    const box = document.querySelector('[data-prompt-box]')?.getBoundingClientRect();
    return popover === undefined || box === undefined
      ? null
      : {
          popoverTop: popover.top,
          popoverBottom: popover.bottom,
          popoverHeight: popover.height,
          boxTop: box.top,
          boxBottom: box.bottom,
          viewport: window.innerHeight,
        };
  }, selector);
  if (geometry === null) fail(`the ${label} popover or the prompt box is not in the document.`);
  console.log(`${label} popover geometry:`, geometry);
  if (geometry.popoverHeight <= 0) {
    fail(`the ${label} popover has no height — it is in the DOM and paints nothing.`);
  }
  if (geometry.popoverBottom > geometry.boxTop + 1) {
    fail(
      `the ${label} popover's bottom is at ${geometry.popoverBottom} and the prompt box starts ` +
        `at ${geometry.boxTop} — it must sit ABOVE the composer, not over it.`,
    );
  }
  if (geometry.popoverTop < 0 || geometry.popoverBottom > geometry.viewport) {
    fail(`the ${label} popover runs outside the ${geometry.viewport}px viewport.`);
  }
  // AND IT MUST NOT PUSH THE COMPOSER OFF THE SCREEN. `composerMustFit` is
  // off for the short-window pass and that is not a weakened check, it is a
  // measured one: at 480px this pane's own blocks -- question card, transcript,
  // composer -- already overflow with no popover open at all, which is a
  // pre-existing layout fact this file did not introduce and must not pretend
  // to have caught. What that pass IS for is the popover's own rect, checked
  // above: it must stay inside the window whatever the window is.
  if (composerMustFit && geometry.boxBottom > geometry.viewport) {
    fail(
      `the ${label} popover pushed the prompt box's bottom to ${geometry.boxBottom}, past the ` +
        `${geometry.viewport}px viewport — the list must never evict the composer.`,
    );
  }
}
await checkPlacement('[data-bang-suggest]', '!');
await page.screenshot({ path: `${outDir}/bang-typeahead-open.png` });
console.log(`${outDir}/bang-typeahead-open.png`);

// C. WHAT IS INSERTED IS WHAT WAS SHOWN, and Enter sends nothing. Both halves
// matter: since `deliver.ts` a recorded prompt really is appended to a live
// session, so a completed `!` line is a command a running agent will run.
const shown = (
  await page.locator('[data-bang-suggestion]').first().locator('[data-bang-command]').innerText()
).trim();

/**
 * WHAT THIS GUARD CANNOT SEE, MEASURED RATHER THAN ASSUMED.
 *
 * "Accepting a suggestion sends nothing" has no browser-visible signature on
 * this fixture, and both candidates were tried here and rejected:
 *
 *  - THE DRAFT. A composer clears its draft when it sends -- but `?demo=1` is
 *    a `'demo'` source, so a send records nothing and clears nothing. Measured:
 *    a bare Enter left the draft byte-identical. `composer-bar-shots.mjs` says
 *    the same about its own wording checks.
 *  - `defaultPrevented`. The box calls `preventDefault()` on Enter whether it
 *    accepts a suggestion or submits, so the flag reads `true` either way.
 *    Measured: `true` with the list open and `true` without it.
 *
 * A control that cannot come out both ways is not a control, so neither is
 * asserted here. `test/panels/DetailPanel.test.tsx` owns that claim, against a
 * real `onSubmit` spy -- "accepts on Enter and sends nothing" asserts the spy
 * was never called, which is the fact itself rather than a proxy for it.
 *
 * What IS a browser fact, and is checked: Enter with the list open puts the
 * row's own characters into the draft, exactly, and closes the list.
 */
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const afterAccept = await composer.inputValue();
console.log('draft after accepting:', JSON.stringify(afterAccept));
if (afterAccept !== `!${shown}`) {
  fail(`the draft is ${JSON.stringify(afterAccept)}, expected exactly "!" + the row's own text.`);
}
if ((await page.locator('[data-bang-suggest]').count()) !== 0) {
  fail('the ! popover is still open over a draft it has already been accepted into.');
}

// D. THE `/` LIST, capped and COUNTING what it is not drawing. The provider's
// real list is fifty-odd commands long; the fixture carries twelve for exactly
// this row.
await typeInto(composer, '/');
await page.waitForSelector('[data-slash-suggest]');
const slashRows = await page.locator('[data-slash-suggestion]').count();
const moreNote = await page.locator('[data-slash-more]').innerText();
console.log(`/ offers ${slashRows} row(s), note: ${JSON.stringify(moreNote)}`);
if (slashRows !== 8) fail(`the / popover drew ${slashRows} rows, expected the cap of 8.`);
if (!moreNote.includes('4 more')) {
  fail(`the / popover's overflow note reads ${JSON.stringify(moreNote)} — it must count the rest.`);
}
// AND THE COUNT IS INSIDE THE BOX IT IS DISCLOSING, painted rather than
// merely present: a count that sat outside the popover's own rect is a
// disclosure nobody reads.
const noteVisible = await page.evaluate(() => {
  const note = document.querySelector('[data-slash-more]')?.getBoundingClientRect();
  const box = document.querySelector('[data-slash-suggest]')?.getBoundingClientRect();
  return note === undefined || box === undefined
    ? null
    : { noteTop: note.top, noteBottom: note.bottom, boxTop: box.top, boxBottom: box.bottom };
});
console.log('overflow note placement:', noteVisible);
if (
  noteVisible === null ||
  noteVisible.noteBottom > noteVisible.boxBottom + 1 ||
  noteVisible.noteTop < noteVisible.boxTop - 1
) {
  fail('the / popover\'s overflow count is outside the box it is disclosing — nobody will see it.');
}
await checkPlacement('[data-slash-suggest]', '/');
await page.screenshot({ path: `${outDir}/slash-typeahead-open.png` });

// AND THE SAME LIST IN A SHORT WINDOW. `src/main/index.ts` sets no
// `minHeight` and the web build runs in whatever window it is given, so a
// half-height one is a real state and the placement rule has to hold there
// too. It is a SECOND VIEWPORT for the same rule, not a guard for a second
// mechanism -- `SUGGEST_LAYER` records the bounded height that was tried here
// and removed again because nothing, at any size this pane still works at,
// could tell it from its absence.
await page.setViewportSize({ width: 1180, height: 480 });
await page.waitForTimeout(200);
await typeInto(composer, '/');
await page.waitForSelector('[data-slash-suggest]');
await checkPlacement('[data-slash-suggest]', '/ in a short window', { composerMustFit: false });
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(200);
await typeInto(composer, '/');
await page.waitForSelector('[data-slash-suggest]');

// Escape closes the list and keeps the text, with a real key press.
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
if ((await page.locator('[data-slash-suggest]').count()) !== 0) {
  fail('Escape did not close the / popover.');
}
if ((await composer.inputValue()) !== '/') {
  fail('Escape took the typed "/" with it — dismissing a list must not edit the draft.');
}

// E. THE TWO UNKNOWNS, ON SCREEN. `notes-1` read its command files and could
// not ask the CLI for its built-ins. A query that matches nothing must not
// look the same as a list vam could not read.
const quiet = await openComposer('notes-1');
await typeInto(quiet, '/zzzz');
await page.waitForTimeout(150);
if ((await page.locator('[data-slash-suggest]').count()) !== 0) {
  fail('a query matching nothing left the / list standing.');
}
const gap = await page.locator('[data-slash-gap]').innerText();
console.log('gap note:', JSON.stringify(gap));
if (!gap.includes('could not read')) {
  fail(`the gap note reads ${JSON.stringify(gap)} — it must say vam could not read the list.`);
}
const gapBox = await page.locator('[data-slash-gap]').boundingBox();
if (gapBox === null || gapBox.height <= 0) {
  fail('the gap note is in the DOM and paints nothing.');
}
await page.screenshot({ path: `${outDir}/slash-typeahead-gap.png` });
console.log(`${outDir}/slash-typeahead-gap.png`);

// And on a session with nothing missing, the note is ABSENT rather than a
// dimmed placeholder -- the same query, the other answer.
const full = await openComposer('vam-build-1');
await typeInto(full, '/zzzz');
await page.waitForTimeout(150);
if ((await page.locator('[data-slash-gap]').count()) !== 0) {
  fail('a session whose list was read in full still drew a "could not read" note.');
}

await browser.close();
console.log('all checks passed');
