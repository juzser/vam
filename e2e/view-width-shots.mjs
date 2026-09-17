/**
 * THE VIEWS' WIDTH AND THE PANE'S READING SIZE, MEASURED IN A REAL ENGINE.
 *
 * ── THE RULE THIS FILE MEASURES, AND THE ONE IT MEASURED BEFORE ──────────
 * Narrowed means TWO THIRDS OF THE PANE, AND NEVER NARROWER THAN EIGHTY
 * CHARACTERS. It used to mean "no more than eighty characters on a line"; the
 * operator used the build and asked for two thirds instead ("narrow width cần
 * lớn hơn, khoảng 2/3 pane width"), and the eighty became the floor under the
 * fraction rather than the promise. Every check below that used to measure the
 * old promise was re-aimed at the role its number now has, not deleted: a guard
 * that measured the old rule should measure the new one. `view-width.ts`'s
 * header carries what changed and who changed it.
 *
 * ── WHY THIS CANNOT BE A UNIT TEST ────────────────────────────────────────
 * Every term of that sentence is a layout fact. happy-dom performs no layout,
 * so `test/panels/DetailPanel.view-width.test.tsx` can prove only WHICH element
 * the cap is put on; it cannot resolve a percentage, a `calc()`, a `ch` or a
 * rectangle. Worse, the halves of this feature fail in ways that look identical
 * to a DOM assertion:
 *
 *   - the floor is derived from an advance MEASURED ON THE OPERATOR'S OWN
 *     MACHINE. The first cut froze one macOS measurement into a constant, every
 *     unit test was green, and the first Linux run of THIS FILE read 83.95
 *     characters where it promised eighty. The independent measurement below
 *     is the whole reason that was caught, so it stays independent — it divides
 *     the prose the page really drew and shares nothing with the app's ruler.
 *   - `max(two thirds, floor)` and `two thirds` alone produce the SAME
 *     rectangle on a wide pane. Only a pane narrower than 1.5× the floor tells
 *     them apart, and only a pane narrower than the floor shows whether the cap
 *     still "never becomes a floor".
 *   - the terminal's floor is written in `ch`, which resolves against the
 *     ELEMENT'S OWN FONT. Moved onto a box drawn in the app's sans face it
 *     silently means the advance of a proportional `0` — 35% wider here — and
 *     the "eighty columns" comes out at 59 with every unit assertion green.
 *   - the pane's reading size is a scope that re-declares two custom
 *     properties. A selector that matches nothing reads exactly like one that
 *     works; only a computed `font-size` on a real element says which.
 *
 *   1. THE FRACTION BINDS, AT A WIDE PANE. The same demo transcript is measured
 *      full-pane and narrowed at 1600px; the body must land on two thirds of
 *      the pane, and the characters on a line — measured off the prose the
 *      page really drew — must fall by the same two thirds.
 *   2. ONE COLUMN. PRs and Agents, the composer and the question card must all
 *      land on the identical rectangle, on the operator's own instruction after
 *      the first screenshots. Compared to each other rather than to a number.
 *   3. THE FLOOR BINDS, AT A MID PANE. At an 800px window two thirds of the
 *      pane is under eighty characters, so the column must be the eighty and
 *      not the fraction. That is the check that separates `max(fraction,
 *      floor)` from a bare fraction — and it is where the floor's own mechanism
 *      is checked: stepped DOWN to `out` 10 the floor must get narrower, and
 *      stepped UP to 20 it must NOT, because the smallest step the pane reads
 *      at is then the scaled control step and the ruler follows that.
 *   4. A MAXIMUM IS NOT A FLOOR. At a 560px window and at a 390px phone the
 *      capped body must be the very same width as the uncapped one. A bare
 *      percentage would have failed this at both; the floor is why it holds.
 *   5. THE TERMINAL FOLLOWS THE SAME SENTENCE. At a wide pane it is two thirds
 *      of its containing block — more than eighty columns, and within 3% of
 *      the prose column (2.1% measured: the two caps resolve inside and
 *      outside the body's gutter). At a 1050px window its floor binds and vam
 *      asks tmux for exactly eighty, at every offered text size. Full-pane,
 *      the count is the box over the advance, unchanged from what shipped.
 *   6. THE PANE'S TEXT FOLLOWS THE READING SIZE. At `out` 15 and 20 the
 *      in-bubble prompt, the question text, the option labels and the composer
 *      must scale, each by ITS OWN share of the scale; `text-meta` chrome must
 *      not; and at `out` 10 nothing may shrink below the shipped scale.
 *
 * ── WHAT IS BEHIND THE PAGE ───────────────────────────────────────────────
 * The prose views run on `?demo=1`, vam's own invented fixture. The Terminal
 * cannot: `?demo=1` has no terminal bridge at all, so the pane is stubbed with
 * `page.addInitScript` exactly as `terminal-chrome-shots.mjs` does, and
 * `?demo=1` is kept on the URL to say on the face of the request that nothing
 * real is behind it. Every string in the stub is invented — no session id,
 * path, host or branch here belongs to a real machine.
 *
 * Falsified, each mutation alone and restored after, against a real build:
 *   - replace `max(fraction, floor)` with the bare fraction -> `at a mid pane
 *     the column is the eighty-character floor, not two thirds` reddens, and so
 *     do both `the cap changes no rectangle` checks (the phone narrows to
 *     260px).
 *   - replace it with the bare floor -> `narrowed, the body is two thirds of
 *     the pane` reddens.
 *   - size the ruler by `--text-control` alone -> `the floor follows the out
 *     stepper down to 10px` reddens.
 *   - size it by `--vam-out-font-size` alone -> `and stops following it up
 *     past the pane's smallest step` reddens.
 *   - take `font-mono` off the element the terminal's cap lands on -> every
 *     `vam asks tmux for exactly 80 columns at …` reddens.
 *   - drop the fraction from the terminal's cap (the old rule, quietly kept
 *     for one view) -> `at a wide pane the narrowed terminal is two thirds of
 *     its containing block` reddens at every size.
 *   - take the cap off the composer -> `narrowed, the composer bar is the same
 *     column the transcript is` reddens.
 *   - drop `Agents` from `narrowsAsProse` -> the agents rectangle check reddens.
 *   - delete the `[data-reading-pane]` block, drop `--text-control` from it,
 *     or take the attribute off the pane -> `at out 15 the option label is
 *     scaled by its own share` reddens.
 *   - key the block to `body` instead of the pane -> `the sidebar outside the
 *     pane does not move` reddens at 15 and 20. (Keyed to `html` it reddens
 *     differently: `--vam-pane-size` is declared there in terms of the very
 *     `--text-body` the block overrides, the cycle invalidates both, and the
 *     whole pane collapses to 12px -- `at out 13 the pane draws the shipped
 *     scale exactly` is what catches that.)
 *   - let `--text-meta` scale too -> `and text-meta chrome does not move`
 *     reddens.
 *   - make `--vam-pane-size` the bare out size -> `at out 10 nothing shrinks`
 *     reddens.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/view-width-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** `factory-sse-1` in `src/renderer/fixtures/demo.ts`. */
