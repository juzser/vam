/**
 * A TURN'S TOOL CALLS, MEASURED IN A REAL BROWSER.
 *
 * Operator: "show the whole progress when focus view is off." Off is the
 * default, and what it drew was one line per turn carrying the turn's mark and
 * the agent's name -- the whole of what a `Decision` held about its own
 * working, because the transcript reader parsed every `tool_use` part and kept
 * exactly one of them, the newest in the window, as the activity line.
 *
 * ── WHY A GUARD AND NOT ONLY UNIT TESTS ───────────────────────────────────
 * `test/panels/DetailPanel.turn-steps.test.tsx` already holds what is in the
 * DOM. Four things about this surface are invisible to it, and each has a
 * matching defect already shipped in this repo:
 *
 *  1. A COLOUR. `text-ink-faint` reads back from `className` whether or not
 *     the token resolves, and issue 201 ruled `ink-ghost` out of anything that
 *     has to be READ. These rows are twenty per turn of the smallest type vam
 *     draws, so "is this readable" is the first question about them.
 *  2. A FAILURE THAT IS ONLY A COLOUR. The failed row is marked with `!` and a
 *     red, and WCAG 1.4.1 is explicit that colour may not be the only channel.
 *     The word rides in `sr-only`, which a unit test can see but only a
 *     browser can prove is off-screen rather than drawn.
 *  3. THE COLUMN'S RESERVED GUTTER. The column keeps a 44px strip on its right
 *     for the floating jump controls (`pr-11`). A row that truncated past it
 *     would put text under a control.
 *  4. THE SEAM FROM THE KEYSTROKE TO THE PAINT. `zf` writes a preference,
 *     which reaches a module store, which re-renders mounted columns. Nothing
 *     below the keystroke is exercised by a unit test of the pane.
 *
 * ── AND THE CAP, WHICH ONLY THE PAGER CAN REACH ───────────────────────────
 * The column draws at most 20 calls per turn and says how many it held back.
 * That is measured: over the operator's 77 real transcripts a turn small
 * enough to fit one 128 KiB window made at most 20 calls, while a turn big
 * enough to SPAN one -- what the backward pager reads -- ran to a median of 30
 * and a largest of 2,144. `demo-history.ts` therefore carries one turn of 26,
 * and this walks the pager back to it, because a cap that ships without ever
 * having been drawn is the silent fold this surface exists to refuse.
 */

import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** `factory-sse-1` in `src/renderer/fixtures/demo.ts` — the only session a
 *  screenshot may show (`demo-history.ts` says why). */
const SESSION = 'factory-sse-1';
/** `MAX_STEP_ROWS` in `src/renderer/panels/DetailPanel.tsx`. */
const CAP = 20;
/** The paged turn's own length, in `src/renderer/fixtures/demo-history.ts`. */
const PAGED_CALLS = 26;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

const failures = [];
/** Collect rather than throw on the first: one run reports every fault. */
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-column-turn]');
await page.waitForSelector('[data-progress-step]');

/** WCAG relative luminance, and `opaque` first: `rgba(0,0,0,0)` compares equal
 *  to `rgba(0,0,0,0)`, so a guard that skips it passes on two absences. */
await page.evaluate(() => {
  const chan = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const parts = (colour) => colour.match(/[\d.]+/g).map(Number);
  const opaque = (colour) => /^rgb\(\s*\d/.test(colour);
  const lum = (colour) => {
    const [r, g, b] = parts(colour);
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)];
    const [hi, lo] = x > y ? [x, y] : [y, x];
    return (hi + 0.05) / (lo + 0.05);
  };
  /** The nearest ancestor that actually paints — a row's own background is
   *  transparent, and comparing ink against `rgba(0,0,0,0)` measures nothing. */
  const ground = (el) => {
    let node = el;
    while (node !== null) {
      const colour = getComputedStyle(node).backgroundColor;
      if (opaque(colour)) return colour;
      node = node.parentElement;
    }
    return null;
  };
  window.vamSteps = { opaque, ratio, ground };
});

// ── THE CORPUS, FIRST ─────────────────────────────────────────────────────
// Every claim below is about elements this fixture produces. A guard that
// found none would report nothing wrong forever — the failure mode this repo
// has already shipped once, where four sweeps ran green having examined zero
// files.
const corpus = await page.evaluate(() => ({
  lists: document.querySelectorAll('[data-progress-steps]').length,
  rows: document.querySelectorAll('[data-progress-step]').length,
  failed: document.querySelectorAll('[data-progress-step-failed]').length,
  turns: document.querySelectorAll('[data-column-turn]').length,
}));
console.log(
  `  live column: ${corpus.turns} turns, ${corpus.lists} lists, ${corpus.rows} rows, ${corpus.failed} of them failed`,
);
check('the demo draws calls at all, on more than one turn', corpus.lists >= 2, `${corpus.lists}`);
check('and enough of them to measure', corpus.rows >= 10, `${corpus.rows} rows`);
check('and at least one that failed, or the failure ink is unmeasured', corpus.failed >= 1);

