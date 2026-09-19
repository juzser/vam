/**
 * THE PROMPT TOOLS ROW HAS ONE POPOVER OPEN AT A TIME, AND A PRESS ELSEWHERE
 * CLOSES IT -- driven in Chromium against the built bundle, because neither
 * half of that sentence can be answered anywhere else.
 *
 * Operator's report, translated: "when I open the auto/manual mode picker,
 * clicking outside or clicking over to the model picker does not close it, so
 * the popovers end up overlapping each other."
 *
 * WHY A BROWSER AND NOT A UNIT TEST. "Did clicking outside close it" is a
 * question about a real `pointerdown` reaching a document listener from a real
 * hit test at a real coordinate. A unit environment can fire a synthetic event
 * at a node it chose itself, which asserts the handler exists and nothing
 * about whether a pointer ever gets there -- and this repo has a standing
 * lesson that jsdom-family environments hide exactly this class of defect.
 * The mutual-exclusion half IS pure state and is held in
 * `test/panels/DetailPanel.popover-dismiss.test.tsx`; what is added here is
 * the pointer.
 *
 * THE PROPERTY, NOT A PROXY. Every check below asks whether the other
 * popover's node is GONE FROM THE DOM. "A setter was called" or "the new one
 * opened" would both have passed against the shipped build, which is the exact
 * state the operator photographed: both on screen, overlapping.
 *
 * SIX ROUTES WERE MEASURED, NOT THE TWO REPORTED. The row had THREE popovers
 * -- provider, model, mode -- so six ordered pairs plus three click-outsides.
 * Measured against the bundle before the fix, ALL of them stacked; with the
 * model popover left open from an earlier route, `provider -> mode` put three
 * layers on screen at once. A bug reported in one direction is a sample.
 *
 * TWO OF THE THREE ARE LEFT HERE, AND THE THIRD IS NOT GONE FROM COVERAGE. The
 * provider picker is withdrawn while `PROVIDERS` (`src/shared/providers.ts`)
 * has one row -- a popover over a single already-selected item is a control
 * that cannot act -- so at 1280px against the shipped bundle there is no third
 * control to collide with. Its four pairs and its click-outside live in
 * `test/panels/DetailPanel.popover-dismiss.test.tsx`, which mocks a two-row
 * table and keeps the whole family of six.
 *
 * WHY NOT PATCH THE TABLE THE WAY THE CAPABILITIES ARE PATCHED BELOW. Those
 * two are member expressions that survive minification verbatim and are
 * asserted present before anything is forced. `PROVIDERS.length > 1` is folded
 * to a constant by the minifier and there is no stable string to find -- a
 * patch on it would be a guess that silently stops matching, which is the
 * failure this file's own `patched === 0` throw exists to prevent. What the
 * browser adds over the unit test is the POINTER, and the pointer is exercised
 * on every popover the shipped app actually has.
 *
 * WHAT THIS HARNESS FORCES, AND WHY. The demo source reports no terminal and
 * does not deliver (`Canvas.tsx` reads both off `source.source.capabilities`),
 * so under `?demo=1` the mode chip would be absent and the model control would
 * draw the recording field -- two of the three popovers could never appear.
 * The two capability expressions are forced true in the served chunk, which is
 * what the desktop app computes for a Claude Code session vam started in tmux;
 * the component, the fixture and the styles are the shipped ones. The throw
 * below keeps that honest: if a patch stops matching, this fails rather than
 * quietly photographing a row with one control in it. Same trick, same
 * argument, as `prompt-mode-icon-shots.mjs` and `model-picker-shots.mjs`.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5746 --strictPort
 *   node e2e/prompt-popovers-shots.mjs http://localhost:5746 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5746';
const outDir = process.argv[3] ?? 'docs/ui';

/** The demo's vam-controlled session whose composer is reachable without a card. */
const SESSION = 'notes-1';

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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

/**
 * THE EXPRESSIONS ARE MATCHED AS PATTERNS NOW, NOT AS LITERALS, and the reason
 * is the second source.
 *
 * These used to be the exact minified strings
 * `t.kind===\`session\`&&t.source.capabilities.terminal` and its
 * `deliverPrompt` twin. Both stopped existing when the canvas started reading
 * a capability PER ROW instead of per app: it calls
 * `capabilitiesFor(source.source, <the row's source id>)`, whose helper name
 * and argument names are whatever the minifier chose on the day. A literal
 * could only ever match one build.
 *
 * What is stable is the SHAPE -- the `kind===\`session\`` guard, a call, and
 * the capability being read off it -- so that is what these match. The throw
 * below is unchanged and is still what keeps this honest: if the pattern ever
 * stops matching, the script fails rather than quietly photographing a pane
 * with no control in it.
 */