const DEMO_SESSION = 'factory-sse-1';
/** A demo session with NO question open, so the composer is drawn rather than
 *  withdrawn. The check that uses it asserts that emptiness rather than
 *  trusting this name. */
const DEMO_COMPOSER_SESSION = 'dogfood-4';
/** Invented, for the stubbed terminal. Nothing here names a real machine. */
const STUB_SESSION = 'atlas-width';
const STUB_BRANCH = 'work/atlas-width';

/**
 * The rule's two numbers, and the sizes the terminal offers.
 *
 * SPELLED HERE BECAUSE A BROWSER SCRIPT CANNOT IMPORT FROM `src/` — the same
 * constraint `terminal-chrome-shots.mjs` records for its own copy of the size
 * list. The unit suite is what holds the lists together: `FRACTION` is
 * `NARROW_PANE_FRACTION` and `FLOOR_CHARACTERS` is `NARROW_FLOOR_CHARACTERS`,
 * and `test/prefs/prefs.view-width.test.ts` derives every other number in the
 * feature from those two, so a change in the source that was not made here
 * fails there.
 */
const FRACTION = 2 / 3;
const FLOOR_CHARACTERS = 80;
const SIZES = [10.5, 11.5, 12.5, 14];
/** The type scale's own steps, for the reading-size checks. `type-scale.test.ts`
 *  pins these against `styles.css`. */
const SCALE = { meta: 11, control: 12, body: 13 };

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}
const near = (a, b, tolerance) => a !== null && b !== null && Math.abs(a - b) <= tolerance;

const browser = await chromium.launch();

/**
 * Seed the store and open the demo session.
 *
 * AN INIT SCRIPT AND NOT AN `evaluate` + `reload`, for the reason
 * `terminal-chrome-shots.mjs` records as a real failure rather than a
 * preference: `activatePrefs` runs on every read AND every write, so a mounted
 * app can put the whole prefs object back — including the value read a moment
 * ago — between the write and the reload. Init scripts run before any page
 * script, and they STACK in registration order, so the last one registered is
 * the one in force.
 */
async function openDemo(target, narrow, { phone = false, outFontSize } = {}) {
  await target.addInitScript(
    ([value, size]) => {
      globalThis.localStorage.setItem(
        'vam.prefs.v1',
        JSON.stringify(
          size === undefined ? { narrowViews: value } : { narrowViews: value, outFontSize: size },
        ),
      );
    },
    [narrow, outFontSize],
  );
  await target.goto(`${origin}/?demo=1&history=off`, { waitUntil: 'networkidle' });
  if (phone) {
    // The phone's session screen is reachable only by tapping a row, which is
    // the point of that screen: it is one session, not a browser over all of
    // them. `PhoneShell` mounts its own `DetailPanel`, which is exactly why
    // this width has to be checked here and not only on the desktop.
    await target.waitForSelector('[data-phone-shell="list"]');
    await target.locator('[data-session-row]').first().click();
    await target.waitForSelector('[data-phone-shell="session"]');
  }
  await target.waitForSelector('[data-detail-body]', { timeout: 10_000 });
  await target.waitForTimeout(250);
}

