/**
 * THE MODEL PICKER, ENABLED WHERE VAM CAN TYPE AND DISABLED WHERE IT CANNOT --
 * measured on the real paint, because two of its properties are ones no unit
 * environment can see:
 *
 *  - WHAT THE DISABLED LABEL PAINTS. A greyed control an operator cannot read
 *    is a control that is not there. `text-ink-faint` is the token; whether
 *    it clears WCAG 1.4.11's 3:1 against the composer's card is a question
 *    about resolved colour, which `getComputedStyle` answers only once a
 *    stylesheet is loaded. (`test/renderer/token-contrast.test.ts` holds the
 *    token values; this holds that they reach THIS node.)
 *
 *  - WHETHER THE DISABLED CONTROL'S NOTE CAN BE READ AT ALL. A disabled
 *    `<button>` takes no focus in any browser, so a `Note` hung on it would
 *    open on hover and on nothing else. The note hangs on a wrapper with a tab
 *    stop instead, and both routes are a browser fact: Radix opens on
 *    `pointermove` and on `focus`, neither of which a fired DOM event in
 *    happy-dom reproduces. The hover half is also where an assumption died:
 *    the first draft gave the button `pointer-events-none` on the belief that
 *    Chromium delivers no pointer events over a disabled control, and removing
 *    it reddened nothing here -- on Chromium 153 the hover reaches the wrapper
 *    and the note opens. The rule is gone; the measurement stays.
 *
 * WHAT THIS HARNESS FORCES, AND WHY. The demo source reports NO terminal and
 * does NOT deliver (`Canvas.tsx`: both are read off `source.source.capabilities`,
 * and the demo source is neither), so under `?demo=1` every row would draw the
 * RECORDING field and the picker could never appear -- the same reason
 * `prompt-mode-icon-shots.mjs` has to patch the bundle to photograph the mode
 * control. So the served bundle is intercepted and those TWO expressions are
 * forced true, which is what the desktop app computes for a Claude Code
 * project: a source that types into a pane it started. Everything else -- the
 * component, the fixture's per-session `vamControlled`, the styles -- is the
 * shipped bundle, and the throw below keeps it honest: if either patch stops
 * matching, the script fails rather than quietly photographing a field.
 *
 * TWO SESSIONS, TWO STATES, from the fixture's own flags (`fixtures/demo.ts`):
 * `vam-build-1` is `vamControlled: false` ("vam did not start this session")
 * and `notes-1` is `vamControlled: true`. The disabled/enabled split is then
 * decided by the shipped `modelControlState` and not by anything this file
 * arranges.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5691 --strictPort
 *   node e2e/model-picker-shots.mjs http://localhost:5691 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5691';
const outDir = process.argv[3] ?? 'docs/ui';

const OWNED = 'notes-1';
const NOT_OWNED = 'vam-build-1';
/**
 * The two rows section 3 needs, and what the fixture says about each
 * (`fixtures/demo.ts`, `demoSessionModel`): `notes-2` is on `Sonnet 5`, which
 * is BOTH the Sonnet row and the Default row; `factory-sse-1` is a session
 * whose model vam could not read, which is what every session with a question
 * open really is -- the prompt replaces the CLI's status line on the screen.
 */
const PAIRED = 'notes-2';
/** The row on `Sonnet 4.5` -- the longest name a real status line prints. */
const LONG_NAME = 'notes-3';
const UNREADABLE = 'factory-sse-1';
const DISABLED_NOTE =
  'vam owns no terminal here — open the session in a vam terminal to send /model';

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

const TERMINAL = 't.kind===`session`&&t.source.capabilities.terminal';
const DELIVERS = 't.kind===`session`&&t.source.capabilities.deliverPrompt';
let patched = 0;
await page.route('**/assets/*.js', async (route) => {
  const response = await route.fetch();
  const body = await response.text();
  if (!body.includes(TERMINAL) && !body.includes(DELIVERS)) {
    await route.fulfill({ response, body });
    return;
  }
  if (!body.includes(TERMINAL) || !body.includes(DELIVERS)) {
    throw new Error(
      `the bundle carries only one of the two capability expressions this harness forces ` +
        `(terminal: ${body.includes(TERMINAL)}, deliverPrompt: ${body.includes(DELIVERS)})`,
    );
  }
  patched += 1;
  console.log('forced terminal and deliverPrompt in', route.request().url());
  await route.fulfill({
    response,
    body: body.split(TERMINAL).join('!0').split(DELIVERS).join('!0'),
  });
});

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
if (patched === 0) {
  throw new Error(
    'no chunk carried the capability expressions — nothing was forced, so every row below ' +
      'would draw the recording field and the shots would photograph the wrong control.',
  );
}

/** WCAG relative luminance and ratio over the `rgb(...)` the browser hands back. */
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
  window.vamInk = {
    opaque,
    ratio: (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    },
    /** The nearest ancestor that paints an opaque fill -- what text is on. */
    groundOf: (el) => {
      let node = el;
      while (node !== null) {
        const fill = getComputedStyle(node).backgroundColor;
        if (opaque(fill)) return fill;
        node = node.parentElement;
      }
      return 'rgba(0, 0, 0, 0)';
    },
  };
});

