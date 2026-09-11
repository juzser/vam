/**
 * `Ctrl-D` / `Ctrl-U` — HALF A SCREEN, AGAINST A COLUMN A BROWSER LAID OUT.
 *
 * The operator asked for vim's two half-page keys. Everything about them that
 * is arithmetic is a unit test (`test/panels/half-page.test.ts`), and
 * everything about the grammar is another
 * (`test/keyboard/chords.half-page.test.ts`). What is left is what those two
 * cannot see, and it is all of the load-bearing part:
 *
 *  - HOW FAR. `clientHeight` is 0 on every element in happy-dom, so "half a
 *    viewport" is unmeasurable there. Here the column has a real height, and
 *    the viewport is CHANGED mid-run so the step has to track it — a fixed
 *    pixel distance passes the fixed-height check and fails that one.
 *
 *  - WHO OWNS THE KEYSTROKE. Decided by whether anything cancelled a real,
 *    CANCELABLE keydown delivered to whatever really holds focus.
 *    `preventDefault()` on an event built without `cancelable` is a no-op by
 *    specification, which is exactly how one keyboard suite in this repo came
 *    to be green BECAUSE OF the defect it was sent to fix. Nothing here builds
 *    an event: every press below is Chromium's own. `watchKeys` records the
 *    cancellation at its source rather than reading `defaultPrevented` from a
 *    listener, for a reason found by falsifying this very file — see there.
 *
 *  - THE PAGER JOIN. `Mod-u` calls no pager. It writes `scrollTop`, the column
 *    hears its own `scroll` event and reads earlier turns in near the top
 *    (`askIfNearTop` in `DetailPanel.tsx`) — the operator's "load more when
 *    scrolling up", which is a rule about the scroll and not about the mouse.
 *    Assigning `scrollTop` fires NO scroll event in happy-dom, so that join is
 *    unobservable in a unit test and is section 5 here.
 *
 * Failures are COLLECTED, not thrown: one regression should not hide the state
 * of the others.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/half-page-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** The demo session with a transcript long enough to scroll. It is also being
 *  ASKED something, so its composer has stood down — which is why section 4
 *  goes elsewhere for a text box and comes back here for a card. */
const LONG_SESSION = 'factory-sse-1';
/** A session with a composer AND a column that overflows a short window --
 *  MEASURED across the fixture, not picked: at 380px the quieter sessions'
 *  columns still fit inside themselves, and "it did not scroll" over a column
 *  that could not have scrolled is the vacuous check this file is against. */
const QUIET_SESSION = 'crosscheck-2';
/** The window height that gives that column room to move. */
const SHORT_WINDOW = { width: 1100, height: 380 };
/** A second session with an open question — an insert scope that is no text
 *  box at all, and the nearest thing the web demo has to the terminal pane. */
const ASKING_SESSION = 'vam-build-1';
/** `NEAR_TOP_PX` in `DetailPanel.tsx`: how close to the top starts a read. */
const NEAR_TOP_PX = 120;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

// `history=off` FOR SECTIONS 1-4, and it is not a convenience: with a pager
// attached the column GROWS whenever anything scrolls near its top, so a
// distance measured before a press would be against a different column by the
// time it was compared. Section 5 is the pager, on a page of its own, where
// that growth is the subject rather than the noise.
await page.goto(`${origin}/?demo=1&history=off`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]');
await page.locator(`[data-session-row="${LONG_SESSION}"]`).click();
await page.waitForSelector('[data-detail-column]');

const column = page.locator('[data-detail-column]');
const metrics = () =>
  column.evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
const statusOf = () =>
  page.evaluate(() => {
    const cell = document.querySelector('[data-status-bar] [data-status]');
    return {
      text: cell?.textContent ?? '',
      full: cell?.getAttribute('data-note') ?? '',
    };
  });

/**
 * WHO ANSWERED THE LAST KEYSTROKE — instrumented at `preventDefault` itself,
 * NOT by reading `defaultPrevented` from a listener of our own.
 *
 * THE OBVIOUS WAY IS WRONG HERE, AND IT WAS MEASURED WRONG BEFORE IT WAS
 * WRITTEN THIS WAY. A probe listener added once on `window` reads
 * `defaultPrevented` in whatever order the listener list happens to be in, and
 * `Canvas.tsx` registers ITS window listener from an effect with a dependency
 * list — `focusedPaneId`, `panes`, `overlayOpen` and more — so every render
 * that changes one of those REMOVES and RE-ADDS it, moving it after the probe.
 * Running this file against a deliberately broken build caught it: the early
 * section read `prevented: true` and the later ones, after a session click had
 * re-rendered the shell, read `false` for the very same handler behaviour. A
 * probe that answers "no" whenever the app has re-rendered is a guard that
 * passes for the wrong reason, which is the family this repo keeps finding.
 *
 * Patching `Event.prototype.preventDefault` asks the question directly — did
 * ANY JavaScript cancel this keystroke — and cannot be reordered. It is also
 * the honest form of the question for section 4: what the composer needs is
 * not "vam's listener specifically stood down", it is "nothing took this key
 * away from the box".
 */