/**
 * The body's boxes, and how many characters of the page's OWN prose fit across
 * its content.
 *
 * THE ADVANCE IS MEASURED OFF WHAT WAS DRAWN, never assumed and never taken
 * from `ch`. `ch` is the advance of `0`, which in this face is 35% wider than a
 * character of English. So every text node inside the answer blocks that the
 * engine laid out as a SINGLE line is measured with a `Range`, and the total
 * ink over the total characters is the advance.
 */
const readProse = (target) =>
  target.evaluate(() => {
    const body = document.querySelector('[data-detail-body]');
    const style = getComputedStyle(body);
    const px = (value) => Number.parseFloat(value) || 0;
    const content = body.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
    let chars = 0;
    let ink = 0;
    for (const block of document.querySelectorAll('[data-detail-block="out"]')) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node !== null) {
        const text = node.textContent ?? '';
        if (text.trim().length >= 20 && !/Mono/.test(getComputedStyle(node.parentElement).fontFamily)) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const rects = [...range.getClientRects()];
          // Only a run the engine kept on ONE line has a clean advance.
          if (rects.length === 1) {
            chars += text.length;
            ink += rects[0].width;
          }
        }
        node = walker.nextNode();
      }
    }
    const advance = chars === 0 ? 0 : ink / chars;
    const boxOf = (selector) =>
      document.querySelector(selector)?.getBoundingClientRect().width ?? null;
    return {
      paneWidth: body.parentElement.clientWidth,
      boxWidth: body.getBoundingClientRect().width,
      composerWidth: boxOf('[data-composer-bar]'),
      questionWidth: boxOf('[data-question-bar]'),
      content,
      advance,
      sampled: chars,
      characters: advance === 0 ? 0 : content / advance,
      // What the app itself decided, for the log only. NEVER used in an
      // assertion: the whole value of this file is that its arithmetic shares
      // nothing with the app's.
      declared: body.style.maxWidth || null,
    };
  });

const openView = async (target, view) => {
  await target.locator(`[data-view="${view}"]`).click();
  await target.waitForTimeout(150);
};

/* ── 1 AND 2: THE FRACTION, AT A WIDE PANE, AND THE ONE COLUMN ───────────── */

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await openDemo(page, false);
const full = await readProse(page);
console.log('full pane:', JSON.stringify(full));
check(
  'the demo really drew prose to measure, so the advance is not an empty average',
  full.sampled > 300 && full.advance > 3,
  `${full.sampled} characters sampled, advance ${full.advance}`,
);
check(
  'full-pane, the response body fills its pane',
  near(full.boxWidth, full.paneWidth, 1),
  `body ${full.boxWidth}px in a ${full.paneWidth}px pane`,
);
check(
  'and a 1600px window really is the complaint: the line runs to two hundred characters',
  full.characters > 180,
  `${full.characters.toFixed(1)} characters across ${full.content}px`,
);
// THE PAGE ITSELF MUST NOT SCROLL SIDEWAYS, and nothing asked this until the
// ruler shipped. `absolute` takes an element out of FLOW but not out of its
// ancestor's SCROLLABLE OVERFLOW, so three hundred `whitespace-pre` characters
// -- ~1750px of them -- put `scrollWidth` at 2015 against a 1280px window and
// drew a scrollbar under the whole app. Every other check in this file passed
// while that was true, because they all measure a rectangle rather than the
// document. This one names the widest offender rather than only the number, so
// the next one is found rather than hunted.
const overflow = await page.evaluate(() => {
  const de = document.documentElement;
  const worst = [...document.querySelectorAll('*')]
    .map((el) => ({ el, right: el.getBoundingClientRect().right }))
    .filter((e) => e.right > de.clientWidth + 1)
    .sort((a, b) => b.right - a.right)[0];
  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    widest:
      worst === undefined
        ? null
        : `${worst.el.tagName.toLowerCase()}${[...worst.el.attributes]
            .map((a) => a.name)
            .filter((n) => n.startsWith('data-'))
            .map((n) => `[${n}]`)
            .join('')} to ${Math.round(worst.right)}px`,
  };
});
console.log(`document: scrollWidth ${overflow.scrollWidth} vs clientWidth ${overflow.clientWidth}`);
check(
  'the page does not scroll sideways, whatever is measured off-screen',
  overflow.scrollWidth <= overflow.clientWidth,
  `${overflow.scrollWidth - overflow.clientWidth}px of horizontal overflow; widest is ${overflow.widest}`,
);
await page.screenshot({ path: `${outDir}/view-width-full.png` });
console.log(`${outDir}/view-width-full.png`);
await page.close();

const narrowPage = await browser.newPage({ viewport: { width: 1600, height: 900 } });
narrowPage.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await openDemo(narrowPage, true);
const narrow = await readProse(narrowPage);
console.log('narrowed:', JSON.stringify(narrow));
// THE RULE, IN PIXELS: two thirds of the pane, to the pixel the engine rounds.
check(
  'narrowed, the body is two thirds of the pane',
  near(narrow.boxWidth, narrow.paneWidth * FRACTION, 1),
  `body ${narrow.boxWidth}px in a ${narrow.paneWidth}px pane; two thirds is ${(narrow.paneWidth * FRACTION).toFixed(1)}`,
);
/**
 * AND THE RULE, IN CHARACTERS — the unit the first version of this file was
 * written in, re-aimed. Divided by the FULL-PANE advance rather than the
 * narrowed page's own, and that is a methodology decision rather than a
 * convenience: the advance is a property of the face, not of the box, but the
 * SAMPLE is a property of the box — a narrower column wraps more, so fewer runs
 * survive the single-rectangle filter. The larger sample is the better estimate
 * of the face.
 */