/** Open a session's composer -- past its question card when it has one. */
async function openComposer(session) {
  await page.locator(`[data-session-row="${session}"]`).first().click();
  await page.waitForTimeout(250);
  if ((await page.locator('[data-prompt-tools]').count()) === 0) {
    // A card with an open step stands the composer down by design; "Chat
    // about this" is the documented way back to the box.
    await page.locator('[data-question-chat]').first().click();
    await page.waitForTimeout(250);
  }
  await page.waitForSelector('[data-prompt-tools]');
}

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

const tipText = () =>
  page
    .waitForSelector('[role="tooltip"]', { timeout: 3000 })
    .then((h) => h.evaluate((el) => el.textContent ?? ''))
    .catch(() => null);

/**
 * The tools row's left end, where the control sits -- cropped with Playwright's
 * own `clip` (sips ignores crop offsets on this machine), and to 420px rather
 * than the whole row: the right end is the microphone and Send, and a shot of
 * the model control does not need 500px of empty composer between them.
 */
const shotOfTools = async (path, extraAbove = 0) => {
  const box = await page.locator('[data-prompt-tools]').first().boundingBox();
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - 12),
      y: Math.max(0, box.y - 10 - extraAbove),
      width: Math.min(box.width + 24, 420),
      height: box.height + 20 + extraAbove,
    },
  });
  console.log(path);
};

// ------------------------------------------------ 1. A SESSION VAM DID NOT START
await openComposer(NOT_OWNED);
const off = await page.evaluate(() => {
  const el = document.querySelector('[data-model-picker]');
  if (el === null) return null;
  const shell = el.closest('[data-model-picker-shell]');
  const r = el.getBoundingClientRect();
  return {
    state: el.getAttribute('data-model-picker-state'),
    disabled: el.disabled,
    ariaDisabled: el.getAttribute('aria-disabled'),
    request: document.querySelector('[data-model-request]') !== null,
    box: `${Math.round(r.width)}x${Math.round(r.height)}`,
    painted: r.width > 0 && r.height > 0,
    shellNote: shell?.getAttribute('data-note') ?? null,
    shellTabIndex: shell?.tabIndex ?? null,
  };
});
console.log(`${NOT_OWNED}: ${JSON.stringify(off)}`);
check('the control is drawn on a session vam did not start', off !== null);
check(
  'and it is DISABLED there — `disabled` and `aria-disabled` both',
  off !== null && off.disabled === true && off.ariaDisabled === 'true' && off.state === 'disabled',
  JSON.stringify(off),
);
check('the recording field is gone on this source', off !== null && off.request === false);
check('it has a box on screen, so "disabled" is a state and not an absence', off?.painted === true, off?.box);
check(
  'its note says why and what to do',
  off?.shellNote === DISABLED_NOTE,
  JSON.stringify(off?.shellNote),
);
check('and the note sits on a stop the keyboard can reach', off?.shellTabIndex === 0, `tabIndex ${off?.shellTabIndex}`);

// THE DIMMED LABEL STILL READS, in both themes. Measured on the button's own
// resolved `color` against the nearest opaque fill behind it -- the composer's
// card -- which is what an eye compares.
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('light', t === 'light');
  }, theme);
  await page.waitForTimeout(150);
  const ink = await page.evaluate(() => {
    const el = document.querySelector('[data-model-picker]');
    if (el === null) return null;
    const cs = getComputedStyle(el);
    const ground = window.vamInk.groundOf(el.parentElement);
    const dim = getComputedStyle(document.querySelector('[data-attach]') ?? el).color;
    return {
      colour: cs.color,
      ground,
      opaque: window.vamInk.opaque(cs.color) && window.vamInk.opaque(ground),
      ratio: Number(window.vamInk.ratio(cs.color, ground).toFixed(3)),
      // The ink an ENABLED tool in the same row paints, so "dimmed" is a
      // comparison and not a class name.
      enabledInk: dim,
      enabledRatio: Number(window.vamInk.ratio(dim, ground).toFixed(3)),
    };
  });
  console.log(`  ${theme}: the disabled label ${JSON.stringify(ink)}`);
  check(`${theme}: the label and its ground are both opaque`, ink?.opaque === true, JSON.stringify(ink));
  check(
    `${theme}: the disabled label clears 3:1 against the composer (WCAG 1.4.11)`,
    ink !== null && ink.ratio >= 3,
    `${ink?.ratio}:1`,
  );
  check(
    `${theme}: and it is quieter than an enabled tool beside it, so disabled reads as disabled`,
    ink !== null && ink.colour !== ink.enabledInk && ink.ratio < ink.enabledRatio,
    `${ink?.ratio} vs ${ink?.enabledRatio}`,
  );
}
await page.evaluate(() => document.documentElement.classList.remove('light'));
await page.waitForTimeout(150);

