/**
 * The view-icon overlay must not paint over the identity line.
 *
 * Audit F1 (S2), measured at a 253px pane: the nav occupied x 924–1014 while
 * the identity line ran to x 1010 — the last 86px of project · epic · turn
 * sat under an opaque `bg-sidebar` pill, and the prompt's first line lost its
 * top pixels. The spans are `truncate`d, but the ellipsis is computed against
 * the PANE edge, not against the pill, so the text is laid out, measured as
 * visible, and then covered. The two facts the deleted header relocated into
 * that line — project and epic — are exactly what disappears, in every
 * focused pane under roughly 600px, in both themes.
 *
 * The overlay's own comment claimed it "can only ever cover the few pixels
 * its glyphs occupy — never the whole line of text beneath it". True of the
 * wrapper, false of the filled pill inside it. Fixed in the code, and fixed
 * in the comment.
 *
 * WHY A REAL BROWSER: this is occlusion. Nothing about the class list of
 * either element says whether one covers the other; only layout plus paint
 * order does, and only `elementFromPoint` reports it. A jsdom test here could
 * assert the padding class and stay green while the pill went on covering a
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

/**
 * The FIXTURE CANNOT DO THIS ALONE, and finding that out is half the guard.
 * The demo's identity line reads `factory · ui-server-sse · you · R-5`,
 * which is short enough that at 620px its glyphs stop 25px short of the pill
 * — so the first version of this file passed with the fix reverted, and the
 * falsification is what caught it. What the audit measured needs the line to
 * OVERFLOW, because that is the mechanism: `truncate` computes its ellipsis
 * against the pane edge, so an overflowing line is laid out all the way to
 * the corner the pill occupies. A longer epic name (they are branch names;
 * this length is ordinary) is injected to get there.
 */
await page.evaluate(() => {
  const spans = document.querySelectorAll('[data-detail-identity] span');
  spans[2].textContent = 'ui-server-sse-reconnect-and-backpressure';
});
await page.waitForTimeout(250);

const identity = page.locator('[data-detail-identity]');
const overlay = page.locator('[data-view-tabs]');
const idBox = await identity.boundingBox();
const navBox = await overlay.boundingBox();
console.log(
  `pane identity x ${Math.round(idBox.x)}–${Math.round(idBox.x + idBox.width)}, ` +
    `nav x ${Math.round(navBox.x)}–${Math.round(navBox.x + navBox.width)}`,
);

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

// 1. NOT ONE PIXEL OF THE IDENTITY LINE IS UNDER THE PILL. This is the whole
//    finding: project and epic are the facts the removed header relocated
//    here, and a truncated line that is then covered has lost them silently.
const id = await coveredText('[data-detail-identity]');
console.log(
  `identity line: ${id.covered} of ${id.samples} sampled glyph pixels under the overlay ` +
    `(${id.rects} text runs)`,
);
if (id.covered > 0) {
  throw new Error(
    `the view-icon overlay covers the identity line at ${id.covered} of ${id.samples} ` +
      `sampled points — project and epic are drawn, measured as visible, and then painted over.`,
  );
}

// 2. NOR THE PROMPT'S FIRST LINE, the other half of F1 ("the prompt's first
//    line loses its top 8px"). Nothing was added for this one: the bubble's
//    own padding already drops the text below the pill's bottom edge, which
//    is why a float spacer written for it was removed again — it could not be
//    falsified, so it was decoration. The check stays because the property is
//    real and the thing discharging it (padding on a bubble, a paint choice)
//    could be changed by someone who never heard of this overlay.
const bubble = await coveredText('[data-detail-scroll="in"]');
console.log(`prompt first line: ${bubble.covered} of ${bubble.samples} sampled glyph pixels covered`);
if (bubble.covered > 0) {
  throw new Error(
    `the overlay covers the prompt's first line at ${bubble.covered} of ${bubble.samples} points`,
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

// 4. THE IDENTITY LINE STILL SAYS SOMETHING. Reserving 7rem of a 253px pane
//    could truncate project and epic to their ellipses, which would lose the
//    same two facts by another route.
const text = (await identity.innerText()).replace(/\s+/g, ' ').trim();
console.log(`identity line reads: ${text}`);
if (!text.includes('factory') || !text.includes('ui-server-sse')) {
  throw new Error(`the identity line no longer names the project and epic: "${text}"`);
}

await page.screenshot({ path: `${outDir}/narrow-pane-overlay.png` });
console.log(`${outDir}/narrow-pane-overlay.png`);

await browser.close();
