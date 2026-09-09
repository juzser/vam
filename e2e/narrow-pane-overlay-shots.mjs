/**
 * The view-icon overlay must not paint over the top of the prompt block.
 *
 * Audit F1 (S2), measured at a 253px pane: the nav occupied x 924-1014 while
 * the identity line ran to x 1010 -- the last 86px of project . epic . turn
 * sat under an opaque `bg-sidebar` pill, and the prompt's first line lost its
 * top pixels. The spans were `truncate`d, but the ellipsis is computed against
 * the PANE edge, not against the pill, so the text was laid out, measured as
 * visible, and then covered.
 *
 * THE IDENTITY LINE IS GONE. The operator had the project and the epic taken
 * off it first ("remove the branch and repo information above the In
 * section"), and then the `you . <turn label>` remainder as well ("also remove
 * the `you . ...` part above In"). Its `pr-[7rem]` reservation went with it --
 * and the OBLIGATION did not, which is the whole reason this file still
 * exists: with nothing above it, the bubble rose into the corner the pill
 * paints on, and this guard measured 24 of 100 sampled glyph pixels of the
 * prompt's first line under the pill the moment the line was deleted. The
 * reservation moved into the bubble as a floated spacer, and the number below
 * is what says so.
 *
 * RETIRED WITH THE LINE: the checks that read `[data-detail-identity]` and
 * `[data-detail-turn]` -- "not one pixel of the identity line is covered",
 * "the reserved corner has not squeezed the label to an ellipsis", and "the
 * line has not grown the session's facts back" -- along with the long-label
 * injection written to make the line overflow. All four were about an element
 * that no longer renders; kept, they would have thrown on `null` and reported
 * a missing selector as if it were an occlusion.
 *
 * WHY A REAL BROWSER: this is occlusion. Nothing about the class list of
 * either element says whether one covers the other; only layout plus paint
 * order does, and only `elementFromPoint` reports it. A jsdom test here could
 * assert the float class and stay green while the pill went on covering a
 * line that had grown.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/narrow-pane-overlay-shots.mjs http://localhost:5521 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5521';
const outDir = process.argv[3] ?? 'docs/ui';

const browser = await chromium.launch();
// Narrow on purpose: the sidebar takes its share and the pane lands near the
// 253px the audit measured, which is where the collision is worst.
const page = await browser.newPage({ viewport: { width: 620, height: 560 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForSelector('[data-detail-column]');

// THE LINE IS REALLY GONE. Not decoration: every check below measures the
// bubble, and the bubble is only in the pill's corner BECAUSE nothing sits
// above it. If the line came back, this file would be measuring the wrong
// element and passing.
if ((await page.locator('[data-detail-identity]').count()) > 0) {
  throw new Error('the identity line above the prompt is back -- this guard now measures the wrong element.');
}

/**
 * WHICH PROMPT IS IN THE CORNER. The pane draws the whole session now, one
 * prompt bubble per turn, and the one the pill floats over is whichever is
 * PINNED at the top of the column. The column opens at its end, so that is the
 * newest turn's — named here rather than left to `querySelector`'s first match,
 * which would be the OLDEST turn's bubble, seven screens away from the pill.
 */
const PINNED = '[data-column-turn][data-turn-newest]';
const overlay = page.locator('[data-view-tabs]');
const bubbleBox = await page.locator(`${PINNED} [data-detail-scroll="in"]`).boundingBox();
const navBox = await overlay.boundingBox();
console.log(
  `prompt bubble x ${Math.round(bubbleBox.x)}-${Math.round(bubbleBox.x + bubbleBox.width)} ` +
    `top ${Math.round(bubbleBox.y)}, nav x ${Math.round(navBox.x)}-${Math.round(navBox.x + navBox.width)} ` +
    `bottom ${Math.round(navBox.y + navBox.height)}`,
);
if (navBox.y + navBox.height <= bubbleBox.y) {
  throw new Error(
    'the pill ends above the bubble, so nothing here can collide -- the state this guard ' +
      'was written for is unreachable and the checks below are vacuous.',
  );
}

/**
 * Which of the element's PAINTED GLYPHS are under the overlay.
 *
 * Not its bounding box: reserving the corner is done with padding and a
 * float, and both leave the box exactly as wide as it was — a box test
 * cannot tell a reserved corner from a covered one. `Range` over the text
 * nodes gives the rectangles the glyph runs actually occupy, and
 * `elementFromPoint` says what is on top of each.
 */