const narrowCharacters = narrow.content / full.advance;
console.log(`narrowed capacity: ${narrowCharacters.toFixed(2)} characters across ${narrow.content}px`);
check(
  'and the line holds about two thirds as many characters as it did',
  near(narrowCharacters, full.characters * FRACTION, 4),
  `${narrowCharacters.toFixed(1)} against ${(full.characters * FRACTION).toFixed(1)}`,
);
// What the operator asked for is PAST the old eighty, and this file says so
// rather than quietly keeping both rules: on a wide pane the column is well
// over eighty characters, by design.
check(
  'which on a wide pane is deliberately past the old eighty-character rule',
  narrowCharacters > FLOOR_CHARACTERS + 20,
  `${narrowCharacters.toFixed(1)} characters`,
);
check(
  'the same face was measured in both states',
  Math.abs(narrow.advance - full.advance) < 0.35,
  `${full.advance.toFixed(4)}px full-pane vs ${narrow.advance.toFixed(4)}px narrowed`,
);
// ONE COLUMN, NOT A COLUMN ON TOP OF CHROME — the operator's own instruction
// after the first screenshots. Whichever of the two blocks the demo has open
// (a `QuestionCard` withdraws the composer) has to be the SAME rectangle as
// the transcript above it.
const belowNarrow = narrow.questionWidth ?? narrow.composerWidth;
check(
  'the demo drew a block under the transcript at all, so the next check is not vacuous',
  belowNarrow !== null,
  'neither a composer bar nor a question bar was on the page',
);
check(
  'narrowed, the question card is the same column the transcript is',
  near(belowNarrow, narrow.boxWidth, 1),
  `${belowNarrow}px under a ${narrow.boxWidth}px transcript`,
);
const belowFull = full.questionWidth ?? full.composerWidth;
check(
  'full-pane, that same block is the width of the pane',
  near(belowFull, full.paneWidth, 1),
  `${belowFull}px in a ${full.paneWidth}px pane`,
);
await narrowPage.screenshot({ path: `${outDir}/view-width-narrow.png` });
console.log(`${outDir}/view-width-narrow.png`);

const perView = { Response: narrow.boxWidth };
for (const view of ['prs', 'agents']) {
  await openView(narrowPage, view);
  const seen = await narrowPage.evaluate(
    () => document.querySelector('[data-detail-body]').getBoundingClientRect().width,
  );
  perView[view] = seen;
  check(
    `narrowed, the ${view} view is the same rectangle the response view is`,
    near(seen, narrow.boxWidth, 1),
    `${seen}px against the response view's ${narrow.boxWidth}px`,
  );
}
console.log('narrowed body width per view:', JSON.stringify(perView));
await narrowPage.screenshot({ path: `${outDir}/view-width-narrow-agents.png` });
console.log(`${outDir}/view-width-narrow-agents.png`);

// AND THE COMPOSER ITSELF, which the demo's focused session never shows: it has
// a `QuestionCard` open, and an open card WITHDRAWS the composer. So a session
// with no question is opened to measure the other block. Without it, taking
// the cap off the composer would redden nothing here.
await openView(narrowPage, 'response');
await narrowPage.locator(`[data-session-row="${DEMO_COMPOSER_SESSION}"]`).first().click();
await narrowPage.waitForSelector('[data-composer-bar]', { timeout: 5_000 });
await narrowPage.waitForTimeout(200);
const composerSeen = await narrowPage.evaluate(() => ({
  composer: document.querySelector('[data-composer-bar]')?.getBoundingClientRect().width ?? null,
  body: document.querySelector('[data-detail-body]')?.getBoundingClientRect().width ?? null,
  question: document.querySelector('[data-question-bar]'),
}));
console.log(
  `a session with no question open: composer ${composerSeen.composer}px, body ${composerSeen.body}px`,
);
check(
  'that session really has no question card, so this measures the composer',
  composerSeen.question === null,
  'a question bar was still on the page',
);
check(
  'narrowed, the composer bar is the same column the transcript is',
  near(composerSeen.composer, composerSeen.body, 1),
  `composer ${composerSeen.composer}px against a ${composerSeen.body}px transcript`,
);
await narrowPage.screenshot({ path: `${outDir}/view-width-narrow-composer.png` });
console.log(`${outDir}/view-width-narrow-composer.png`);
await narrowPage.close();

/* ── 3: THE FLOOR, AT A MID PANE, AND WHAT IT FOLLOWS ────────────────────── */

