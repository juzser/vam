/**
 * THE SEAM BETWEEN THE SIDEBAR AND THE PANE, READ AS PAINT.
 *
 * Operator: "có một line màu trắng rất nhỏ ở chỗ giao giữa sidebar và pane, ở
 * trên cùng, ngay phần resize sidebar" — a very small white line where the
 * sidebar meets the pane, at the very top, right at the sidebar resizer.
 *
 * It was real, it was one pixel tall and four wide, and NOTHING IN THIS REPO
 * COULD HAVE SEEN IT. Every element at that seam declared the right thing: the
 * sidebar's `border-r` is `border-line`, the handle is `bg-transparent`, no
 * radius anywhere near it, every rectangle on an integer. The line was not in
 * any declaration this repo wrote at all — it came from Tailwind's own
 * preflight, which re-adds `border-top-width: 1px` to every `<hr>` AFTER the
 * `*` reset has zeroed borders, leaving `border-style: solid` from that reset
 * and `currentColor` for the colour. The three resize handles are `<hr>`
 * elements (a native `separator`, which is what biome's a11y rule asks for),
 * so each of them wore a one-pixel line in the INK COLOUR OF ITS COLUMN across
 * the top of its own box. `PaneResizer`'s own comment asserted the opposite —
 * "Tailwind's preflight zeroes its default margin/border" — which is true of
 * the margin and false of the border, and that sentence is why it survived.
 *
 * SO THE CLAIM HERE IS ABOUT PIXELS, NOT ABOUT STYLE. A `getComputedStyle`
 * check on `borderTopWidth` is cheap and is kept below as the second half, but
 * on its own it is the same kind of evidence that already failed: it reads a
 * declaration. The first half rasterises the seam and compares the TOP ROW OF
 * PIXELS, column by column, against a reference row a few pixels down. That
 * comparison does not know what the defect was, which is the point — a border
 * nobody declared, a resizer's rest state leaking, a rounded corner showing
 * the ground beneath, a background stopping a pixel short and a sub-pixel gap
 * at a fractional position all produce the same symptom and all fail it.
 *
 * WHAT WAS RULED OUT, BY MEASUREMENT, BEFORE THE FIX (dark theme, 1100x700):
 *   - the aside's own `border-right` is `1px solid rgb(68, 68, 68)` and paints
 *     at x=263 on EVERY row: the intended seam, a different colour, full
 *     height. Not it.
 *   - the handle's `background-color` at rest is `rgba(0, 0, 0, 0)`, and the
 *     anomaly was 1px tall while the handle is 668px. Not a hover/focus leak.
 *   - every element at the seam reports `border-radius: 0px`. No corner.
 *   - aside 0→264, handle 261→265, detail column at 264, `deviceScaleFactor`
 *     1. Every edge an integer. No sub-pixel gap.
 *   - the painted row: y=0 gave x=261..264 at rgb(237, 237, 237), which is
 *     `--vam-ink`; y>=1 gave the sidebar's fill to x=262, the `--vam-line`
 *     seam at x=263, the ground beyond. The handle's own `border-top`
 *     computed to `1px solid rgb(237, 237, 237)`. That is the whole defect.
 *
 * THE FAMILY, NOT THE INSTANCE. The operator saw one line because one handle
 * is on screen at rest. Opening a vertical and then a horizontal split puts
 * two more `<hr>` handles up, and the horizontal one is 468px wide — a
 * near-white rule most of the way across the pane. So the style sweep below
 * runs with both splits open and counts what it found, because a sweep that
 * examined nothing reports no violation and passes forever.
 *
 * BOTH THEMES, because `currentColor` is the defect's colour: the dark theme
 * drew the line in near-white and the light theme drew it in near-black
 * (`rgb(24, 24, 27)`). One theme's guard would have been half a guard.
 *
 * FALSIFIED, not argued. With the fix reverted in the built bundle the pixel
 * half reports the four columns by name and the style half names all three
 * handles; with it in place, and with no mutation at all, every check here is
 * green. Both runs are recorded in the pull request.
 *
 * `?demo=1`, always: vam is public, and every real session on this machine is
 * somebody's work.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/sidebar-seam-shots.mjs http://localhost:5530 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5530';
const outDir = process.argv[3] ?? 'docs/ui';

/** How far either side of the handle the pixel strip reaches. Wide enough to
 *  hold the sidebar's fill, its border and the ground beyond it, which is what
 *  makes the corpus check below able to prove the strip straddles the seam. */
