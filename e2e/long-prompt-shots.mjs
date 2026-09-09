/**
 * The answer must be reachable under a prompt of ANY length — and the prompt
 * must read as a bubble of its own.
 *
 * Audit F2 (S2), measured: a 3,822-character prompt left the answer 19px, and
 * a 10,920-character one covered `progress` and `out` AT MAXIMUM SCROLL. The
 * `in` block is `position: sticky` with no height bound, so a tall sticky
 * element simply stays pinned over the whole column: there was no scroll
 * offset that revealed the answer and no control to recover it. A16 accepted
 * "a very long prompt can cover the pane" as a cost; unreachable-forever is
 * not that cost, and pasting a plan or a stack trace is this tool's daily
 * case.
 *
 * WHY A REAL BROWSER: every fact here is layout. `position: sticky` resolves
 * against a scrolling ancestor, a percentage `max-height` resolves against a
 * flex parent's computed height, and happy-dom computes neither — a unit test
 * can only read the class name back, which is the guard that stays green
 * while the answer sits off screen.
 *
 * THE FIXTURE CANNOT DO THIS ALONE: the demo's longest prompt is 211
 * characters. The long text is injected at runtime into the paragraph the
 * pane already rendered, which is enough for layout and touches nothing about
 * how the pane got its data.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/long-prompt-shots.mjs http://localhost:5521 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5521';
const outDir = process.argv[3] ?? 'docs/ui';

/** Realistic prose, not one unbreakable word: wrapping is the thing measured. */
const LONG = 'A plan pasted into the prompt, one clause after another, until the box is longer than the pane it lives in. '.repeat(100);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForSelector('[data-detail-column]');

/**
 * ONE TURN, NAMED, AND ONE THAT CAN ACTUALLY BE PINNED.
 *
 * The pane draws the whole session now — one `in`, one `progress` and one `out`
 * PER TURN — so an unqualified `[data-detail-block="in"]` names seven elements
 * and Playwright refuses it outright. Which turn is not arbitrary: F2 is about
 * a prompt that is PINNED covering the answer underneath it, and only a turn
 * whose own start can be scrolled to the top of the column is ever in that
 * state. The NEWEST turn never is — the column cannot scroll past its end, so
 * at maximum scroll the newest turn sits 67px down with the turn before it
 * above, unpinned, and every check here would have been measuring a prompt that
 * cannot cover anything. The fourth of seven is the subject: middling, and with
 * three turns of column below it to be scrolled under.
 *
 * The cap itself is per-turn and resolves through the per-turn wrapper — that
 * is measured separately, for several turns, by
 * `e2e/transcript-column-shots.mjs`.
 */
const TURN = '[data-column-turn]:nth-of-type(4)';
const column = page.locator('[data-detail-column]');
const inBlock = page.locator(`${TURN} [data-detail-block="in"]`);
const outBlock = page.locator(`${TURN} [data-detail-block="out"]`);
const bubble = page.locator(`${TURN} [data-detail-scroll="in"]`);

// Inject the long prompt into the paragraph already on screen.
await page.locator(`${TURN} [data-detail-scroll="in"] p`).evaluate((el, text) => {
  el.textContent = text;
}, LONG);
await page.waitForTimeout(250);
console.log(`injected prompt: ${LONG.length} characters`);

const col = await column.boundingBox();
// PINNED, which is the whole premise: the turn's own start at the top of the
// column, so its capped prompt is stuck there with its answer directly beneath.
const pinnedAt = await column.evaluate((el) => {
  const article = el.querySelectorAll('[data-column-turn]')[3];
  const top = article.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  el.scrollTop = top;
  return { asked: Math.round(top), got: Math.round(el.scrollTop) };
});
await page.waitForTimeout(250);
const pinCheck = await inBlock.evaluate(
  (el) => el.getBoundingClientRect().top - el.closest('[data-detail-column]').getBoundingClientRect().top,
);
console.log(
  `scrolled ${JSON.stringify(pinnedAt)}; the prompt sits ${pinCheck.toFixed(1)}px from the ` +
    `top of the column`,
);
if (Math.abs(pinCheck) > 4) {
  throw new Error(
    `the prompt is ${pinCheck.toFixed(1)}px from the column's top edge at its own turn's start ` +
      `— it is not pinned, so nothing below is measuring what it says it is.`,
  );
}