async function watchKeys() {
  await page.evaluate(() => {
    const real = Event.prototype.preventDefault;
    window.__vamPrevented = null;
    Event.prototype.preventDefault = function patched() {
      if (this instanceof KeyboardEvent) {
        window.__vamPrevented = { key: this.key, ctrl: this.ctrlKey };
      }
      return real.call(this);
    };
  });
}

/** Press, then let the handler's write land and a frame go by. */
async function press(keys) {
  await page.evaluate(() => {
    window.__vamPrevented = null;
  });
  await page.keyboard.press(keys);
  await page.waitForTimeout(80);
}

/** What the last press did about the browser's own default, if anything. */
const lastPrevented = () => page.evaluate(() => window.__vamPrevented);

/** Put the column somewhere known without using the keys under test. */
async function scrollTo(top) {
  await column.evaluate((el, y) => {
    el.scrollTop = y;
  }, top);
  await page.waitForTimeout(80);
}

await watchKeys();

// ------------------------------------------- 1. HALF THE COLUMN, MEASURED
//
// Half of the SCROLLER'S OWN `clientHeight` — the answer this repo chose, and
// the one the operator asked for by naming vim's keys.
const opened = await metrics();
console.log(
  `  column: clientHeight ${Math.round(opened.clientHeight)}, ` +
    `scrollHeight ${Math.round(opened.scrollHeight)}, at ${Math.round(opened.scrollTop)}`,
);
check(
  'the column overflows, so a half-page step has room to prove anything',
  opened.scrollHeight > opened.clientHeight * 1.5,
  `${Math.round(opened.scrollHeight)} of ${Math.round(opened.clientHeight)}`,
);

await scrollTo(0);
const beforeDown = await metrics();
await press('Control+KeyD');
const afterDown = await metrics();
const stepDown = afterDown.scrollTop - beforeDown.scrollTop;
console.log(`  Ctrl-D moved ${stepDown.toFixed(1)}px of a ${beforeDown.clientHeight}px column`);
check(
  'Ctrl-D scrolls down half the column’s visible height',
  Math.abs(stepDown - beforeDown.clientHeight / 2) <= 1.5,
  `moved ${stepDown.toFixed(1)}, half the column is ${(beforeDown.clientHeight / 2).toFixed(1)}`,
);

await press('Control+KeyU');
const afterUp = await metrics();
console.log(`  Ctrl-U came back to ${afterUp.scrollTop.toFixed(1)}`);
check(
  'Ctrl-U scrolls back up by the same half',
  Math.abs(afterUp.scrollTop - beforeDown.scrollTop) <= 1.5,
  `${afterUp.scrollTop.toFixed(1)}, started at ${beforeDown.scrollTop.toFixed(1)}`,
);

// AND IT IS HALF OF WHATEVER THE COLUMN IS, not a number that happens to
// match at one window size. A constant passes every check above and fails
// this one: the window is resized, so the step has to change with it.
//
// SHORTER, NOT TALLER, and that is a measurement rather than a preference: at
// 980px this demo column has less than half a screen of scroll left in it, so
// a taller window measures the CLAMP at the bottom and calls it the step. The
// room is asserted below rather than assumed, so a fixture that grows or
// shrinks cannot quietly turn this back into that.
await page.setViewportSize({ width: 1100, height: 460 });
await page.waitForTimeout(200);
await scrollTo(0);
const shorter = await metrics();
await press('Control+KeyD');
const afterShorter = await metrics();
const stepShorter = afterShorter.scrollTop - shorter.scrollTop;
console.log(
  `  at ${shorter.clientHeight}px tall, Ctrl-D moved ${stepShorter.toFixed(1)}px ` +
    `(was ${stepDown.toFixed(1)}px at ${beforeDown.clientHeight}px)`,
);
check(
  'the window really changed size, so this comparison means something',
  beforeDown.clientHeight - shorter.clientHeight > 100,
  `${beforeDown.clientHeight} -> ${shorter.clientHeight}`,
);
check(
  'and the column still has more than a half-page of room, so this is a step and not a clamp',
  shorter.scrollHeight - shorter.clientHeight > shorter.clientHeight / 2 + 20,
  `${Math.round(shorter.scrollHeight - shorter.clientHeight)}px of room`,
);
check(
  'and the step is half of THAT column, not a fixed number of pixels',
  Math.abs(stepShorter - shorter.clientHeight / 2) <= 1.5 && stepDown - stepShorter > 50,
  `moved ${stepShorter.toFixed(1)}, half is ${(shorter.clientHeight / 2).toFixed(1)}`,
);
await page.setViewportSize({ width: 1100, height: 700 });
await page.waitForTimeout(200);