const REACH = 10;
/** How many rows down the strip goes. The top row is the suspect; the rest are
 *  the reference, and they must agree with each other before the top row is
 *  compared to any of them. */
const ROWS = 8;
/** Which of those rows the top row is compared against — far enough from the
 *  edge that a one-pixel defect cannot have reached it. */
const REFERENCE_ROW = 4;

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

const browser = await chromium.launch();
// `deviceScaleFactor: 1` deliberately: a 2x shot would blend the defect into
// its neighbours and turn an exact comparison into a threshold nobody chose.
const page = await browser.newPage({
  viewport: { width: 1100, height: 700 },
  deviceScaleFactor: 1,
});
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-sidebar-pane]');
await page.waitForSelector('[data-session-row]');

/**
 * Rasterise a strip of the live page and hand back its pixels as rows.
 *
 * The screenshot is decoded BY THE PAGE ITSELF, through an `Image` and a
 * canvas, so the numbers compared below are the ones a compositor produced —
 * not a second renderer's idea of them, and not a stylesheet's.
 */
async function strip(x, y, w, h) {
  const shot = await page.screenshot({ clip: { x, y, width: w, height: h } });
  return page.evaluate(
    async ({ b64, w: width, h: height }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, width, height).data;
      const rows = [];
      for (let row = 0; row < height; row += 1) {
        const cells = [];
        for (let col = 0; col < width; col += 1) {
          const i = (row * width + col) * 4;
          cells.push(`${d[i]},${d[i + 1]},${d[i + 2]}`);
        }
        rows.push(cells);
      }
      return rows;
    },
    { b64: shot.toString('base64'), w, h },
  );
}

/** Every `<hr>` on the page and what its top edge declares. */
const handles = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('hr')].map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        id:
          el.getAttribute('data-pane-resize-handle') ??
          el.getAttribute('data-split-resize-handle') ??
          el.getAttribute('data-files-tree-resize') ??
          '(unnamed hr)',
        width: Math.round(r.width),
        height: Math.round(r.height),
        borderTopWidth: cs.borderTopWidth,
        borderTopColor: cs.borderTopColor,
        colour: cs.color,
      };
    }),
  );

// ---------------------------------------------------------------------------
// 1. THE PAINTED SEAM — the operator's own report, answered in pixels.
// ---------------------------------------------------------------------------

const handleBox = await page.evaluate(() => {
  const el = document.querySelector('[data-pane-resize-handle="sidebar"]');
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  const aside = document.querySelector('[data-sidebar-pane]').getBoundingClientRect();
  return {
    x: r.x,
    right: r.right,
    top: r.top,
    height: r.height,
    asideRight: aside.right,
    asideTop: aside.top,
  };
});
check(
  'the sidebar resize handle is on screen at all — every pixel check below reads its seam',
  handleBox !== null,
  'no [data-pane-resize-handle="sidebar"]',
);
if (handleBox === null) {
  await browser.close();
  process.exit(1);
}
check(
  'the handle really starts at the top of the column, which is where the line was',
  Math.round(handleBox.top) === Math.round(handleBox.asideTop),
  `handle top ${handleBox.top}, sidebar top ${handleBox.asideTop}`,
);