/**
 * THE CHECK THAT SEPARATES `max(fraction, floor)` FROM THE BARE FRACTION.
 *
 * At an 800px window the pane is ~535px, two thirds of that is ~357px, and the
 * eighty-character floor is ~460px: the floor is the wider of the two, so the
 * column MUST be the floor. On the 1600px pane above the two implementations
 * produce the identical rectangle, which is why a wide pane alone would have
 * been green for a reason nobody chose.
 *
 * AND THE FLOOR'S OWN MECHANISM IS CHECKED HERE, because a pane where the
 * floor binds is the only place it shows. The floor is eighty characters of
 * the SMALLEST step the pane reads at, `min(out, --text-control)`, and the two
 * halves of that `min()` are told apart by stepping `out` to each end: at 10
 * the answers are the smallest step and the floor must follow them down; at 20
 * the control step (now scaled to 18.5px) is the smallest, so the floor must
 * stop short of eighty 20px characters.
 *
 * THE `out` 20 PAGE IS A 1000px WINDOW, NOT 800, and that is a lesson rather
 * than a preference: at 800px the pane is 535px, and eighty characters at
 * EITHER 18.5px (~656px) or 20px (~703px) is wider than that, so the pane
 * clipped both answers to 535 and a ruler sized by the bare out size passed
 * the check as written first. At 1000px the pane is 735px, two thirds is
 * 490px, and both candidate floors fit inside — so the one the page really
 * drew can be told from the one it must not.
 */
const midpane = {};
for (const size of [10, 13, 20]) {
  const mid = await browser.newPage({
    viewport: { width: size === 20 ? 1000 : 800, height: 800 },
  });
  mid.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await openDemo(mid, true, { outFontSize: size });
  await mid.locator(`[data-session-row="${DEMO_SESSION}"]`).first().click();
  await mid.waitForTimeout(200);
  midpane[size] = await readProse(mid);
  if (size === 13) {
    await mid.screenshot({ path: `${outDir}/view-width-mid-pane.png` });
    console.log(`${outDir}/view-width-mid-pane.png`);
  }
  await mid.close();
}
console.log(
  'mid pane by out size:',
  JSON.stringify(
    Object.fromEntries(
      Object.entries(midpane).map(([size, s]) => [
        size,
        { pane: s.paneWidth, box: s.boxWidth, content: s.content, advance: Number(s.advance.toFixed(4)) },
      ]),
    ),
  ),
);
const mid = midpane[13];
check(
  'at a mid pane the cap still binds',
  mid.boxWidth < mid.paneWidth - 20,
  `body ${mid.boxWidth}px in a ${mid.paneWidth}px pane`,
);
check(
  'at a mid pane the column is the eighty-character floor, not two thirds',
  mid.boxWidth > mid.paneWidth * FRACTION + 40,
  `body ${mid.boxWidth}px; two thirds would be ${(mid.paneWidth * FRACTION).toFixed(1)}px`,
);
// The floor, in the unit it is defined in — measured off the page's own prose.
// The app's ruler is ordinary English against answers that run wider, and it
// is counted at the control step rather than the body step, so the column
// holds somewhat FEWER than eighty of the answer's own characters; what must
// hold is that it is a reading column and not a fraction of a small pane.
const midCharacters = mid.content / mid.advance;
console.log(`mid-pane capacity: ${midCharacters.toFixed(2)} characters across ${mid.content}px`);
check(
  'and that column is about eighty characters wide',
  midCharacters > FLOOR_CHARACTERS - 14 && midCharacters <= FLOOR_CHARACTERS,
  `${midCharacters.toFixed(1)} characters`,
);
check(
  'the floor follows the out stepper down to 10px',
  midpane[10].boxWidth < midpane[13].boxWidth - 20,
  `${midpane[10].boxWidth}px at 10 against ${midpane[13].boxWidth}px at 13`,
);
// At `out` 20 the control step is 20 × 12/13 = 18.46px, so the floor is eighty
// of THOSE: wider than at 13, and still the floor (two thirds of this pane is
// 490px), but short of eighty of the 20px characters the page really drew --
// which is what a ruler sized by the bare out size would produce. Measured:
// the page's own 20px advance is ~8.59px, so eighty of them is ~687px of
// content; the control-step floor is ~636px and the bare-out floor ~675px.
// 96% of the page's own eighty (~660px) sits between the two.
const twentyContent = midpane[20].content;
const eightyAtTwenty = FLOOR_CHARACTERS * midpane[20].advance;
check(
  'and stops following it up past the pane’s smallest step',
  midpane[20].boxWidth > midpane[13].boxWidth + 20 &&
    midpane[20].boxWidth < midpane[20].paneWidth - 20 &&
    twentyContent < eightyAtTwenty * 0.96,
  `${twentyContent}px of content at 20 against eighty 20px characters = ${eightyAtTwenty.toFixed(0)}px (box ${midpane[20].boxWidth}px in a ${midpane[20].paneWidth}px pane; ${midpane[13].boxWidth}px at 13)`,
);

/* ── 4: A MAXIMUM IS NOT A FLOOR ─────────────────────────────────────────── */

