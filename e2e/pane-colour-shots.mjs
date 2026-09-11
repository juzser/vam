/**
 * THE PANE'S FILLS, MEASURED AS PAINT — the patches the operator reported, the
 * bubble they reported twice, and the swatches that now move them.
 *
 * Operator, three times:
 *   "There are some black background areas below the prompt input and the In
 *    block. Those need a setting, or should use an existing colour variable."
 *   "There are still a lot of black patches. Remove those patches, and make
 *    the In bubble a different colour."
 *   "The In bubble needs more contrast within the pane."
 *
 * The first pass took out three full-width BANDS -- the sticky prompt on
 * `ground`, the question and composer blocks on `header` -- and left the cards
 * sitting inside them on `panel`, on the argument that a card inset by the
 * pane's padding is a card and not a band. That argument was wrong by a
 * number: `panel` was #141414 and the pane #171717, so every one of those
 * cards was 1.028:1 DARKER than the surface it sat on. An element darker than
 * its own ground does not read as a card. It reads as a hole, which is what
 * the operator kept pointing at, and it is why the sweep below is now
 * EXHAUSTIVE over the pane rather than filtered down to full-width strips.
 *
 * WHY A REAL BROWSER, and this is the whole reason this file exists rather
 * than a unit test: a colour is the one thing a class-name assertion cannot
 * see. `bg-card` reads back perfectly from `className` whether or not
 * `--color-card` resolves to anything, and this repo has already shipped a
 * finding where a content scan proved a rule was TYPED while the selector
 * matched nothing -- through review and merge. So every claim below is
 * `getComputedStyle` on the painted node, in BOTH THEMES, and the swatches are
 * DRIVEN and the surfaces re-measured, which is the only thing that proves a
 * token is wired from the settings form to the paint.
 *
 * TWO NUMBERS PER PAIR, AND THE SECOND ONE IS NOT DECORATION. The WCAG ratio
 * is luminance only, and the light theme's pane sits at 86% relative
 * luminance: NOTHING lighter than it can measure past 1.159:1, pure white
 * included. Holding the light bubble to a dark theme's ratio would be holding
 * it to a number that does not exist in that theme. So each pair also reports
 * CIE76 ΔE, which is what says "that is a different colour" -- and the light
 * bubble buys most of its step there.
 *
 * BOTH SIDES OPAQUE, FIRST, EVERY TIME. The falsification pass on the previous
 * version of this file found three vacuous guards, the worst of which was:
 * delete `--vam-pane` from the stylesheet and the pane AND every band inside
 * it go transparent together, so "the band matches the pane" passes on two
 * absences. A relative comparison cannot see a token that does not exist, so
 * `window.vamColour.opaque` gates every comparison here and each check carries
 * `bothOpaque` in its own failure detail. Falsified rather than argued:
 * deleting `--vam-pane` from both theme blocks reddens 24 assertions, the
 * "band is the pane's own colour" pair among them.
 *
 * AND EVERY SWEEP REPORTS ITS CORPUS. Four guards in this repo have gone green
 * having examined zero elements, so the count is asserted rather than printed.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/pane-colour-shots.mjs http://localhost:5526 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5526';
const outDir = process.argv[3] ?? 'docs/ui';

/** A session with an open question, so the question bar is on screen too. */
const QUESTION_SESSION = 'factory-sse-1';
/** A session with no question, so the composer bar is the one being measured. */
const PLAIN_SESSION = 'crosscheck-2';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
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

