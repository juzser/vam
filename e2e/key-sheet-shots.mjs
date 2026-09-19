/**
 * THE `?` SHEET'S NEW SHAPE, MEASURED AS RECTANGLES.
 *
 * The operator, translated: "the shortcut table when you press `?` needs a
 * search box, clearer section separation, and a one-column layout with the
 * label on one side and the shortcut on the other."
 *
 * ── WHY THIS CANNOT BE A UNIT TEST ────────────────────────────────────────
 *
 * Every term of that sentence is a layout fact and happy-dom lays nothing out.
 * "One column" is a set of x positions; "label on one side and the shortcut on
 * the other" is two rectangles that must not overlap and must sit at opposite
 * ends of a third; "clearer section separation" is the claim that the gap
 * BETWEEN two groups is bigger than the gap between two rows inside one — a
 * comparison of two distances, both zero in every unit environment. A class
 * assertion is not a substitute: this repo has shipped a style rule that
 * matched no element and a token that resolved to nothing, both green in the
 * unit suite and both visible on screen.
 *
 * The search box's KEYBOARD is measured here for a different reason: what
 * happens to a keystroke typed into it depends on a real listener stack —
 * `Canvas.tsx`'s window handler stands aside for an INPUT, which is what lets
 * `?` type a question mark and what makes the sheet's own Escape handler
 * load-bearing. A hand-built event in a unit test is not cancelable by
 * specification and cannot tell those apart.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/key-sheet-shots.mjs http://localhost:5527 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5527';
const outDir = process.argv[3] ?? 'docs/ui';

const browser = await chromium.launch();
const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]');

/** Open the sheet from the keyboard, the way an operator does. */
async function openSheet() {
  await page.keyboard.press('?');
  await page.waitForSelector('[data-key-sheet]', { timeout: 2_000 });
}

/** Every row as a rectangle, with its two halves. */
const geometry = () =>
  page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const panel = document.querySelector('[data-key-sheet-groups]');
    const rows = [...document.querySelectorAll('[data-key-sheet] li')].map((li) => {
      const label = li.querySelector('[data-key-sheet-label]');
      const keys = li.querySelector('[data-key-sheet-keys]');
      const box = li.getBoundingClientRect();
      const labelBox = label?.getBoundingClientRect() ?? null;
      const keysBox = keys?.getBoundingClientRect() ?? null;
      return {
        keys: keys?.textContent ?? '',
        label: label?.textContent ?? '',
        left: round(box.left),
        right: round(box.right),
        top: round(box.top),
        bottom: round(box.bottom),
        width: round(box.width),
        labelRight: labelBox === null ? null : round(labelBox.right),
        labelLeft: labelBox === null ? null : round(labelBox.left),
        keysLeft: keysBox === null ? null : round(keysBox.left),
        keysRight: keysBox === null ? null : round(keysBox.right),
        keysPainted: keysBox !== null && keysBox.width > 0 && keysBox.height > 0,
      };
    });
    const headings = [...document.querySelectorAll('[data-key-sheet-group]')].map((h3) => {
      const box = h3.getBoundingClientRect();
      const section = h3.closest('section')?.getBoundingClientRect();
      return {
        title: h3.textContent ?? '',
        top: round(box.top),
        bottom: round(box.bottom),
        sectionTop: section === undefined ? null : round(section.top),
      };
    });
    const scroller = panel?.getBoundingClientRect() ?? null;
    return {
      rows,
      headings,
      scroller:
        scroller === null
          ? null
          : { left: round(scroller.left), right: round(scroller.right), top: round(scroller.top) },
      scrollable: panel === null ? false : panel.scrollHeight > panel.clientHeight,
      searchTop: round(
        document.querySelector('[data-key-sheet-search]')?.getBoundingClientRect().top ?? -1,
      ),
    };
  });

await openSheet();
const first = await geometry();

