/**
 * THE VIEWS' WIDTH AND THE PANE'S READING SIZE, MEASURED IN A REAL ENGINE.
 *
 * ── THE RULE THIS FILE MEASURES, AND THE TWO IT MEASURED BEFORE ──────────
 * Narrowed means TWO THIRDS OF THE PANE, WHILE TWO THIRDS OF THE PANE IS AT
 * LEAST EIGHTY CHARACTERS; OTHERWISE THE WHOLE PANE. It used to mean "no more
 * than eighty characters on a line"; the operator used the build and asked for
 * two thirds instead ("narrow width cần lớn hơn, khoảng 2/3 pane width"), and
 * the eighty became the floor under the fraction rather than the promise. Then
 * they split a pane and met the floor as a defect — a ~508px column pinned in
 * the middle of a ~700px pane, margins shrinking around it — and asked that
 * "once a certain size is reached, the split pane goes full width". So the
 * eighty is now the THRESHOLD: a pane of at least one and a half floors is
 * narrowed to two thirds, a narrower one is left whole, and a narrowed column
 * is only ever one of those two rectangles. Every check below that used to
 * measure an older rule was re-aimed at the role its number now has, not
 * deleted: a guard that measured the old rule should measure the new one.
 * `view-width.ts`'s header carries what changed and who changed it.
 *
 * ── WHY THIS CANNOT BE A UNIT TEST ────────────────────────────────────────
 * Every term of that sentence is a layout fact. happy-dom performs no layout,
 * so `test/panels/DetailPanel.view-width.test.tsx` can prove only WHICH element
 * the cap is put on; it cannot resolve a percentage, a `calc()`, a `ch` or a
 * rectangle. `prefs.view-width.test.ts` resolves the step's arithmetic by hand,
 * which says where it should land and nothing about where Chromium rounds it
 * to. Worse, the halves of this feature fail in ways that look identical to a
 * DOM assertion:
 *
 *   - the floor is derived from an advance MEASURED ON THE OPERATOR'S OWN
 *     MACHINE. The first cut froze one macOS measurement into a constant, every
 *     unit test was green, and the first Linux run of THIS FILE read 83.95
 *     characters where it promised eighty. The independent measurement below
 *     is the whole reason that was caught, so it stays independent — it divides
 *     the prose the page really drew and shares nothing with the app's ruler.
 *   - the step, `max(two thirds, floor)` and `two thirds` alone all produce
 *     the SAME rectangle on a wide pane. Only a pane between one floor and one
 *     and a half tells the step from the old floor, and only a pane narrower
 *     than the floor shows whether the cap still "never becomes a floor".
 *   - the step is a ramp with a gain, not a discontinuity — CSS math has none
 *     — and whether the ramp is narrower than a layout unit is a claim about
 *     the engine, held here by sweeping a real pane across the boundary.
 *   - the terminal's floor is written in `ch`, which resolves against the
 *     ELEMENT'S OWN FONT. Moved onto a box drawn in the app's sans face it
 *     silently means the advance of a proportional `0` — 8% wider than a cell
 *     here — and the "eighty columns" comes out at 84 with every unit
 *     assertion green.
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
 *   3. THE STEP, AND WHAT IT FOLLOWS. The window is bisected to the narrowest
 *      pane at which the narrowed body is not the whole pane: one pixel of
 *      window below it the body must BE the whole pane, at it the body must be
 *      two thirds — and that two thirds, the narrowest column this setting ever
 *      draws, must be about eighty characters of the prose the page drew. That
 *      is the check that separates the step from the old floor, and it is
 *      where the floor's own mechanism is checked: stepped DOWN to `out` 10 the
 *      threshold must move in, and stepped UP to 20 it must move out but NOT as
 *      far as eighty of the 20px characters, because the smallest step the pane
 *      reads at is then the scaled control step and the ruler follows that.
 *   4. A MAXIMUM IS NOT A FLOOR. At a 560px window, at a 390px phone AND at a
 *      900px window — whose pane sits squarely between one floor and one and a
 *      half, where the old rule pinned the column — the capped body must be
 *      the very same width as the uncapped one.
 *   5. THE TERMINAL FOLLOWS THE SAME SENTENCE. At a wide pane it is two thirds
 *      of its containing block — more than eighty columns, and within 3% of
 *      the prose column (2.1% measured: the two caps resolve inside and
 *      outside the body's gutter). At a 1050px window, in the band where the
 *      old rule pinned eighty, the cap lets go and vam asks tmux for the
 *      columns that fit; bisected to ITS threshold, the narrowest narrowed
 *      terminal is exactly eighty columns, at every offered text size.
 *      Full-pane, the count is the box over the advance, unchanged.
 *   6. THE PANE'S TEXT FOLLOWS THE READING SIZE. At `out` 15 and 20 the
 *      in-bubble prompt, the question text, the option labels and the composer
 *      must scale, each by ITS OWN share of the scale; `text-meta` chrome must
 *      not; and at `out` 10 nothing may shrink below the shipped scale.
 *   7. THE SPLIT, WHICH IS WHERE THE OPERATOR MET THE DEFECT. One pane at
 *      1440, then `zv` into two, then at 2000 into three, and the terminal
 *      split the same way at 3100: every pane's column must be exactly two
 *      thirds of its pane or exactly the whole of it, decided by the threshold
 *      measured in 3, and the three-way layout must show both answers at once.
 *      A two-pane split at 1440 is the operator's own case — each pane wider
 *      than the floor and narrower than one and a half of it — and it is the
 *      screenshot committed under `docs/ui/narrow-split-two.png`.
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
 *   - put the old `max(fraction, floor)` back -> 25 checks redden. `at a pane
 *     between one and one and a half floors the cap changes no rectangle`
 *     (468px against a 635px pane); the bisection finds the FLOOR binding
 *     instead of the step, so `at the threshold the body is two thirds of the
 *     pane` reddens at 13 and 20 (468px in a 470px pane) and at 10 the range
 *     no longer brackets anything (404px in a 435px pane at the low end); the
 *     1050px terminal checks redden at every text size (the tab is 632px in a
 *     757px box and tmux is asked for 80); and in the split both 1440 panes
 *     come out `between` — 468px in 587px panes.
 *   - move the threshold to 1.25 floors -> 14 checks redden, from the other
 *     side: the bisection finds the step at a 585px pane, where two thirds is
 *     60.3 characters, so `the narrowest column this setting draws is about
 *     eighty characters` reddens; the terminal's `exactly 80 columns` reads 66
 *     at every size; the 900px pane narrows to 423px; and the 1440 split's
 *     587px panes land 2px from the moved threshold, which the 20px-margin
 *     check refuses to judge.
 *   - size the ruler by `--text-control` alone -> `the threshold follows the
 *     out stepper down to 10px` reddens (702px at 10 against 702px at 13).
 *   - size it by `--vam-out-font-size` alone -> `and stops following it up
 *     past the pane's smallest step` reddens (675px of content against 96% of
 *     691).
 *   - take `font-mono` off the element the terminal's cap lands on -> every
 *     `at its threshold vam asks tmux for exactly 80 columns at …` reddens:
 *     `ch` then means the sans face's `0`, and the count is 84 at every size.
 *   - keep the flat eighty-column floor for the terminal alone (the old rule,
 *     quietly kept for one view) -> `at a wide pane the narrowed terminal is
 *     two thirds of its containing block` reddens at every size, and so do the
 *     1050px band checks.
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

/* ── 3: THE STEP, AND WHAT IT FOLLOWS ───────────────────────────────────── */