// 560px is a DESKTOP window one pixel-class above the phone breakpoint
// (`SIDEBAR_MIN + DETAIL_MIN`), so the detail pane there is near vam's
// narrowest legal one; 390px is the phone. Both are narrower than the floor,
// so the capped body must be the very same rectangle as the uncapped one. A
// BARE FRACTION WOULD FAIL BOTH OF THESE — the phone would go to 260px — which
// is the whole reason the floor survived the rule change.
for (const [label, viewport] of [
  ['a narrow desktop pane', { width: 560, height: 800 }],
  ['the phone', { width: 390, height: 844 }],
]) {
  const widths = [];
  const phone = viewport.width < 500;
  for (const narrowed of [false, true]) {
    const small = await browser.newPage({ viewport });
    small.on('pageerror', (err) => console.error('PAGE ERROR:', err));
    await openDemo(small, narrowed, { phone });
    if (!phone) {
      await small.locator(`[data-session-row="${DEMO_SESSION}"]`).first().click();
      await small.waitForTimeout(200);
    }
    widths.push(
      await small.evaluate(
        () => document.querySelector('[data-detail-body]').getBoundingClientRect().width,
      ),
    );
    if (narrowed) {
      const name = phone ? 'view-width-phone' : 'view-width-narrow-pane';
      await small.screenshot({ path: `${outDir}/${name}.png` });
      console.log(`${outDir}/${name}.png`);
    }
    await small.close();
  }
  console.log(`${label}: full ${widths[0]}px, narrowed ${widths[1]}px`);
  check(
    `at ${label} the cap changes no rectangle — a maximum never becomes a floor`,
    Math.abs(widths[0] - widths[1]) < 0.5 && widths[0] > 0,
    `full ${widths[0]}px, narrowed ${widths[1]}px`,
  );
}

/* ── 5: THE TERMINAL'S COLUMN COUNT ──────────────────────────────────────── */

const term = await browser.newPage({ viewport: { width: 1600, height: 900 } });
term.on('pageerror', (err) => console.error('PAGE ERROR:', err));

/**
 * A complete `PreloadSourceApi` stub whose `resize` RECORDS what it was asked.
 * Merely DEFINING `window.api` takes `App.tsx` off the `?demo=1` fixture and
 * onto `createSourceFromPreload(api)`, so it has to be complete or the page
 * reddens before a check runs — the note `terminal-ime-shots.mjs` left and
 * `terminal-chrome-shots.mjs` repeats.
 */
await term.addInitScript(
  ({ session, branch }) => {
    const SCREEN = Array.from(
      { length: 120 },
      (_, i) => `${String(i).padStart(3, '0')}  $ this line is composed at the width tmux was told`,
    ).join('\n');
    globalThis.window.__resized = [];
    const unavailable = () =>
      Promise.resolve({
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
      });
    globalThis.window.api = {
      describe: async () => ({
        id: 'stub',
        label: 'Stub',
        capabilities: {
          liveUpdates: false,
          recordPrompt: false,
          deliverPrompt: false,
          promptAttachments: false,
          slashCommands: false,
          renameSession: false,
          closeSession: false,
          createSession: false,
          governance: false,
          pullRequests: false,
          terminal: true,
          agentRoster: false,
        },
        declines: {},
        viewerScope: 'operator',
      }),
      load: async () => [
        {
          id: 'p1',
          name: 'stub project',
          sessions: [
            {
              id: session,
              title: 'stub session',
              icon: null,
              epic: null,
              branch,
              status: 'waiting',
              runningAgents: 0,
              activity: null,
              age: '2m',
              decisions: [
                { id: 'd1', label: 'step 1', input: 'a turn', output: 'an answer', commands: [] },
              ],
            },
          ],
        },
      ],
      subscribe: () => () => {},
      recordPrompt: async () => {},
      renameSession: async () => {},
      closeSession: async () => {},
      createSession: async () => {},
      createSessionIn: async () => {},
      pickImageAttachment: async () => null,
      history: async () => unavailable(),
      agentWork: async () => unavailable(),
      applyWaivers: async () => {},
      transitionLesson: async () => {},
      usage: { get: async () => ({ kind: 'unavailable' }) },
      terminal: {
        read: async () => ({
          kind: 'ok',
          name: 'vam-atlas-width-a1b2c3',
          text: SCREEN,
          cursor: { kind: 'unreadable' },
        }),
        resize: async (_projectId, columns, rows) => {
          globalThis.window.__resized.push({ columns, rows });
          return true;
        },
        send: async () => 'sent',
        answer: async () => ({ kind: 'unavailable' }),
        prompt: async () => ({ kind: 'unavailable' }),
      },
    };
  },
  { session: STUB_SESSION, branch: STUB_BRANCH },
);

async function openTerminal(size, narrowed) {
  await term.addInitScript(
    ([px, value]) => {
      globalThis.localStorage.setItem(
        'vam.prefs.v1',
        JSON.stringify({ terminalFontSize: px, narrowViews: value }),
      );
    },
    [size, narrowed],
  );
  await term.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await term.waitForSelector('[data-tab-strip]');
  await term.locator(`[data-session-row="${STUB_SESSION}"]`).first().click();
  await term.locator('[data-view="terminal"]').click();
  await term.waitForSelector('[data-terminal-pane]', { timeout: 5_000 });
  // The measurement is debounced, and it is the thing being read back.
  await term.waitForTimeout(450);
}

/**
 * The advance the screen is REALLY drawn at, the box vam really divided, and
 * the column count vam really asked for.
 *
 * The probe goes inside the `<pre>` for the reason `terminal-chrome-shots.mjs`
 * gives: reading the ruler alone would make this file self-consistent and
 * blind, because a size put on one element and not the other keeps vam's own
 * arithmetic agreeing with itself while every line on screen is composed for
 * the wrong width.
 */