const inBox = await inBlock.boundingBox();
const outBox = await outBlock.boundingBox();

/**
 * HOW MUCH OF THE ANSWER IS ACTUALLY PAINTED, not how much of it intersects
 * the column. The two differ by exactly the bug: `out` sat inside the
 * column's box the whole time and was covered by the sticky block painting
 * over it, so a geometric intersection reported 41 visible pixels of an
 * answer nothing could read. `elementFromPoint` asks the compositor instead
 * — it answers with whatever is on top at that pixel.
 */
async function paintedRowsOfOut() {
  return page.evaluate(
    ({ box, turn }) => {
      const out = document.querySelector(`${turn} [data-detail-block="out"]`);
      let painted = 0;
      for (let dy = 2; dy < box.height; dy += 4) {
        const el = document.elementFromPoint(box.x + box.width / 2, box.y + dy);
        if (el !== null && (el === out || out.contains(el))) painted += 4;
      }
      return painted;
    },
    { box: outBox, turn: TURN },
  );
}

const painted = await paintedRowsOfOut();
console.log(
  `with the prompt pinned: column ${Math.round(col.height)}px, in ${Math.round(inBox.height)}px, ` +
    `out ${Math.round(outBox.height)}px of which ${painted}px is actually on top`,
);

// 1. THE ANSWER IS REACHABLE. Not "is laid out somewhere" — on top, at the
//    pixels it occupies, at the scroll offset furthest from the prompt.
if (painted < outBox.height - 8) {
  throw new Error(
    `the answer is unreachable: with the prompt pinned only ${painted}px of a ` +
      `${Math.round(outBox.height)}px answer is painted — the rest is under the pinned prompt.`,
  );
}

// 2. WHAT STICKS IS BOUNDED. The bound is the mechanism behind check 1, and
//    measuring it separately is what stops a future change from satisfying 1
//    by accident (a shorter fixture, a taller viewport).
if (inBox.height > col.height * 0.55) {
  throw new Error(
    `the pinned prompt takes ${Math.round(inBox.height)}px of a ${Math.round(col.height)}px ` +
      `column — a sticky block with no height bound is what made the answer unreachable.`,
  );
}

// 3. THE PROMPT ITSELF STAYS FULLY READABLE. Bounding what sticks may not
//    truncate what was typed: the bubble scrolls to its own end.
const reach = await bubble.evaluate((el) => {
  el.scrollTop = el.scrollHeight;
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
});
console.log(`bubble scroll: ${reach.scrollTop} of ${reach.scrollHeight - reach.clientHeight}`);
if (reach.scrollHeight <= reach.clientHeight + 4) {
  throw new Error('the bubble does not scroll, so the long prompt is being clipped or truncated');
}
if (reach.scrollTop < reach.scrollHeight - reach.clientHeight - 4) {
  throw new Error('the bubble will not scroll to its own end — the end of the prompt is unreachable');
}

// 4. IT READS AS A BUBBLE (operator: "the IN prompt should have a different
//    colour so it stands out, and sit in a bubble"). A distinct ground and a
//    rounded frame, measured off the element — a stylesheet rule that matches
//    nothing has passed review in this project before.
const skin = await bubble.evaluate((el) => {
  const cs = getComputedStyle(el);
  const column = el.closest('[data-detail-column]');
  return {
    background: cs.backgroundColor,
    radius: Number.parseFloat(cs.borderTopLeftRadius),
    ground: getComputedStyle(column).backgroundColor,
    // The sticky block's own ground is what the bubble has to stand out
    // FROM: it is the opaque backing the column scrolls under, and if the
    // two match there is no bubble, only padding.
    sectionGround: getComputedStyle(el.closest('[data-detail-block="in"]')).backgroundColor,
  };
});
console.log('bubble skin:', JSON.stringify(skin));
if (skin.radius < 4) throw new Error(`the bubble has no rounded frame (radius ${skin.radius}px)`);
if (skin.background === 'rgba(0, 0, 0, 0)') {
  throw new Error('the bubble has no ground of its own — it is transparent');
}
if (skin.background === skin.sectionGround) {
  throw new Error(
    `the bubble's ground ${skin.background} is the block's own — nothing distinguishes it`,
  );
}