// A CORPUS, OR EVERY LINE BELOW IS VACUOUS. The sheet draws a hundred rows;
// anything near zero means it did not open and this measured an empty screen.
check(
  'the sheet drew its whole corpus of rows',
  first.rows.length > 80,
  `only ${first.rows.length} rows`,
);

/* ── ONE COLUMN ──────────────────────────────────────────────────────────── */
{
  const lefts = [...new Set(first.rows.map((row) => row.left))];
  const widths = [...new Set(first.rows.map((row) => row.width))];
  console.log(`rows: ${first.rows.length}, distinct left ${lefts.length}, widths ${widths.length}`);
  check(
    'every row starts at the same x — one column, not two',
    lefts.length === 1,
    `${lefts.length} distinct left edges: ${lefts.slice(0, 6).join(', ')}`,
  );
  check(
    'and every row is the same width',
    widths.length === 1,
    `${widths.length} distinct widths: ${widths.slice(0, 6).join(', ')}`,
  );
  // AND NO TWO ROWS SHARE A LINE. Equal x with equal y would be a stack; the
  // two-column sheet had pairs of rows at the same y and different x, and this
  // is the reading that tells them apart.
  const byTop = new Map();
  for (const row of first.rows) byTop.set(row.top, (byTop.get(row.top) ?? 0) + 1);
  const shared = [...byTop.entries()].filter(([, count]) => count > 1);
  check(
    'and no two rows sit side by side on one line',
    shared.length === 0,
    `${shared.length} y positions carry more than one row`,
  );
}

/* ── LABEL LEFT, KEY RIGHT ───────────────────────────────────────────────── */
{
  const missing = first.rows.filter((row) => row.labelRight === null || row.keysLeft === null);
  check('every row has both halves', missing.length === 0, `${missing.length} rows do not`);
  const overlapping = first.rows.filter((row) => (row.labelRight ?? 0) > (row.keysLeft ?? 0));
  check(
    'the label ends before the key begins — they never overlap',
    overlapping.length === 0,
    overlapping
      .slice(0, 3)
      .map((row) => `"${row.label}" ${row.labelRight} > ${row.keysLeft}`)
      .join(' | '),
  );
  // FLUSH RIGHT, not merely after the label: "on the other side" is a claim
  // about the row's far edge. `px-1` and a 1px border sit between the chip's
  // box and the row's, so the tolerance is the chip's own chrome.
  const notFlush = first.rows.filter((row) => row.right - (row.keysRight ?? 0) > 2);
  check(
    'and the key is flush with the row’s right edge',
    notFlush.length === 0,
    notFlush
      .slice(0, 3)
      .map((row) => `"${row.keys}" ends ${row.right - (row.keysRight ?? 0)}px short`)
      .join(' | '),
  );
  const unpainted = first.rows.filter((row) => !row.keysPainted);
  check('and every key chip is painted', unpainted.length === 0, `${unpainted.length} are not`);
  // The label starts at the row's own left edge: nothing is indented past it,
  // which is what "on one side" means for the other half.
  const indented = first.rows.filter((row) => (row.labelLeft ?? 0) - row.left > 1);
  check('and the label starts at the row’s left edge', indented.length === 0, `${indented.length}`);
}

