/**
 * THE COMPOSER'S TWO CONTROLS THAT SAID NOTHING, measured where they paint.
 *
 * Both come out of the same audit and neither can be held by a unit test,
 * for the two reasons this directory exists:
 *
 *  - ONE ARROW FOR TWO OUTCOMES. `src/main/sources/claude-code/deliver.ts`
 *    runs `claude --resume <id> -p "<prompt>"` and genuinely appends a turn to
 *    a running session; the factory source only appends to a log. "Sent to the
 *    agent" and "filed for later" are different things, and the button painted
 *    the same `ArrowUp` for both. The whole distinction lived in an
 *    `aria-label` and a native `title` -- and a native `title` opens on hover
 *    and on nothing else, so on a keyboard-first tool it was invisible to the
 *    primary input device. What is asserted here is that the button PAINTS a
 *    word, that the word is in the accessible name (WCAG 2.5.3), that the
 *    native `title` is gone, and that a keyboard reaching the button opens a
 *    real tooltip -- all of which are facts about layout, focus and paint.
 *
 *  - A FIELD WITH NO CURSOR. The model-request input carried `outline-none`
 *    and `focus:text-ink`, which recolours TYPED TEXT: focus an empty field
 *    and the only thing on screen is a caret. The phone stylesheet's
 *    replacement ring applies to `.vam-tap:has(> [data-tap-skin])`, and this
 *    control has no inner skin, so nothing drew one there either. A class-name
 *    test cannot see an outline; this measures `outlineStyle`, `outlineWidth`
 *    and the ratio of `outlineColor` against the surface it is drawn on, in
 *    both themes, after a REAL Tab press -- `:focus-visible` is a heuristic
 *    about the last input device, and a programmatic `.focus()` does not
 *    satisfy it.
 *
 * WHAT THIS FILE CANNOT SEE, said plainly: `?demo=1` is a `'demo'` source, so
 * `delivers` is false on every row here and only the RECORD wording is ever
 * painted. The pairing -- that a delivering source gets a different word and a
 * different glyph -- is a pure prop-driven render with no layout in it, and is
 * held in `test/panels/DetailPanel.test.tsx` where both branches can be
 * mounted. This file holds everything that needs a browser.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/composer-bar-shots.mjs http://localhost:5528 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5528';
const outDir = process.argv[3] ?? 'docs/ui';

/** A session with no open question, so the composer is the block on screen. */
const PLAIN_SESSION = 'crosscheck-2';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

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
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${PLAIN_SESSION}"]`).first().click();
await page.waitForSelector('[data-prompt-record]');
await page.waitForTimeout(300);

/** WCAG relative luminance and ratio, over an `rgb(...)` triple. */
await page.evaluate(() => {
  const chan = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const parts = (colour) => (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const opaque = (colour) => /^rgb\(\s*\d/.test(colour);
  const lum = (colour) => {
    const [r, g, b] = parts(colour);
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  };
  window.vamRing = {
    opaque,
    ratio: (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    },
    /** The nearest ancestor that paints an opaque fill — what a ring is on. */
    groundOf: (el) => {
      let node = el.parentElement;
      while (node !== null) {
        const fill = getComputedStyle(node).backgroundColor;
        if (opaque(fill)) return fill;
        node = node.parentElement;
      }
      return 'rgba(0, 0, 0, 0)';
    },
  };
});

/** Walk the real tab order until `selector` is the active element. */
async function tabTo(selector, stops = 300) {
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < stops; i += 1) {
    await page.keyboard.press('Tab');
    const landed = await page.evaluate(
      (s) => document.activeElement?.matches?.(s) === true,
      selector,
    );
    if (landed) return i + 1;
  }
  return null;
}

// ------------------------------------- 1. THE SUBMIT SAYS WHICH OUTCOME IT IS
const submit = await page.evaluate(() => {
  const el = document.querySelector('[data-prompt-record]');
  if (el === null) return null;
  // THE PAINTED WORD, not `textContent`: an icon-only button whose label sat
  // in a visually-hidden span would read the same from `textContent` and tell
  // an operator looking at the screen nothing. So the text nodes are measured
  // with a `Range`, and a run with no box is not a word.
  const runs = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const text = (n.textContent ?? '').trim();
    if (text === '') continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    runs.push({ text, width: Number(r.width.toFixed(1)), height: Number(r.height.toFixed(1)) });
  }
  const box = el.getBoundingClientRect();
  return {
    title: el.getAttribute('title'),
    name: el.getAttribute('aria-label') ?? '',
    delivers: el.getAttribute('data-prompt-delivers'),
    glyphs: el.querySelectorAll('svg').length,
    runs,
    box: `${Math.round(box.width)}x${Math.round(box.height)}`,
  };
});
console.log(`the submit control: ${JSON.stringify(submit)}`);
check('the composer draws a submit control at all', submit !== null, JSON.stringify(submit));
if (submit !== null) {
  check(
    'it carries no native `title` — the tooltip no keyboard can open',
    submit.title === null,
    `title=${JSON.stringify(submit.title)}`,
  );
  // THE WORD IS GONE, AT THE OPERATOR'S ASK ("drop the Send label from the
  // button, the icon is enough"), and these three checks turned over with it.
  //
  // What they were protecting was that the button says WHICH OUTCOME it
  // produces. A painted word said it; with none, the glyph and the accessible
  // name have to -- so the assertion is that nothing is painted BUT a glyph,
  // and that the name still names the act. WCAG 2.5.3 (label in name) applies
  // only where a visible label exists; with none it is 1.1.1, and the name is
  // the whole of it.
  const painted = submit.runs.filter((r) => r.width >= 12 && r.height >= 6);
  check(
    'it paints no word, only its glyph',
    painted.length === 0 && submit.glyphs === 1,
    `runs=${JSON.stringify(submit.runs)} glyphs=${submit.glyphs}`,
  );
  check(
    'and its accessible name still says which act it performs (WCAG 1.1.1)',
    /record|send/i.test(submit.name),
    JSON.stringify(submit.name),
  );
  // THE FIXTURE IS THE RECORDING KIND, and saying so is what keeps the check
  // above from being read as "any name will do": `?demo=1` cannot deliver, so
  // the name it carries must not claim delivery.
  check(
    'the name matches what this source can actually do',
    submit.delivers === null && !/send|deliver/i.test(submit.name),
    `delivers=${submit.delivers}, name=${JSON.stringify(submit.name)}`,
  );
  check(
    'and it still draws a glyph beside it',
    submit.glyphs === 1,
    `${submit.glyphs} svg(s)`,
  );
}

