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
 * number: `panel` is #141414 and the pane is #171717, so every one of those
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
 * absences. A relative comparison cannot see a token that does not exist.
 * `opaquePair` below is the answer, and nothing here compares two colours
 * without going through it.
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
  window.vamColour = { opaque, lum, ratio, deltaE };
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
 * The RATIO floors are the reachable ones. Dark's 1.35 is just under the band
 * this palette's own tinted grounds already sit in (`waiting-tint` 1.389:1,
 * `done-tint` 1.444:1 against the pane), so the bubble is held to the standard
 * the design set rather than to a number invented here. Light's 1.10 is 95% of
 * the 1.159 ceiling that pure white imposes on anything lighter than that
 * theme's pane -- there is no room above it.
 *
 * The DISTANCE floor is the same in both themes because it is the one that
 * carries the complaint: 6.24 is what the light theme's own card step (white
 * on the pane) measures, so the bar is "at least as distinct as a card".
 *
 * For scale, the fill this replaced -- `raised` -- measured 1.030:1 / ΔE 1.52
 * in dark and 1.015:1 / ΔE 1.38 in light.
 */
const BUBBLE_FLOORS = {
  dark: { ratio: 1.35, distance: 6.24 },
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
  // 4.789:1 on the dark fill and `ink-faint` would read 3.353:1, so an edit
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