// THE NOTE OPENS BOTH WAYS. Hover first: the pointer lands on the disabled
// button's own pixels, and what is measured is that the wrapper's handlers
// still see it (Chromium 153; see the header for the assumption this buried).
const disabledBox = await page.locator('[data-model-picker]').boundingBox();
await page.mouse.move(disabledBox.x + disabledBox.width / 2, disabledBox.y + disabledBox.height / 2);
const hoverTip = await tipText();
console.log(`  hover tip: ${JSON.stringify(hoverTip)}`);
check('hovering the disabled control opens its note', hoverTip === DISABLED_NOTE, JSON.stringify(hoverTip));
await page.mouse.move(0, 0);
await page.waitForTimeout(200);
// Then the keyboard, which is the route a disabled button closes entirely.
const stops = await tabTo('[data-model-picker-shell]');
check('Tab reaches the disabled control’s note', stops !== null, `${stops} stops`);
const focusTip = await tipText();
check('and focusing it opens the same note', focusTip === DISABLED_NOTE, JSON.stringify(focusTip));
await page.evaluate(() => document.activeElement?.blur());
await page.waitForTimeout(150);
// And a click does nothing at all: no menu, no caption.
await page.mouse.click(disabledBox.x + disabledBox.width / 2, disabledBox.y + disabledBox.height / 2);
await page.waitForTimeout(150);
const afterClick = await page.evaluate(() => ({
  menu: document.querySelector('[data-model-picker-menu]') !== null,
  caption: document.querySelector('[data-mode-cycle]')?.textContent ?? null,
}));
check('clicking it opens nothing and says nothing', !afterClick.menu && afterClick.caption === null, JSON.stringify(afterClick));
await page.mouse.move(0, 0);
await page.waitForTimeout(150);
await shotOfTools(`${outDir}/model-picker-disabled.png`);

// ------------------------------------------------------ 2. A SESSION VAM STARTED
await openComposer(OWNED);
const on = await page.evaluate(() => {
  const el = document.querySelector('[data-model-picker]');
  if (el === null) return null;
  return {
    state: el.getAttribute('data-model-picker-state'),
    disabled: el.disabled,
    ariaDisabled: el.getAttribute('aria-disabled'),
    haspopup: el.getAttribute('aria-haspopup'),
    expanded: el.getAttribute('aria-expanded'),
    request: document.querySelector('[data-model-request]') !== null,
    shell: el.closest('[data-model-picker-shell]') !== null,
  };
});
console.log(`${OWNED}: ${JSON.stringify(on)}`);
check('the control is drawn on a session vam started', on !== null);
check(
  'and it is ENABLED there: a real popup button, nothing disabled about it',
  on !== null &&
    on.disabled === false &&
    on.ariaDisabled === null &&
    on.state === 'picker' &&
    on.haspopup === 'listbox' &&
    on.expanded === 'false',
  JSON.stringify(on),
);
check('with no wrapper stop, because the button itself takes focus here', on?.shell === false);
check('and no recording field either', on?.request === false);