/* ── SECTIONS THAT READ AS SECTIONS ──────────────────────────────────────── */
{
  check(
    'every group carries a heading',
    first.headings.length >= 5,
    `${first.headings.length} headings`,
  );
  // The distance a boundary has to beat, MEASURED AS PITCH rather than as the
  // gap between two row boxes — which is 0 here, because the rows carry their
  // spacing as their own padding. Comparing against that zero would have made
  // every line below vacuous: any boundary at all, including none, beats it.
  const pitches = [];
  for (let i = 1; i < first.rows.length; i += 1) {
    const step = first.rows[i].top - first.rows[i - 1].top;
    // Within one group only: a step that crosses a heading is the thing being
    // measured, not the baseline for it.
    if (step > 0 && step < 40) pitches.push(step);
  }
  pitches.sort((a, b) => a - b);
  const rowGap = pitches[Math.floor(pitches.length / 2)] ?? 0;
  check(
    'the row pitch is a real measurement',
    pitches.length > 50 && rowGap > 0,
    `${pitches.length} steps, median ${rowGap}px`,
  );
  // And the gap a section boundary really opens: from the last row above it to
  // the heading below it.
  const boundaries = [];
  for (const heading of first.headings) {
    const above = first.rows.filter((row) => row.bottom <= heading.top);
    if (above.length === 0) continue;
    const last = above.reduce((a, b) => (a.bottom >= b.bottom ? a : b));
    boundaries.push({ title: heading.title, gap: heading.top - last.bottom });
  }
  const tightest = boundaries.reduce((a, b) => (a.gap <= b.gap ? a : b), { gap: Infinity });
  console.log(
    `row pitch ${rowGap}px; tightest section boundary "${tightest.title}" at ${tightest.gap}px`,
  );
  check(
    'a section boundary opens more space than a whole row of the list',
    tightest.gap > rowGap,
    `boundary ${tightest.gap}px vs row pitch ${rowGap}px`,
  );
  // AND THERE IS A RULE, not only space. Measured as a painted border on the
  // section box rather than read off a class name.
  const ruled = await page.evaluate(() =>
    [...document.querySelectorAll('[data-key-sheet-groups] section')].map((section) => {
      const style = getComputedStyle(section);
      return {
        width: style.borderTopWidth,
        colour: style.borderTopColor,
      };
    }),
  );
  const withRule = ruled.filter(
    (each) => Number.parseFloat(each.width) > 0 && !/rgba\(0, 0, 0, 0\)/.test(each.colour),
  );
  check(
    'every section but the first is separated by a painted rule',
    withRule.length === ruled.length - 1,
    `${withRule.length} of ${ruled.length} sections carry one`,
  );
}

await page.screenshot({ path: `${outDir}/key-sheet-column.png` });
console.log(`${outDir}/key-sheet-column.png`);

/* ── THE SEARCH BOX ──────────────────────────────────────────────────────── */
{
  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute('data-key-sheet-search') !== null,
  );
  check('the search box holds the keyboard on open', focused, 'something else has it');

  // A REAL KEYSTROKE, not a value assignment: what is being measured is that
  // the character reaches the box at all, with the canvas's window listener
  // live underneath it.
  await page.keyboard.type('palette');
  await page.waitForTimeout(80);
  const filtered = await geometry();
  console.log(`"palette" leaves ${filtered.rows.length} rows`);
  check(
    'typing narrows the sheet',
    filtered.rows.length > 0 && filtered.rows.length < first.rows.length,
    `${filtered.rows.length} of ${first.rows.length}`,
  );
  check(
    'and every row left is one the query names',
    filtered.rows.every((row) => row.label.toLowerCase().includes('palette')),
    filtered.rows.map((row) => row.label).join(' | '),
  );
  await page.screenshot({ path: `${outDir}/key-sheet-search.png` });
  console.log(`${outDir}/key-sheet-search.png`);

  // THE EMPTY RESULT IS A SENTENCE WITH A BOX, not a blank panel.
  await page.fill('[data-key-sheet-search]', 'zzzznothing');
  await page.waitForTimeout(80);
  const empty = await page.evaluate(() => {
    const note = document.querySelector('[data-key-sheet-empty]');
    const box = note?.getBoundingClientRect() ?? null;
    return {
      text: note?.textContent ?? '',
      painted: box !== null && box.width > 0 && box.height > 0,
      rows: document.querySelectorAll('[data-key-sheet] li').length,
    };
  });
  console.log(`empty: ${JSON.stringify(empty)}`);
  check('an empty result says so, in a box that exists', empty.painted, empty.text);
  check('and names what was searched for', empty.text.includes('zzzznothing'), empty.text);
  check('and draws no rows behind it', empty.rows === 0, `${empty.rows} rows`);

  // AND `?` IS A CHARACTER HERE, not the sheet's own key. It is also a real
  // binding, so typing it finds a row rather than nothing.
  await page.fill('[data-key-sheet-search]', '');
  await page.keyboard.press('?');
  await page.waitForTimeout(80);
  const question = await page.evaluate(() => ({
    value: document.querySelector('[data-key-sheet-search]')?.value ?? '',
    open: document.querySelector('[data-key-sheet]') !== null,
    keys: [...document.querySelectorAll('[data-key-sheet-keys]')].map((k) => k.textContent),
  }));
  check('`?` typed in the box is a question mark', question.value === '?', question.value);
  check('and the sheet is still open', question.open, 'it closed');
  check('and it finds the key it names', question.keys.includes('?'), question.keys.join(' '));

  // THE BOX STAYS PUT WHEN THE LIST SCROLLS. It is outside the scroller, so a
  // wheel over a hundred rows cannot carry the search away.
  await page.fill('[data-key-sheet-search]', '');
  await page.waitForTimeout(80);
  const before = await geometry();
  await page.mouse.move(600, 500);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(120);
  const after = await geometry();
  check('the list scrolls at all', before.scrollable, 'nothing to scroll');
  check(
    'and the search box does not move with it',
    after.searchTop === before.searchTop,
    `${before.searchTop} -> ${after.searchTop}`,
  );
  check(
    'while the rows do',
    after.rows[0].top !== before.rows[0].top,
    `${before.rows[0].top} -> ${after.rows[0].top}`,
  );
}

