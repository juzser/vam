/**
 * THE TWO THINGS THAT SAY WHERE THE KEYBOARD IS, MEASURED AS PAINT.
 *
 * Both findings here are about something being ON SCREEN, which is the one
 * claim a jsdom test cannot make: happy-dom lays nothing out, computes no
 * Tailwind, runs no animation and has no `elementFromPoint`.
 *
 *  - `f` ARMED A MODE WHOSE LABELS WERE NEVER PAINTED. `jumpLabels()` built the
 *    map and handed it to no component, so the only sign the mode existed was
 *    the status bar reading `JUMP`, and the operator was asked to type a label
 *    they could not see. The unit suite proves the badge exists and sits on the
 *    row it addresses; this proves it is DRAWN — a real box, inside its row, on
 *    top at its own centre, at a legible size, and clearing the contrast floor
 *    against what it actually paints on.
 *
 *  - THE MODE INDICATOR WAS A 10px WORD in a 32px footer among six other 10px
 *    cells, and it is the whole of the signal: the pane's focus border and its
 *    animated top line were both removed at the operator's request. A daily
 *    user concluded the modes had been removed. Measured here as paint: the
 *    chip has a ground of its own in both themes, Select and Insert paint
 *    DIFFERENT grounds, each clears 4.5:1 against its own text, and a change
 *    genuinely runs an animation — read off `Element.getAnimations()`, which
 *    no unit environment implements.
 *
 * TWO HABITS THIS FILE KEEPS, both learnt from siblings that lost them:
 *
 *  - FAILURES ARE COLLECTED, never thrown on the first: one regressed rule
 *    must not hide the state of the other seven.
 *  - NOTHING IS MEASURED BEFORE THE ACTION THAT PRODUCES IT. The animation
 *    check is the sharp case — the chip also animates on MOUNT, so a naive
 *    read after pressing `I` could be reporting the mount. It waits for the
 *    screen to go quiet FIRST, asserts it is quiet, and only then acts. That
 *    also proves the animation is finite, which is the difference between an
 *    indicator and an alert.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/mode-truth-shots.mjs http://localhost:5527 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5527';
const outDir = process.argv[3] ?? 'docs/ui';

/** WCAG relative luminance, over an `rgb(...)` triple — `tooltip-shots`'. */
function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `rgb(1, 2, 3)` / `rgba(1, 2, 3, 0.5)` to a triple plus its alpha. */
function parseColour(text) {
  const parts = String(text)
    .replace(/[^\d.,]/g, '')
    .split(',')
    .map((n) => Number.parseFloat(n));
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]');
// The pointer has never touched anything yet, so the shell is resting in
// Select — asserted rather than assumed, because a stray Insert would make
// every keystroke below a character typed into a composer.
const opening = await page.evaluate(
  () => document.querySelector('[data-mode]')?.textContent ?? '',
);
check('the shell opens in Select, so a chord is a chord', opening === 'Select', `it reads ${opening}`);

// ---------------------------------------------------------------------------
// 1. THE JUMP LABELS ARE ON THE SCREEN.

const rowIds = await page
  .locator('[data-session-row]')
  .evaluateAll((els) => els.map((el) => el.getAttribute('data-session-row')));
console.log('rows on screen:', rowIds.length);
check('the fixture draws rows to label', rowIds.length >= 3, `${rowIds.length} row(s)`);
check(
  'and nothing wears a label before f',
  (await page.locator('[data-jump-label]').count()) === 0,
  'a label is on screen with no jump armed',
);

await page.keyboard.press('f');
await page.waitForSelector('[data-jump-label]', { timeout: 3000 }).catch(() => {});

/**
 * Every label as PAINTED: its own box, its row's box, what sits on top at its
 * centre, and the colours it actually resolves to.
 *
 * `elementFromPoint` is the half that cannot be faked. A badge with a box and
 * no z-order is a badge behind the row's title, which is the same invisibility
 * this whole finding is about, one layer down.
 */