async function coveredText(selector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const nav = document.querySelector('[data-view-tabs]');
    const note = document.querySelector('[data-view-note]');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const rects = [];
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if ((n.textContent ?? '').trim() === '') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      // CLIPPED TO WHAT IS ACTUALLY PAINTED. A `Range` over a `truncate`d
      // span reports the text's full laid-out extent, including the part
      // `overflow: hidden` throws away — and that invisible tail runs right
      // under the pill, so sampling it reported the very defect the fix had
      // just removed. The parent element's own box IS the clip.
      const clip = n.parentElement.getBoundingClientRect();
      for (const r of range.getClientRects()) {
        const x = Math.max(r.x, clip.x);
        const right = Math.min(r.right, clip.right);
        if (right - x > 0 && r.height > 0) rects.push({ x, y: r.y, width: right - x, height: r.height });
      }
    }
    let covered = 0;
    let samples = 0;
    for (const r of rects) {
      // Only the first 24px of the block can meet the overlay at all; below
      // that the pill has ended, and sampling a 10,000px paragraph is slow.
      if (r.y > root.getBoundingClientRect().y + 24) continue;
      for (let dx = 1; dx < r.width; dx += 3) {
        samples += 1;
        // THREE HEIGHTS, not the midline. The audit's second half was "the
        // prompt's first line loses its top 8px" — a pill whose bottom edge
        // cuts the ascenders covers the line without ever reaching its
        // middle, so sampling the centre alone would call that clean.
        for (const dy of [1.5, r.height / 2, r.height - 1.5]) {
          const top = document.elementFromPoint(r.x + dx, r.y + dy);
          if (top === null) continue;
          if (nav.contains(top) || (note !== null && note.contains(top))) {
            covered += 1;
            break;
          }
        }
      }
    }
    return { covered, samples, rects: rects.length };
  }, selector);
}

// 1. NOT ONE PIXEL OF THE PROMPT'S FIRST LINE IS UNDER THE PILL. This is
//    what is left of F1 once the identity line is gone -- and it is now the
//    whole of it, because the bubble is what sits in that corner. The bubble's
//    padding alone does NOT discharge it (measured: 24 of 100 points covered);
//    the floated spacer inside the paragraph does.
const bubble = await coveredText(`${PINNED} [data-detail-scroll="in"]`);
console.log(
  `prompt first line: ${bubble.covered} of ${bubble.samples} sampled glyph pixels covered ` +
    `(${bubble.rects} text runs)`,
);
if (bubble.samples < 10) {
  throw new Error(
    `only ${bubble.samples} glyph pixels of the prompt's first line were sampled -- a check ` +
      `over almost no points passes for the wrong reason.`,
  );
}
if (bubble.covered > 0) {
  throw new Error(
    `the overlay covers the prompt's first line at ${bubble.covered} of ${bubble.samples} points`,
  );
}

// 2. AND THE RESERVATION IS NO WIDER THAN THE PILL IT IS FOR. Reserving the
//    corner costs the prompt's first line real width, so over-reserving loses
//    the opening words by a second route -- which is what the identity line's
//    7rem did (40px past the pill). Measured against the pill's own left edge
//    rather than against a remembered number.
const reserve = await page.locator(`${PINNED} [data-detail-corner-reserve]`).boundingBox();
const slack = Math.round(navBox.x - reserve.x);
console.log(
  `corner reservation x ${Math.round(reserve.x)}-${Math.round(reserve.x + reserve.width)}, ` +
    `${slack}px wider on the left than the pill needs`,
);
if (slack < 0) {
  throw new Error(
    `the reservation starts ${-slack}px INSIDE the pill -- it cannot be what keeps the ` +
      `first line clear, and check 1 above is passing for some other reason`,
  );
}
if (slack > 48) {
  throw new Error(
    `the reservation runs ${slack}px past the pill's left edge -- that width is taken out of ` +
      `the prompt's first line for nothing`,
  );
}

// 3. AND THE FIX IS NOT "SHRINK THE PILL". The icons stay a real touch
//    target; reserving the corner must not have been paid for out of the
//    44px floor the phone rules hold everywhere else.
const tap = await page.locator('[data-view-tabs] button').first().boundingBox();
console.log(`view icon hit box: ${Math.round(tap.width)}x${Math.round(tap.height)}`);
if (tap.width < 22 || tap.height < 22) {
  throw new Error(`the view icons were shrunk to ${tap.width}x${tap.height} to make room`);
}

// 4. THE OTHER THING THAT REACHES THAT CORNER. Since the pane became a column
//    of the whole session, the element at the very top of it is not a prompt at
//    all: it is the boundary that says how far back vam has read, and at
//    scrollTop 0 THAT is what the pill floats over. F1's obligation follows
//    whatever sits in the corner, so it is measured there too — with the same
//    method, because the reservation is padding here and a box test cannot tell
//    padding from a collision.
await page.locator('[data-detail-column]').evaluate((el) => {
  el.scrollTop = 0;
});
await page.waitForTimeout(200);
const boundary = await coveredText('[data-column-start]');
console.log(
  `column boundary: ${boundary.covered} of ${boundary.samples} sampled glyph pixels covered ` +
    `(${boundary.rects} text runs)`,
);
if (boundary.samples < 10) {
  throw new Error(
    `only ${boundary.samples} glyph pixels of the boundary were sampled -- a check over almost ` +
      `no points passes for the wrong reason.`,
  );
}
if (boundary.covered > 0) {
  throw new Error(
    `the overlay covers the column's boundary line at ${boundary.covered} of ` +
      `${boundary.samples} points -- the one sentence that says the session may go back further`,
  );
}
await page.screenshot({ path: `${outDir}/narrow-pane-overlay-boundary.png` });
console.log(`${outDir}/narrow-pane-overlay-boundary.png`);

// Back to where the shot belongs: the pinned prompt in the corner.
await page.locator('[data-detail-column]').evaluate((el) => {
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/narrow-pane-overlay.png` });
console.log(`${outDir}/narrow-pane-overlay.png`);

await browser.close();