await page.locator('[data-model-picker]').click();
await page.waitForTimeout(200);
const menu = await page.evaluate(() => {
  const popover = document.querySelector('[data-model-picker-menu]');
  if (popover === null) return null;
  const options = [...popover.querySelectorAll('[data-model-option]')];
  const listbox = popover.querySelector('[role="listbox"]');
  const r = popover.getBoundingClientRect();
  // ON TOP, at its own centre: a popover drawn under the transcript column
  // would pass every DOM check and be unclickable.
  const atCentre = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  // THE VERSION COLUMN, AS RECTANGLES. "On the right" is a layout fact and
  // nothing else can answer it: in a unit environment no stylesheet loads, so
  // `ml-auto` resolves to nothing and every box measures 0 -- a DOM-order
  // check there would be asserting a proxy. Measured per row: the version's
  // left edge past the name's right edge (that is "to the right of it"), and
  // its right edge inside the row's padding box.
  const columns = options.map((el) => {
    const name = el.querySelector('[data-model-name]');
    const version = el.querySelector('[data-model-version]');
    if (name === null || version === null) return null;
    const n = name.getBoundingClientRect();
    const v = version.getBoundingClientRect();
    const row = el.getBoundingClientRect();
    return {
      id: el.getAttribute('data-model-option'),
      text: (version.textContent ?? '').trim(),
      rightOfName: Math.round(v.left - n.right),
      rightEdge: Math.round(row.right - v.right),
      painted: v.width > 0 && v.height > 0,
      // The ink is INHERITED on purpose -- a dimmer version would be the one
      // word in the row that does not brighten on hover, and `ink-quiet` is
      // under the 4.5:1 text owes. So it must equal the name's resolved ink.
      sameInk: getComputedStyle(version).color === getComputedStyle(name).color,
    };
  });
  return {
    ids: options.map((el) => el.getAttribute('data-model-option')),
    labels: options.map((el) => (el.querySelector('[data-model-name]')?.textContent ?? '').trim()),
    columns,
    // The five numbers in ONE lane, which is what `ml-auto` in a stretched
    // `flex-col` is for: a column that stair-steps is not a column.
    //
    // `null` RATHER THAN 1 WHEN A ROW IS MISSING ITS VERSION, because a `Set`
    // of five nulls also has size 1 -- the check would pass hardest exactly
    // when there is no column at all. (Observed: the first red run of this
    // guard had every other version assertion failing and this one green.)
    lane: columns.some((c) => c === null)
      ? null
      : new Set(columns.map((c) => Math.round(c.rightEdge))).size,
    inListbox: options.every((el) => listbox !== null && listbox.contains(el)),
    inputInListbox: listbox?.querySelector('[data-model-id]') !== null,
    freeText: popover.querySelector('[data-model-id]') !== null,
    painted: options.every((el) => el.getBoundingClientRect().height > 0),
    onTop: popover.contains(atCentre),
    expanded: document.querySelector('[data-model-picker]')?.getAttribute('aria-expanded'),
    box: `${Math.round(r.width)}x${Math.round(r.height)}`,
  };
});
console.log(`  the open picker: ${JSON.stringify(menu)}`);
check('clicking it opens the picker', menu !== null);
check(
  'listing Default · Sonnet · Fable · Opus · Haiku, in the CLI’s own order',
  menu !== null &&
    menu.ids.join(',') === 'default,sonnet,fable,opus,haiku' &&
    menu.labels.join(',') === 'Default,Sonnet,Fable,Opus,Haiku',
  JSON.stringify(menu?.labels),
);
// ---------------------------------------------------------------------------
// THE VERSIONS, ON THE RIGHT. Operator: "in the model picker, add the version
// on the right as well." The values are `MODEL_CHOICES`' own, re-captured from
// Claude Code 2.1.276 (see `model-command.ts` for the capture and its date);
// what is measured here is the two things a unit test cannot say -- that they
// PAINT, and that they paint to the RIGHT of the name rather than merely after
// it in the markup.
// ---------------------------------------------------------------------------
check(
  'every row draws a version beside its name',
  menu !== null && menu.columns.every((c) => c !== null && c.painted),
  JSON.stringify(menu?.columns),
);
check(
  'carrying the CLI’s own numbers — Fable 5.1 and Opus 5, not the other way round',
  menu !== null && menu.columns.map((c) => c?.text).join(',') === 'Sonnet 5,5,5.1,5,4.5',
  JSON.stringify(menu?.columns?.map((c) => `${c?.id}=${c?.text}`)),
);
check(
  'and each one really is to the RIGHT of its name, by rectangle',
  menu !== null && menu.columns.every((c) => c !== null && c.rightOfName > 0),
  JSON.stringify(menu?.columns?.map((c) => `${c?.id}: +${c?.rightOfName}px`)),
);
check(
  'in one lane: the five right edges line up, so the column is a column',
  menu?.lane === 1,
  JSON.stringify(menu?.columns?.map((c) => `${c?.id}: ${c?.rightEdge}px from the row’s edge`)),
);
check(
  'painting the row’s own ink, not a quieter one that would owe 4.5:1 and miss it',
  menu !== null && menu.columns.every((c) => c !== null && c.sameInk),
  JSON.stringify(menu?.columns),
);
check('the five are options of one listbox, and the free-text row is outside it', menu?.inListbox === true && menu?.inputInListbox === false);
check('with a free-text row for a full model id', menu?.freeText === true);
check('every option has a box on screen', menu?.painted === true);
check('and the popover is on top at its own centre', menu?.onTop === true);
check('while the button says it is expanded', menu?.expanded === 'true');

// ---------------------------------------------------------------------------
// 3. THE MODEL THE SESSION IS RUNNING -- on the button, and ticked in the row.
//
// The operator's ask, translated: "the model switcher button's label also
// needs to show the model that is currently selected, and there should be a
// tick icon on the currently selected model in the popover."
//
// WHERE THE FACT COMES FROM HERE. On the desktop it is read off the CLI's own
// status line in the session's pane (`main/terminal/model.ts`); in this build
// there is no `window.api` at all, so `Canvas.tsx` hands the panel the demo
// fixture's answer instead -- per ROW, exactly as it already does for the
// pane-prompt. That is the same honesty the capability patch at the top of
// this file has: the COMPONENT, the rule that turns a name into ticks and
// every pixel below are the shipped ones; only the reading of somebody's real
// tmux pane is stood in for, because there is none in a browser.
//
// WHAT ONLY A BROWSER CAN SAY, and the reason these are not unit assertions:
// that the tick is PAINTED rather than merely present in the markup, that it
// falls between the name and the version as RECTANGLES, that adding it did not
// widen the popover or push the version column out of its lane (`ml-auto` and
// `flex` resolve to nothing in a unit environment -- every box measures 0),
// and that the row is NOT distinguished by ink, which is WCAG 1.4.1 and a
// question about resolved colour.
// ---------------------------------------------------------------------------