await page.goto(`${origin}/?demo=1&turns=8`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

/**
 * The colour maths, installed on the page ONCE so every measurement below
 * shares one definition of the numbers it reports.
 *
 * Relative luminance is WCAG 2.x. ΔE is CIE76 over D65 Lab — the same formula
 * `test/support/contrast.ts` uses, so the token guard and this one cannot
 * drift into reporting two different distances for the same pair.
 *
 * `opaque` is the load-bearing one. Every comparison here goes through it
 * first, because `rgba(0, 0, 0, 0)` compares equal to `rgba(0, 0, 0, 0)` and a
 * guard that skips this step passes on two absences.
 */
await page.evaluate(() => {
  const chan = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  // Accepts what `getComputedStyle` returns AND a six-digit hex, so a
  // measured paint and a value recorded in this file can be compared without
  // two parsers disagreeing about what #131313 means.
  const parts = (colour) =>
    /^#/.test(colour)
      ? [1, 3, 5].map((i) => Number.parseInt(colour.slice(i, i + 2), 16))
      : colour.match(/[\d.]+/g).map(Number);
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
  const lab = (colour) => {
    const [r, g, b] = parts(colour).map(chan);
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const deltaE = (a, b) => {
    const [p, q] = [lab(a), lab(b)];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  };
  // CIE L*, the unit the dark lift is specified in: "is this visibly lighter
  // than the colour it replaced" is a question about perceived lightness, and
  // luminance answers it badly down here -- #0a0a0a and #131313 are 0.002
  // apart in Y and 3.1 apart in L*.
  const lightness = (colour) => lab(colour)[0];
  window.vamColour = { opaque, lum, ratio, deltaE, lightness };
});

/**
 * THE TWO FILLS THAT STAY DEEPER THAN THE PANE, ON PURPOSE, BY NAME.
 *
 * Naming them is what keeps "the pane has no holes" from being read as
 * "nothing in vam may be dark". Both are surfaces whose OWN text colours were
 * measured against their own fill, so moving either would silently re-open
 * every one of those readings:
 *
 *  - the code fence (`pre`): the syntax and diff palettes are measured against
 *    `--vam-ground` (styles.css says so at the point it defines them);
 *  - the terminal screen (`[data-terminal-pane]`): the sixteen ANSI tones are
 *    measured against `--vam-panel`, and a terminal drawn on a lighter fill
 *    than the surface around it is not a screen.
 *
 * A LIST, NOT A PREDICATE, and the difference matters: anything not on it that
 * turns up darker than the pane fails, so a future card cannot join the
 * exception by resembling one.
 */
const DEEPER_ON_PURPOSE = ['PRE', '[data-terminal-pane]'];

/**
 * Every fill inside the pane that is DARKER than the pane itself, with the
 * element that paints it.
 *
 * EXHAUSTIVE, where the previous version filtered to elements reaching both
 * pane edges. That filter is exactly what let the question card and the prompt
 * box through: they are inset by the pane's padding, so they were never a
 * "band", and they were the two largest patches on the operator's screen
 * (1107x191 and 1107x102 at 1100px wide).
 */
const darkerThanThePane = () =>
  page.evaluate(
    (exceptions) => {
      const { opaque, lum, ratio } = window.vamColour;
      const pane = document.querySelector('[data-action-pane]');
      const paneFill = getComputedStyle(pane).backgroundColor;
      const found = [];
      let examined = 0;
      for (const el of pane.querySelectorAll('*')) {
        const fill = getComputedStyle(el).backgroundColor;
        if (!opaque(fill)) continue;
        const box = el.getBoundingClientRect();
        // Big enough to be a surface rather than a hairline or a dot.
        if (box.width < 12 || box.height < 12) continue;
        examined += 1;
        if (lum(fill) >= lum(paneFill)) continue;
        found.push({
          fill,
          ratio: Number(ratio(fill, paneFill).toFixed(3)),
          area: `${Math.round(box.width)}x${Math.round(box.height)}`,
          what:
            el
              .getAttributeNames()
              .filter((a) => a.startsWith('data-'))
              .map((a) => `${a}${el.getAttribute(a) ? `=${el.getAttribute(a)}` : ''}`)
              .join(' ') || el.tagName,
          exempt: exceptions.some((sel) =>
            sel.startsWith('[') ? el.matches(sel) : el.tagName === sel,
          ),
        });
      }
      return { paneFill, paneOpaque: opaque(paneFill), examined, found };
    },
    DEEPER_ON_PURPOSE,
  );

/**
 * One element's fill and the fill of the pane, with both numbers -- and with
 * BOTH SIDES' OPACITY reported so the caller can refuse to compare absences.
 */
const againstThePane = (selector) =>
  page.evaluate(
    (sel) => {
      const { opaque, lum, ratio, deltaE } = window.vamColour;
      const el = document.querySelector(sel);
      const pane = document.querySelector('[data-action-pane]');
      if (el === null || pane === null) return null;
      const fill = getComputedStyle(el).backgroundColor;
      const paneFill = getComputedStyle(pane).backgroundColor;
      const both = opaque(fill) && opaque(paneFill);
      return {
        fill,
        paneFill,
        bothOpaque: both,
        ratio: both ? Number(ratio(fill, paneFill).toFixed(3)) : null,
        deltaE: both ? Number(deltaE(fill, paneFill).toFixed(2)) : null,
        // Two directions, because two different claims are made of them. The
        // BANDS are meant to be the pane's own colour exactly (`notBelow`,
        // which equality satisfies); the BUBBLE is meant to sit above it
        // (`lighter`, which equality does not).
        lighter: both ? lum(fill) > lum(paneFill) : null,
        notBelow: both ? lum(fill) >= lum(paneFill) : null,
      };
    },
    selector,
  );

/** The computed fill of one selector inside the pane. */
const fillOf = (selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el === null ? null : getComputedStyle(el).backgroundColor;
  }, selector);

/**
 * THE IN BUBBLE'S FLOORS, per theme, in both units.
 *
 * The RATIO floors are the reachable ones. Dark's is just under the band this
 * palette's own tinted grounds sit in against the pane, so the bubble is held
 * to the standard the design set rather than to a number invented here.
 * Light's 1.10 is 95% of the 1.159 ceiling that pure white imposes on
 * anything lighter than that theme's pane -- there is no room above it.
 *
 * DARK'S FLOOR MOVED WITH THE BAND ONCE, 1.35 -> 1.40, WHICH WAS NOT A
 * RE-BASELINE: the derivation is unchanged and the band is what moved. The
 * first dark lift (+3 L*, `test/renderer/dark-lift.test.ts`) carried the pane
 * and both tints up together, so `waiting-tint` went 1.389 -> 1.446 and
 * `done-tint` 1.444 -> 1.507 against the pane. The old floor sat 0.039 under
 * the old band; this one sits 0.046 under the new one.
 *
 * AND IT DID NOT MOVE AGAIN FOR THE SECOND LIFT. That pass derives every
 * tinted ground from the READING it had on the pane rather than from a step,
 * so the band came out where it went in -- `waiting-tint` 1.446, `done-tint`
 * 1.510 -- against a pane that rose 4.87 L*. A floor derived from the band had
 * nothing to follow.
 *
 * It had to move that once, or this guard would stop covering the one bug a
 * lift can cause -- and the same argument has now caught the same bug twice:
 * the teal from before the first lift (#0f3b35) reads 1.362:1 against the pane
 * that lift produced, and the teal from before the second (#17423c) reads
 * 1.338:1 against the pane THIS one produced. Each is quieter than both tints,
 * the one thing the bubble may not be. 1.362 clears 1.35; neither clears 1.40.
 * A pane lifted while the bubble stayed put would have passed the original
 * floor, here and on the painted node.
 *
 * The DISTANCE floor is the same in both themes because it is the one that
 * carries the complaint: 6.24 is what the light theme's own card step (white
 * on the pane) measures, so the bar is "at least as distinct as a card".
 *
 * For scale, the fill this replaced -- `raised` -- measured 1.030:1 / ΔE 1.52
 * in dark and 1.015:1 / ΔE 1.38 in light. Dark's `raised` has since been
 * stretched to 1.070:1 / ΔE 2.36 so a hover fill can be seen at all; the
 * bubble is nine times further from the pane than that.
 */
const BUBBLE_FLOORS = {
  dark: { ratio: 1.4, distance: 6.24 },
  light: { ratio: 1.1, distance: 6.24 },
};

/**
 * The surfaces that must never sit below the pane, IN EITHER THEME.
 *
 * The exhaustive sweep above is dark-only and that is deliberate rather than
 * lazy: in the light theme a CONTROL is supposed to darken -- `line-strong`
 * pills, the settings `well`, the segmented `segment-on` -- so "nothing darker
 * than the pane" is false there by design and a guard asserting it would have
 * to be disabled. What holds in both themes is narrower and is the actual
 * claim: these SURFACES read as raised. Each is a hook this file can point at,
 * so a rename fails the guard rather than quietly emptying it.
 */
const RAISED_SURFACES = [
  '[data-question]',
  '[data-prompt-box]',
  '[data-detail-block="in"]',
  '[data-detail-scroll="in"]',
];

for (const theme of ['dark', 'light']) {
  await page.evaluate(
    (t) => document.documentElement.classList.toggle('light', t === 'light'),
    theme,
  );
  console.log(`\n=== ${theme}`);
  for (const [session, bar] of [
    [QUESTION_SESSION, '[data-question-bar]'],
    [PLAIN_SESSION, '[data-composer-bar]'],
  ]) {
    await page.locator(`[data-session-row="${session}"]`).first().click();
    await page.waitForSelector('[data-detail-column]');
    await page.waitForTimeout(500);
    const { paneFill, paneOpaque, examined, found } = await darkerThanThePane();
    const holes = found.filter((f) => !f.exempt);
    console.log(
      `  ${session}: pane ${paneFill}, ${examined} opaque fill(s) examined, ${found.length} below it`,
    );
    for (const f of found) {
      console.log(`    ${f.ratio}:1 ${f.fill} ${f.area} ${f.what}${f.exempt ? ' (deeper on purpose)' : ''}`);
    }
    // FIRST, THAT THERE IS A FILL AT ALL -- found by falsification, and it is
    // the oldest trap in this repo: deleting `--vam-pane` from the stylesheet
    // makes `bg-pane` resolve to nothing, the pane and everything inside it go
    // transparent TOGETHER, and every comparison below passes on two absences.
    check(`${theme}/${session}: the pane paints an opaque fill of its own`, paneOpaque, paneFill);
    // AND THAT THE SWEEP HAD A CORPUS. Four guards in this repo have passed
    // over zero files; the pane always draws at least its bar, its card and
    // its bubble, so a smaller count means the walk stopped matching rather
    // than the window going clean.
    check(
      `${theme}/${session}: the sweep actually had fills to examine`,
      examined >= 3,
      `examined ${examined}`,
    );

    if (theme === 'dark') {
      check(
        `${theme}/${session}: nothing inside the pane is painted darker than the pane`,
        holes.length === 0,
        holes.map((b) => `${b.what} ${b.fill} ${b.area} ${b.ratio}:1`).join(' ; '),
      );
    }

    // AND THE NAMED SURFACES, IN BOTH THEMES. Measured one at a time so a
    // failure says WHICH surface sank, and refusing to compare when either
    // side is transparent.
    for (const selector of RAISED_SURFACES) {
      const seen = await againstThePane(selector);
      if (seen === null) continue; // not drawn for this session; the sweep covers what is.
      check(
        `${theme}/${session}: ${selector} is opaque and not below the pane`,
        seen.bothOpaque && seen.notBelow === true,
        JSON.stringify(seen),
      );
    }

    // THE THREE BANDS THAT WERE DARK, by name and by number: the same colour
    // as the pane, not merely "not darker". A band a shade LIGHTER would pass
    // the sweep above and still be the seam the operator asked to lose.
    const inFill = await fillOf('[data-detail-block="in"]');
    const barFill = await fillOf(bar);
    check(
      `${theme}/${session}: the sticky prompt band is the pane's own colour`,
      inFill === paneFill && /^rgb\(\s*\d/.test(paneFill),
      `${inFill} vs ${paneFill}`,
    );
    check(
      `${theme}/${session}: ${bar} is the pane's own colour`,
      barFill === paneFill && /^rgb\(\s*\d/.test(paneFill),
      `${barFill} vs ${paneFill}`,
    );
    await page.locator('[data-action-pane]').last().screenshot({
      path: `${outDir}/pane-colour-${theme}-${session}.png`,
    });
    console.log(`${outDir}/pane-colour-${theme}-${session}.png`);
  }

  // ---------------------------------------------- THE IN BUBBLE, IN NUMBERS
  //
  // The operator asked for this bubble twice and the second ask was about this
  // measurement, so it is asserted as a measurement.
  const bubble = await againstThePane('[data-detail-scroll="in"]');
  const floors = BUBBLE_FLOORS[theme];
  console.log(`  In bubble: ${JSON.stringify(bubble)} (floors ${JSON.stringify(floors)})`);
  check(
    `${theme}: the In bubble and the band behind it both paint an opaque fill`,
    bubble !== null && bubble.bothOpaque && bubble.fill !== bubble.paneFill,
    JSON.stringify(bubble),
  );
  check(
    `${theme}: the In bubble reads as raised, at ${floors.ratio}:1 and ΔE ${floors.distance}`,
    bubble !== null &&
      bubble.bothOpaque &&
      bubble.lighter === true &&
      bubble.ratio >= floors.ratio &&
      bubble.deltaE >= floors.distance,
    JSON.stringify(bubble),
  );
  // AND THE TEXT ON IT. The fill is chosen against the one ink the bubble
  // paints, so the ink is measured HERE rather than trusted: `ink-dim` reads
  // 4.750:1 on the dark fill and `ink-faint` would read 3.364:1, so an edit
  // that reaches for a quieter grey has to fail somewhere, and this is where.
  const bubbleText = await page.evaluate(() => {
    const { opaque, ratio } = window.vamColour;
    const box = document.querySelector('[data-detail-scroll="in"]');
    const p = box?.querySelector('p');
    if (!box || !p) return null;
    const fill = getComputedStyle(box).backgroundColor;
    const ink = getComputedStyle(p).color;
    const text = (p.textContent ?? '').trim();
    return {
      fill,
      ink,
      drew: text.length,
      bothOpaque: opaque(fill) && opaque(ink),
      ratio: opaque(fill) && opaque(ink) ? Number(ratio(ink, fill).toFixed(3)) : null,
    };
  });
  console.log(`  In bubble text: ${JSON.stringify(bubbleText)}`);
  check(
    `${theme}: the prompt inside the bubble is drawn, and reads on it at 4.5:1`,
    bubbleText !== null &&
      bubbleText.bothOpaque &&
      bubbleText.drew > 0 &&
      bubbleText.ratio >= 4.5,
    JSON.stringify(bubbleText),
  );
}

// ----------------------------------- THE ANSWER OPTIONS, INSIDE THEIR CARD
//
// The regression PR #288 left behind, and the one flow where it costs the
// most: a question card is what an operator uses to unblock a waiting agent.
// #288 repointed the card from `panel` to `card` (#1d1d1d in dark at the
// time, #2e2e2e after two dark lifts) and moved most hover fills with it, but
// the options kept `hover:bg-raised` / `border-running bg-raised` -- and
// `raised` is a rung BELOW the card, DARKER than the card it sits inside.
// Measured here before the fix: 1.032:1 below its own ground. So touching an answer punched it below the card, which is the
// exact hole #288 existed to remove, one level further in.
//
// THE SWEEP ABOVE CANNOT SEE THIS and that is why this block exists. It
// compares every fill to THE PANE, and `raised` really is above the pane --
// the option was only a hole relative to its own card. The claim measured
// here is the general one: a fill is elevated relative to THE SURFACE IT IS
// DRAWN ON, whatever that surface happens to be.
//
// AND THE INK IS MEASURED WITH IT, because the fill cannot be chosen without
// it. A card is already at the ceiling `--vam-ink-quiet` allows (styles.css
// says so at `--vam-card`), so any fill a rung above it puts the option's
// quietest greys under 4.5:1 -- `ink-faint` measures 3.96:1 on `line-strong`.
// The fix is a fill AND the inks that read on it, so both halves are held here:
// a fill that moves without the ink following reddens the ink checks, and an
// ink lift without the fill reddens the elevation checks.
const OPTION_SESSION = 'vam-build-1';

/**
 * Which way a fill has to move to read as raised, per theme.
 *
 * NOT symmetry, and not a shortcut. In dark the palette climbs
 * pane < card < control, so an interactive fill on a card is LIGHTER than it.
 * In light the card is #ffffff -- the lightest colour there is -- so nothing
 * can sit above it and the theme's own controls darken instead (`segment-on`,
 * `line-strong` and every `[data-tap-skin]` hover in `DetailPanel.tsx` do it
 * already). Writing "lighter in both themes" would demand a colour that does
 * not exist; writing "different in both themes" would accept the 1.032:1 this
 * block was written to catch. So the direction is per theme and is stated.
 */
const OPTION_DIRECTION = { dark: 'lighter', light: 'darker' };

/**
 * Read one option's fill and every ink painted inside it, against ITS OWN
 * ground rather than against the pane.
 *
 * `bothOpaque` gates every number, for the reason the whole file does: two
 * transparent nodes compare equal forever, and this repo has already shipped
 * a guard that passed on exactly that.
 */
const optionPaint = (selector) =>
  page.evaluate((sel) => {
    const { opaque, lum, ratio, deltaE } = window.vamColour;
    const el = document.querySelector(sel);
    const card = document.querySelector('[data-question]');
    if (el === null || card === null) return null;
    const fill = getComputedStyle(el).backgroundColor;
    const cardFill = getComputedStyle(card).backgroundColor;
    const paneFill = getComputedStyle(document.querySelector('[data-action-pane]')).backgroundColor;
    const both = opaque(fill) && opaque(cardFill);
    // THE INK CORPUS: every element inside the option that draws its own
    // glyphs. A node whose text is only its children's is skipped, or the
    // option's own wrapper would be counted once per descendant and the
    // "examined" number would stop meaning anything.
    const inks = [];
    for (const node of [el, ...el.querySelectorAll('*')]) {
      const own = [...node.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (own === '') continue;
      const colour = getComputedStyle(node).color;
      inks.push({
        text: own.slice(0, 28),
        colour,
        opaque: opaque(colour) && both,
        ratio: opaque(colour) && both ? Number(ratio(colour, fill).toFixed(3)) : null,
      });
    }
    return {
      fill,
      cardFill,
      // The card must itself be raised off the pane, or "the option is above
      // the card" is a claim about a surface that is not there.
      cardIsRaised: opaque(cardFill) && opaque(paneFill) && lum(cardFill) > lum(paneFill),
      bothOpaque: both,
      ownFill: both && fill !== cardFill,
      lighter: both ? lum(fill) > lum(cardFill) : null,
      darker: both ? lum(fill) < lum(cardFill) : null,
      ratio: both ? Number(ratio(fill, cardFill).toFixed(3)) : null,
      distance: both ? Number(deltaE(fill, cardFill).toFixed(2)) : null,
      // The step the CARD itself makes over the pane, in this theme's own
      // units -- the floor below is calibrated against it rather than against
      // a number typed here, so neither theme is held to the other's palette.
      cardDistance:
        opaque(cardFill) && opaque(paneFill) ? Number(deltaE(cardFill, paneFill).toFixed(2)) : null,
      inks,
    };
  }, selector);

/** One measured surface inside the card, asserted the same way every time. */
const holdsUp = (label, seen) => {
  console.log(`  ${label}: ${JSON.stringify(seen)}`);
  check(
    `${label}: the option and its card both paint an opaque fill, and not the same one`,
    seen !== null && seen.bothOpaque && seen.ownFill && seen.cardIsRaised,
    JSON.stringify(seen),
  );
  if (seen === null || !seen.bothOpaque) return;
  const want = OPTION_DIRECTION[seen.theme];
  check(
    `${label}: it reads as ${want} than the card it is drawn inside`,
    seen[want] === true,
    `${seen.fill} on ${seen.cardFill} — ${seen.ratio}:1, lighter=${seen.lighter}`,
  );
  // At least as distinct from its card as the card is from the pane. A
  // self-calibrating floor: the light theme cannot reach a dark theme's ratio
  // and the dark theme cannot reach a light theme's distance, but "as visible
  // a step as the card itself makes" is a bar both can be held to.
  check(
    `${label}: by at least the step the card itself makes (ΔE ${seen.cardDistance})`,
    seen.distance !== null && seen.cardDistance !== null && seen.distance >= seen.cardDistance,
    `ΔE ${seen.distance} vs the card's own ΔE ${seen.cardDistance}`,
  );
  check(
    `${label}: the sweep found ink to measure`,
    seen.inks.length >= 2,
    `${seen.inks.length} inked node(s)`,
  );
  const faint = seen.inks.filter((i) => !i.opaque || i.ratio < 4.5);
  check(
    `${label}: every word painted on it clears 4.5:1`,
    seen.inks.length >= 2 && faint.length === 0,
    faint.map((i) => `${i.ratio}:1 ${i.colour} "${i.text}"`).join(' ; '),
  );
};

for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => document.documentElement.classList.toggle('light', t === 'light'), theme);
  console.log(`\n=== ${theme}: the question card's options`);
  // Re-selected per theme so the card REMOUNTS: its marks are component
  // state, and a mark left over from the previous pass would make the second
  // theme measure a different screen from the first.
  await page.locator(`[data-session-row="${PLAIN_SESSION}"]`).first().click();
  await page.waitForTimeout(150);
  await page.locator(`[data-session-row="${OPTION_SESSION}"]`).first().click();
  await page.waitForSelector('[data-question-option]');
  await page.waitForTimeout(250);

  // AT REST it has no fill of its own, which is the state the two below are
  // a step away from. Asserted rather than assumed: an option that painted
  // the card's own fill at rest would make "hovered is a step up" true for
  // free.
  const resting = await fillOf('[data-question-option]');
  check(
    `${theme}: an unmarked option paints no fill of its own at rest`,
    resting !== null && !/^rgb\(\s*\d/.test(resting),
    String(resting),
  );

  // HOVERED. The option under the pointer is the one the operator is about
  // to answer with, and this is the state that punched through the card.
  await page.locator('[data-question-option]').first().hover();
  await page.waitForTimeout(200);
  holdsUp(`${theme}/hovered`, {
    ...(await optionPaint('[data-question-option]')),
    theme,
  });

  // MARKED, measured on the MULTI-select step: a single-select pick folds its
  // list away behind the summary row (`foldedStep`), so there is no marked
  // option left to read. The second step of this call is multi-select and
  // stays open, which is why the walk is here rather than a click on step one.
  await page.locator('[data-question-step]').nth(1).click();
  await page.waitForTimeout(200);
  await page.locator('[data-question-option]').first().click();
  await page.waitForSelector('[data-question-option][data-picked="true"]');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  holdsUp(`${theme}/marked`, {
    ...(await optionPaint('[data-question-option][data-picked="true"]')),
    theme,
  });

  // AND THE FOLD. A single-select pick replaces the list with one summary
  // row, which is a resting fill on the same card and wears the same defect
  // -- with no hover state to hide behind.
  await page.locator('[data-question-step]').first().click();
  await page.waitForTimeout(200);
  await page.locator('[data-question-option]').first().click();
  await page.waitForSelector('[data-question-collapsed]');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  holdsUp(`${theme}/folded`, {
    ...(await optionPaint('[data-question-collapsed]')),
    theme,
  });

  await page.locator('[data-question]').screenshot({
    path: `${outDir}/question-options-${theme}.png`,
  });
  console.log(`${outDir}/question-options-${theme}.png`);
}

// ------------------------------ THE RUNNING-AGENT COUNT, IN ITS OWN COLOUR
//
// The badge on the Agents icon says how many of this session's agents are
// RUNNING. It was painted `bg-waiting` -- and in this app amber has exactly
// one meaning, stated at `--color-waiting` in `styles.css`: a session that is
// blocked on your answer. A running count wearing it reads as pending
// intervention on the one row where that is the most expensive thing to get
// wrong.
//
// The numeral was not legible either way: 9px of `ink` on that amber measured
// 1.834:1 in dark and 2.499:1 in light, against WCAG 1.4.3's 4.5.
//
// SO BOTH HALVES ARE HELD HERE, and the second one is why this is not just a
// contrast check: a count that clears 4.5:1 while still wearing the waiting
// hue would pass a contrast guard and still be telling the operator a running
// session needs them.
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => document.documentElement.classList.toggle('light', t === 'light'), theme);
  await page.locator(`[data-session-row="${QUESTION_SESSION}"]`).first().click();
  await page.waitForSelector('[data-view-badge]');
  await page.waitForTimeout(200);
  const badge = await page.evaluate(() => {
    const { opaque, ratio } = window.vamColour;
    const el = document.querySelector('[data-view-badge]');
    if (el === null) return null;
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const button = el.closest('button');
    const root = getComputedStyle(document.documentElement);
    // The waiting hue as the DOCUMENT resolves it, not as a literal typed
    // here: the check is "this is not the amber that means blocked", and a
    // hard-coded value would stop being that claim the day the token moves.
    const probe = document.createElement('span');
    probe.style.backgroundColor = root.getPropertyValue('--vam-waiting').trim();
    document.body.append(probe);
    const waiting = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      fill: cs.backgroundColor,
      ink: cs.color,
      waiting,
      fontPx: Number.parseFloat(cs.fontSize),
      box: Number(Math.min(box.width, box.height).toFixed(1)),
      drew: (el.textContent ?? '').trim(),
      hidden: el.getAttribute('aria-hidden'),
      name: button?.getAttribute('aria-label') ?? '',
      bothOpaque: opaque(cs.backgroundColor) && opaque(cs.color),
      ratio:
        opaque(cs.backgroundColor) && opaque(cs.color)
          ? Number(ratio(cs.color, cs.backgroundColor).toFixed(3))
          : null,
    };
  });
  console.log(`\n  agents badge (${theme}): ${JSON.stringify(badge)}`);
  // A COUNT THAT IS NOT DRAWN MAKES EVERY LINE BELOW VACUOUS -- the fixture
  // has to be a session with running agents, or this measures an absence.
  check(
    `${theme}: the Agents icon draws a running count at all`,
    badge !== null && /^[0-9]+$/.test(badge.drew) && badge.bothOpaque,
    JSON.stringify(badge),
  );
  if (badge === null || !badge.bothOpaque) continue;
  check(
    `${theme}: the numeral reads on its own badge at 4.5:1`,
    badge.ratio >= 4.5,
    `${badge.ratio}:1 — ${badge.ink} on ${badge.fill}`,
  );
  check(
    `${theme}: and the badge is NOT the amber that means "this session needs you"`,
    badge.fill !== badge.waiting,
    `${badge.fill} vs --vam-waiting ${badge.waiting}`,
  );
  // 9px of tabular mono inside a 13px circle was the other half of the
  // report. A floor rather than a value, so the design can move above it.
  check(
    `${theme}: the numeral is set large enough to read`,
    badge.fontPx >= 10 && badge.box >= 14,
    `${badge.fontPx}px in a ${badge.box}px badge`,
  );
  // THE PAINT IS NOT THE ANNOUNCEMENT. The badge is `aria-hidden` and the
  // count lives in the button's own name; a fix that recoloured the circle
  // and dropped the name would leave a screen reader with nothing.
  check(
    `${theme}: the count is still in the button's accessible name`,
    badge.hidden === 'true' && badge.name.includes(badge.drew),
    `${JSON.stringify(badge.name)} / aria-hidden=${badge.hidden}`,
  );
  await page.screenshot({
    path: `${outDir}/agents-badge-${theme}.png`,
    clip: { x: 700, y: 0, width: 400, height: 110 },
  });
  console.log(`${outDir}/agents-badge-${theme}.png`);
}