const readTerminal = () =>
  term.evaluate(() => {
    const tab = document.querySelector('[data-terminal]');
    const pane = document.querySelector('[data-terminal-pane]');
    const screen = pane.querySelector('pre');
    const style = getComputedStyle(pane);
    const probe = document.createElement('span');
    probe.textContent = 'M'.repeat(10);
    probe.style.whiteSpace = 'pre';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    screen.appendChild(probe);
    const drawn = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const px = (value) => Number.parseFloat(value) || 0;
    const asked = globalThis.window.__resized.at(-1) ?? null;
    // The tab's containing block is the body's CONTENT box -- the body carries
    // the pane's gutter, and a percentage resolves inside it. Read as such,
    // rather than as `clientWidth`, which would include the gutter and put
    // "two thirds" 19px off for a reason that is the measurement's, not the
    // cap's.
    const body = tab.parentElement;
    const bodyStyle = getComputedStyle(body);
    return {
      tabWidth: tab.getBoundingClientRect().width,
      containerWidth: body.clientWidth - px(bodyStyle.paddingLeft) - px(bodyStyle.paddingRight),
      paneWidth: body.parentElement.clientWidth,
      content: pane.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
      drawn,
      columns: asked === null ? null : asked.columns,
    };
  });

// AT A WIDE PANE: two thirds, which is more than eighty columns, and within 3%
// of the prose column at the same pane — the two caps resolve their
// percentage against different boxes (the terminal's floor is in `ch` and can
// only live on the mono-faced element INSIDE the body's gutter, so its two
// thirds is of the content box: 871px against the prose's 890px at 1335px,
// 2.1% apart), so they are held near each other rather than pinned equal.
const wideReport = [];
for (const size of SIZES) {
  await openTerminal(size, true);
  const seen = await readTerminal();
  wideReport.push({ size, columns: seen.columns, tab: seen.tabWidth });
  check(
    `at a wide pane the narrowed terminal is two thirds of its containing block at ${size}px`,
    near(seen.tabWidth, seen.containerWidth * FRACTION, 1),
    `tab ${seen.tabWidth}px in a ${seen.containerWidth}px content box`,
  );
  check(
    `and that is more than eighty columns at ${size}px`,
    seen.columns !== null && seen.columns > FLOOR_CHARACTERS,
    `vam asked for ${seen.columns}`,
  );
  check(
    `and within 3% of the prose column at ${size}px`,
    near(seen.tabWidth, narrow.boxWidth, narrow.boxWidth * 0.03),
    `terminal ${seen.tabWidth}px against prose ${narrow.boxWidth}px`,
  );
  if (size === 12.5) {
    await term.screenshot({ path: `${outDir}/view-width-terminal-narrow.png` });
    console.log(`${outDir}/view-width-terminal-narrow.png`);
  }
}
console.log('terminal, wide pane:', JSON.stringify(wideReport));

// AT A MID PANE: the floor, exactly. A 1050px window puts the body's content
// box at ~757px, where two thirds (~505px) is under the floor at every offered
// size -- the 10.5px floor is the narrowest at ~535px -- so the eighty must
// win; and the 14px floor, the widest at ~705px, still sits well inside the
// box, so "the floor binds" is distinguishable from "the pane is small". The
// window is chosen for that pair of margins: at 1000px the 14px floor filled
// the box to within 3px, and at 1100px the fraction would have out-grown the
// 10.5px floor. The whole claim of writing the floor in `ch` is that "eighty"
// is the SAME count at 10.5px and at 14px alike.
await term.setViewportSize({ width: 1050, height: 800 });
const floorReport = [];
for (const size of SIZES) {
  await openTerminal(size, true);
  const seen = await readTerminal();
  floorReport.push({ size, columns: seen.columns, tab: seen.tabWidth, container: seen.containerWidth });
  check(
    `at a mid pane the floor binds at ${size}px rather than the pane being small`,
    seen.tabWidth < seen.containerWidth - 20,
    `tab ${seen.tabWidth}px in a ${seen.containerWidth}px content box`,
  );
  check(
    `and vam asks tmux for exactly ${FLOOR_CHARACTERS} columns at ${size}px`,
    seen.columns === FLOOR_CHARACTERS,
    `vam asked for ${seen.columns}; the box is ${seen.content}px at ${seen.drawn}px per cell`,
  );
}
console.log('terminal, mid pane:', JSON.stringify(floorReport));

// FULL-PANE: the count is still the box over the measured advance, unchanged
// from what shipped. Without this, "narrowed" could be the only state that
// works.
await term.setViewportSize({ width: 1600, height: 900 });
for (const size of SIZES) {
  await openTerminal(size, false);
  const wide = await readTerminal();
  const want = Math.floor(wide.content / wide.drawn);
  check(
    `full-pane, vam still asks for the ${want} columns that fit at ${size}px`,
    wide.columns === want,
    `vam asked for ${wide.columns} over a ${wide.content}px box at ${wide.drawn}px per cell`,
  );
  if (size === 12.5) {
    await term.screenshot({ path: `${outDir}/view-width-terminal-full.png` });
    console.log(`${outDir}/view-width-terminal-full.png`);
  }
}
await term.close();

