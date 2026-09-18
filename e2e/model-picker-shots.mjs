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
const DISABLED_NOTE =
  'vam has no terminal it owns for this session, so it cannot send /model — open it in a vam terminal';

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
  return {
    ids: options.map((el) => el.getAttribute('data-model-option')),
    labels: options.map((el) => (el.textContent ?? '').trim()),
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
check('the five are options of one listbox, and the free-text row is outside it', menu?.inListbox === true && menu?.inputInListbox === false);
check('with a free-text row for a full model id', menu?.freeText === true);
check('every option has a box on screen', menu?.painted === true);
check('and the popover is on top at its own centre', menu?.onTop === true);
check('while the button says it is expanded', menu?.expanded === 'true');
await shotOfTools(`${outDir}/model-picker.png`, 200);

// PICKING ONE, IN THE BROWSER BUILD, is refused out loud: there is no
// `window.api` here, and the shared caption says so in the same row. This is
// the one thing a pick can be measured to do without a pane -- and it proves
// the picker reports through the mode chip's channel rather than a copy.
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

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} model picker guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('model picker guards: all assertions passed');