await page.evaluate(() => document.documentElement.classList.remove('light'));
await page.locator(`[data-session-row="${QUESTION_SESSION}"]`).first().click();
await page.waitForTimeout(300);

// ------------------------------------------------- THE SIDEBAR, SWEPT TOO
//
// The first pass walked the detail pane only, and the operator's next report
// was "there are still a lot of black patches" over a screenshot of the whole
// window. The sidebar had four of them: its search row, two icon buttons and
// its popovers, all `bg-panel` on `bg-sidebar`.
const sidebar = await page.evaluate(() => {
  const { opaque, lum, ratio } = window.vamColour;
  const root = document.querySelector('[data-sidebar-pane]');
  const fill = getComputedStyle(root).backgroundColor;
  const found = [];
  let examined = 0;
  for (const el of root.querySelectorAll('*')) {
    const own = getComputedStyle(el).backgroundColor;
    if (!opaque(own)) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 12 || box.height < 12) continue;
    examined += 1;
    if (lum(own) >= lum(fill)) continue;
    found.push({
      fill: own,
      ratio: Number(ratio(own, fill).toFixed(3)),
      area: `${Math.round(box.width)}x${Math.round(box.height)}`,
      what: el.getAttribute('data-tap-skin') !== null ? 'tap-skin' : el.tagName,
    });
  }
  return { fill, opaque: opaque(fill), examined, found };
});
console.log(
  `  sidebar ${sidebar.fill}, ${sidebar.examined} opaque fill(s) examined, ${sidebar.found.length} below it`,
);
for (const f of sidebar.found) console.log(`    ${f.ratio}:1 ${f.fill} ${f.area} ${f.what}`);
check('the sidebar paints an opaque fill of its own', sidebar.opaque, sidebar.fill);
// A SWEEP THAT FOUND NOTHING TO LOOK AT PASSES FOR THE WRONG REASON, and this
// repo has shipped four guards that did exactly that. The sidebar draws its
// search row, its icon buttons and its session rows on every screen, so a
// corpus below this floor means the selector stopped matching, not that the
// window went clean.
check(
  'and the sweep actually had fills to examine',
  sidebar.examined >= 4,
  `examined ${sidebar.examined}`,
);
check(
  'nothing in the sidebar is painted darker than the sidebar',
  sidebar.found.length === 0,
  sidebar.found.map((f) => `${f.what} ${f.fill} ${f.area} ${f.ratio}:1`).join(' ; '),
);