/** The label, the ticks and their rectangles, in the open popover. */
const readMarks = () =>
  page.evaluate(() => {
    const button = document.querySelector('[data-model-picker]');
    const popover = document.querySelector('[data-model-picker-menu]');
    const skin = button?.querySelector('[data-tap-skin]') ?? null;
    const options = popover === null ? [] : [...popover.querySelectorAll('[data-model-option]')];
    const box = popover?.getBoundingClientRect() ?? null;
    const rows = options.map((el) => {
      const name = el.querySelector('[data-model-name]');
      const version = el.querySelector('[data-model-version]');
      const tick = el.querySelector('[data-model-current]');
      const r = (node) => (node === null ? null : node.getBoundingClientRect());
      const n = r(name);
      const v = r(version);
      const t = r(tick);
      return {
        id: el.getAttribute('data-model-option'),
        ticked: tick !== null,
        // A GLYPH, NOT A BOX: lucide draws an `svg`, and a node with no
        // painted area is a tick nobody can see.
        glyph: tick === null ? null : tick.tagName.toLowerCase(),
        painted: t !== null && t.width > 0 && t.height > 0,
        // BETWEEN THE NAME AND THE VERSION, by rectangle -- the CLI's own
        // layout (`❯ 2. Sonnet ✔`), and the thing markup order cannot prove.
        afterName: n === null || t === null ? null : Math.round(t.left - n.right),
        beforeVersion: v === null || t === null ? null : Math.round(v.left - t.right),
        // The version must still end inside the popover: a tick that pushed it
        // out would be a column clipped by the box that draws it.
        versionInside: v === null || box === null ? null : Math.round(box.right - v.right),
        rightEdge: v === null ? null : Math.round(el.getBoundingClientRect().right - v.right),
        // WCAG 1.4.1: the mark must not BE the colour. The row's own ink is
        // compared against an unticked row's below.
        ink: getComputedStyle(el).color,
        // And the tick paints the row's ink rather than one of its own, so it
        // brightens with the row on hover instead of being the one mark that
        // does not.
        tickInk: tick === null ? null : getComputedStyle(tick).color,
        selected: el.getAttribute('aria-selected'),
      };
    });
    const tools = document.querySelector('[data-prompt-tools]');
    return {
      label: (skin?.textContent ?? '').trim(),
      name: button?.getAttribute('aria-label') ?? null,
      box: box === null ? null : `${Math.round(box.width)}x${Math.round(box.height)}`,
      rows,
      ticked: rows.filter((row) => row.ticked).map((row) => row.id),
      // The five right edges still in ONE lane. `null` rather than 1 when a
      // row is missing its version, because a `Set` of nulls also has size 1
      // -- the trap this file's own version guard records falling into.
      lane: rows.some((row) => row.rightEdge === null)
        ? null
        : new Set(rows.map((row) => row.rightEdge)).size,
      // A wider label must not push the tools row past its own box. Measured
      // at the pane's narrowest legal width, at the end of this file: at the
      // default width the row has 900px of room and the check cannot fail,
      // which is not a check.
      toolsOverflow: tools === null ? null : tools.scrollWidth - tools.clientWidth,
    };
  });

/**
 * THE ACCESSIBLE NAME CHROMIUM COMPUTES, for the button and for each row.
 *
 * `ariaSnapshot` and NOT `textContent`, and the difference is the whole reason
 * this helper exists: the mark's meaning is carried by an `sr-only` clause, and
 * `textContent` reads text that is `display: none` just as happily as text that
 * is merely clipped -- so a mutation that hid the words from screen readers
 * entirely left every assertion here green. Measured: with the clause hidden,
 * Chromium's own name drops it and `textContent` does not. The property is the
 * name; the text was a proxy for it, and the proxy was wrong.
 */
const buttonName = () => page.locator('[data-model-picker]').ariaSnapshot();

const accessibleNames = async () => {
  const names = { button: await buttonName() };
  for (const id of ['default', 'sonnet', 'fable', 'opus', 'haiku']) {
    names[id] = await page.locator(`[data-model-option="${id}"]`).ariaSnapshot();
  }
  return names;
};

/** Open one session's composer and its model popover. */
async function openPicker(session) {
  await openComposer(session);
  await page.waitForTimeout(300);
  if ((await page.locator('[data-model-picker-menu]').count()) === 0) {
    await page.locator('[data-model-picker]').click();
    await page.waitForTimeout(200);
  }
}