// ── 1. THE ROWS CAN BE READ ───────────────────────────────────────────────
const ink = await page.evaluate(() => {
  const { opaque, ratio, ground } = window.vamSteps;
  const rows = [...document.querySelectorAll('[data-progress-step]')];
  const label = (row) => row.querySelector('[data-progress-step-label]');
  const line = document.querySelector('[data-progress-line] [data-progress-turn-label]');
  const measure = (el) => {
    const colour = getComputedStyle(el).color;
    const bg = ground(el);
    return { colour, bg, ok: opaque(colour) && bg !== null, ratio: bg === null ? 0 : ratio(colour, bg) };
  };
  return {
    rows: rows.map((row) => measure(label(row))),
    line: measure(line),
    size: Number.parseFloat(getComputedStyle(label(rows[0])).fontSize),
  };
});
const worst = ink.rows.reduce((a, b) => (a.ratio < b.ratio ? a : b));
console.log(
  `  row ink ${worst.colour} on ${worst.bg} = ${worst.ratio.toFixed(2)}:1 at ${ink.size}px; the line above is ${ink.line.ratio.toFixed(2)}:1`,
);
check('every row was measured against a ground that actually paints', ink.rows.every((r) => r.ok));
check(
  'the quietest row clears 4.5:1, the floor for text this size',
  worst.ratio >= 4.5,
  `${worst.ratio.toFixed(2)}:1`,
);
check(
  'and is no quieter than the progress line it belongs to',
  worst.ratio >= ink.line.ratio - 0.01,
  `${worst.ratio.toFixed(2)}:1 vs ${ink.line.ratio.toFixed(2)}:1`,
);

// ── 2. A FAILURE IS NOT ONLY A COLOUR ─────────────────────────────────────
const failure = await page.evaluate(() => {
  const { ratio, ground } = window.vamSteps;
  const failed = document.querySelector('[data-progress-step-failed]');
  const passed = [...document.querySelectorAll('[data-progress-step]')].find(
    (el) => el.getAttribute('data-progress-step-failed') === null,
  );
  const markOf = (row) => getComputedStyle(row.firstElementChild).color;
  const glyphOf = (row) => (row.firstElementChild.textContent ?? '').trim();
  const word = [...failed.querySelectorAll('span')].find(
    (el) => (el.textContent ?? '').toLowerCase() === 'failed',
  );
  const box = word?.getBoundingClientRect() ?? null;
  return {
    failedMark: markOf(failed),
    passedMark: markOf(passed),
    failedGlyph: glyphOf(failed),
    passedGlyph: glyphOf(passed),
    saysFailed: word !== undefined,
    // `sr-only` is announced, not drawn: it is laid out in a 1px box.
    wordDrawn: box === null ? false : box.width > 2 && box.height > 2,
    contrast: ratio(markOf(failed), ground(failed)),
  };
});
console.log(
  `  failed mark "${failure.failedGlyph}" ${failure.failedMark} vs passing "${failure.passedGlyph}" ${failure.passedMark}`,
);
check('a failed call is a different ink from a passing one', failure.failedMark !== failure.passedMark);
check('and a different glyph, so the ink is not the only channel', failure.failedGlyph !== failure.passedGlyph);
check('and it says the word "failed" for a reader who sees neither', failure.saysFailed);
check('which is announced rather than drawn', failure.saysFailed && !failure.wordDrawn);
check(
  'and the failure ink is itself readable',
  failure.contrast >= 4.5,
  `${failure.contrast.toFixed(2)}:1`,
);

// ── 3. THE COLUMN'S RESERVED GUTTER ───────────────────────────────────────
const gutter = await page.evaluate(() => {
  const col = document.querySelector('[data-detail-column]');
  const right = col.getBoundingClientRect().right;
  const reserved = Number.parseFloat(getComputedStyle(col).paddingRight);
  const overruns = [...document.querySelectorAll('[data-progress-step]')]
    .map((el) => el.getBoundingClientRect().right)
    .filter((edge) => edge > right - reserved + 0.5).length;
  return { reserved, overruns, rows: document.querySelectorAll('[data-progress-step]').length };
});
console.log(`  the column reserves ${gutter.reserved}px on the right for its jump controls`);
check('the gutter is really reserved, so this check is about something', gutter.reserved >= 40);
check(
  'no row runs under the floating jump controls',
  gutter.overruns === 0,
  `${gutter.overruns} of ${gutter.rows}`,
);

// ── 4. ORDER: THE WORKING COMES BEFORE THE ANSWER ─────────────────────────
const order = await page.evaluate(() => {
  const turn = document.querySelector('[data-progress-steps]').closest('[data-column-turn]');
  const list = turn.querySelector('[data-progress-steps]');
  const section = turn.querySelector('[data-detail-block="progress"]');
  const line = turn.querySelector('[data-progress-line]');
  const answer = turn.querySelector('[data-detail-block="out"]');
  const after = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  return {
    inSection: section.contains(list),
    afterLine: after(line, list),
    beforeAnswer: after(list, answer),
  };
});
check('the list lives inside the turn’s own progress section', order.inSection);
check('below the line it details', order.afterLine);
check('and above the answer, which is the order the work happened in', order.beforeAnswer);

