/**
 * TWO FACTS VAM ALREADY HELD AND NEVER DREW, measured on the real paint.
 *
 * 1. WHY a session is waiting. `waitingFor` -- the session's own words for
 *    what it is blocked on, and the only surface that can say so, since a
 *    tool-approval prompt writes no transcript record -- was computed and then
 *    spent as a boolean. "It needs something" and "it needs permission to run
 *    rm" were one picture, and telling them apart cost one open per tab.
 *
 * 2. A TURN THAT FAILED. A turn's mark was binary, so a turn whose tools blew
 *    up three times still read `✓` and the fold above it said "N turns read"
 *    over a run that was on fire.
 *
 * WHY A REAL BROWSER, when jsdom already pins both. Because the unit tests
 * assert that a node exists with the right text, and this asserts that the
 * text is PAINTED: `text-waiting` and `text-failed` are Tailwind utilities
 * that only resolve in a built stylesheet, and a rule matching nothing looks
 * identical to a rule that works when you read the class attribute back. A
 * colour channel asserted from the class list has already shipped broken in
 * this repo once. So the colours are read off `getComputedStyle` here, and
 * they are required to DIFFER from the line's own ink -- the point of the
 * amber and the red is that they are not the surrounding grey.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/turn-signal-shots.mjs http://localhost:5524 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5524';
const outDir = process.argv[3] ?? 'docs/ui';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

// `factory-sse-1` is the demo's blocked session: `waitingFor: 'permission
// prompt'`, and one turn (`d-task4`) that answered and still failed three
// tools. Both fixtures exist so these two signals cannot ship unseen.
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForTimeout(300);

/** The painted colour of an element, and of the line it sits on. */
const inkOf = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) return null;
    return { text: el.textContent.trim(), colour: getComputedStyle(el).color };
  }, sel);

// --- 1. THE WAITING CAUSE, on the detail pane's condensed progress line.
const cause = await inkOf('[data-progress-waiting]');
console.log('progress line cause:', JSON.stringify(cause));
if (cause === null) throw new Error('the progress line drew no waiting cause at all');
if (cause.text !== 'permission prompt') {
  throw new Error(`the cause should read the session's own words, got "${cause.text}"`);
}

// --- 2. THE SAME CAUSE ON THE SIDEBAR ROW, on the DESKTOP. This line was
// gated on `phone &&` because the desktop sidebar "sits beside a canvas" --
// and the canvas was deleted in 0.2, which is what makes this assertion the
// interesting one: at this viewport the old build drew nothing here.
const row = await inkOf('[data-row-waiting]');
console.log('sidebar row cause:', JSON.stringify(row));
if (row === null) throw new Error('the desktop sidebar row drew no waiting cause');
if (row.text !== 'permission prompt') {
  throw new Error(`the row's cause should be the session's own words, got "${row.text}"`);
}

// --- 3. THE FAILURE COUNT, appended to the turns-read line.
const failed = await inkOf('[data-progress-failed]');
console.log('failure count:', JSON.stringify(failed));
if (failed === null) throw new Error('a run with three failed tools reported no failures');
if (!/^·\s*3 failed$/.test(failed.text)) {
  throw new Error(`the count should name how many failed, got "${failed.text}"`);
}

// --- 4. "TURNS READ" SURVIVES BESIDE IT. The qualifier is load-bearing: only
// the newest TAIL_BYTES of a transcript is ever opened, so the count is what
// vam FOUND. A failure count that replaced it would trade one honesty for
// another.
const line = await page.locator('[data-progress-line]').first().innerText();
console.log('progress line reads:', JSON.stringify(line.replace(/\s+/g, ' ').trim()));
if (!line.includes('turns read')) {
  throw new Error('the failure count replaced the "turns read" qualifier instead of joining it');
}

// --- 5. THE COLOURS ARE REAL, not class names that resolved to nothing.
const baseInk = await page.evaluate(
  () => getComputedStyle(document.querySelector('[data-progress-count]')).color,
);
console.log('line ink:', baseInk);
for (const [name, seen] of [
  ['waiting cause', cause.colour],
  ['sidebar cause', row.colour],
  ['failure count', failed.colour],
]) {
  if (seen === baseInk) {
    throw new Error(
      `the ${name} painted the line's own ink (${seen}) -- its class resolved to nothing`,
    );
  }
}

// --- 6. A FAILED TURN IS MARKED IN THE PICKER, not folded into `✓`.
const picker = await page.locator('[data-progress-jump]').first().innerText();
console.log('picker options:', JSON.stringify(picker.replace(/\s+/g, ' ').trim()));
if (!picker.includes('!')) {
  throw new Error('no turn in the picker carries a failure mark, so the fold still hides it');
}

await page.screenshot({ path: `${outDir}/turn-signal-waiting-cause.png` });
console.log(`${outDir}/turn-signal-waiting-cause.png`);

// The same pane with the turn list open, where the per-turn mark is readable
// rather than inside a native `<select>` a screenshot cannot open.
await page.locator('[data-progress-expand]').first().click();
await page.waitForTimeout(200);
const marks = await page.evaluate(() =>
  [...document.querySelectorAll('[data-progress-turn]')].map((b) => b.innerText.trim()),
);
console.log('expanded turn marks:', JSON.stringify(marks));
if (!marks.some((m) => m.startsWith('!'))) {
  throw new Error('the expanded turn list marks no turn as failed');
}
await page.screenshot({ path: `${outDir}/turn-signal-failed-turn.png` });
console.log(`${outDir}/turn-signal-failed-turn.png`);

await browser.close();