// ------------------------------------------------------- 2. BOTH ENDS
//
// Clamped where it would overshoot — vim scrolls the last half-screen rather
// than refusing it — and REFUSED ALOUD where the column is already resting
// against that end. A key cannot be withdrawn from the screen, so the house
// rule ("absent, not dimmed") leaves it saying so.
await scrollTo(1e7);
const bottom = await metrics();
const restingAtBottom = bottom.scrollHeight - bottom.clientHeight;
await press('Control+KeyD');
const stillBottom = await metrics();
const saidBottom = await statusOf();
console.log(`  at the bottom, Ctrl-D says: ${JSON.stringify(saidBottom.text)}`);
check(
  'a press at the bottom moves nothing',
  Math.abs(stillBottom.scrollTop - restingAtBottom) <= 1,
  `${stillBottom.scrollTop.toFixed(1)} of ${restingAtBottom.toFixed(1)}`,
);
check(
  'and says so rather than doing nothing silently',
  /bottom/i.test(saidBottom.text),
  JSON.stringify(saidBottom.text),
);
check(
  'in a sentence the bar can print whole — the tooltip half adds nothing',
  saidBottom.text === saidBottom.full,
  `${JSON.stringify(saidBottom.text)} vs ${JSON.stringify(saidBottom.full)}`,
);
await page.screenshot({ path: `${outDir}/half-page-bottom-refusal.png` });
console.log(`${outDir}/half-page-bottom-refusal.png`);

// The last half-screen is reachable, which is what clamping is for: from just
// under a half-page off the bottom, one press lands ON the bottom.
await scrollTo(restingAtBottom - bottom.clientHeight / 4);
await press('Control+KeyD');
const landed = await metrics();
check(
  'a press that would overshoot lands exactly on the bottom instead of refusing',
  Math.abs(landed.scrollTop - restingAtBottom) <= 1,
  `${landed.scrollTop.toFixed(1)} of ${restingAtBottom.toFixed(1)}`,
);

await scrollTo(0);
await press('Control+KeyU');
const stillTop = await metrics();
const saidTop = await statusOf();
console.log(`  at the top, Ctrl-U says: ${JSON.stringify(saidTop.text)}`);
check('a press at the top moves nothing', stillTop.scrollTop <= 1, `${stillTop.scrollTop}`);
check('and says so', /top/i.test(saidTop.text), JSON.stringify(saidTop.text));
check(
  'without claiming anything about the SESSION — only the column’s head may',
  !/begin|start of the session|nothing older|no earlier/i.test(saidTop.text),
  JSON.stringify(saidTop.text),
);

// ------------------------------------------ 3. VAM TAKES IT, IN SELECT
//
// `Cmd+D` is bookmark in a browser and `Ctrl+D` is one folded chord with it
// (`normalizeKey`). Taking the keystroke is what keeps the browser's own out
// of the way — and is the same flag that must be FALSE in section 4.
await scrollTo(0);
await press('Control+KeyD');
const selectKey = await lastPrevented();
console.log(`  in Select, preventDefault: ${JSON.stringify(selectKey)}`);
check(
  'in Select the grammar takes Ctrl-D, so nothing native answers it',
  selectKey?.key === 'd' && selectKey?.ctrl === true,
  JSON.stringify(selectKey),
);