// The explanation, reachable from the keyboard rather than from a `title`.
const submitStops = await tabTo('[data-prompt-record]');
check('Tab reaches the submit control', submitStops !== null, `${submitStops} stops`);
const tip = await page
  .waitForSelector('[role="tooltip"]', { timeout: 3000 })
  .then((h) => h.evaluate((el) => el.textContent ?? ''))
  .catch(() => null);
console.log(`the submit's tip on focus: ${JSON.stringify(tip)}`);
check(
  'and focusing it opens a real tooltip with the explanation in it',
  tip !== null && tip.trim().length > 20,
  JSON.stringify(tip),
);
const described = await page.evaluate(() => {
  const el = document.querySelector('[data-prompt-record]');
  const id = el?.getAttribute('aria-describedby');
  return id === null || id === undefined ? null : document.getElementById(id)?.textContent ?? null;
});
check(
  'the tip is what the button points `aria-describedby` at',
  described !== null && described.trim().length > 20,
  JSON.stringify(described),
);
const shotOfComposer = async (path) => {
  const bar = await page.locator('[data-composer-bar]').boundingBox();
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, bar.x - 8),
      // Up far enough to take the tip that opens ABOVE the control being
      // measured: a shot of a focused button with its explanation cropped off
      // is a picture of half the fix.
      y: Math.max(0, bar.y - 120),
      width: Math.min(1100 - Math.max(0, bar.x - 8), bar.width + 16),
      height: bar.height + 128,
    },
  });
};
await shotOfComposer(`${outDir}/composer-submit.png`);
console.log(`${outDir}/composer-submit.png`);

// ---------------------------------------- 2. THE MODEL FIELD'S FOCUS RING
//
// Measured after a real Tab press, in both themes, against the surface the
// ring is drawn on.
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('light', t === 'light');
  }, theme);
  await page.waitForTimeout(150);
  const stops = await tabTo('[data-model-request]');
  check(`${theme}: Tab reaches the model field`, stops !== null, `${stops} stops`);
  const ring = await page.evaluate(() => {
    const el = document.querySelector('[data-model-request]');
    if (el === null) return null;
    const cs = getComputedStyle(el);
    const ground = window.vamRing.groundOf(el);
    const box = document.querySelector('[data-prompt-box]');
    return {
      empty: el.value === '',
      style: cs.outlineStyle,
      width: Number.parseFloat(cs.outlineWidth),
      colour: cs.outlineColor,
      ground,
      // The composer's own active border, which the ring must not be
      // mistakable for: one says "this pane is armed", the other says "the
      // keyboard is in this field".
      boxBorder: box === null ? null : getComputedStyle(box).borderTopColor,
      opaque: window.vamRing.opaque(cs.outlineColor) && window.vamRing.opaque(ground),
      ratio: window.vamRing.opaque(cs.outlineColor)
        ? Number(window.vamRing.ratio(cs.outlineColor, ground).toFixed(3))
        : null,
    };
  });
  console.log(`  ${theme}: the model field's focus ring ${JSON.stringify(ring)}`);
  // AN EMPTY FIELD IS THE CASE THAT FAILED: `focus:text-ink` recolours typed
  // text, so a field with text in it had a signal of sorts and an empty one
  // had none. Asserting the field is empty is what keeps this measuring the
  // state the audit reported.
  check(`${theme}: the field under test is empty`, ring !== null && ring.empty, JSON.stringify(ring));
  check(
    `${theme}: focusing it draws a ring`,
    ring !== null && ring.style !== 'none' && ring.width >= 1,
    JSON.stringify(ring),
  );
  // THE DRAWN-NESS IS PART OF THIS CHECK TOO, not only of the one above:
  // measured before the fix, an undrawn ring still reports Chrome UA
  // `outlineColor` (9.681:1 in dark), so a ratio asserted on its own passes
  // over a ring nobody can see.
  check(
    `${theme}: the ring and its ground are both opaque, and it clears 3:1`,
    ring !== null && ring.style !== 'none' && ring.width >= 1 && ring.opaque && ring.ratio >= 3,
    JSON.stringify(ring),
  );
  check(
    `${theme}: and it is not the composer's own armed border wearing a second meaning`,
    ring !== null && ring.colour !== ring.boxBorder,
    `${ring?.colour} vs ${ring?.boxBorder}`,
  );
  await shotOfComposer(`${outDir}/composer-model-focus-${theme}.png`);
  console.log(`${outDir}/composer-model-focus-${theme}.png`);
}
await page.evaluate(() => document.documentElement.classList.remove('light'));

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} composer bar guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('composer bar guards: all assertions passed');