const x0 = Math.round(handleBox.x) - REACH;
const width = Math.round(handleBox.right - handleBox.x) + REACH * 2;
const rows = await strip(x0, 0, width, ROWS);
const reference = rows[REFERENCE_ROW];
const top = rows[0];

// The corpus, first. A strip that landed on one flat colour would compare a
// row of greys to an identical row of greys and pass having looked at nothing.
const distinct = new Set(reference);
check(
  'the strip really straddles the seam — the reference row holds the fill, the border and the ground',
  distinct.size >= 3,
  `${distinct.size} distinct colours across ${reference.length}px: ${[...distinct].join(' | ')}`,
);
check(
  'and it is wide enough to have caught a four-pixel defect with room either side',
  width >= 4 + REACH * 2 && reference.length === width,
  `${reference.length} columns of a requested ${width}`,
);
// And the reference itself has to be stable, or "the top row differs from the
// reference" would be a claim about the reference.
const referenceStable = rows
  .slice(1)
  .every((row) => row.every((cell, i) => cell === reference[i]));
check(
  'the rows below the top edge all agree, so the reference row is a reference',
  referenceStable,
  rows
    .slice(1)
    .map((row, i) => `y=${i + 1}: ${row.filter((c, j) => c !== reference[j]).length} differ`)
    .join(', '),
);

const differing = top
  .map((cell, i) => (cell === reference[i] ? null : `x=${x0 + i} ${cell} vs ${reference[i]}`))
  .filter((entry) => entry !== null);
check(
  'THE TOP ROW OF THE SEAM IS THE SAME PICTURE AS THE ROWS BELOW IT — no hairline',
  differing.length === 0,
  `${differing.length} column(s): ${differing.join(', ')}`,
);

await page.screenshot({
  path: `${outDir}/sidebar-seam-top.png`,
  clip: { x: x0 - 8, y: 0, width: width + 16, height: 24 },
});
console.log(`${outDir}/sidebar-seam-top.png`);

// ---------------------------------------------------------------------------
// 2. EVERY HANDLE, IN BOTH THEMES, WITH BOTH SPLIT ORIENTATIONS OPEN.
//
// The declaration half. Cheap, and it covers the two handles the operator
// cannot see at rest — including the horizontal split divider, which is the
// widest surface in the family and drew the loudest version of the same line.
// ---------------------------------------------------------------------------

async function sweep(label, expected) {
  const found = await handles();
  console.log(`${label}: ${JSON.stringify(found)}`);
  check(
    `${label} — the sweep found the ${expected} handle(s) it is about`,
    found.length === expected,
    `${found.length} <hr> on screen`,
  );
  const bordered = found.filter((h) => h.borderTopWidth !== '0px');
  check(
    `${label} — no resize handle paints a rule across its own top edge`,
    bordered.length === 0,
    bordered.map((h) => `${h.id}: ${h.borderTopWidth} ${h.borderTopColor}`).join(', '),
  );
}

await sweep('at rest', 1);

// `zv` splits the focused pane vertically, `zs` splits it horizontally: one
// divider of each orientation, which is two more handles and the only way the
// wide one gets measured at all.
await page.keyboard.press('z');
await page.keyboard.press('v');
await page.waitForTimeout(250);
await page.keyboard.press('z');
await page.keyboard.press('s');
await page.waitForTimeout(250);
await sweep('with a vertical and a horizontal split open', 3);

// The light theme's answer to the same question. `currentColor` is what the
// defect painted in, so the two themes drew two different lines and a
// single-theme guard would have been half of one.
await page.evaluate(() => {
  document.documentElement.classList.remove('dark');
  document.documentElement.classList.add('light');
});
await page.waitForTimeout(150);
check(
  'the light theme really applied, or the sweep below repeats the dark one',
  (await page.evaluate(() => document.documentElement.classList.contains('light'))) === true,
  await page.evaluate(() => document.documentElement.className),
);
await sweep('in the light theme', 3);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nsidebar-seam-shots: all checks passed.');