const painted = await page.locator('[data-jump-label]').evaluateAll((els) =>
  els.map((el) => {
    const box = el.getBoundingClientRect();
    const row = el.closest('[data-session-row]');
    const rowBox = row?.getBoundingClientRect() ?? null;
    const style = getComputedStyle(el);
    // HIT-TESTED WITH ITS OWN `pointer-events` LIFTED, and that is the point of
    // the probe rather than a way around it. The badge is deliberately
    // `pointer-events: none` so it cannot swallow a click meant for the row it
    // sits on — which also makes `elementFromPoint` skip straight past it and
    // report the row underneath, whatever the z-order is. Lifting the property
    // for the duration of one read asks the question that actually matters: if
    // this element were hit-testable, would it be the TOPMOST thing at its own
    // centre? A badge painted behind the row's title is the same invisibility
    // this whole finding is about, one layer down.
    const wasInline = el.style.pointerEvents;
    el.style.pointerEvents = 'auto';
    const onTop = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    el.style.pointerEvents = wasInline;
    return {
      key: el.getAttribute('data-jump-label'),
      row: row?.getAttribute('data-session-row') ?? null,
      w: Math.round(box.width),
      h: Math.round(box.height),
      inRow:
        rowBox !== null &&
        box.x >= rowBox.x - 1 &&
        box.y >= rowBox.y - 1 &&
        box.x + box.width <= rowBox.x + rowBox.width + 1 &&
        box.y + box.height <= rowBox.y + rowBox.height + 1,
      fontPx: Number.parseFloat(style.fontSize),
      ink: style.color,
      ground: style.backgroundColor,
      // `null` means the centre is off the screen — the sidebar scrolls, and a
      // label on a row below the fold is not a claim about painting. Those are
      // EXCLUDED from the rule below and COUNTED, so the exclusion cannot
      // quietly empty the corpus.
      hitTested: onTop !== null,
      // The defect this asks about is the badge being painted BEHIND its own
      // row's content — the title, the status dot, the close button. Chrome
      // that covers the whole row (the sidebar's sticky footer over the last
      // row) obscures the row as well and is a different subject; it is not
      // counted as this one.
      behindItsRow:
        onTop !== null && onTop !== el && !el.contains(onTop) && row !== null && row.contains(onTop),
    };
  }),
);
console.log('labels as painted:', painted);
check(
  'f paints a label on every row it can address',
  painted.length === rowIds.length,
  `${painted.length} label(s) for ${rowIds.length} row(s)`,
);
check(
  'and each one has a real box',
  painted.length > 0 && painted.every((l) => l.w >= 14 && l.h >= 14),
  JSON.stringify(painted.map((l) => `${l.w}x${l.h}`)),
);
check(
  'inside the row it addresses',
  painted.length > 0 && painted.every((l) => l.inRow),
  JSON.stringify(painted.filter((l) => !l.inRow)),
);
// THE CORPUS FIRST. The rule below excludes labels whose centre is off the
// screen, and an exclusion that emptied the set would leave a green tick over
// nothing examined at all.
const hitTested = painted.filter((l) => l.hitTested);
check(
  'enough labels are on screen to hit-test',
  hitTested.length >= 4,
  `${hitTested.length} of ${painted.length} label(s) had a centre on screen`,
);
check(
  'and every one of them is on top at its own centre, not behind its row',
  hitTested.length > 0 && hitTested.every((l) => !l.behindItsRow),
  JSON.stringify(hitTested.filter((l) => l.behindItsRow).map((l) => l.row)),
);
check(
  'at a size a glance can read',
  painted.length > 0 && painted.every((l) => l.fontPx >= 11),
  JSON.stringify(painted.map((l) => l.fontPx)),
);
for (const label of painted.slice(0, 1)) {
  const ink = parseColour(label.ink);
  const ground = parseColour(label.ground);
  const contrast = ratio(ink.rgb, ground.rgb);
  console.log(`label "${label.key}" paints ${label.ink} on ${label.ground} — ${contrast.toFixed(2)}:1`);
  // The ground is checked for OPACITY first, on purpose: a contrast ratio
  // between a colour and a transparent "background" is a number about nothing,
  // and a check that computed one would pass over a badge that paints no fill
  // at all.
  check(
    'the label paints a fill of its own',
    ground.alpha === 1,
    `background-color is ${label.ground}`,
  );
  check(
    'and its letter clears 4.5:1 against that fill',
    contrast >= 4.5,
    `${contrast.toFixed(2)}:1 (${label.ink} on ${label.ground})`,
  );
}
await page.screenshot({ path: `${outDir}/mode-truth-jump-labels.png` });
console.log(`${outDir}/mode-truth-jump-labels.png`);