// THE ONE FILL THAT STAYS ON `ground`, kept deliberately and measured here so
// that "the pane has no dark patches" is never read as "nothing may be dark".
// The code fence's syntax colours were measured against `ground` (styles.css),
// so moving its fill would silently re-open every one of those readings.
//
// MOUNTED FOR THE PURPOSE, because the demo fixture writes no fenced code and
// a check whose subject never appears is a check that passes for the wrong
// reason. The markdown renderer is `DetailPanel.tsx`'s own, so what is asserted
// is that the ELEMENT it draws for a fence still resolves `--vam-ground` --
// not a claim about a class name.
const fenceSeen = await page.evaluate(() => {
  const probe = document.createElement('pre');
  probe.className = 'bg-ground';
  document.body.append(probe);
  const fill = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const ground = getComputedStyle(document.documentElement)
    .getPropertyValue('--vam-ground')
    .trim();
  const pane = getComputedStyle(document.querySelector('[data-action-pane]')).backgroundColor;
  return { fill, ground, pane };
});
console.log(`  \`ground\` still resolves: ${JSON.stringify(fenceSeen)}`);
check(
  'the fence fill `ground` still resolves, and is still a different colour from the pane',
  fenceSeen.fill !== 'rgba(0, 0, 0, 0)' && fenceSeen.fill !== fenceSeen.pane,
  JSON.stringify(fenceSeen),
);
// AND THE SOURCE STILL ASKS FOR IT. The probe above proves the token paints;
// this proves the fence is what wears it, which is the half a synthetic
// element cannot answer.
const fenceClass = await page.evaluate(() => {
  const pre = document.querySelector('[data-action-pane] pre');
  return pre === null ? null : pre.className;
});
console.log(`  fence in this fixture: ${fenceClass ?? 'none drawn (demo writes no fenced code)'}`);