/* ── 6: THE PANE'S TEXT FOLLOWS THE READING SIZE ─────────────────────────── */

/**
 * Operator report, translated: "the font size of the other parts of the pane
 * (in bubble, heading, choice popover, prompt input...) needs to be in
 * proportion to the out font size; at `out` 15 the answers are comfortably
 * large but the prompt's choice options are now very small."
 *
 * Four surfaces named, and each is read off a REAL element's computed
 * `font-size` rather than off the stylesheet: `styles.css` re-declares
 * `--text-body` and `--text-control` under `[data-reading-pane]`, and a selector
 * that matches nothing reads exactly like one that works. The mechanism check
 * is the RATIO: control must stay at 12/13 of body at every size, which is what
 * separates "scaled by its own share" from "set to the reading size" and from
 * "left alone". `text-meta` is read too, to prove it does NOT move — it is the
 * scale's floor and the chrome annotating the reading, and the terminal's
 * status rule wears it under a screen whose size has a setting of its own.
 */
const readType = (target) =>
  target.evaluate(() => {
    const size = (selector) => {
      const el = document.querySelector(selector);
      return el === null ? null : Number.parseFloat(getComputedStyle(el).fontSize);
    };
    return {
      bubble: size('[data-detail-block="in"] p'),
      question: size('[data-question-text]'),
      option: size('[data-question-option] > span'),
      chatKey: size('[data-question-chat-key]'),
      // The composer, which a session with a question open withdraws -- so
      // the loop below reads it off a second session, and the first read
      // carries `null` here on purpose.
      composer: size('[data-composer-bar] textarea'),
      // Outside the pane: the sidebar's session title is `text-body` too
      // (`data-row-title` in `SessionList.tsx`), and it must NOT follow a
      // setting that is about the pane. Read off the title itself -- the row
      // around it inherits a size no scale step sets, and read there this
      // check stayed green with the scope keyed to `body`.
      sidebar: size('[data-session-row] [data-row-title]'),
    };
  });
const typeBySize = {};
for (const size of [10, 13, 15, 20]) {
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  p.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await openDemo(p, false, { outFontSize: size });
  const withQuestion = await readType(p);
  await p.locator(`[data-session-row="${DEMO_COMPOSER_SESSION}"]`).first().click();
  await p.waitForSelector('[data-composer-bar] textarea', { timeout: 5_000 });
  const withComposer = await readType(p);
  typeBySize[size] = { ...withQuestion, composer: withComposer.composer };
  if (size === 15) {
    await p.locator(`[data-session-row="${DEMO_SESSION}"]`).first().click();
    await p.waitForSelector('[data-question-text]', { timeout: 5_000 });
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${outDir}/view-type-out-15.png` });
    console.log(`${outDir}/view-type-out-15.png`);
  }
  await p.close();
}
console.log('pane type by out size:', JSON.stringify(typeBySize));
check(
  'the named surfaces were all on the page, so nothing below is vacuous',
  [10, 13, 15, 20].every((s) =>
    ['bubble', 'question', 'option', 'chatKey', 'composer', 'sidebar'].every(
      (k) => typeBySize[s][k] !== null,
    ),
  ),
  JSON.stringify(typeBySize[13]),
);
check(
  'at out 13 the pane draws the shipped scale exactly',
  near(typeBySize[13].bubble, SCALE.body, 0.05) &&
    near(typeBySize[13].question, SCALE.body, 0.05) &&
    near(typeBySize[13].composer, SCALE.body, 0.05) &&
    near(typeBySize[13].option, SCALE.control, 0.05) &&
    near(typeBySize[13].chatKey, SCALE.meta, 0.05),
  JSON.stringify(typeBySize[13]),
);
for (const size of [15, 20]) {
  const t = typeBySize[size];
  check(
    `at out ${size} the in-bubble prompt, the question and the composer follow the reading size`,
    near(t.bubble, size, 0.05) && near(t.question, size, 0.05) && near(t.composer, size, 0.05),
    `bubble ${t.bubble}px, question ${t.question}px, composer ${t.composer}px`,
  );
  check(
    `at out ${size} the option label is scaled by its own share of the scale`,
    near(t.option, (size * SCALE.control) / SCALE.body, 0.05),
    `option ${t.option}px; ${SCALE.control}/${SCALE.body} of ${size} is ${((size * SCALE.control) / SCALE.body).toFixed(2)}`,
  );
  check(
    `and text-meta chrome does not move at out ${size}`,
    near(t.chatKey, SCALE.meta, 0.05),
    `chat key ${t.chatKey}px`,
  );
  check(
    `and the sidebar outside the pane does not move at out ${size}`,
    near(t.sidebar, SCALE.body, 0.05),
    `sidebar title ${t.sidebar}px against the shipped ${SCALE.body}px`,
  );
}
check(
  'at out 10 nothing shrinks below the shipped scale',
  near(typeBySize[10].bubble, SCALE.body, 0.05) &&
    near(typeBySize[10].composer, SCALE.body, 0.05) &&
    near(typeBySize[10].option, SCALE.control, 0.05) &&
    near(typeBySize[10].chatKey, SCALE.meta, 0.05),
  JSON.stringify(typeBySize[10]),
);

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} view-width guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('view width guards: all assertions passed');