/**
 * THE CHECK THAT SEPARATES THE STEP FROM `max(fraction, floor)`.
 *
 * Under the old rule a pane between one floor and one and a half got the
 * floor: at an 800px window the pane is ~535px, two thirds of that is ~357px,
 * the eighty-character floor is ~508px, and the column was the 508 with the
 * margins shrinking around it. Under the step that pane is left whole, and
 * the floor shows up somewhere else: as the ONE PANE WIDTH at which the
 * narrowed body stops being the whole pane. So rather than a window chosen to
 * land where the floor binds, the window is BISECTED to that width — the
 * narrowest at which the body is not its pane — and the rule is read off both
 * sides of it. One pixel of window below, the body must be the pane; at it,
 * two thirds; and that two thirds, being two thirds of one and a half floors,
 * IS the floor, so it must be about eighty characters of the prose the page
 * really drew.
 *
 * AND THE FLOOR'S OWN MECHANISM IS CHECKED HERE, because the threshold is now
 * the only place it shows. The floor is eighty characters of the SMALLEST step
 * the pane reads at, `min(out, --text-control)`, and the two halves of that
 * `min()` are told apart by stepping `out` to each end: at 10 the answers are
 * the smallest step and the threshold must move in with them; at 20 the
 * control step (now scaled to 18.5px) is the smallest, so the threshold must
 * move out — but stop short of one and a half times eighty of the 20px
 * characters the page really drew, which is where a ruler sized by the bare
 * out size would put it.
 *
 * WHY BISECT RATHER THAN PICK A WINDOW, given the old checks picked one: the
 * two candidate floors at `out` 20 — the control step's and the bare out
 * size's — are about 6% apart, so the band of panes that tells them apart is
 * ~60px wide and sits ~50px lower on the Linux runner, whose face is 5%
 * narrower, than on this machine. No fixed window lands in both bands. The
 * threshold itself moves with the face, and measuring it moves with it too.
 */
const readBody = (target) =>
  target.evaluate(() => {
    const body = document.querySelector('[data-detail-body]');
    return {
      pane: body.parentElement.clientWidth,
      box: body.getBoundingClientRect().width,
    };
  });