const TERMINAL = /[\w$]+\.kind===`session`&&[\w$]+\([^()]*\)\.capabilities\.terminal/g;
const DELIVERS = /[\w$]+\.kind===`session`&&[\w$]+\([^()]*\)\.capabilities\.deliverPrompt/g;
const has = (body, pattern) => {
  pattern.lastIndex = 0;
  return pattern.test(body);
};
let patched = 0;
await page.route('**/assets/*.js', async (route) => {
  const response = await route.fetch();
  const body = await response.text();
  if (!has(body, TERMINAL) && !has(body, DELIVERS)) {
    await route.fulfill({ response, body });
    return;
  }
  if (!has(body, TERMINAL) || !has(body, DELIVERS)) {
    throw new Error(
      `the bundle carries only one of the two capability expressions this harness forces ` +
        `(terminal: ${has(body, TERMINAL)}, deliverPrompt: ${has(body, DELIVERS)})`,
    );
  }
  patched += 1;
  await route.fulfill({
    response,
    body: body.replace(TERMINAL, '!0').replace(DELIVERS, '!0'),
  });
});

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
if (patched === 0) {
  throw new Error(
    'no chunk carried the capability expressions — nothing was forced, so the mode chip would ' +
      'be absent and the model control would draw the recording field, and every check below ' +
      'would be about a row that is not the one the operator was looking at.',
  );
}

await page.locator(`[data-session-row="${SESSION}"]`).first().click();
await page.waitForTimeout(250);
if ((await page.locator('[data-prompt-tools]').count()) === 0) {
  // A card with an open step stands the composer down by design; "Chat about
  // this" is the documented way back to the box.
  await page.locator('[data-question-chat]').first().click();
  await page.waitForTimeout(250);
}
await page.waitForSelector('[data-prompt-tools]');

/** Each popover: the toggle that opens it, and the layer it opens. */
const POPOVERS = {
  model: { toggle: '[data-model-picker]', layer: '[data-model-picker-menu]' },
  mode: { toggle: '[data-mode-toggle]', layer: '[data-mode-picker]' },
};
const NAMES = ['model', 'mode'];

/** Withdrawn while the provider table has one row -- see the header. */
const PROVIDER_TOGGLE = '[data-provider-picker-toggle]';

/** Which layers have a node on screen right now, by name -- the property itself. */
const openNow = () =>
  page.evaluate(
    (popovers) =>
      Object.entries(popovers)
        .filter(([, p]) => document.querySelector(p.layer) !== null)
        .map(([name]) => name),
    POPOVERS,
  );

async function openOne(name) {
  await page.locator(POPOVERS[name].toggle).click();
  await page.waitForTimeout(150);
}

/**
 * Get to "only `name` is open", reporting instead of hanging when it cannot.
 *
 * A SETUP STEP IS NOT AN ASSERTION, and it must not become one by accident in
 * either direction. Driven against the broken build this script used to reach
 * a `locator.click` on a popover that was not there and die on a 30s timeout,
 * which loses every check after it; and the opposite shape -- carrying on
 * regardless -- is the vacuous pass this repo has a lesson about. So the state
 * is CHECKED, the later work is skipped when it was not reached, and the skip
 * is itself a recorded failure.
 */
async function reachOnly(name) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  for (const other of NAMES) {
    if ((await openNow()).includes(other) && other !== name) {
      await page.locator(POPOVERS[other].toggle).click();
      await page.waitForTimeout(120);
    }
  }
  if (!(await openNow()).includes(name)) await openOne(name);
  const state = await openNow();
  const ok = state.join(',') === name;
  check(`set-up: only the ${name} popover is open`, ok, `[${state}]`);
  return ok;
}

/**
 * A point clearly OUTSIDE every control in the row: the middle of the
 * transcript column, well above the composer. Read off the tools row's own
 * rectangle rather than hard-coded, so a layout change cannot quietly move the
 * click onto a control and make "it closed" mean something else.
 */
const outsidePoint = async () => {
  const row = await page.locator('[data-prompt-tools]').first().boundingBox();
  const at = { x: Math.round(row.x + row.width / 2), y: Math.round(row.y - 160) };
  const hit = await page.evaluate(
    (p) => {
      const el = document.elementFromPoint(p.x, p.y);
      return {
        inRow: el?.closest('[data-prompt-tools]') !== null,
        inPopover: el?.closest('[data-popover-root]') !== null,
        tag: el?.tagName ?? null,
      };
    },
    at,
  );
  return { at, hit };
};

// ---------------------------------------------------------------- THE CONTROLS
const present = await page.evaluate(
  (popovers) =>
    Object.fromEntries(
      Object.entries(popovers).map(([name, p]) => [name, document.querySelector(p.toggle) !== null]),
    ),
  POPOVERS,
);
console.log('controls on the row:', JSON.stringify(present));
check(
  'both popover controls are drawn, so the collision is reachable here',
  NAMES.every((name) => present[name] === true),
  JSON.stringify(present),
);
// AND THE THIRD IS ABSENT ON PURPOSE, asserted rather than left to be noticed:
// if it came back without its condition, the pairs below would silently stop
// being the whole family this row can produce.
check(
  'and the provider control is withdrawn, so two really is the whole row',
  (await page.locator(PROVIDER_TOGGLE).count()) === 0,
  `${await page.locator(PROVIDER_TOGGLE).count()} provider toggles on the row`,
);
check('and nothing is open at rest', (await openNow()).length === 0);