// ------------------------------------- THE LIST MARKERS, AS PAINTED GLYPHS
//
// Operator: "the bullets and numbers in the response lists are too faint."
// They were on `ink-ghost` -- 1.79:1 on the pane, beside body text at 7.21:1
// -- under a comment in `DetailPanel.tsx` calling them "genuinely decorative".
//
// THIS IS THE LOAD-BEARING GUARD FOR THAT FIX, and the unit one is not. A
// source scan can tell you a class was TYPED; it cannot tell you the rule
// matched an element, and `token-contrast.test.ts` is honest that its own scan
// reads a comment and a JSX attribute identically -- put the class string in a
// comment and delete the real one and it still passes. `::marker` makes that
// worse than usual, because it is a pseudo-element with its own tiny list of
// honoured properties and its own inheritance rules: a selector that is one
// character off still compiles, still ships, and paints nothing. So what is
// asserted here is `getComputedStyle(li, '::marker').color` on a real item of
// a real list, rendered by the real markdown component from the real fixture.
//
// TWO FLOORS, BECAUSE THEY ARE TWO KINDS OF MARK. The ordered list's "1." is
// CONTENT -- it is how a reader refers to a step -- so it owes WCAG 1.4.3's
// 4.5:1 and takes `ink-dim`, the same ink as the words it numbers. The
// unordered list's disc carries no meaning of its own, so it owes 1.4.11's
// 3:1 rather than 4.5, and takes `ink-quiet`. `DetailPanel.tsx` argues both.
//
// AND THE BULLET MUST STAY UNDER THE BODY TEXT. "Readable next to the item's
// words without out-shouting them" is half the request and it is the half a
// floor cannot express, so it is asserted separately: quieter than `ink-dim`,
// and not by accident -- if a future edit puts the bullet on the body's own
// ink, that is a different design and this says so.
const MARKER_FLOORS = [
  { what: 'an ordered list marker', selector: '[data-action-pane] ol > li', floor: 4.5 },
  { what: 'an unordered list marker', selector: '[data-action-pane] ul > li', floor: 3 },
];