/**
 * The narrowest window at which the narrowed body is not the whole pane,
 * to the pixel, by bisection over the viewport width; and what the body
 * measured one pixel either side of it.
 *
 * The predicate is "narrower than the pane by more than a pixel", read
 * straight off rectangles; nothing here knows the threshold, the fraction or
 * the floor. Both ends are checked before bisecting, so a rule that narrowed
 * everywhere (the bare fraction) or nowhere fails LOUDLY here rather than
 * converging on an end of the range and passing a comparison by accident.
 */
async function bisectThreshold(target, label, low, high) {
  const at = async (width) => {
    await target.setViewportSize({ width, height: 800 });
    await target.waitForTimeout(60);
    const seen = await readBody(target);
    return { width, ...seen, narrowed: seen.box < seen.pane - 1 };
  };
  let lo = await at(low);
  let hi = await at(high);
  check(
    `${label}: the range brackets the threshold — whole at ${low}px, narrowed at ${high}px`,
    !lo.narrowed && hi.narrowed,
    `at ${low}: body ${lo.box}px in ${lo.pane}px; at ${high}: body ${hi.box}px in ${hi.pane}px`,
  );
  if (!(!lo.narrowed && hi.narrowed)) return { below: lo, threshold: hi, bracketed: false };
  while (hi.width - lo.width > 1) {
    const mid = await at(Math.floor((lo.width + hi.width) / 2));
    if (mid.narrowed) hi = mid;
    else lo = mid;
  }
  return { below: lo, threshold: hi, bracketed: true };
}

const thresholds = {};
for (const size of [10, 13, 20]) {
  const mid = await browser.newPage({ viewport: { width: 700, height: 800 } });
  mid.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await openDemo(mid, true, { outFontSize: size });
  await mid.locator(`[data-session-row="${DEMO_SESSION}"]`).first().click();
  await mid.waitForTimeout(200);
  // 700..1500: the pane runs ~435..1235px, which brackets one and a half of
  // every floor the three sizes produce on either platform (the 10px floor on
  // the Linux face is ~386px, the 20px control-step floor here is ~664).
  const found = await bisectThreshold(mid, `out ${size}`, 700, 1500);
  // SETTLE ON THE THRESHOLD WINDOW BEFORE READING THE PROSE. The bisection
  // leaves the viewport wherever its last probe landed, which is either side
  // of the step; read there, the "narrowest column" below was once the whole
  // pane -- 92 characters across -- and the check was green for the wrong
  // state on one run and red for the wrong reason on another.
  await mid.setViewportSize({ width: found.threshold.width, height: 800 });
  await mid.waitForTimeout(100);
  const prose = found.bracketed ? await readProse(mid) : null;
  thresholds[size] = { ...found, prose };
  console.log(
    `out ${size}: threshold at a ${found.threshold.width}px window — body ${found.threshold.box}px in a ${found.threshold.pane}px pane; one pixel below, body ${found.below.box}px in a ${found.below.pane}px pane`,
  );
  if (size === 13 && found.bracketed) {
    await mid.screenshot({ path: `${outDir}/view-width-mid-pane.png` });
    console.log(`${outDir}/view-width-mid-pane.png`);
  }
  await mid.close();
}
for (const size of [10, 13, 20]) {
  const { below, threshold } = thresholds[size];
  check(
    `out ${size}: one pixel of window below the threshold the body is the whole pane`,
    near(below.box, below.pane, 1),
    `body ${below.box}px in a ${below.pane}px pane`,
  );
  // THE STEP IS SHARP: the very next pixel of window is two thirds, and not
  // a column somewhere on its way there. This is the ramp claim, measured.
  check(
    `out ${size}: at the threshold the body is two thirds of the pane, not a width between`,
    near(threshold.box, threshold.pane * FRACTION, 1),
    `body ${threshold.box}px in a ${threshold.pane}px pane; two thirds is ${(threshold.pane * FRACTION).toFixed(1)}`,
  );
}
const atThirteen = thresholds[13].prose;
// The floor, in the unit it is defined in — measured off the page's own prose
// at the one pane where two thirds IS the floor. The app's ruler is ordinary
// English against answers that run wider, and it is counted at the control
// step rather than the body step, so the column holds somewhat FEWER than
// eighty of the answer's own characters; what must hold is that it is a
// reading column and not a fraction of a small pane. DIVIDED BY THE FULL-PANE
// ADVANCE from section 1, for the reason given there: the face is the same
// at both widths, and a 440px column keeps too few single-line runs for its
// own average to be trusted (with the threshold mutated to 1.25 floors, the
// 362px column's own sample read 3.9px a character and 92 across, where the
// full-pane advance reads the same column as 60).
const midCharacters = atThirteen === null ? 0 : atThirteen.content / full.advance;
console.log(
  `at the out-13 threshold: ${midCharacters.toFixed(2)} characters across ${atThirteen?.content}px of content`,
);
check(
  'the narrowest column this setting draws is about eighty characters wide',
  midCharacters > FLOOR_CHARACTERS - 14 && midCharacters <= FLOOR_CHARACTERS,
  `${midCharacters.toFixed(1)} characters`,
);
check(
  'the threshold follows the out stepper down to 10px',
  thresholds[10].threshold.pane < thresholds[13].threshold.pane - 20,
  `${thresholds[10].threshold.pane}px at 10 against ${thresholds[13].threshold.pane}px at 13`,
);
// At `out` 20 the control step is 20 × 12/13 = 18.46px, so the floor is eighty
// of THOSE: the threshold moves out past the 13px one, but stops short of one
// and a half times eighty of the 20px characters the page really drew --
// which is where a ruler sized by the bare out size would put it. Measured:
// the page's own 20px advance is ~8.59px, so eighty of them is ~687px of
// content; the control-step floor is ~636px and the bare-out floor ~675px.
// 96% of the page's own eighty (~660px) sits between the two. The column at
// the threshold is two thirds of one and a half floors, i.e. the floor, so it
// is read directly rather than derived.
const twenty = thresholds[20].prose;
const twentyContent = twenty === null ? 0 : twenty.content;
const eightyAtTwenty = twenty === null ? 0 : FLOOR_CHARACTERS * twenty.advance;
check(
  'and stops following it up past the pane’s smallest step',
  thresholds[20].threshold.pane > thresholds[13].threshold.pane + 20 &&
    twentyContent < eightyAtTwenty * 0.96,
  `${twentyContent}px of content at the out-20 threshold against eighty 20px characters = ${eightyAtTwenty.toFixed(0)}px (threshold pane ${thresholds[20].threshold.pane}px at 20; ${thresholds[13].threshold.pane}px at 13)`,
);
/** The out-13 floor in pixels, as the page really drew it: two thirds of the
 *  threshold pane. Sections 4 and 7 use it to say a pane is "between one floor
 *  and one and a half" with a measured number rather than an assumed one. */