// -- 3a. A ROW ON A MODEL EXACTLY ONE OF THE FIVE IS: one tick, and the name.
await openPicker(OWNED);
const one = await readMarks();
const oneNames = await accessibleNames();
console.log(`  ${OWNED}: ${JSON.stringify(one)}`);
console.log(`  ${OWNED} names: ${JSON.stringify(oneNames)}`);
check(
  'the button wears the model the session is running, not the word "model"',
  one.label === 'Opus 5',
  JSON.stringify(one.label),
);
check(
  'and a screen reader is told the same name — the one Chromium computes',
  oneNames.button.includes('Opus 5'),
  JSON.stringify(oneNames.button),
);
check(
  'exactly the row whose model that is carries the tick',
  one.ticked.join(',') === 'opus',
  JSON.stringify(one.ticked),
);
check(
  'the tick is a painted glyph and not an empty box',
  one.rows.every((row) => !row.ticked || (row.painted && row.glyph === 'svg')),
  JSON.stringify(one.rows.filter((row) => row.ticked)),
);
check(
  'it falls between the name and the version, as rectangles',
  one.rows.every(
    (row) => !row.ticked || (row.afterName >= 0 && row.beforeVersion > 0),
  ),
  JSON.stringify(one.rows.filter((row) => row.ticked).map((row) => `${row.id}: +${row.afterName}px after the name, +${row.beforeVersion}px before the version`)),
);
check(
  'and it says in WORDS what it means, rather than claiming a selection',
  one.rows.every((row) =>
    row.ticked
      ? /running this model/.test(oneNames[row.id]) && row.selected === 'false'
      : !/running this model/.test(oneNames[row.id]),
  ),
  JSON.stringify(one.rows.map((row) => `${row.id}: ${row.selected} ${oneNames[row.id]}`)),
);
// THE MARK IS A SHAPE AND NOT A COLOUR (WCAG 1.4.1): the ticked row paints the
// same ink as the four that are not, so nothing here is carried by hue alone.
check(
  'the ticked row is not distinguished by ink — the glyph is the whole signal',
  new Set(one.rows.map((row) => row.ink)).size === 1 && one.rows.length === 5,
  JSON.stringify(one.rows.map((row) => `${row.id}: ${row.ink}`)),
);
check(
  'and the glyph takes the row’s own ink rather than one of its own',
  one.rows.every((row) => !row.ticked || row.tickInk === row.ink),
  JSON.stringify(one.rows.filter((row) => row.ticked).map((row) => `${row.tickInk} vs ${row.ink}`)),
);
// THE BOX DID NOT GROW. 158x164 is what the popover measured when the version
// column shipped (PR 407), before any tick existed; the slot the tick sits in
// is reserved out of the slack the free-text row's own width already gave the
// five rows, so the box is the same box.
check(
  'the popover is still 158x164 — the tick did not stretch it',
  one.box === '158x164',
  JSON.stringify(one.box),
);
check(
  'the version column is still in one lane, and still inside the box',
  one.lane === 1 && one.rows.every((row) => row.versionInside > 0),
  JSON.stringify(one.rows.map((row) => `${row.id}: lane ${row.rightEdge}, ${row.versionInside}px inside`)),
);
await shotOfTools(`${outDir}/model-picker.png`, 200);
await page.keyboard.press('Escape');
// Blurred before the closed-button shot: Escape leaves the focus ring on the
// control, and a picture of the LABEL should not be a picture of a focus
// state. The ring is measured where it belongs, on the fields that own it.
await page.evaluate(() => document.activeElement?.blur());
await page.waitForTimeout(200);
await shotOfTools(`${outDir}/model-picker-label.png`);
// THE WAY BACK TO A CLIPPED NAME, for an eye. The label gives way at a narrow
// pane (section 5), and a tooltip that did not name the model would leave a
// mouse with nothing but the first few characters -- while a screen reader had
// the whole thing. Measured as the tip REALLY OPENS on hover, which is a
// browser fact: Radix opens on `pointermove`, and no fired DOM event in a unit
// environment reproduces it.
const modelBox = await page.locator('[data-model-picker]').boundingBox();
// Two moves, and the first one is not idle: Radix opens on `pointermove`, so a
// pointer that is already resting where the control happens to be sends
// nothing at all when the control appears under it.
await page.mouse.move(modelBox.x - 40, modelBox.y - 40);
await page.waitForTimeout(150);
await page.mouse.move(modelBox.x + modelBox.width / 2, modelBox.y + modelBox.height / 2, {
  steps: 6,
});
await page.waitForTimeout(300);
const labelTip = await tipText();
console.log(`  hover tip: ${JSON.stringify(labelTip)}`);
check(
  'hovering the labelled button names the model it is running',
  (labelTip ?? '').startsWith('running Opus 5 ·'),
  JSON.stringify(labelTip),
);
check(
  'without dropping the CLI side effect the note has always disclosed',
  /default for new sessions/.test(labelTip ?? ''),
  JSON.stringify(labelTip),
);
// AND THE HALF THAT STOPPED BEING A SIDE EFFECT. vam drives the CLI's own
// `/model` menu and presses `s` for an alias (`main/terminal/model-switch.ts`),
// which the CLI answers "...for this session only" -- measured, with
// `~/.claude/settings.json` byte-identical afterwards. The disclosure above is
// now true of the FULL-ID row alone, and a note that dropped this half would
// read as the old one, which told the operator every pick cost them a default.
check(
  'and saying which route does NOT cost the operator their default',
  /this session only/.test(labelTip ?? ''),
  JSON.stringify(labelTip),
);
await page.mouse.move(0, 0);
await page.waitForTimeout(200);