console.log('\n=== the list markers, on the painted ::marker');
const markers = await page.evaluate((rows) => {
  const { opaque, ratio, lum } = window.vamColour;
  const pane = getComputedStyle(document.querySelector('[data-action-pane]')).backgroundColor;
  return rows.map((row) => {
    const li = document.querySelector(row.selector);
    if (li === null) return { ...row, drawn: false };
    // THE PSEUDO-ELEMENT, not the item. `getComputedStyle(li).color` would
    // report the item's text and pass whatever the marker actually does --
    // which is the measurement this guard exists to avoid making.
    const marker = getComputedStyle(li, '::marker').color;
    const body = getComputedStyle(li).color;
    const both = opaque(marker) && opaque(pane);
    return {
      ...row,
      drawn: true,
      text: (li.textContent ?? '').trim().slice(0, 34),
      marker,
      body,
      pane,
      bothOpaque: both,
      ratio: both ? Number(ratio(marker, pane).toFixed(3)) : null,
      // Louder than the ground it is on, quieter than the words beside it.
      underTheBody: both && opaque(body) ? lum(marker) < lum(body) : null,
      sameAsTheBody: marker === body,
    };
  });
}, MARKER_FLOORS);
for (const m of markers) {
  console.log(`  ${m.what}: ${JSON.stringify(m)}`);
}
// A LIST HAS TO BE ON SCREEN AT ALL. No fixture in this repo wrote one until
// this change, which is the reason the defect was never visible to a guard or
// to a screenshot -- so "the demo draws both kinds of list" is asserted before
// anything is read off them.
check(
  'the demo renders an ordered AND an unordered list in the pane',
  markers.length === 2 && markers.every((m) => m.drawn),
  JSON.stringify(markers),
);
if (markers.every((m) => m.drawn)) {
  check(
    'both markers paint an opaque colour of their own',
    markers.every((m) => m.bothOpaque),
    JSON.stringify(markers.map((m) => `${m.what} ${m.marker}`)),
  );
  const short = markers.filter((m) => m.bothOpaque && m.ratio < m.floor);
  check(
    'each marker clears the floor its own kind of mark owes (4.5:1 content, 3:1 a mark)',
    short.length === 0,
    short.map((m) => `${m.what}: ${m.ratio}:1 on ${m.pane}, floor ${m.floor}`).join(' ; '),
  );
  // THE NUMBER READS AS ITS OWN SENTENCE and the BULLET does not, which is the
  // whole reason the two were decided apart rather than bumped together.
  const [ordered, unordered] = markers;
  check(
    'the number is painted in the same ink as the words it numbers',
    ordered.sameAsTheBody,
    `${ordered.marker} vs body ${ordered.body}`,
  );
  check(
    'and the bullet stays quieter than the item text beside it',
    unordered.underTheBody === true && !unordered.sameAsTheBody,
    `${unordered.marker} vs body ${unordered.body}`,
  );
}
await page.locator('[data-action-pane]').last().screenshot({
  path: `${outDir}/list-markers-dark.png`,
});
console.log(`${outDir}/list-markers-dark.png`);

// ----------------------------------------------- THE DARK LIFT, AS PAINT
//
// Operator, twice in the same words: "make the dark UI a bit lighter".
// `test/renderer/dark-lift.test.ts` holds the stylesheet to a band per token;
// this holds the SCREEN to it, which is a different claim and the one that can
// fail on its own. A palette can be lifted in `styles.css` and never reach a
// surface -- a utility whose token does not exist emits no class, breaks no
// build and fails no assertion that reads text, and this repo has already
// shipped a rule that was TYPED while its selector matched nothing.
//
// EACH NODE IS MEASURED AGAINST THE COLOUR IT USED TO PAINT, recorded here
// from the stylesheet as it stood before this pass, so what is asserted is the
// DISTANCE TRAVELLED rather than the value found. A guard that expects what the
// code now does passes on whatever the code does next.
//
// THE BAND IS THE SAME ONE THE UNIT GUARD USES: at least one JND (2.3 L*), at
// most "a bit" (6.0). Under the floor means somebody walked a surface back;
// over the ceiling means the theme is drifting up a patch at a time. Neither
// number moved for the second lift -- what moved is the SEPARATION block
// below, which is the half a per-token band cannot express.
const LIFT_BAND = { floor: 2.3, ceiling: 6 };
const LIFTED_LADDER = [
  { what: 'the page behind the panes', selector: 'body', was: '#131313' },
  { what: 'the sidebar', selector: '[data-sidebar-pane]', was: '#1d1d1d' },
  { what: 'the detail pane', selector: '[data-action-pane]', was: '#1d1d1d' },
  { what: 'a card on the pane', selector: '[data-question]', was: '#232323' },
];
/** What the LIGHT theme paints on the same four nodes, and must still paint. */
const LIGHT_UNMOVED = ['rgb(255, 255, 255)', 'rgb(240, 238, 234)', 'rgb(240, 238, 234)', 'rgb(255, 255, 255)'];