const FLOOR_PX = thresholds[13].threshold.pane * FRACTION;
const THRESHOLD_PX = thresholds[13].threshold.pane;
console.log(`floor ${FLOOR_PX.toFixed(1)}px, threshold ${THRESHOLD_PX}px, at out 13`);

/* ── 4: A MAXIMUM IS NOT A FLOOR ─────────────────────────────────────────── */

// 560px is a DESKTOP window one pixel-class above the phone breakpoint
// (`SIDEBAR_MIN + DETAIL_MIN`), so the detail pane there is near vam's
// narrowest legal one; 390px is the phone. Both are narrower than the floor,
// so the capped body must be the very same rectangle as the uncapped one. A
// BARE FRACTION WOULD FAIL BOTH OF THESE — the phone would go to 260px — which
// is the whole reason the floor survived the rule change.
//
// AND 900px IS THE OPERATOR'S DEFECT, on a single pane: its ~635px pane sits
// between one floor and one and a half (~508 and ~762 here, ~485 and ~728 on
// the Linux face), which is exactly the band where `max(two thirds, floor)`
// pinned a 508px column with 64px of margin either side. The step leaves that
// pane whole, so the same "changes no rectangle" holds there — and the check
// says, from the threshold measured in 3, that the pane really is in the band
// rather than under the floor, where the old rule would have passed it too.
for (const [label, viewport, shot] of [
  ['a narrow desktop pane', { width: 560, height: 800 }, 'view-width-narrow-pane'],
  ['the phone', { width: 390, height: 844 }, 'view-width-phone'],
  ['a pane between one and one and a half floors', { width: 900, height: 800 }, 'view-width-band'],
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
    widths.push(await readBody(small));
    if (narrowed) {
      await small.screenshot({ path: `${outDir}/${shot}.png` });
      console.log(`${outDir}/${shot}.png`);
    }
    await small.close();
  }
  const [full, capped] = widths;
  console.log(`${label}: full ${full.box}px, narrowed ${capped.box}px, in a ${capped.pane}px pane`);
  if (viewport.width === 900) {
    check(
      'that pane really is between one floor and one and a half, so the next check is about the band',
      capped.pane > FLOOR_PX + 20 && capped.pane < THRESHOLD_PX - 20,
      `pane ${capped.pane}px against a floor of ${FLOOR_PX.toFixed(1)}px and a threshold of ${THRESHOLD_PX}px`,
    );
  }
  check(
    `at ${label} the cap changes no rectangle — a maximum never becomes a floor`,
    Math.abs(full.box - capped.box) < 0.5 && full.box > 0,
    `full ${full.box}px, narrowed ${capped.box}px`,
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

// AT A MID PANE: THE BAND, where the old rule pinned eighty. A 1050px window
// puts the body's content box at ~757px, which is wider than every offered
// size's floor (the 14px one is the widest at ~705px) and narrower than one
// and a half of every one of them (the 10.5px threshold is the nearest at
// ~802px) -- so at every size this is the band between one floor and one and a
// half, the same band the operator met in a split. The old rule answered it
// with eighty columns in the middle of the box; the step leaves the tab its
// whole box and vam asks tmux for the columns that FIT, which is more than
// eighty at every size. The window was chosen for the old rule's margins and
// happens to sit inside the band at all four sizes, which is why it is kept.
await term.setViewportSize({ width: 1050, height: 800 });
const bandReport = [];
for (const size of SIZES) {
  await openTerminal(size, true);
  const seen = await readTerminal();
  const fit = Math.floor(seen.content / seen.drawn);
  bandReport.push({ size, columns: seen.columns, tab: seen.tabWidth, container: seen.containerWidth, fit });
  check(
    `in the band the cap lets go at ${size}px — the tab is its whole box`,
    near(seen.tabWidth, seen.containerWidth, 1),
    `tab ${seen.tabWidth}px in a ${seen.containerWidth}px content box`,
  );
  check(
    `and vam asks tmux for the ${fit} columns that fit at ${size}px, more than ${FLOOR_CHARACTERS}`,
    seen.columns === fit && fit > FLOOR_CHARACTERS,
    `vam asked for ${seen.columns}; the box is ${seen.content}px at ${seen.drawn}px per cell`,
  );
}
console.log('terminal, in the band:', JSON.stringify(bandReport));

/**
 * AT ITS THRESHOLD: EXACTLY EIGHTY. The narrowest terminal vam ever narrows to
 * is two thirds of a pane exactly one and a half of its floor wide, which is
 * the floor -- eighty and a half cells plus the pane's chrome -- so at the
 * narrowest window that narrows the tab at all, the column count sent to
 * tmux must be exactly eighty. This is where the `ch` floor is checked in the
 * unit it is written in, at every offered size: the threshold moves with the
 * cell, and the count at it must not.
 *
 * BISECTED, like the prose threshold, and for the same reason: the threshold
 * is a property of the face the screen is really drawn in. The predicate is
 * the tab's rectangle against its containing block, which resolves in the
 * same layout pass as the resize; only the column count is debounced, so it
 * is read once, after the bisection settles on the threshold window.
 */
const readTab = () =>
  term.evaluate(() => {
    const tab = document.querySelector('[data-terminal]');
    const body = tab.parentElement;
    const style = getComputedStyle(body);
    const px = (value) => Number.parseFloat(value) || 0;
    return {
      box: tab.getBoundingClientRect().width,
      pane: body.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
    };
  });
const terminalThresholds = [];
for (const size of SIZES) {
  await term.setViewportSize({ width: 800, height: 800 });
  await openTerminal(size, true);
  const at = async (width) => {
    await term.setViewportSize({ width, height: 800 });
    await term.waitForTimeout(60);
    const seen = await readTab();
    return { width, ...seen, narrowed: seen.box < seen.pane - 1 };
  };
  // 800..1700: content boxes of ~507..1407px, bracketing one and a half of
  // every size's floor (~802px at 10.5, ~1057px at 14 here).
  let lo = await at(800);
  let hi = await at(1700);
  check(
    `terminal at ${size}px: the range brackets the threshold — whole at 800px, narrowed at 1700px`,
    !lo.narrowed && hi.narrowed,
    `at 800: tab ${lo.box}px in ${lo.pane}px; at 1700: tab ${hi.box}px in ${hi.pane}px`,
  );
  if (!(!lo.narrowed && hi.narrowed)) continue;
  while (hi.width - lo.width > 1) {
    const mid = await at(Math.floor((lo.width + hi.width) / 2));
    if (mid.narrowed) hi = mid;
    else lo = mid;
  }
  // The count is debounced; settle on the threshold window and read it.
  await term.setViewportSize({ width: hi.width, height: 800 });
  await term.waitForTimeout(600);
  const seen = await readTerminal();
  terminalThresholds.push({ size, window: hi.width, tab: seen.tabWidth, container: seen.containerWidth, columns: seen.columns, below: lo });
  check(
    `terminal at ${size}px: one pixel of window below its threshold the tab is its whole box`,
    near(lo.box, lo.pane, 1),
    `tab ${lo.box}px in a ${lo.pane}px box at a ${lo.width}px window`,
  );
  check(
    `terminal at ${size}px: at its threshold the tab is two thirds of its box`,
    near(seen.tabWidth, seen.containerWidth * FRACTION, 1),
    `tab ${seen.tabWidth}px in a ${seen.containerWidth}px box at a ${hi.width}px window`,
  );
  check(
    `and at its threshold vam asks tmux for exactly ${FLOOR_CHARACTERS} columns at ${size}px`,
    seen.columns === FLOOR_CHARACTERS,
    `vam asked for ${seen.columns}; the box is ${seen.content}px at ${seen.drawn}px per cell`,
  );
}
console.log('terminal thresholds:', JSON.stringify(terminalThresholds.map(({ below, ...rest }) => rest)));

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

/* ── 7: THE SPLIT, WHERE THE OPERATOR MET THE DEFECT ─────────────────────── */

/**
 * Operator report, translated: "with the narrowed view, the split should be
 * computed against the min width, so the narrow width does not get too small
 * when panes are split — once a certain size is reached, the split pane goes
 * full width."
 *
 * A SPLIT IS THE ORDINARY WAY TO A PANE IN THE BAND. A single pane on a
 * desktop window is almost always past one and a half floors; halve it and it
 * is almost always between one floor and one and a half, which is exactly the
 * band where the old rule pinned the column. So this section measures the
 * rule where it was found wanting: every `[data-split-pane]` that draws a body
 * is read against ITS OWN containing block, and each column must be exactly
 * two thirds of that block or exactly the whole of it — nothing between, and
 * which one is decided by the threshold section 3 measured, with 20px of
 * margin either side so no pane is judged at the edge.
 *
 * `zv` MOVES the focused tab into the new pane (`splitFocused`'s own note),
 * so after one split the source pane keeps the demo project's other two tabs
 * and the new pane holds the one; after a second `zv` on the new pane, that
 * one moves again and leaves an empty pane behind. A pane with no body is
 * logged and skipped, not asserted about.
 *
 * WIDTHS: 1440 is where the operator's two-pane split lands in the band on
 * either platform (~587px panes against floors of ~508/~485 and thresholds of
 * ~762/~728); 2000 is where a two-way split is past the threshold (~867px)
 * and a three-way split's quarter pane (~434px) is under it, so one layout
 * shows both answers at once. `zv` on a 587px pane is refused — `MIN_PANE_PX`
 * twice — which is why the three-way split is not attempted at 1440.
 */
const readPanes = (target) =>
  target.evaluate(() => {
    return [...document.querySelectorAll('[data-split-pane]')].map((pane, at) => {
      const body = pane.querySelector('[data-detail-body]');
      if (body === null) return { at, pane: pane.clientWidth, container: null, box: null };
      return {
        at,
        pane: pane.clientWidth,
        container: body.parentElement.clientWidth,
        box: body.getBoundingClientRect().width,
      };
    });
  });
/** What a column measured as, against its own containing block. */
const classify = ({ container, box }) =>
  container === null
    ? 'empty'
    : near(box, container, 1)
      ? 'whole'
      : near(box, container * FRACTION, 1)
        ? 'two-thirds'
        : 'between';
/**
 * The rule, applied to one layout: every drawn column is whole or two thirds,
 * and which is decided by the pane against the threshold. `expect` names the
 * answers the layout was chosen to show, so a layout where a split was refused
 * (one pane instead of two) fails on the count rather than passing vacuously.
 */
function checkLayout(label, panes, expect) {
  const states = panes.map(classify);
  console.log(
    `${label}: ${panes
      .map((p, i) => `pane ${i} ${p.pane}px` + (p.box === null ? ' (empty)' : `, body ${p.box}px in ${p.container}px → ${states[i]}`))
      .join('; ')}`,
  );
  check(
    `${label}: ${expect.panes} pane(s) were drawn`,
    panes.length === expect.panes,
    `${panes.length} panes`,
  );
  check(
    `${label}: no column sits between two thirds of its pane and the whole of it`,
    !states.includes('between'),
    states.join(', '),
  );
  for (const [i, p] of panes.entries()) {
    if (p.container === null) continue;
    const want = p.container >= THRESHOLD_PX + 20 ? 'two-thirds' : p.container <= THRESHOLD_PX - 20 ? 'whole' : null;
    check(
      `${label}: pane ${i} is not within 20px of the threshold, so its answer is not a coin toss`,
      want !== null,
      `container ${p.container}px against a threshold of ${THRESHOLD_PX}px`,
    );
    if (want === null) continue;
    check(
      `${label}: pane ${i} (${p.container}px, ${want === 'whole' ? 'under' : 'past'} the threshold) is ${want}`,
      states[i] === want,
      `body ${p.box}px; two thirds is ${(p.container * FRACTION).toFixed(1)}px`,
    );
  }
  const drawn = states.filter((s) => s !== 'empty');
  for (const state of expect.states) {
    check(`${label}: at least one pane came out ${state}`, drawn.includes(state), drawn.join(', '));
  }
}
/** A screenshot of the panes alone — the sidebar cropped away with `clip`,
 *  the height held to the top of the layout so the file stays small. */
async function shootPanes(target, name) {
  const boxes = await target.locator('[data-split-pane]').evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, top: r.top })),
  );
  const left = Math.min(...boxes.map((b) => b.left));
  const right = Math.max(...boxes.map((b) => b.right));
  const top = Math.min(...boxes.map((b) => b.top));
  await target.screenshot({
    path: `${outDir}/${name}.png`,
    clip: { x: left, y: top, width: right - left, height: 600 },
  });
  console.log(`${outDir}/${name}.png`);
}
const splitChord = async (target) => {
  await target.keyboard.press('z');
  await target.keyboard.press('v');
  await target.waitForTimeout(250);
};