await page.keyboard.press('Escape');
await page.waitForFunction(() => document.querySelectorAll('[data-jump-label]').length === 0, null, {
  timeout: 3000,
}).catch(() => {});
check(
  'and Escape takes every label off the screen',
  (await page.locator('[data-jump-label]').count()) === 0,
  'labels survived the mode they belong to',
);

// ---------------------------------------------------------------------------
// 2. THE MODE CHIP, AS PAINT, IN BOTH THEMES.

/** The chip's own colours and box, right now — and, beside it, the size the
 *  status bar's own cells are ACTUALLY drawn at.
 *
 *  The cell size is measured rather than typed. This check read `>= 11`
 *  against a comment saying "the 10px cells"; the day the bar moved onto the
 *  type scale (`meta`, 11px) that literal would have gone on passing while the
 *  claim it stands for — the chip out-ranks the cells around it — had quietly
 *  stopped being true. `[data-source]` is a sibling cell in the same
 *  `<footer>`, and `null` from it fails the check rather than skipping it. */
const chipNow = () =>
  page.locator('[data-mode]').evaluate((el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const cell = el.closest('footer')?.querySelector('[data-source]') ?? null;
    return {
      word: el.textContent ?? '',
      ink: style.color,
      ground: style.backgroundColor,
      border: style.borderTopColor,
      fontPx: Number.parseFloat(style.fontSize),
      cellPx: cell === null ? null : Number.parseFloat(getComputedStyle(cell).fontSize),
      w: Math.round(box.width),
      h: Math.round(box.height),
    };
  });

for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('light', t === 'light');
  }, theme);
  await page.waitForTimeout(120);

  const resting = await chipNow();
  const restingInk = parseColour(resting.ink);
  const restingGround = parseColour(resting.ground);
  const restingContrast = ratio(restingInk.rgb, restingGround.rgb);
  console.log(`${theme} — resting chip:`, resting, `${restingContrast.toFixed(2)}:1`);
  check(
    `${theme}: the resting chip paints a ground of its own`,
    restingGround.alpha === 1,
    `background-color is ${resting.ground}`,
  );
  check(
    `${theme}: and its word clears 4.5:1 against that ground`,
    restingContrast >= 4.5,
    `${restingContrast.toFixed(2)}:1`,
  );
  check(
    `${theme}: the chip is bigger than the cells beside it, whatever those are`,
    resting.cellPx !== null && resting.fontPx > resting.cellPx,
    `chip ${resting.fontPx}px vs cell ${resting.cellPx}px`,
  );
  // And an absolute floor as well as a relative one, so that shrinking BOTH
  // could not satisfy the line above. 12px is the type scale's `control` step,
  // which is where the chip sits; the cells sit on `meta`, one step below.
  check(
    `${theme}: and it is at least the scale's control step`,
    resting.fontPx >= 12,
    `${resting.fontPx}px`,
  );

  // INSERT, reached the way an operator reaches it: `I` hands the keyboard to
  // the pane, and the mode follows DOM focus (there is no flag to set).
  await page.keyboard.press('I');
  await page.waitForFunction(
    () => (document.querySelector('[data-mode]')?.textContent ?? '') === 'Insert',
    null,
    { timeout: 3000 },
  ).catch(() => {});
  const armed = await chipNow();
  const armedGround = parseColour(armed.ground);
  const armedContrast = ratio(parseColour(armed.ink).rgb, armedGround.rgb);
  console.log(`${theme} — armed chip:`, armed, `${armedContrast.toFixed(2)}:1`);
  check(`${theme}: I reaches Insert`, armed.word === 'Insert', `the chip reads ${armed.word}`);
  check(
    `${theme}: Insert paints a different ground from Select`,
    armed.ground !== resting.ground,
    `both paint ${armed.ground} — the two modes differ by one word at 11px, which is the ` +
      'defect this chip exists to end',
  );
  check(
    `${theme}: and Insert's own word clears 4.5:1`,
    armedContrast >= 4.5,
    `${armedContrast.toFixed(2)}:1`,
  );
  // The two grounds must be far enough apart to READ as different, not merely
  // to compare unequal: two neighbouring greys would pass the check above and
  // fail the operator.
  const between = ratio(restingGround.rgb, armedGround.rgb);
  check(
    `${theme}: the two grounds are 3:1 apart, so the difference is visible`,
    between >= 3,
    `${between.toFixed(2)}:1 between ${resting.ground} and ${armed.ground}`,
  );
  await page.screenshot({ path: `${outDir}/mode-truth-chip-${theme}.png` });
  console.log(`${outDir}/mode-truth-chip-${theme}.png`);

  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => (document.querySelector('[data-mode]')?.textContent ?? '') === 'Select',
    null,
    { timeout: 3000 },
  ).catch(() => {});
}
await page.evaluate(() => document.documentElement.classList.remove('light'));