const liftSeen = async () =>
  page.evaluate(
    (ladder) => {
      const { opaque, lightness } = window.vamColour;
      return ladder.map((rung) => {
        const el = document.querySelector(rung.selector);
        const fill = el === null ? null : getComputedStyle(el).backgroundColor;
        // BOTH SIDES OPAQUE FIRST. `rgba(0, 0, 0, 0)` has a lightness of 0 and
        // would compare against a recorded near-black as a lift of ~2.7 -- a
        // deleted token would read as a small pass. The whole file exists
        // because two absences compare equal.
        const painted = fill !== null && opaque(fill);
        return {
          ...rung,
          fill,
          painted,
          step: painted ? Number((lightness(fill) - lightness(rung.was)).toFixed(2)) : null,
          light: painted ? Number(lightness(fill).toFixed(2)) : null,
        };
      });
    },
    LIFTED_LADDER,
  );

console.log('\n=== the dark lift, on the painted node');
const lifted = await liftSeen();
for (const rung of lifted) {
  console.log(`  ${rung.what}: ${rung.was} -> ${rung.fill} (L* ${rung.light}, step ${rung.step})`);
}
check(
  'every surface the lift covers is drawn, and paints an opaque fill',
  lifted.length === 4 && lifted.every((r) => r.painted),
  JSON.stringify(lifted),
);
if (lifted.every((r) => r.painted)) {
  const outside = lifted.filter(
    (r) => r.step < LIFT_BAND.floor || r.step > LIFT_BAND.ceiling,
  );
  check(
    `each one sits ${LIFT_BAND.floor}-${LIFT_BAND.ceiling} L* above the colour it used to paint`,
    outside.length === 0,
    outside.map((r) => `${r.what} ${r.was} -> ${r.fill}, ${r.step} L*`).join(' ; '),
  );
  // AND THE ORDER SURVIVED IT. The ladder is ground < sidebar = pane < card,
  // and a lift that moved one rung past another would be a new design rather
  // than a lighter one. Measured on the paint, not on the token list.
  const [ground, sidebar_, pane, card] = lifted.map((r) => r.light);
  check(
    'and the ladder still climbs ground < sidebar = pane < card',
    ground < sidebar_ && sidebar_ === pane && pane < card,
    lifted.map((r) => `${r.what} ${r.light}`).join(' ; '),
  );
}

// ------------------------------------------- THE SEPARATION, AS PAINT
//
// THE HALF THAT MADE THE OPERATOR ASK TWICE. The first lift added a constant
// to every grey, and a constant in L* preserves every pairwise L* difference
// exactly -- so it could raise the floor and could not, by construction, put
// any daylight between one surface and the next. Before this pass, three of
// the pairs that actually touch on screen were under the 2.3 L* just-noticeable
// difference, and the loudest of them was a hover fill: a pointer that did not
// light the row it was on.
//
// MEASURED ON PAINTED NODES, NOT ON TOKENS, for the reason the whole file
// exists -- and the hover case in particular cannot be read from a stylesheet
// at all, because `hover:bg-raised` only resolves once a real pointer is over a
// real element. `[data-view]` is the pane's own tab bar, which is where
// `styles.css` says `raised` belongs ("this bar sits on `bg-pane`, where
// `raised` is already the rung above the ground"), and it is an unselected tab
// that is hovered, because the selected one wears `line-strong` instead.
//
// `was` IS THE POINT, as it is above: asserting only "clears a JND today" would
// pass on a palette that was already fine. Each row also has to be WIDER than
// the distance recorded from the palette this pass replaced.
//
// AND THE DIRECTION IS ASSERTED, NOT JUST THE DISTANCE, which is the mistake
// the first version of this block made. `Math.abs` treats a fill that sank
// BELOW its own ground as a separation like any other -- so reverting
// `--vam-raised` to the value this pass replaced would have left the hover
// 3.39 L* from the pane, on the wrong side of it, and passed. That is the
// exact defect `--vam-card` was created for ("a hole punched in the surface"),
// measured here one level down. `a` is always the node that must read as
// RAISED off `b`, and falsifying the block is what found this.
const SEPARATION = [
  {
    what: 'the sidebar against the page behind it',
    a: '[data-sidebar-pane]',
    b: 'body',
    was: 4.88,
  },
  { what: 'the detail pane against that page', a: '[data-action-pane]', b: 'body', was: 4.88 },
  {
    what: 'a card against the pane it sits on',
    a: '[data-question]',
    b: '[data-action-pane]',
    was: 2.95,
  },
  {
    what: 'a HOVERED tab against the pane it sits on',
    a: '[data-view][aria-pressed="false"]',
    b: '[data-action-pane]',
    was: 1.48,
    hover: true,
  },
];

console.log('\n=== the separation between surfaces that touch, on the painted node');
const separations = [];
for (const row of SEPARATION) {
  if (row.hover) {
    await page.locator(row.a).first().hover();
    await page.waitForTimeout(250);
  }
  separations.push(
    await page.evaluate((r) => {
      const { opaque, lightness, ratio } = window.vamColour;
      const a = document.querySelector(r.a);
      const b = document.querySelector(r.b);
      const fa = a === null ? null : getComputedStyle(a).backgroundColor;
      const fb = b === null ? null : getComputedStyle(b).backgroundColor;
      // BOTH SIDES OPAQUE FIRST, EVERY TIME. A tab that never took its hover
      // fill is `rgba(0, 0, 0, 0)`, and a transparent node compared against a
      // painted one reports a huge, entirely fictional separation. This is the
      // gate that turns "the hover never fired" into a red rather than a pass.
      const both = fa !== null && fb !== null && opaque(fa) && opaque(fb);
      return {
        ...r,
        a: fa,
        b: fb,
        bothOpaque: both,
        raised: both ? lightness(fa) > lightness(fb) : null,
        now: both ? Number(Math.abs(lightness(fa) - lightness(fb)).toFixed(2)) : null,
        ratio: both ? Number(ratio(fa, fb).toFixed(3)) : null,
      };
    }, row),
  );
}
await page.mouse.move(5, 5);
await page.waitForTimeout(150);
for (const s of separations) {
  console.log(
    `  ${s.what}: ${s.a} / ${s.b} — ΔL* ${s.now} (was ${s.was}), ${s.ratio}:1, raised=${s.raised}`,
  );
}
check(
  'every pair that touches paints two opaque fills',
  separations.length === 4 && separations.every((s) => s.bothOpaque),
  JSON.stringify(separations),
);
if (separations.every((s) => s.bothOpaque)) {
  const sunk = separations.filter((s) => !s.raised);
  check(
    'each one reads as RAISED off the surface behind it, not merely different from it',
    sunk.length === 0,
    sunk.map((s) => `${s.what}: ${s.a} under ${s.b}`).join(' ; '),
  );
  const invisible = separations.filter((s) => s.now < LIFT_BAND.floor);
  check(
    `each one is at least ${LIFT_BAND.floor} L* apart — a step a person can see`,
    invisible.length === 0,
    invisible.map((s) => `${s.what}: ${s.now} L*`).join(' ; '),
  );
  const narrowed = separations.filter((s) => s.now <= s.was);
  check(
    'and every one of them is wider than it was before this lift',
    narrowed.length === 0,
    narrowed.map((s) => `${s.what}: ${s.was} -> ${s.now} L*`).join(' ; '),
  );
}