const split = await browser.newPage({ viewport: { width: 1440, height: 900 } });
split.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await openDemo(split, true);
await split.locator(`[data-session-row="${DEMO_SESSION}"]`).first().click();
await split.waitForTimeout(200);
checkLayout('one pane at 1440', await readPanes(split), { panes: 1, states: ['two-thirds'] });
await splitChord(split);
// THE OPERATOR'S CASE: two panes, each between one floor and one and a half.
const two1440 = await readPanes(split);
for (const [i, p] of two1440.entries()) {
  if (p.container === null) continue;
  check(
    `two panes at 1440: pane ${i} is wider than the floor, so this is the band and not a pane the floor never reached`,
    p.container > FLOOR_PX + 20,
    `container ${p.container}px against a floor of ${FLOOR_PX.toFixed(1)}px`,
  );
}
checkLayout('two panes at 1440', two1440, { panes: 2, states: ['whole'] });
await shootPanes(split, 'narrow-split-two');
await split.setViewportSize({ width: 2000, height: 900 });
await split.waitForTimeout(250);
checkLayout('two panes at 2000', await readPanes(split), { panes: 2, states: ['two-thirds'] });
await splitChord(split);
checkLayout('three panes at 2000', await readPanes(split), { panes: 3, states: ['two-thirds', 'whole'] });
await shootPanes(split, 'narrow-split-three');
await split.close();