/* ── ESCAPE, FROM INSIDE THE BOX ─────────────────────────────────────────── */
{
  const closed = await page.evaluate(() => document.activeElement?.tagName);
  check('the keyboard is still in the box', closed === 'INPUT', `it is on ${closed}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const gone = await page.evaluate(() => document.querySelector('[data-key-sheet]') === null);
  // THE WHOLE REASON THE SHEET BINDS ITS OWN ESCAPE: the canvas never hears
  // this one, because its window listener steps aside for an input.
  check('Escape typed in the search box closes the sheet', gone, 'the sheet is still up');
}

/* ── A NARROW WINDOW ─────────────────────────────────────────────────────── */
{
  await page.setViewportSize({ width: 700, height: 560 });
  await page.waitForTimeout(120);
  await openSheet();
  const narrow = await page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const panel = document.querySelector('[data-key-sheet] > div:not([aria-label])');
    const scroller = document.querySelector('[data-key-sheet-groups]');
    const box = panel?.getBoundingClientRect() ?? null;
    const rows = [...document.querySelectorAll('[data-key-sheet] li')].map((li) => {
      const r = li.getBoundingClientRect();
      return { right: round(r.right), left: round(r.left) };
    });
    return {
      panel:
        box === null
          ? null
          : { left: round(box.left), right: round(box.right), bottom: round(box.bottom) },
      view: { width: window.innerWidth, height: window.innerHeight },
      scrolls: scroller === null ? false : scroller.scrollHeight > scroller.clientHeight,
      spilling: rows.filter((row) => box !== null && (row.right > box.right || row.left < box.left))
        .length,
      rows: rows.length,
    };
  });
  console.log(`narrow: ${JSON.stringify(narrow)}`);
  check('the sheet still draws its rows at 700px', narrow.rows > 80, `${narrow.rows} rows`);
  check(
    'the panel stays inside the window',
    narrow.panel !== null &&
      narrow.panel.left >= 0 &&
      narrow.panel.right <= narrow.view.width &&
      narrow.panel.bottom <= narrow.view.height + 1,
    JSON.stringify(narrow.panel),
  );
  check('no row leaves the panel sideways', narrow.spilling === 0, `${narrow.spilling} rows do`);
  check('and the list scrolls inside it rather than overflowing', narrow.scrolls, 'it does not');
  await page.screenshot({ path: `${outDir}/key-sheet-narrow.png` });
  console.log(`${outDir}/key-sheet-narrow.png`);
}

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} key-sheet guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('\nkey-sheet: every assertion passed.');