await page.screenshot({ path: `${outDir}/turn-steps-shown.png` });
console.log(`${outDir}/turn-steps-shown.png`);

// ── 5. THE KEYSTROKE REACHES THE PAINT ────────────────────────────────────
// `zf` writes a preference, which reaches a module store, which re-renders
// every mounted column. None of that is exercised by a unit test of the pane.
// Per turn, BEFORE the fold, so the way back can be pressed on a turn that
// actually had calls to restore.
const callsPerTurn = await page.evaluate(() =>
  Object.fromEntries(
    [...document.querySelectorAll('[data-column-turn]')].map((turn) => [
      turn.getAttribute('data-column-turn'),
      turn.querySelectorAll('[data-progress-step]').length,
    ]),
  ),
);
await page.locator(`[data-session-row="${SESSION}"]`).first().click();
await page.waitForTimeout(150);
await page.keyboard.press('z');
await page.keyboard.press('f');
await page.waitForTimeout(250);
const folded = await page.evaluate(() => ({
  rows: document.querySelectorAll('[data-progress-step]').length,
  unfolds: document.querySelectorAll('[data-turn-unfold]').length,
}));
console.log(`  after zf: ${folded.rows} rows, ${folded.unfolds} ways back`);
check('focus view puts every call away', folded.rows === 0, `${folded.rows} left`);
check('and leaves a way back on the turns it folded', folded.unfolds > 0);

// AND THE WAY BACK HAS TO BE PRESSED ON A TURN THAT MADE CALLS, which is not
// the first one on screen and was not, when this was written: focus view keeps
// the newest turn's line (it has a present to report) and a failing turn's
// (alarm is never folded), so the two turns the demo gave calls to were
// precisely the two that never draw a `···`. This guard failed on that, and
// `demo.ts` gained a quiet older turn with a list. The lookup is by turn id
// rather than by position so it cannot silently start measuring the wrong one.
const foldedTurn = await page.evaluate(
  (before) =>
    [...document.querySelectorAll('[data-turn-unfold]')]
      .map((el) => el.getAttribute('data-turn-unfold'))
      .find((id) => (before[id] ?? 0) > 0) ?? null,
  callsPerTurn,
);
check(
  'the fixture folds at least one turn that actually made calls',
  foldedTurn !== null,
  'every turn with calls kept its line, so the unfold could not be tested',
);
if (foldedTurn !== null) {
  await page.locator(`[data-turn-unfold="${foldedTurn}"]`).click();
  await page.waitForTimeout(200);
  const restored = await page.evaluate(
    (id) =>
      document
        .querySelector(`[data-column-turn="${id}"]`)
        ?.querySelectorAll('[data-progress-step]').length ?? 0,
    foldedTurn,
  );
  check(
    'and the way back restores that turn’s calls, not merely its label',
    restored > 0,
    `${restored} rows on ${foldedTurn}`,
  );
}
await page.screenshot({ path: `${outDir}/turn-steps-folded.png` });

await page.keyboard.press('z');
await page.keyboard.press('f');
await page.waitForTimeout(250);
const back = await page.evaluate(() => document.querySelectorAll('[data-progress-step]').length);
check('and turning focus view off brings all of them back', back >= corpus.rows, `${back} rows`);

// ── 6. THE CAP, WALKED BACK TO ────────────────────────────────────────────
// The pager's own contract is four answers in a fixed order, one of which is a
// refusal that has to be retried (`demo-history.ts`), so this asks repeatedly
// and presses the retry when it is offered rather than assuming one scroll is
// enough.
let capped = null;
for (let attempt = 0; attempt < 12 && capped === null; attempt += 1) {
  await page.evaluate(() => {
    const col = document.querySelector('[data-detail-column]');
    if (col !== null) col.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  const ask = page.locator('[data-column-more-ask]');
  if ((await ask.count()) > 0) await ask.first().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
  capped = await page.evaluate(() => {
    const note = document.querySelector('[data-progress-steps-more]');
    if (note === null) return null;
    const list = note.closest('[data-progress-steps]');
    return {
      rows: list.querySelectorAll('[data-progress-step]').length,
      text: note.textContent ?? '',
      number: Number.parseInt(/(\d+)/.exec(note.textContent ?? '')?.[1] ?? '-1', 10),
    };
  });
}
check('the pager reaches a turn with more calls than the column draws', capped !== null);
if (capped !== null) {
  console.log(`  capped turn: ${capped.rows} rows drawn, note reads "${capped.text.trim()}"`);
  check('the column draws exactly its cap, no more', capped.rows === CAP, `${capped.rows}`);
  check(
    'and the remainder it names is the one it really held back',
    capped.number === PAGED_CALLS - CAP,
    `${capped.number} vs ${PAGED_CALLS - CAP}`,
  );
  await page.locator('[data-progress-steps-more]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/turn-steps-capped.png` });
  console.log(`${outDir}/turn-steps-capped.png`);
}

await browser.close();

if (failures.length > 0) {
  console.error(`\nturn-steps: ${failures.length} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nturn-steps: every assertion passed.');