/**
 * AND THE TERMINAL, split the same way. Its floor is in cells, which are wider
 * than characters, so both its floor and its threshold sit at a wider pane
 * than the prose views' (~632px and ~948px of content box at 12.5px here,
 * against ~468 and ~702): 3100 is where a two-way split (~1417px panes) is
 * past the threshold with room to spare and a three-way split's quarter pane
 * (~709px) is IN THE BAND — wider than the floor, narrower than one and a
 * half of it — which is the operator's case for this view, and the one a
 * 2600px window missed on the first run: its 584px quarter pane was under the
 * floor, whole for the reason the phone is whole, and asked tmux for 70. The
 * stub has one session, so each `zv` leaves an empty pane behind and the
 * terminal is always in the newest, smallest one; the threshold is read off
 * the bisection above at the same size rather than assumed.
 */
const termSplit = await browser.newPage({ viewport: { width: 3100, height: 900 } });
termSplit.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await termSplit.addInitScript(
  ({ session, branch }) => {
    // The same stub `term` runs on -- see its own note for why it must be
    // complete. Duplicated rather than hoisted because `addInitScript` takes
    // a function it serialises, and a shared function would have to close
    // over nothing, which this one already does not.
    globalThis.window.__resized = [];
    const unavailable = () =>
      Promise.resolve({ kind: 'unavailable', error: { kind: 'unreachable', code: 'stub', message: 'stub source' } });
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
              decisions: [{ id: 'd1', label: 'step 1', input: 'a turn', output: 'an answer', commands: [] }],
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
          text: Array.from({ length: 40 }, (_, i) => `${String(i).padStart(3, '0')}  $ composed at the width tmux was told`).join('\n'),
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
await termSplit.addInitScript(() => {
  globalThis.localStorage.setItem('vam.prefs.v1', JSON.stringify({ terminalFontSize: 12.5, narrowViews: true }));
});
await termSplit.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
await termSplit.waitForSelector('[data-tab-strip]');
await termSplit.locator(`[data-session-row="${STUB_SESSION}"]`).first().click();
await termSplit.locator('[data-view="terminal"]').click();
await termSplit.waitForSelector('[data-terminal-pane]', { timeout: 5_000 });
await termSplit.waitForTimeout(450);
const readTerminalPanes = (target) =>
  target.evaluate(() => {
    const px = (value) => Number.parseFloat(value) || 0;
    return [...document.querySelectorAll('[data-split-pane]')].map((pane, at) => {
      const tab = pane.querySelector('[data-terminal]');
      if (tab === null) return { at, pane: pane.clientWidth, container: null, box: null };
      const body = tab.parentElement;
      const style = getComputedStyle(body);
      // The box vam divided and the cell it divided by, read the way
      // `readTerminal` reads them, so "what fits" is measured and not assumed.
      const screen = pane.querySelector('[data-terminal-pane]');
      const screenStyle = getComputedStyle(screen);
      const probe = document.createElement('span');
      probe.textContent = 'M'.repeat(10);
      probe.style.whiteSpace = 'pre';
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      screen.querySelector('pre').appendChild(probe);
      const drawn = probe.getBoundingClientRect().width / 10;
      probe.remove();
      return {
        at,
        pane: pane.clientWidth,
        container: body.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
        box: tab.getBoundingClientRect().width,
        content: screen.clientWidth - px(screenStyle.paddingLeft) - px(screenStyle.paddingRight),
        drawn,
        columns: globalThis.window.__resized.at(-1)?.columns ?? null,
      };
    });
  });
const twelveAndAHalf = terminalThresholds.find((t) => t.size === 12.5);
const TERMINAL_THRESHOLD_PX = twelveAndAHalf === undefined ? Number.NaN : twelveAndAHalf.container;
/** The terminal's floor at 12.5px as the page really drew it: two thirds of
 *  its threshold box -- eighty and a half cells and the pane's chrome. */
const TERMINAL_FLOOR_PX = TERMINAL_THRESHOLD_PX * FRACTION;
function checkTerminalLayout(label, panes, expect) {
  const states = panes.map(classify);
  console.log(
    `${label}: ${panes
      .map((p, i) => `pane ${i} ${p.pane}px` + (p.box === null ? ' (empty)' : `, tab ${p.box}px in ${p.container}px, ${p.columns} columns → ${states[i]}`))
      .join('; ')}`,
  );
  check(`${label}: ${expect.panes} pane(s) were drawn`, panes.length === expect.panes, `${panes.length} panes`);
  check(
    `${label}: the terminal is in exactly one pane`,
    panes.filter((p) => p.box !== null).length === 1,
    states.join(', '),
  );
  for (const p of panes) {
    if (p.container === null) continue;
    const want = p.container >= TERMINAL_THRESHOLD_PX + 20 ? 'two-thirds' : p.container <= TERMINAL_THRESHOLD_PX - 20 ? 'whole' : null;
    check(
      `${label}: the terminal's pane is not within 20px of its threshold`,
      want !== null,
      `container ${p.container}px against a threshold of ${TERMINAL_THRESHOLD_PX}px`,
    );
    check(
      `${label}: the terminal (${p.container}px, ${expect.state === 'whole' ? 'under' : 'past'} its threshold) is ${expect.state}`,
      classify(p) === expect.state && want === expect.state,
      `tab ${p.box}px; two thirds is ${(p.container * FRACTION).toFixed(1)}px`,
    );
    // In both states the count is the box vam was given over the cell it
    // drew -- the cap works by shrinking the box, nothing else.
    const fit = Math.floor(p.content / p.drawn);
    check(
      `${label}: vam asked tmux for the ${fit} columns that fit the ${expect.state} box`,
      p.columns === fit,
      `${p.columns} columns; the box is ${p.content}px at ${p.drawn}px per cell`,
    );
    // And in both it is past eighty -- two thirds is only ever applied where
    // it holds eighty, and a whole pane IN THE BAND holds more. The band is
    // asserted, not assumed: under the floor a whole pane holds fewer, for the
    // reason the phone does, and that would not be this view's defect.
    if (expect.state === 'whole') {
      check(
        `${label}: the terminal's pane is wider than its floor, so this is the band`,
        p.container > TERMINAL_FLOOR_PX + 20,
        `container ${p.container}px against a floor of ${TERMINAL_FLOOR_PX.toFixed(1)}px`,
      );
    }
    check(
      `${label}: and those ${fit} columns are more than ${FLOOR_CHARACTERS}`,
      fit > FLOOR_CHARACTERS,
      `${fit} columns`,
    );
  }
}
checkTerminalLayout('terminal, one pane at 3100', await readTerminalPanes(termSplit), { panes: 1, state: 'two-thirds' });
// Focus back on vam's own keyboard before the chord: a focused terminal pane
// would SEND `z` and `v` to the stub rather than split.
await termSplit.locator(`[data-session-row="${STUB_SESSION}"]`).first().click();
await termSplit.waitForTimeout(100);
await splitChord(termSplit);
await termSplit.waitForTimeout(500);
checkTerminalLayout('terminal, two panes at 3100', await readTerminalPanes(termSplit), { panes: 2, state: 'two-thirds' });
await termSplit.locator(`[data-session-row="${STUB_SESSION}"]`).first().click();
await termSplit.waitForTimeout(100);
await splitChord(termSplit);
await termSplit.waitForTimeout(500);
checkTerminalLayout('terminal, three panes at 3100', await readTerminalPanes(termSplit), { panes: 3, state: 'whole' });
await termSplit.screenshot({ path: `${outDir}/view-width-terminal-split.png` });
console.log(`${outDir}/view-width-terminal-split.png`);
await termSplit.close();

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} view-width guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('view width guards: all assertions passed');