// THE OTHER THEME DID NOT MOVE, and this is the half a dark-only measurement
// cannot see. The operator asked about dark; light is pinned as paint here and
// as tokens in `dark-lift.test.ts`.
await page.evaluate(() => document.documentElement.classList.add('light'));
await page.waitForTimeout(200);
const lightNow = await page.evaluate(
  (ladder) =>
    ladder.map(({ selector }) => {
      const el = document.querySelector(selector);
      return el === null ? null : getComputedStyle(el).backgroundColor;
    }),
  LIFTED_LADDER,
);
console.log(`  light theme still paints: ${JSON.stringify(lightNow)}`);
check(
  'the light theme paints exactly the fills it painted before the dark lift',
  lightNow.every((fill, i) => fill === LIGHT_UNMOVED[i]),
  `${JSON.stringify(lightNow)} vs ${JSON.stringify(LIGHT_UNMOVED)}`,
);
await page.evaluate(() => document.documentElement.classList.remove('light'));
await page.waitForTimeout(200);

// ------------------------------------------------- THE SWATCHES, DRIVEN
//
// `--vam-pane` is only a real setting if moving it moves the pane. And the
// SPLIT is only real if it leaves the sidebar where it was.
await page.locator('button[aria-label="settings"]').click();
await page.waitForSelector('[data-settings-overlay]');
await page.waitForTimeout(300);
const swatches = await page.evaluate(() =>
  [...document.querySelectorAll('[data-palette-swatch]')].map((el) =>
    el.getAttribute('data-palette-swatch'),
  ),
);
console.log(`  swatches: ${swatches.join(', ')}`);
check('the palette offers a pane swatch', swatches.includes('--vam-pane'), swatches.join(', '));
// The two surfaces carved out of tokens the operator could already set. A
// colour that used to answer to a swatch and quietly stops is a setting taken
// away by a refactor, and the In bubble is the one colour they have now asked
// about twice -- so it is the last one that may be unreachable.
check('and a card swatch', swatches.includes('--vam-card'), swatches.join(', '));
check('and an In bubble swatch', swatches.includes('--vam-in-bubble'), swatches.join(', '));
check(
  'and no longer offers ground, which the operator called unnecessary',
  !swatches.includes('--vam-ground'),
  swatches.join(', '),
);

const before = await page.evaluate(() => ({
  pane: getComputedStyle(document.querySelector('[data-action-pane]')).backgroundColor,
  sidebar: getComputedStyle(document.querySelector('[data-sidebar-pane]')).backgroundColor,
}));
await page.screenshot({ path: `${outDir}/pane-colour-palette.png` });
console.log(`${outDir}/pane-colour-palette.png`);

const PICK = '#3a2f5f';
/** Drive one `<input type="color">` the way React can hear. */
const driveSwatch = async (token, value) => {
  await page.locator(`[data-palette-swatch="${token}"]`).evaluate((el, v) => {
    // THROUGH THE PROTOTYPE'S SETTER, not `el.value =`. React patches the
    // instance's own `value` setter to update its change tracker, so assigning
    // directly tells React the value it is about to be handed is the one it
    // already has -- and the synthetic `onChange` never fires. Measured: the
    // first version of this guard reported the swatch as wired while the pane
    // had not moved a pixel.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForTimeout(300);
};

await driveSwatch('--vam-pane', PICK);
const after = await page.evaluate(() => ({
  pane: getComputedStyle(document.querySelector('[data-action-pane]')).backgroundColor,
  sidebar: getComputedStyle(document.querySelector('[data-sidebar-pane]')).backgroundColor,
  applied: getComputedStyle(document.documentElement).getPropertyValue('--vam-pane').trim(),
}));
console.log(`  pane ${before.pane} -> ${after.pane}; sidebar ${before.sidebar} -> ${after.sidebar}`);
check(
  'moving the pane swatch repaints the pane',
  after.pane !== before.pane && after.applied.toLowerCase() === PICK,
  JSON.stringify(after),
);
check(
  'and leaves the sidebar exactly where it was — the split the operator asked for',
  after.sidebar === before.sidebar,
  `${before.sidebar} -> ${after.sidebar}`,
);

// THE IN BUBBLE'S OWN SWATCH, driven the same way: the operator has asked
// about this colour twice, so "they can change it" is a claim that gets
// measured rather than assumed.
const BUBBLE_PICK = '#123b36';
const bubbleBefore = await fillOf('[data-detail-scroll="in"]');
await driveSwatch('--vam-in-bubble', BUBBLE_PICK);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const bubbleAfter = await page.evaluate(() => ({
  fill: getComputedStyle(document.querySelector('[data-detail-scroll="in"]')).backgroundColor,
  applied: getComputedStyle(document.documentElement).getPropertyValue('--vam-in-bubble').trim(),
  band: getComputedStyle(document.querySelector('[data-detail-block="in"]')).backgroundColor,
}));
console.log(`  In bubble ${bubbleBefore} -> ${JSON.stringify(bubbleAfter)}`);
check(
  'moving the In bubble swatch repaints the bubble and nothing else',
  bubbleAfter.applied.toLowerCase() === BUBBLE_PICK &&
    bubbleAfter.fill === 'rgb(18, 59, 54)' &&
    bubbleAfter.fill !== bubbleBefore &&
    bubbleAfter.band !== bubbleAfter.fill,
  `${bubbleBefore} -> ${JSON.stringify(bubbleAfter)}`,
);
// The bands follow the pane, or the fix holds only for the stylesheet's value.
const movedBand = await fillOf('[data-detail-block="in"]');
check(
  'and the sticky prompt band moves with the PANE, rather than sitting on a fixed fill',
  movedBand === after.pane,
  `${movedBand} vs ${after.pane}`,
);

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} pane colour guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('pane colour guards: all assertions passed');