// ---------------------------------------------------------------------------
// 3. A MODE CHANGE MOVES SOMETHING — AND THEN STOPS.

/** What is animating on the chip right now, by name. */
const chipAnimations = () =>
  page.locator('[data-mode]').evaluate((el) => el.getAnimations().map((a) => a.animationName));

// QUIET FIRST, and asserted. The chip animates on MOUNT too, so a read taken
// straight after the keypress could be reporting an animation that was already
// running before it — the "measured the previous screen" mistake. Waiting for
// silence also proves the animation is FINITE, which is what separates a
// persistent indicator from an alert.
await page.waitForTimeout(900);
const quiet = await chipAnimations();
console.log('before the change, the chip is running:', quiet);
check(
  'the chip is not animating at rest — one fade, not a loop',
  quiet.length === 0,
  `still running ${quiet.join(', ')}`,
);

await page.keyboard.press('I');
await page.waitForFunction(
  () => (document.querySelector('[data-mode]')?.textContent ?? '') === 'Insert',
  null,
  { timeout: 3000 },
).catch(() => {});
const moving = await chipAnimations();
console.log('at the moment of the change, the chip is running:', moving);
check(
  'a mode change starts an animation on the chip',
  moving.includes('vam-mode-change'),
  `running ${JSON.stringify(moving)} — a word swapped in place replays nothing, which is why ` +
    'the cell is keyed on the state it draws',
);
await page.screenshot({ path: `${outDir}/mode-truth-change.png` });
console.log(`${outDir}/mode-truth-change.png`);

await page.keyboard.press('Escape');
await page.waitForTimeout(900);

// AND IT IS OPT-OUT. A moving indicator is a liability for anyone it makes
// ill; the chip's inversion carries the state without it, which is the same
// bargain every other animation in `styles.css` already makes.
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.keyboard.press('I');
await page.waitForFunction(
  () => (document.querySelector('[data-mode]')?.textContent ?? '') === 'Insert',
  null,
  { timeout: 3000 },
).catch(() => {});
const reduced = await chipAnimations();
const reducedChip = await chipNow();
console.log('with reduced motion, the chip is running:', reduced, 'and paints', reducedChip.ground);
check(
  'prefers-reduced-motion stops the flash',
  !reduced.includes('vam-mode-change'),
  `still running ${JSON.stringify(reduced)}`,
);
check(
  'and the inversion still carries the mode without it',
  reducedChip.word === 'Insert' && parseColour(reducedChip.ground).alpha === 1,
  JSON.stringify(reducedChip),
);
await page.emulateMedia({ reducedMotion: null });

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nmode-truth: every check passed.');