// 5. THE BUBBLE HAS REAL PADDING, MEASURED AS PAINT (the operator: "the In
//    section's background needs padding"). Not the computed `padding`
//    property: that is the rule as typed, and this project has shipped a
//    stylesheet rule matching nothing before. What is measured is the gap
//    between the bubble's own box and the box of the text inside it, on all
//    four sides — the top and the sides at rest, the bottom at maximum
//    scroll, because the bottom inset of a scrolling box only exists at its
//    end and that is exactly where a tight bubble looks worst.
//
//    A BAND, NOT A FLOOR, since the operator asked the bubble to get tighter
//    ("the In bubble needs to be smaller, but the background behind the bubble
//    must be full") while it stays a bubble. Both edges are measured because
//    both have been wrong: at 8px the ground read as a highlight behind the
//    words rather than a shape around them, and at 14x12 the operator called
//    it too big. 9 to 12 is the room that leaves.
// Lowered from 9 to 7 when the operator asked a second time for a tighter
// bubble (12x10 -> 10x8). The floor still exists for the reason it always
// did: at 0 the tint reads as a highlight behind the words rather than a
// bubble, which an earlier 8px pass was judged to do. 7 leaves 8 a margin
// rather than sitting exactly on the bound.
const PAD_FLOOR = 7;
const PAD_CEILING = 12;
const pad = await bubble.evaluate((el) => {
  const p = el.querySelector('p');
  const inset = () => {
    const box = el.getBoundingClientRect();
    const text = p.getBoundingClientRect();
    return {
      // `clientLeft`/`clientWidth` rather than the border box's right edge:
      // this element scrolls, and the scrollbar lives inside the border box.
      // Measuring to it would credit the gutter as padding.
      left: text.left - (box.left + el.clientLeft),
      right: box.left + el.clientLeft + el.clientWidth - text.right,
      top: text.top - box.top,
      bottom: box.bottom - text.bottom,
    };
  };
  el.scrollTop = 0;
  const rest = inset();
  el.scrollTop = el.scrollHeight;
  const end = inset();
  return { top: rest.top, left: rest.left, right: rest.right, bottom: end.bottom };
});
console.log(`bubble padding painted: ${JSON.stringify(pad)}`);
for (const [side, value] of Object.entries(pad)) {
  // Half a pixel of slack for subpixel layout, and no more: the point is the
  // floor, not the rounding.
  if (value + 0.5 < PAD_FLOOR) {
    throw new Error(
      `the bubble's ${side} padding paints ${value.toFixed(1)}px, under the ${PAD_FLOOR}px floor ` +
        `— the tint reads as a highlight behind the text, not as a bubble around it`,
    );
  }
  if (value - 0.5 > PAD_CEILING) {
    throw new Error(
      `the bubble's ${side} padding paints ${value.toFixed(1)}px, over the ${PAD_CEILING}px ` +
        `ceiling — the operator asked for a tighter bubble than that`,
    );
  }
}

// 6. AND #266 IS NOT UNDONE. That PR removed `in`'s bordered panel so the turn
//    reads straight through; a bubble is a speech affordance inside the one
//    column, not the labelled band coming back.
const seam = await inBlock.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { top: cs.borderTopWidth, bottom: cs.borderBottomWidth };
});
if (Number.parseFloat(seam.bottom) > 0 || Number.parseFloat(seam.top) > 0) {
  throw new Error(`the \`in\` block wears a border again (${JSON.stringify(seam)}) — #266 removed it`);
}