// ------------------------------------------------- 1. EVERY ORDERED PAIR CLOSES
// The reported route is `mode -> model`; the other four were measured to be
// broken in exactly the same way. Both of the pairs this row can still produce
// are held here with a real pointer; the other four are held against a two-row
// provider table in the unit file named in the header.
for (const first of NAMES) {
  for (const second of NAMES) {
    if (first === second) continue;
    await reachOnly(first);
    const before = await openNow();
    await openOne(second);
    const after = await openNow();
    check(
      `opening ${second} while ${first} is open leaves ONLY ${second} on screen`,
      before.join(',') === first && after.join(',') === second,
      `opened ${first} -> [${before}], then ${second} -> [${after}]`,
    );
  }
}

// ------------------------------------------------ 2. A PRESS OUTSIDE CLOSES IT
for (const name of NAMES) {
  await reachOnly(name);
  const before = await openNow();
  const { at, hit } = await outsidePoint();
  // The click really is outside -- asserted, not assumed. A coordinate that
  // had drifted onto the row would make every check below vacuous.
  check(
    `the ${name} outside-click really lands outside the row and every popover`,
    hit.inRow === false && hit.inPopover === false,
    JSON.stringify({ at, hit }),
  );
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(200);
  const after = await openNow();
  check(
    `pressing outside closes the ${name} popover`,
    before.join(',') === name && after.length === 0,
    `opened -> [${before}], clicked outside -> [${after}]`,
  );
}

// --------------------------------------- 3. A PRESS INSIDE DOES *NOT* CLOSE IT
// The other direction of the same rule, and the one a too-eager dismissal
// breaks: a pointer that goes down inside the open layer must not shut it
// under the operator's hands.
//
// IT USED TO BE PRESSED ON THE FREE-TEXT ROW -- click the field, type a full
// model id, and the popover had to still be there. That row is gone: a full id
// has no row on the CLI's own `/model` menu, so the only form that takes one
// also rewrites `~/.claude/settings.json`, and the operator chose refusal over
// that fallback (`main/terminal/model-switch.ts`). So the press lands on the
// layer's own PADDING instead -- inside the boundary the dismissal reads
// (`data-popover-root`), and on nothing that would close it by doing its job.
// THE POINT IS CHECKED BEFORE IT IS CLICKED, because a coordinate that had
// drifted onto an option would make "it stayed open" mean the opposite.
if (await reachOnly('model')) {
  const layer = await page.locator('[data-model-picker-menu]').boundingBox();
  const inside = { x: Math.round(layer.x + 2), y: Math.round(layer.y + 2) };
  const insideHit = await page.evaluate((p) => {
    const el = document.elementFromPoint(p.x, p.y);
    return {
      inPopover: (el?.closest('[data-popover-root="model"]') ?? null) !== null,
      onOption: (el?.closest('[data-model-option]') ?? null) !== null,
      tag: el?.tagName ?? null,
    };
  }, inside);
  check(
    'the inside press really lands in the model layer and on none of its options',
    insideHit.inPopover === true && insideHit.onOption === false,
    JSON.stringify({ inside, insideHit }),
  );
  await page.mouse.click(inside.x, inside.y);
  await page.waitForTimeout(150);
  const afterInside = await openNow();
  check(
    'pressing INSIDE the popover leaves it open',
    afterInside.join(',') === 'model',
    `[${afterInside}]`,
  );

  // --------------------------------------------------- 4. ESCAPE STILL CLOSES
  // It did before this change (`DetailPanel.composer-escape.test.tsx`), on the
  // toggle and on the listbox. Held here as well because the state it reads
  // was replaced: a rule that peels the layer must keep peeling it. Pressed
  // from a row of the listbox, which is where the keyboard used to be handed
  // to the free-text field.
  await page.locator('[data-model-option="opus"]').focus();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const afterEscape = await openNow();
  check('Escape closes the open popover', afterEscape.length === 0, `[${afterEscape}]`);
} else {
  check('the inside-press and Escape checks ran at all', false, 'the model popover never opened');
}

// ------------------------------------------------------------------- THE SHOTS
/** The row and the space a popover floats into, cropped to its left end. */
const shot = async (path) => {
  const box = await page.locator('[data-prompt-tools]').first().boundingBox();
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - 12),
      y: Math.max(0, box.y - 210),
      width: Math.min(box.width + 24, 460),
      height: box.height + 226,
    },
  });
  console.log(path);
};

// AFTER: the mode popover open, and the model popover NOT -- the same two
// gestures the operator reported, ending in one layer.
await reachOnly('mode');
await openOne('model');
const shotState = await openNow();
check(
  'the shot below is of ONE open popover, so it records the fix and not a lucky frame',
  shotState.join(',') === 'model',
  `[${shotState}]`,
);
await shot(`${outDir}/prompt-popovers-after.png`);

await browser.close();

if (failures.length > 0) {
  throw new Error(
    `${failures.length} prompt popover guard(s) failed:\n  - ${failures.join('\n  - ')}`,
  );
}
console.log('prompt popover guards: all assertions passed');