// ------------------------------ 4. IN INSERT IT IS NOT THIS GRAMMAR'S
//
// THE CONSTRAINT THAT MATTERS MOST. Inside a text field `Ctrl-D` is
// delete-forward and `Ctrl-U` deletes to the start of the line; in a shell
// `Ctrl-D` is EOF. The window listener lets `Mod-` chords past its typing
// guard on purpose — a chord is never a character — so without a rule of its
// own this pair would fire while somebody was writing a prompt AND cancel the
// edit on the way past.
//
// WHAT IS ASSERTED IS THAT VAM LET IT GO, not what the platform then did with
// it: `Ctrl-D` is delete-forward on macOS and nothing at all on Linux, where
// CI runs, so an assertion about the deletion would be an assertion about the
// runner. That the box still has the keyboard afterwards IS portable, and is
// checked by typing one more character into it.
//
// A DIFFERENT SESSION, AND A SHORTER WINDOW, both for the same reason: this
// case needs a composer AND a column with room to move, or "it scrolled
// nothing" is satisfied by a column that could not have scrolled anyway.
// `factory-sse-1` is being asked a question, so its composer has stood down —
// `i` lands on the card there, which is section 4b. The quiet session has the
// composer; at this window height its column also overflows, and the room is
// asserted rather than assumed.
await page.locator(`[data-session-row="${QUIET_SESSION}"]`).click();
await page.waitForSelector('[data-detail-column]');
await page.setViewportSize(SHORT_WINDOW);
await page.waitForTimeout(250);
await page.keyboard.press('i');
await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA', undefined, {
  timeout: 4000,
});
await page.keyboard.type('abc');
// Scrolled AFTER the composer has opened, so the offset being compared is not
// one the composer's own layout is about to change.
const quietRoom = await metrics();
await scrollTo(Math.round((quietRoom.scrollHeight - quietRoom.clientHeight) / 2));
const beforeInsert = await metrics();
console.log(
  `  quiet session: ${Math.round(quietRoom.scrollHeight - quietRoom.clientHeight)}px of room, ` +
    `resting at ${beforeInsert.scrollTop.toFixed(1)}`,
);
check(
  'the quiet session’s column can really scroll, so "it did not move" means something',
  quietRoom.scrollHeight - quietRoom.clientHeight > 40 && beforeInsert.scrollTop > 10,
  `${Math.round(quietRoom.scrollHeight - quietRoom.clientHeight)}px of room, at ${beforeInsert.scrollTop}`,
);
await press('Control+KeyD');
const insertKey = await lastPrevented();
const afterInsert = await metrics();
await page.keyboard.type('Z');
const draft = await page.evaluate(() => document.activeElement?.value ?? '');
console.log(
  `  in the composer, preventDefault: ${JSON.stringify(insertKey)}, draft ${JSON.stringify(draft)}`,
);
check(
  'the caret is in the composer, which is what makes this case the real one',
  await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'),
);
check(
  'Ctrl-D in the composer is NOT taken by the grammar',
  insertKey === null,
  `something cancelled it: ${JSON.stringify(insertKey)}`,
);
check(
  'and scrolls nothing',
  Math.abs(afterInsert.scrollTop - beforeInsert.scrollTop) <= 1,
  `${beforeInsert.scrollTop.toFixed(1)} -> ${afterInsert.scrollTop.toFixed(1)}`,
);
check(
  'and the box still owns the keyboard afterwards',
  draft.endsWith('Z'),
  JSON.stringify(draft),
);
await press('Control+KeyU');
const insertUp = await lastPrevented();
check(
  'Ctrl-U in the composer is not taken either',
  insertUp === null,
  `something cancelled it: ${JSON.stringify(insertUp)}`,
);
await page.screenshot({ path: `${outDir}/half-page-composer-keeps-the-key.png` });
console.log(`${outDir}/half-page-composer-keeps-the-key.png`);
await page.keyboard.press('Escape');