// 7. THE GROUND BEHIND THE BUBBLE IS FULL-BLEED (operator: "the background
//    behind the bubble must be full and bleed out to both sides, and the
//    top"). The bubble shrank; the opaque backing it sits on did the
//    opposite. This is the sticky block's own box against the PANE's, not
//    against the scroll column's: the column sits inside `px-3.5 py-3`, so a
//    ground that stops at the column's edge leaves a gutter on each side
//    through which the answer scrolls past in full view.
const bleed = await inBlock.evaluate((el) => {
  const body = el.closest('[data-detail-column]').parentElement.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  return {
    left: box.left - body.left,
    right: body.right - box.right,
    top: box.top - body.top,
    bodyWidth: body.width,
  };
});
console.log(`sticky ground insets while pinned: ${JSON.stringify(bleed)}`);
for (const side of ['left', 'right', 'top']) {
  if (bleed[side] > 0.5) {
    throw new Error(
      `the sticky ground stops ${bleed[side].toFixed(1)}px short of the pane's ${side} edge — ` +
        `the transcript scrolls past in that gutter`,
    );
  }
}

// 8. AND NOTHING SHOWS THROUGH BESIDE IT. Two halves, because neither is
//    sufficient and finding that out was the work.
//
//    `elementFromPoint` answers PAINT ORDER, not visibility: hit-testing
//    ignores alpha, so a fully transparent sticky block still comes back as
//    the topmost element at every gutter pixel while the transcript is
//    plainly readable through it. Verified by trying it -- dropping
//    `bg-ground` off the block leaves this half reporting 0 hits. So it is
//    paired with the ground's own alpha, read off the computed style: order
//    from the compositor, opacity from the element, and the defect needs both
//    to be wrong.
//
//    Sampled down both gutters and across the strip above the bubble, at
//    the offset where this prompt is pinned, which is where the transcript is
//    at its most eager to appear beside it.
// ANY turn's answer or progress line, not only this turn's: the column scrolls
// six other turns past this pinned prompt, and one of those showing through the
// gutter is the same defect as this turn's own doing it.
const throughGutters = await inBlock.evaluate((el) => {
  const box = el.getBoundingClientRect();
  const hits = [];
  const probe = (x, y) => {
    const top = document.elementFromPoint(x, y);
    if (top === null) return;
    if (
      top.closest('[data-detail-block="out"]') !== null ||
      top.closest('[data-detail-block="progress"]') !== null
    ) {
      hits.push(`${Math.round(x)},${Math.round(y)}`);
    }
  };
  for (let dy = 2; dy < box.height; dy += 6) {
    probe(box.left + 2, box.top + dy);
    probe(box.right - 2, box.top + dy);
  }
  for (let dx = 2; dx < box.width; dx += 6) probe(box.left + dx, box.top + 2);
  return hits;
});
console.log(`transcript pixels showing beside or above the pinned prompt: ${throughGutters.length}`);
if (throughGutters.length > 0) {
  throw new Error(
    `the transcript is painted beside or above the pinned prompt at ${throughGutters.length} ` +
      `points (${throughGutters.slice(0, 4).join(' ')}) — the ground does not cover them`,
  );
}
const groundAlpha = await inBlock.evaluate((el) => {
  const value = getComputedStyle(el).backgroundColor;
  const parts = value.match(/[\d.]+/g) ?? [];
  return { value, alpha: parts.length > 3 ? Number(parts[3]) : 1 };
});
console.log(`sticky ground: ${groundAlpha.value} (alpha ${groundAlpha.alpha})`);
if (groundAlpha.alpha < 1) {
  throw new Error(
    `the sticky ground is ${groundAlpha.value} — the transcript reads straight through it, and ` +
      `the check above cannot see that because hit-testing ignores alpha`,
  );
}

await page.screenshot({ path: `${outDir}/long-prompt-bubble.png` });
console.log(`${outDir}/long-prompt-bubble.png`);

await browser.close();