// -- 3b. THE PAIR THE PANE CANNOT SEPARATE: `Sonnet 5` is Default AND Sonnet.
//
// MEASURED on Claude Code 2.1.276: `/model default` and `/model sonnet` leave
// the same status line, while the CLI's own menu ticks whichever was chosen.
// vam holds the model and not the alias, so it marks both rows -- each of
// which is true -- rather than picking one and being wrong half the time.
await openPicker(PAIRED);
const pair = await readMarks();
const pairNames = await accessibleNames();
console.log(`  ${PAIRED}: ${JSON.stringify(pair)}`);
console.log(`  ${PAIRED} names: ${JSON.stringify(pairNames)}`);
check(
  'a session on Sonnet 5 says so on the button, to an eye and to a reader',
  pair.label === 'Sonnet 5' && pairNames.button.includes('Sonnet 5'),
  JSON.stringify({ label: pair.label, name: pairNames.button }),
);
check(
  'and ticks BOTH Default and Sonnet, because the pane cannot say which set it',
  pair.ticked.join(',') === 'default,sonnet',
  JSON.stringify(pair.ticked),
);
check(
  'saying so in words, on both rows, and naming what it cannot tell apart',
  pair.rows.every((row) => !row.ticked || /cannot say whether/.test(pairNames[row.id])),
  JSON.stringify(pair.rows.filter((row) => row.ticked).map((row) => pairNames[row.id])),
);
check(
  'with the box and the lane unmoved by two ticks',
  pair.box === '158x164' && pair.lane === 1,
  JSON.stringify({ box: pair.box, lane: pair.lane }),
);
await shotOfTools(`${outDir}/model-picker-pair.png`, 200);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// -- 3c. A ROW WHOSE PANE DOES NOT SAY. The commonest state there is: a
// session with a question open is not painting its status line at all
// (measured -- a permission prompt takes the bottom of the screen). The button
// goes back to the word it always wore, and NOTHING is ticked.
await openPicker(UNREADABLE);
const blank = await readMarks();
const blankNames = await accessibleNames();
console.log(`  ${UNREADABLE}: ${JSON.stringify(blank)}`);
console.log(`  ${UNREADABLE} names: ${JSON.stringify(blankNames)}`);
check(
  'a row whose model vam cannot read keeps the word "model", in both names',
  blank.label === 'model' && !/model: /.test(blankNames.button),
  JSON.stringify({ label: blank.label, name: blankNames.button }),
);
check('and ticks nothing at all', blank.ticked.length === 0, JSON.stringify(blank.ticked));
check(
  'and says nothing about running anything, in words either',
  blank.rows.every((row) => !/running this model/.test(blankNames[row.id])),
  JSON.stringify(blank.rows.map((row) => blankNames[row.id])),
);
check(
  'while the popover is exactly the box it is everywhere else',
  blank.box === '158x164' && blank.lane === 1,
  JSON.stringify({ box: blank.box, lane: blank.lane }),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// ---------------------------------------------------------------------------
// 4. PICKING ONE, IN THE BROWSER BUILD, is refused out loud: there is no
// `window.api` here, and the shared caption says so in the same row. This is
// the one thing a pick can be measured to do without a pane -- and it proves
// the picker reports through the mode chip's channel rather than a copy.
//
// LAST, AND NOT BESIDE THE PICKER IT OPENS, for one reason: the caption it
// leaves in the tools row stays there, and every shot taken after it would
// carry a refusal across the composer instead of the control being
// photographed.
// ---------------------------------------------------------------------------
await openPicker(OWNED);
await page.locator('[data-model-option="opus"]').click();
await page.waitForTimeout(200);
const picked = await page.evaluate(() => {
  const note = document.querySelector('[data-mode-cycle]');
  return {
    bridge: typeof window.api,
    menuClosed: document.querySelector('[data-model-picker-menu]') === null,
    state: note?.getAttribute('data-mode-cycle-state') ?? null,
    text: note?.textContent ?? null,
    inRow: note?.closest('[data-prompt-tools]') !== null,
  };
});
console.log(`  after picking Opus: ${JSON.stringify(picked)}`);
check('this really is the browser build, with no keyboard into a pane', picked.bridge === 'undefined');
check('the pick closes the picker', picked.menuClosed);
check(
  'and is refused OUT LOUD in the shared caption, never silently',
  picked.state === 'refused' && /no keyboard/.test(picked.text ?? '') && picked.inRow,
  JSON.stringify(picked),
);

// ---------------------------------------------------------------------------
// 5. THE LABEL AT VAM'S NARROWEST LEGAL PANE.
//
// A model name is wider than the word it replaced -- `Sonnet 4.5` is ten
// characters where `model` was five -- and the tools row is a `flex` that does
// not wrap, so "does it still fit" is a real question with a real failure: a
// control pushed out of the box it sits in.
//
// IT IS ASKED WHERE IT CAN FAIL, which is the whole reason this section is at
// the bottom of the file rather than beside the label check. At the default
// 1280px viewport the row has some 960px for about 200px of controls: a
// FORTY-EIGHT character label was pushed through it and nothing overflowed, so
// an assertion there would pass whatever the label said. 520px is the other
// end -- `SIDEBAR_MIN + DETAIL_MIN` (`prefs/panes.ts`), the narrowest window
// in which vam still draws two columns at all, one pixel above the phone
// shell's own query (`phone/viewport.ts`). Both panes are at their floors
// there, so the detail column is exactly the 320px minimum these controls have
// to share.
// ---------------------------------------------------------------------------
await page.setViewportSize({ width: 520, height: 800 });
await page.waitForTimeout(400);

/** The tools row at whatever width the page currently is. */
const readRow = () =>
  page.evaluate(() => {
    const row = document.querySelector('[data-prompt-tools]');
    const model = document.querySelector('[data-model-picker]');
    const wrapper = model?.closest('[data-popover-root="model"]') ?? null;
    const text = model?.querySelector('[data-model-label]') ?? null;
    if (row === null || model === null || wrapper === null || text === null) return null;
    const r = row.getBoundingClientRect();
    const w = wrapper.getBoundingClientRect();
    const m = model.getBoundingClientRect();
    const next = wrapper.nextElementSibling?.getBoundingClientRect() ?? null;
    return {
      phone: document.querySelector('[data-phone-shell]') !== null,
      rowWidth: Math.round(r.width),
      label: (text.textContent ?? '').trim(),
      // CLIPPED OR WHOLE: `truncate` paints an ellipsis when the text is wider
      // than the box it is in, and this is the box measuring itself -- the one
      // question a class name cannot answer.
      clipped: text.scrollWidth > text.clientWidth,
      overflow: Math.round(row.scrollWidth - row.clientWidth),
      // THE BUTTON AGAINST ITS OWN WRAPPER, and against the control after it.
      // Both are here because the row-level check ALONE passed a real defect:
      // a `relative` block wrapper shrank to 93px while the button inside
      // stayed 101px, so every direct child of the row was inside the row and
      // the model button was painting over the mode chip regardless.
      spill: Math.round(m.right - w.right),
      overlap: next === null ? null : Math.round(m.right - next.left),
      // Every control still inside the row -- what an overflow actually costs.
      // Zero-width boxes are the hidden file input.
      outside: [...row.children]
        .map((el) => ({ el, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && (box.right > r.right + 0.5 || box.left < r.left - 0.5))
        .map(({ el }) => (el.className || el.tagName).slice(0, 40)),
    };
  });

await openComposer(OWNED);
const narrow = await readRow();
console.log(`  ${OWNED} at 520px: ${JSON.stringify(narrow)}`);
check(
  'this really is the desktop shell at its narrowest, not the phone',
  narrow !== null && narrow.phone === false && narrow.rowWidth < 330,
  JSON.stringify({ phone: narrow?.phone, row: narrow?.rowWidth }),
);
check(
  'a short name is drawn whole there, and nothing leaves the row',
  narrow?.label === 'Opus 5' &&
    narrow.clipped === false &&
    narrow.outside.length === 0 &&
    narrow.spill <= 0,
  JSON.stringify(narrow),
);

// THE LONGEST NAME A REAL CLI PRINTS: `Sonnet 4.5`, off a session started on a
// full model id. Ten characters is what burst this row before the label was
// allowed to shrink -- 16px of overflow, with the send button outside the box.
await openComposer(LONG_NAME);
const long = await readRow();
console.log(`  ${LONG_NAME} at 520px: ${JSON.stringify(long)}`);
const longName = { button: await buttonName() };
check(
  'a ten-character name does not push a single control out of the row',
  long !== null && long.overflow <= 0 && long.outside.length === 0,
  JSON.stringify({ overflow: long?.overflow, outside: long?.outside }),
);
check(
  'nor over the top of the control beside it — the button fits its own wrapper',
  long !== null && long.spill <= 0 && long.overlap !== null && long.overlap <= 0,
  JSON.stringify({ spill: long?.spill, overlap: long?.overlap }),
);
check(
  'it gives way by clipping itself instead, the way the CLI’s own line does',
  long?.clipped === true,
  JSON.stringify({ label: long?.label, clipped: long?.clipped }),
);
check(
  'and the whole name is still there for a reader, and one hover away for an eye',
  longName.button.includes('Sonnet 4.5'),
  JSON.stringify(longName.button),
);
// AND A NAME THAT IS NONE OF THE FIVE TICKS NOTHING, which is the other half
// of `Sonnet 4.5`: the picker offers Sonnet 5, and this session is not on it.
await page.locator('[data-model-picker]').click();
await page.waitForTimeout(200);
const longMarks = await readMarks();
console.log(`  ${LONG_NAME} marks: ${JSON.stringify(longMarks.ticked)}`);
check(
  'a model none of the five is ticks none of them',
  longMarks.ticked.length === 0,
  JSON.stringify(longMarks.ticked),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} model picker guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('model picker guards: all assertions passed');