// --- 4b. AN INSERT SCOPE THAT IS NOT A TEXT BOX AT ALL.
//
// The rule is the cursor MODE, never the tag name — which is what also covers
// the terminal pane, a `section` no `INPUT|TEXTAREA` test can see and the one
// surface where `Ctrl-D` means most. The demo has no terminal to drive (its
// pane has no bridge behind it, so it never takes focus); a question card is
// the same shape of scope and is reachable here.
await page.setViewportSize({ width: 1100, height: 700 });
await page.waitForTimeout(200);
await page.locator(`[data-session-row="${ASKING_SESSION}"]`).click();
await page.waitForSelector('[data-question-option]', { timeout: 4000 });
await page.keyboard.press('I');
await page.waitForFunction(
  () => document.activeElement?.hasAttribute('data-question-option') === true,
  undefined,
  { timeout: 4000 },
);
// Again after the landing, so nothing the focus move itself did to the
// scroller is being read as this key's doing.
const cardRoom = await metrics();
await scrollTo(Math.round((cardRoom.scrollHeight - cardRoom.clientHeight) / 2));
const beforeCard = await metrics();
await press('Control+KeyD');
const cardKey = await lastPrevented();
const afterCard = await metrics();
console.log(
  `  on a question card, preventDefault: ${JSON.stringify(cardKey)}, ` +
    `${beforeCard.scrollTop.toFixed(1)} -> ${afterCard.scrollTop.toFixed(1)}`,
);
check(
  'the asking session’s column can scroll too, so its "did not move" is not free',
  cardRoom.scrollHeight - cardRoom.clientHeight > 40 && beforeCard.scrollTop > 10,
  `${Math.round(cardRoom.scrollHeight - cardRoom.clientHeight)}px of room, at ${beforeCard.scrollTop}`,
);
check(
  'Ctrl-D on a question card is not taken either — the scope is the rule, not the tag',
  cardKey === null,
  `something cancelled it: ${JSON.stringify(cardKey)}`,
);
check(
  'and it scrolled nothing there',
  Math.abs(afterCard.scrollTop - beforeCard.scrollTop) <= 1,
  `${beforeCard.scrollTop.toFixed(1)} -> ${afterCard.scrollTop.toFixed(1)}`,
);

// ------------------------------------------------ 5. THE PAGER, JOINED
//
// `Mod-u` asks for no page of its own. It writes `scrollTop`; the column hears
// its own scroll event and reads earlier turns in near the top. That is what
// makes the key reach history that exists WITHOUT firing a fetch nobody asked
// for: the ask is the column's, on exactly the terms a trackpad scroll gets —
// including its refusals (a source with no pager, a proven start, a read that
// just failed are all decided there and not here).
//
// ITS OWN PAGE: the demo's pager is a scripted sequence in a closure, so it
// must start at step one.
const back = await browser.newPage({ viewport: { width: 1100, height: 700 } });
back.on('pageerror', (err) => console.error('PAGE ERROR (pager):', err));
await back.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await back.waitForSelector('[data-session-row]');
await back.locator(`[data-session-row="${LONG_SESSION}"]`).click();
await back.waitForSelector('[data-detail-column]');
const backState = () =>
  back.evaluate(() => {
    const col = document.querySelector('[data-detail-column]');
    return {
      scrollTop: col.scrollTop,
      scrollHeight: col.scrollHeight,
      clientHeight: col.clientHeight,
      turns: col.querySelectorAll('[data-column-turn]').length,
      more: document.querySelector('[data-column-more]')?.getAttribute('data-column-more') ?? null,
    };
  });

const opening = await backState();
console.log(`  pager page opens with ${opening.turns} turns, more=${opening.more}`);
check(
  'the demo source can page, so reaching the top has something to read',
  opening.more === 'available',
  `${opening.more}`,
);

// Press ONLY the key under test, never a scrollTop write: the whole claim is
// that this gesture reaches the pager the same way a trackpad does.
let presses = 0;
let reached = false;
for (; presses < 30; presses += 1) {
  await back.keyboard.press('Control+KeyU');
  await back.waitForTimeout(60);
  const now = await backState();
  if (now.turns > opening.turns) {
    reached = true;
    break;
  }
  if (now.scrollTop <= NEAR_TOP_PX) {
    // At the top with nothing read yet — give the walk a moment to land.
    for (let wait = 0; wait < 40 && !reached; wait += 1) {
      await back.waitForTimeout(100);
      reached = (await backState()).turns > opening.turns;
    }
    break;
  }
}
const grown = await backState();
console.log(
  `  ${presses + 1} presses of Ctrl-U: ${opening.turns} -> ${grown.turns} turns, ` +
    `scrollHeight ${Math.round(opening.scrollHeight)} -> ${Math.round(grown.scrollHeight)}`,
);
check(
  'Ctrl-U to the top reads earlier turns in, with no other gesture at all',
  reached && grown.turns > opening.turns,
  `${opening.turns} -> ${grown.turns} turns after ${presses + 1} presses`,
);
check(
  'and the column really grew, so the turns landed above the reader',
  grown.scrollHeight > opening.scrollHeight,
  `${Math.round(opening.scrollHeight)} -> ${Math.round(grown.scrollHeight)}`,
);
check(
  'and the key left the reader with somewhere to go — it did not strand them at 0',
  grown.scrollTop > 0,
  `${grown.scrollTop}`,
);
await back.screenshot({ path: `${outDir}/half-page-read-back.png` });
console.log(`${outDir}/half-page-read-back.png`);

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} half-page guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('\nhalf-page: every assertion passed.');
