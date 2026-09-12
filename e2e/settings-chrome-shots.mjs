/**
 * The settings overlay's own chrome, in an engine that lays out and paints.
 *
 * Two audit findings live here, and neither can be held by the unit suite.
 *
 *  - ITEM 1 (S2). `SectionStrip` carried `<span className="hidden sm:inline">`
 *    around every label, so below 640px the narrow nav WAS the icon rail its
 *    own doc comment argued cannot work. `hidden` takes the label out of the
 *    accessibility tree as well as out of the paint and the buttons carry no
 *    `aria-label`, so the measured tree at 390px was literally
 *    `tab / tab / tab / tab` — four destinations, none of them named. jsdom
 *    applies no stylesheet, so it cannot see a breakpoint at all: what is
 *    asserted here is the COMPUTED ACCESSIBLE NAME at four narrow widths, the
 *    name attached to the element the keyboard actually lands on, and the row
 *    count the strip resolves to.
 *  - ITEM 3 (operator report). "The button in the Remote section of settings
 *    has the same colour as the background, so it doesn't look like a button."
 *    `PairingPanel.ACTION_BUTTON` had no resting fill at all: it painted
 *    whatever was behind it and was marked only by a `border-line` outline,
 *    which measures 1.12:1 against the `bg-panel` it sits on. Asserted as
 *    COMPUTED PAINT in both themes — an opaque fill, distinct from the
 *    surface, a boundary that reaches WCAG 1.4.11's 3:1, and a hover that
 *    moves further from the surface rather than back into it.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/settings-chrome-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** WCAG relative luminance, over an `rgb(...)` triple. */
function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The four sections, spelled once. Read from the page rather than from
 * `sections.ts` — this file runs against the BUILT bundle, and a guard that
 * imported the source would be asserting against something it did not load.
 */
const SECTIONS = [
  ['appearance', 'Appearance'],
  ['sessions', 'Sessions'],
  ['remote', 'Remote'],
  ['keyboard', 'Keyboard'],
];

const browser = await chromium.launch();

/** A page with the demo fixture loaded and the settings overlay open. */
async function openSettings(width, height = 844) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  return page;
}

/**
 * Which element the accessible name `label` resolves to, or null.
 *
 * `getByRole` runs Chromium's own accessible-name computation, which is the
 * only thing that answers the question this item is about: a `hidden` label
 * contributes nothing to it, and neither does an unlabelled `<svg>`.
 */
async function namedTab(page, label) {
  const found = page.getByRole('tab', { name: label, exact: true });
  if ((await found.count()) !== 1) return null;
  return await found.getAttribute('data-settings-nav-item');
}

// ---------------------------------------------------------------- ITEM 1.
// The name, at every width the strip is the nav at.

/** Below `md` the strip is the nav; `sm` is where it stops being two rows. */
const STRIP_WIDTHS = [320, 390, 500, 639, 700, 767];

for (const width of STRIP_WIDTHS) {
  const page = await openSettings(width);
  const orientation = await page
    .locator('[data-settings-nav]')
    .getAttribute('aria-orientation');
  if (orientation !== 'horizontal') {
    throw new Error(
      `${width}px: the nav is ${JSON.stringify(orientation)}, so this is not the narrow strip and the width table is wrong`,
    );
  }

  const names = [];
  for (const [id, label] of SECTIONS) {
    const resolved = await namedTab(page, label);
    names.push(`${label}->${resolved}`);
    if (resolved === null) {
      throw new Error(
        `${width}px: no tab has the accessible name ${JSON.stringify(label)} — the narrow nav is an unnamed icon rail`,
      );
    }
    if (resolved !== id) {
      throw new Error(
        `${width}px: the name ${JSON.stringify(label)} lands on ${resolved}, not on ${id}`,
      );
    }
  }

  // A label that is present but clipped is a label the operator cannot read,
  // and `overflow: hidden` hides that from every name computation.
  const geometry = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-settings-nav-item]')];
    return items.map((el) => ({
      id: el.getAttribute('data-settings-nav-item'),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      top: Math.round(el.getBoundingClientRect().top),
    }));
  });
  for (const item of geometry) {
    if (item.scrollW > item.clientW + 1) {
      throw new Error(
        `${width}px: ${item.id} is clipped — ${item.scrollW}px of content in a ${item.clientW}px box`,
      );
    }
  }

  // Rows, measured rather than assumed: the strip wraps to two below `sm`
  // (four labelled tabs need 306px of strip and get 278px at 320px) and sits
  // on one row from `sm` up.
  const rows = new Set(geometry.map((item) => item.top)).size;
  const expected = width < 640 ? 2 : 1;
  console.log(`${width}px: ${names.join(' ')} rows=${rows}`);
  if (rows !== expected) {
    throw new Error(`${width}px: the strip laid out on ${rows} row(s), expected ${expected}`);
  }
  if (width === 390) {
    await page.screenshot({ path: `${outDir}/settings-nav-390-after.png` });
  }
  await page.close();
}

// The keyboard path, at the narrowest width the app ships a shell for. The
// nav is one tab stop with a roving `tabIndex`, so "the tab order reaches each
// section" means: Tab arrives on a NAMED tab, and the arrows walk the rest
// without ever landing on an anonymous one.
{
  const page = await openSettings(390);
  const reached = [];
  for (const [id, label] of SECTIONS) {
    const active = await page.evaluate(() => ({
      id: document.activeElement?.getAttribute('data-settings-nav-item') ?? null,
      role: document.activeElement?.getAttribute('role') ?? null,
      shown: [...document.querySelectorAll('[data-settings-panel]')]
        .filter((el) => !el.hasAttribute('hidden'))
        .map((el) => el.getAttribute('data-settings-panel')),
    }));
    if (active.role !== 'tab' || active.id !== id) {
      throw new Error(
        `390px: the keyboard is on ${JSON.stringify(active.id)} (role ${active.role}), expected the ${id} tab`,
      );
    }
    if (active.shown.join(',') !== id) {
      throw new Error(`390px: ${id} is focused but ${active.shown.join(',')} is the panel on screen`);
    }
    const named = await namedTab(page, label);
    if (named !== id) {
      throw new Error(
        `390px: the focused ${id} tab does not answer to the name ${JSON.stringify(label)} (it is ${named})`,
      );
    }
    reached.push(label);
    await page.keyboard.press('ArrowRight');
  }
  console.log(`390px: the keyboard reached ${reached.join(', ')}, each by name`);
  await page.close();
}

// The wide rail, which was never the defect — asserted so a fix to the strip
// cannot quietly cost the rail its names.
{
  const page = await openSettings(1100, 800);
  for (const [id, label] of SECTIONS) {
    if ((await namedTab(page, label)) !== id) {
      throw new Error(`1100px: the rail's ${id} tab is not named ${JSON.stringify(label)}`);
    }
  }
  console.log('1100px: the rail names all four sections');
  await page.close();
}

// ---------------------------------------------------------------- ITEM 4.
// THE SHORTCUT COLUMN, MEASURED WHERE THE CHORD IS ACTUALLY LAID OUT.
//
// The operator: "increase the width of the shortcut column in settings". The
// column was 68px, sized when the widest thing in it was `gt`. `Mod-Shift-[` /
// `]` and `Mod-Alt-[` / `]` arrived with the pane-stepping work and nothing
// resized the column they landed in. Measured here, on the shipped bundle,
// before the fix:
//
//   Mod-Shift-]   50.58px of ink over 2 lines   scrollHeight 36 / client 24
//   Mod-Shift-[   43.36px of ink over 3 lines   scrollHeight 54 / client 24
//
// The slot is 26px tall and does not scroll, so those chords were not tight --
// they were WRAPPED AND CUT, and what an operator saw of `Mod-Shift-[` was its
// first line and nothing else.
//
// THIS CANNOT BE A UNIT TEST. happy-dom lays nothing out and measures no text,
// so `scrollHeight` there is 0 and `getClientRects()` is empty: the wrap that
// did the cutting is invisible to the entire unit suite. What is asserted is
// the RANGE over the chord's own text -- its widest painted line, and how many
// lines there are -- against the slot's content box, in a real engine.
{
  for (const theme of ['dark', 'light']) {
    // The wide form and the narrow one where the section strip wraps two by
    // two: the column has to survive both, and 390 is the narrowest shell.
    for (const width of [1100, 390]) {
      const page = await openSettings(width, 800);
      await page.evaluate((t) => {
        document.documentElement.classList.toggle('light', t === 'light');
      }, theme);
      await page.locator('[data-settings-nav-item="keyboard"]').click();
      await page.waitForSelector('[data-binding-slot]', { timeout: 5_000 });

      const slots = await page.evaluate(() => {
        const rows = [];
        for (const slot of document.querySelectorAll('[data-binding-slot]')) {
          const kbd = slot.querySelector('[data-settings-keys]');
          // An empty slot draws a `+` and no chord; it is not a claim about
          // width and is counted out rather than measured as zero.
          if (kbd === null) continue;
          const range = document.createRange();
          range.selectNodeContents(kbd);
          const lines = [...range.getClientRects()];
          rows.push({
            keys: (kbd.textContent ?? '').trim(),
            inkW: Math.max(...lines.map((r) => r.width)),
            lines: lines.length,
            innerW: slot.clientWidth,
            scrollW: slot.scrollWidth,
            scrollH: slot.scrollHeight,
            clientH: slot.clientHeight,
          });
        }
        return rows;
      });

      // A CORPUS THAT IS NOT THERE MAKES EVERY LINE BELOW VACUOUS. The
      // shortcut section draws sixty-odd bound chords; anything near zero
      // means the section did not open and this measured an empty list.
      if (slots.length < 40) {
        throw new Error(
          `${theme} ${width}px: only ${slots.length} bound chord(s) on screen — the shortcut list did not render`,
        );
      }
      const wrapped = slots.filter((s) => s.lines > 1);
      const clipped = slots.filter((s) => s.scrollH > s.clientH + 1);
      // Sideways rather than downwards: with `whitespace-nowrap` a chord that
      // does not fit runs off the end of a box that cannot scroll, and only
      // `scrollWidth` sees it. Comparing the ink to `clientWidth` would not —
      // that box includes the slot's own padding.
      const spilling = slots.filter((s) => s.scrollW > s.innerW + 1);
      const widest = slots.reduce((a, b) => (a.inkW >= b.inkW ? a : b));
      console.log(
        `${theme} ${width}px: ${slots.length} chords, widest ${widest.keys} at ${widest.inkW.toFixed(2)}px in a ${widest.innerW}px box`,
      );
      // THE KEY IS THE ONE THING THAT MAY NOT CLIP. Three ways it can, and
      // each is a different symptom of the same defect: a second line the 26px
      // box cannot show, content taller than the box, and ink wider than it.
      if (wrapped.length > 0) {
        throw new Error(
          `${theme} ${width}px: ${wrapped.length} chord(s) wrap onto more than one line in a 26px slot — ${JSON.stringify(wrapped.slice(0, 3))}`,
        );
      }
      if (clipped.length > 0) {
        throw new Error(
          `${theme} ${width}px: ${clipped.length} chord(s) are cut by their own box — ${JSON.stringify(clipped.slice(0, 3))}`,
        );
      }
      if (spilling.length > 0) {
        throw new Error(
          `${theme} ${width}px: ${spilling.length} chord(s) are wider than the box that holds them — ${JSON.stringify(spilling.slice(0, 3))}`,
        );
      }
      // And the label is what yields, not the key: it must still be marked to
      // truncate, or a long label would push the key columns off their x.
      const labelTruncates = await page.evaluate(() =>
        [...document.querySelectorAll('[data-binding-label]')].every((el) =>
          el.className.includes('truncate'),
        ),
      );
      if (!labelTruncates) {
        throw new Error(`${theme} ${width}px: a binding label is not marked to truncate`);
      }
      if (theme === 'dark' && width === 1100) {
        await page.screenshot({ path: `${outDir}/settings-shortcut-column-after.png` });
        console.log(`${outDir}/settings-shortcut-column-after.png`);
      }
      await page.close();
    }
  }
}

// AND THE HALF THE SHIPPED TABLES CANNOT REACH.
//
// The floor holds every chord `buildBindingSheet` produces, so a corpus made
// only of those would pass with `whitespace-nowrap` deleted and the slot's
// growth taken away — the two things that exist for a chord LONGER than the
// floor. A capture has no length bound: `normalizeKey` answers
// `Mod-Alt-<event.key>`, and `event.key` is whatever the keyboard reports.
// So one is planted, through the same `localStorage` an override really
// lives in, and asked the same questions.
//
// 320px IS IN THIS LIST BECAUSE OF A MUTATION THAT SURVIVED WITHOUT IT.
// Deleting `whitespace-nowrap` from `SLOT_BOX` and re-running this check at
// 1100 and 390 changed nothing at all: both of those have room, the
// `max-content` track takes it, and the chord sits on one line either way. At
// 320 — the narrowest width this file already tests the nav at — the grid runs
// out of room, the slot falls back to 154px against 166px of chord, and
// WITHOUT the class the chord wraps onto a second line that a 26px box cannot
// show (measured: `lines: 2`, `slotW: 154`). With it, one line, 206px of ink
// ending 113px inside the panel that clips. So the class is kept for what it
// actually does — carry the overflow sideways where it stays readable — and
// this loop runs at the width where deleting it goes red.
for (const width of [1100, 390, 320]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(() => {
    localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({ keyBindings: { rename: ['Mod-Alt-AudioVolumeDown'] } }),
    );
  });
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator('[data-settings-nav-item="keyboard"]').click();
  await page.waitForSelector('[data-binding-slot]', { timeout: 5_000 });

  const planted = await page.evaluate(() => {
    const slot = document.querySelector('[data-binding-slot="rename:0"]');
    if (slot === null) return null;
    const kbd = slot.querySelector('[data-settings-keys]');
    if (kbd === null) return null;
    const range = document.createRange();
    range.selectNodeContents(kbd);
    const lines = [...range.getClientRects()];
    // The nearest ancestor that actually clips — the scrolling panel, not the
    // slot. A chord that overflows its slot is fine; a chord that overflows
    // THIS is cut off the screen.
    let clipper = slot.parentElement;
    while (clipper !== null && clipper !== document.body) {
      const cs = getComputedStyle(clipper);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') break;
      clipper = clipper.parentElement;
    }
    return {
      keys: (kbd.textContent ?? '').trim(),
      lines: lines.length,
      inkW: Math.max(...lines.map((r) => r.width)),
      inkRight: Math.max(...lines.map((r) => r.right)),
      innerW: slot.clientWidth,
      scrollH: slot.scrollHeight,
      clientH: slot.clientHeight,
      clipRight: clipper === null ? null : clipper.getBoundingClientRect().right,
    };
  });
  // The plant not landing would make every line below vacuous — a slot
  // showing `r` passes all of them and proves nothing.
  if (planted === null || planted.keys !== 'Mod-Alt-AudioVolumeDown') {
    throw new Error(
      `${width}px: the long-chord override did not reach the editor: ${JSON.stringify(planted)} — this check measured nothing`,
    );
  }
  console.log(
    `planted ${width}px: ${planted.keys} at ${planted.inkW.toFixed(2)}px in a ${planted.innerW}px box, ${planted.lines} line(s)`,
  );
  // ONE LINE, ALWAYS. Whether the slot grew to hold the chord or the chord
  // runs off a slot that could not grow, the whole of it is on one line and
  // therefore readable. A second line in a 26px box is the defect.
  if (planted.lines > 1) {
    throw new Error(`${width}px: a captured chord wrapped: ${JSON.stringify(planted)}`);
  }
  if (planted.scrollH > planted.clientH + 1) {
    throw new Error(
      `${width}px: a captured chord is taller than its own box: ${JSON.stringify(planted)}`,
    );
  }
  // Overflowing the SLOT is allowed and is the design; overflowing the panel
  // that clips is the chord going off the screen.
  if (planted.clipRight === null || planted.inkRight > planted.clipRight) {
    throw new Error(
      `${width}px: a captured chord runs past the panel that clips it: ${JSON.stringify(planted)}`,
    );
  }
  if (width === 1100) {
    // Wide, there is room, so the slot is expected to have TAKEN it rather
    // than overflowed — the label column is what yields.
    if (planted.innerW < planted.inkW) {
      throw new Error(
        `1100px: the slot did not grow for a long chord: ${JSON.stringify(planted)}`,
      );
    }
    await page.screenshot({ path: `${outDir}/settings-shortcut-column-long-chord.png` });
    console.log(`${outDir}/settings-shortcut-column-long-chord.png`);
  }
  await page.close();
}

// ---------------------------------------------------------------- ITEM 3.
// The Remote section's buttons, as paint.

/**
 * A pairing screen for the browser build, which has no preload bridge.
 *
 * This supplies STATE and nothing else: the component, its classes and the
 * stylesheet are the shipped ones, and every number below is read off the
 * element Chromium actually painted. Every value is invented — no address, no
 * device and no code here belongs to a real machine.
 */
const REMOTE_STUB = {
  view: {
    code: null,
    expiresAtMs: 0,
    burned: false,
    throttledUntilMs: 0,
    awaiting: null,
    pairedName: null,
  },
  devices: [],
  address: { kind: 'found', url: 'https://example-host.example-tailnet.ts.net:7777' },
  allowWrites: false,
  registry: null,
  serve: { enabled: false, lastError: null, timedOut: false, tailnetServeDisabledUrl: null },
  serverError: null,
  writesPreference: false,
  nowMs: 1_700_000_000_000,
};

{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((state) => {
    const answer = () => Promise.resolve(state);
    // `RemotePanel` reads `window.api.remote`; nothing else on this object is
    // read by the browser build, and the demo fixture is untouched.
    globalThis.window.api = {
      ...(globalThis.window.api ?? {}),
      remote: {
        state: answer,
        open: answer,
        approve: answer,
        deny: answer,
        remove: answer,
        revokeAll: answer,
        enableServe: answer,
        disableServe: answer,
        setWrites: answer,
      },
    };
  }, REMOTE_STUB);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator('[data-settings-nav-item="remote"]').click();
  await page.waitForSelector('[data-testid="pairing-panel"]', { timeout: 5_000 });

  const button = page.getByRole('button', { name: 'Enable phone access' });
  if ((await button.count()) !== 1) {
    throw new Error(
      'the pairing panel drew no "Enable phone access" button — the stub no longer reaches PairingPanel',
    );
  }

  /** The button's own paint, and the surface behind it, from the same frame. */
  const measure = () =>
    button.evaluate((el) => {
      const parse = (s) => {
        const n = (s.match(/[\d.]+/g) ?? []).map(Number);
        return { rgb: n.slice(0, 3), alpha: n.length > 3 ? n[3] : 1 };
      };
      const cs = getComputedStyle(el);
      // What is UNDER the button, asked of the document rather than guessed
      // from a token name: walk up until something paints an opaque fill.
      let behind = el.parentElement;
      let backdrop = 'rgba(0, 0, 0, 0)';
      while (behind !== null && parse(backdrop).alpha === 0) {
        backdrop = getComputedStyle(behind).backgroundColor;
        behind = behind.parentElement;
      }
      return {
        fill: parse(cs.backgroundColor),
        border: parse(cs.borderTopColor),
        borderWidth: Number.parseFloat(cs.borderTopWidth),
        behind: parse(backdrop),
      };
    });

  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('light', t === 'light');
    }, theme);
    await page.waitForTimeout(120);

    const rest = await measure();
    // Every ratio below is a claim about two PAINTED colours. A transparent
    // element has no colour, and comparing one is how a contrast assertion
    // becomes a tautology — so refuse before measuring, in both directions.
    if (rest.fill.alpha === 0) {
      throw new Error(
        `${theme}: the action button has no resting fill (${JSON.stringify(rest.fill)}) — it paints whatever is behind it`,
      );
    }
    if (rest.behind.alpha === 0) {
      throw new Error(`${theme}: nothing behind the button paints an opaque colour to compare with`);
    }
    if (rest.border.alpha === 0 || rest.borderWidth === 0) {
      throw new Error(`${theme}: the button has no drawn boundary`);
    }

    const fillVsBehind = ratio(rest.fill.rgb, rest.behind.rgb);
    const borderVsBehind = ratio(rest.border.rgb, rest.behind.rgb);
    console.log(
      `${theme}: action button fill ${JSON.stringify(rest.fill.rgb)} on ${JSON.stringify(rest.behind.rgb)} = ${fillVsBehind.toFixed(3)}:1, border ${borderVsBehind.toFixed(2)}:1`,
    );

    if (rest.fill.rgb.join(',') === rest.behind.rgb.join(',')) {
      throw new Error(
        `${theme}: the button's fill is the surface's own colour ${JSON.stringify(rest.fill.rgb)} — the operator's report exactly`,
      );
    }
    // WCAG 1.4.11: the visual information that identifies a control needs
    // 3:1. In this palette no surface token reaches 3:1 against `panel`, so
    // it is the BOUNDARY that has to carry it — which is what the fill alone
    // could never do and why both are asserted.
    if (borderVsBehind < 3) {
      throw new Error(
        `${theme}: the button's border is ${borderVsBehind.toFixed(2)}:1 against the panel, under the 3:1 of WCAG 1.4.11`,
      );
    }

    // Direction, not magnitude: PR #288's defect was a hover that moved the
    // control TOWARDS the surface and punched a hole in it. Measured as
    // distance from the surface's luminance, so it holds in both themes
    // without either one naming a colour.
    await button.hover();
    await page.waitForTimeout(120);
    const hover = await measure();
    if (hover.fill.alpha === 0) {
      throw new Error(`${theme}: the hover state removed the fill`);
    }
    const away = (m) => Math.abs(luminance(m.fill.rgb) - luminance(m.behind.rgb));
    console.log(
      `${theme}: hover fill ${JSON.stringify(hover.fill.rgb)}; distance from surface rest ${away(rest).toFixed(4)} -> hover ${away(hover).toFixed(4)}`,
    );
    if (away(hover) <= away(rest)) {
      throw new Error(
        `${theme}: hovering moves the button back towards the surface (${away(rest).toFixed(4)} -> ${away(hover).toFixed(4)}) instead of lifting it off`,
      );
    }
    await page.mouse.move(0, 0);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${outDir}/settings-remote-button-${theme}-after.png` });
  }
  await page.close();
}

// ---------------------------------------------------------------------------
// THE CASE LADDER, MEASURED AS PAINT.
//
// Operator: "the settings text is all lower case — the big headings should be
// upper case and the normal ones capitalised."
//
// THE CASE IS A CSS TRANSFORM, NOT A REWRITTEN STRING, and that choice is what
// makes this file the only place the change can be checked. The DOM keeps its
// canonical lower-case text, so `textContent` is unchanged, every unit
// assertion that quotes a label still holds, and the ACCESSIBLE NAME a screen
// reader receives stays a normal word rather than four capitals it may spell
// out. What changes is the paint -- and a class name in a `.tsx` file proves
// only that somebody typed it. This repo has shipped a stylesheet rule that
// matched nothing and passed review on exactly that evidence.
//
// SO EACH ELEMENT IS ASKED WHAT IT COMPUTED, and the corpus is asserted first:
// a sweep that found no headings would satisfy every "is uppercase" check
// below by having nothing to check.
console.log('\n=== the settings case ladder');
{
  const page = await openSettings(1100, 800);
  // ALL FOUR SECTIONS, not the one that happens to open. Three quarters of
  // this surface is behind a nav click, and a ladder checked on `appearance`
  // alone would have left `keyboard` -- the longest list of words here -- in
  // whatever case it was already in.
  const sectionIds = await page.evaluate(() =>
    [...document.querySelectorAll('[data-settings-nav-item]')].map((el) =>
      el.getAttribute('data-settings-nav-item'),
    ),
  );
  if (sectionIds.length < 4) {
    throw new Error(`the nav offers ${sectionIds.length} sections, so this sweep is about nothing`);
  }
  const seen = { headings: 0, labels: 0, hints: 0, controls: 0, descriptions: 0 };
  for (const sectionId of sectionIds) {
  await page.locator(`[data-settings-nav-item="${sectionId}"]`).click();
  await page.waitForTimeout(150);
  const cased = await page.evaluate(() => {
    const read = (el) => ({
      text: (el.textContent ?? '').trim().slice(0, 40),
      transform: getComputedStyle(el).textTransform,
    });
    const panel = document.querySelector('[data-settings-panel]:not([hidden])');
    return {
      // FROM THE PANEL ON SCREEN, not from the document: all four panels are
      // rendered and the other three carry `hidden`, so a document-wide query
      // returns four headings and none of them is "the one you are reading".
      heading: [...(panel?.querySelectorAll('[data-settings-heading]') ?? [])].map(read),
      labels: [...(panel?.querySelectorAll('[data-settings-rows] h4') ?? [])].map(read),
      hints: [...(panel?.querySelectorAll('[data-settings-rows] p') ?? [])].map(read),
      descriptions: [...(panel?.querySelectorAll('[data-binding-label]') ?? [])].map((el) => ({
        ...read(el),
        first: getComputedStyle(el, '::first-letter').textTransform,
      })),
      // THE CONTROLS THEMSELVES, which are the bulk of the words on this
      // surface: theme choices, colour-template chips, swatch names, the focus
      // view switch. A ladder that stopped at the headings would leave a panel
      // whose every pressable word was still lower case.
      controls: [
        ...(panel?.querySelectorAll('[data-settings-rows] button, [data-settings-rows] span') ??
          []),
      ]
        .filter((el) => {
          // A DIRECT TEXT NODE, not `textContent`: the colour-template chips
          // wrap three preview discs in a `span`, so a wrapper test on
          // `querySelector` dropped them from the corpus entirely -- measured,
          // and they are five of the controls this is about.
          const own = [...el.childNodes].some(
            (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
          );
          if (!own) return false;
          // Sentences and shouted eyebrows are ranks of their own, checked
          // above. A UNIT is not a name either: `px` capitalised is `Px`.
          if (el.closest('p') !== null) return false;
          // A UNIT is not a name: `px` capitalised is `Px`. And a BINDING ROW
          // is a description -- "previous tab of this project — a ring, so it
          // never runs out" -- which takes sentence case; there are seventy of
          // them down one list and title-casing that is a wall of capitals.
          // Both are checked below, in the rank they belong to.
          return (
            el.closest('[data-settings-unit]') === null &&
            el.closest('[data-binding-label]') === null
          );
        })
        .map(read),
    };
  });
  console.log(`  [${sectionId}] heading: ${JSON.stringify(cased.heading)}`);
  console.log(`  [${sectionId}] labels: ${JSON.stringify(cased.labels.map((l) => l.text))}`);

  // THE CORPUS FIRST, in every one of the three ranks.
  if (cased.heading.length !== 1) {
    throw new Error(`expected one visible panel heading, found ${cased.heading.length}`);
  }
  // THE CORPUS IS COUNTED ACROSS THE SWEEP, not per panel, and that is not a
  // softening. `remote` draws its own chrome and has no `Block` rows at all,
  // so a per-panel floor is either wrong for that one or vacuous for it -- and
  // a vacuous floor is how a sweep comes to pass having examined nothing. The
  // totals are asserted once, after all four, against literals.
  seen.headings += cased.heading.length;
  seen.labels += cased.labels.length;
  seen.hints += cased.hints.length;
  seen.controls += cased.controls.length;

  // THE BIG HEADING SHOUTS. It is the one piece of text on this surface that
  // names where you are rather than what you are changing.
  for (const row of cased.heading) {
    if (row.transform !== 'uppercase') {
      throw new Error(
        `[${sectionId}] the panel heading ${JSON.stringify(row.text)} is ${row.transform}`,
      );
    }
    if (row.text.length === 0) {
      throw new Error('the panel heading is empty, so its case is about nothing');
    }
  }

  // A SETTING'S NAME IS CAPITALISED, never shouted: there are four or five of
  // them down one panel and a column of capitals is a column with no word
  // shapes left to scan by.
  for (const row of cased.labels) {
    if (row.transform !== 'capitalize') {
      throw new Error(
        `[${sectionId}] the setting label ${JSON.stringify(row.text)} is ${row.transform}`,
      );
    }
  }

  // EVERY CONTROL NAME IS CAPITALISED TOO. Corpus first, as above.
  console.log(`  [${sectionId}] controls: ${JSON.stringify(cased.controls.map((c) => c.text))}`);
  const shouted = cased.controls.filter((c) => c.transform !== 'capitalize');
  if (shouted.length > 0) {
    throw new Error(
      `[${sectionId}] control names not capitalised: ${JSON.stringify(shouted.map((c) => `${c.text}=${c.transform}`))}`,
    );
  }

  // A BINDING ROW IS A DESCRIPTION, in the same rank as a hint.
  const titled = cased.descriptions.filter(
    (d) => d.transform !== 'none' || d.first !== 'uppercase',
  );
  if (titled.length > 0) {
    throw new Error(
      `[${sectionId}] binding rows are not sentences: ${JSON.stringify(titled.slice(0, 3))}`,
    );
  }
  seen.descriptions += cased.descriptions.length;

  // AND A HINT IS A SENTENCE, so only its first letter moves. `capitalize`
  // here would give "System Follows What The Operating System Asks For",
  // which is the failure that looks most like the fix.
  for (const row of cased.hints) {
    if (row.transform !== 'none') {
      throw new Error(
        `[${sectionId}] the hint ${JSON.stringify(row.text)} is ${row.transform}, not a sentence`,
      );
    }
  }
  // EVERY PARAGRAPH ON THE PANEL, and the panel's OWN hint by name. That one
  // is the reason this check widened: it wore the sentence class and stayed
  // lower case, because `::first-letter` applies only to a BLOCK container and
  // it was a `<span>` -- while the identical class worked one row up, whose
  // parent is a flex container and whose children are therefore blockified.
  // The first corpus here stopped at `[data-settings-rows]` and could not see
  // the element that was wrong.
  const sentences = await page.evaluate(() => {
    const panel = document.querySelector('[data-settings-panel]:not([hidden])');
    const own = panel?.querySelector('[data-settings-panel-hint]') ?? null;
    const rows = [...(panel?.querySelectorAll('[data-settings-rows] p') ?? [])];
    const at = (el) =>
      el === null
        ? null
        : {
            text: (el.textContent ?? '').trim().slice(0, 28),
            first: getComputedStyle(el, '::first-letter').textTransform,
          };
    return { own: at(own), rows: rows.map(at) };
  });
  console.log(`  [${sectionId}] panel hint: ${JSON.stringify(sentences.own)}`);
  if (sentences.own === null) {
    throw new Error(`[${sectionId}] the panel draws no hint of its own`);
  }
  for (const row of [sentences.own, ...sentences.rows]) {
    if (row.first !== 'uppercase') {
      throw new Error(
        `[${sectionId}] ${JSON.stringify(row.text)} starts ${row.first}, not a sentence`,
      );
    }
  }

  // THE HEADING NAMES THE SECTION THE NAV NAMES. Before this the nav said
  // "Appearance" and the panel beside it said "appearance" -- the same
  // destination, spelled two ways, one of them a raw id.
  const agree = await page.evaluate(() => {
    const heading = document.querySelector(
      '[data-settings-panel]:not([hidden]) [data-settings-heading]',
    );
    const id = heading?.closest('[data-settings-panel]')?.getAttribute('data-settings-panel');
    const tab = document.querySelector(`[data-settings-nav-item="${id}"]`);
    return {
      heading: (heading?.textContent ?? '').trim(),
      tab: (tab?.textContent ?? '').trim(),
    };
  });
  console.log(`  heading vs tab: ${JSON.stringify(agree)}`);
  if (agree.heading !== agree.tab || agree.heading === '') {
    throw new Error(`the panel heading ${JSON.stringify(agree.heading)} is not the tab's ${JSON.stringify(agree.tab)}`);
  }

  await page.screenshot({ path: `${outDir}/settings-case-${sectionId}.png` });
  console.log(`${outDir}/settings-case-${sectionId}.png`);
  }
  console.log(`  swept: ${JSON.stringify(seen)}`);
  // ONE HEADING PER SECTION, and enough rows and names across the four that a
  // panel which quietly stopped drawing them cannot pass this by drawing
  // nothing. Literals rather than `> 0`: that is the difference between a
  // corpus and a pulse.
  if (seen.headings !== sectionIds.length) {
    throw new Error(`${seen.headings} headings over ${sectionIds.length} sections`);
  }
  if (seen.descriptions < 40) {
    throw new Error(`the keyboard list drew ${seen.descriptions} rows, so its rank is untested`);
  }
  if (seen.labels < 7 || seen.hints < 7 || seen.controls < 24) {
    throw new Error(`the sweep found too little to be about the surface: ${JSON.stringify(seen)}`);
  }
  await page.close();
}

// ---------------------------------------------------------------- ITEM 5.
// A SWITCH THAT LOOKS LIKE ONE.
//
// Operator: "turn some of the settings buttons into a toggle UI." Focus view
// was already `role="switch"` with an `aria-checked` -- a switch to a screen
// reader and a bordered word to everybody else -- so the whole of this change
// is PAINT, and paint is the one thing a unit test cannot see. A `.tsx` file
// reading `left-[17px]` proves somebody typed it; this asks the browser where
// the knob actually is, in both states.
//
// AND WCAG 1.4.11, which is what a switch has instead of text contrast: the
// parts that carry the state -- the track's boundary against the panel, and
// the knob against its track -- have to clear 3:1, or the state is legible
// only to someone who already knows where to look.
console.log('\n=== the appearance switch');
{
  const page = await openSettings(1100, 800);
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
    const ground = (el) => {
      let node = el?.parentElement ?? null;
      while (node !== null) {
        const colour = getComputedStyle(node).backgroundColor;
        if (opaque(colour)) return colour;
        node = node.parentElement;
      }
      return null;
    };
    window.vamSwitch = { opaque, ratio, ground };
  });

  const readSwitch = () =>
    page.evaluate(() => {
      const { opaque, ratio, ground } = window.vamSwitch;
      const control = document.querySelector('[data-switch="focus-view"]');
      if (control === null) return null;
      const track = control.querySelector('[data-switch-track]');
      const knob = control.querySelector('[data-switch-knob]');
      const box = control.getBoundingClientRect();
      const trackBox = track.getBoundingClientRect();
      const knobBox = knob.getBoundingClientRect();
      const trackFill = getComputedStyle(track).backgroundColor;
      const trackEdge = getComputedStyle(track).borderTopColor;
      const knobFill = getComputedStyle(knob).backgroundColor;
      return {
        checked: control.getAttribute('aria-checked'),
        word: (control.textContent ?? '').trim(),
        hit: { w: box.width, h: box.height },
        track: { w: trackBox.width, h: trackBox.height },
        knob: { w: knobBox.width, h: knobBox.height, at: knobBox.left - trackBox.left },
        opaque: opaque(trackFill) && opaque(trackEdge) && opaque(knobFill),
        edgeVsPanel: ratio(trackEdge, ground(track)),
        knobVsTrack: ratio(knobFill, trackFill),
      };
    });

  const off = await readSwitch();
  if (off === null) throw new Error('the appearance section draws no switch at all');
  await page.locator('[data-switch="focus-view"]').click();
  await page.waitForTimeout(250);
  const on = await readSwitch();
  console.log(`  off: ${JSON.stringify(off)}`);
  console.log(`  on:  ${JSON.stringify(on)}`);

  if (off.checked !== 'false' || on.checked !== 'true') {
    throw new Error(`the switch did not change state: ${off.checked} -> ${on.checked}`);
  }
  // THE TRAVEL IS THE STATE. A knob that moved a pixel or two would satisfy
  // "it moved" while reading identical at arm's length, so the floor is a
  // whole knob's width.
  const travel = on.knob.at - off.knob.at;
  console.log(`  the knob travels ${Math.round(travel)}px in a ${Math.round(off.track.w)}px track`);
  if (travel < off.knob.w) {
    throw new Error(`the knob moved ${travel}px, less than its own ${off.knob.w}px width`);
  }
  if (off.track.w < 28 || off.track.h < 16 || off.knob.w < 10) {
    throw new Error(`the switch is drawn too small to read: ${JSON.stringify(off)}`);
  }
  // 24px is the desktop target floor this repo already holds elsewhere.
  if (off.hit.h < 24 || off.hit.w < 24) {
    throw new Error(`the switch answers across ${off.hit.w}x${off.hit.h}`);
  }
  for (const state of [off, on]) {
    if (!state.opaque) {
      throw new Error('a part of the switch paints nothing, so its contrast is unmeasured');
    }
    if (state.edgeVsPanel < 3) {
      throw new Error(`the track's edge is ${state.edgeVsPanel.toFixed(2)}:1 against the panel`);
    }
    if (state.knobVsTrack < 3) {
      throw new Error(`the knob is ${state.knobVsTrack.toFixed(2)}:1 against its track`);
    }
  }
  if (off.word === on.word) {
    throw new Error(`both states read "${off.word}", so the word says nothing`);
  }
  await page.screenshot({ path: `${outDir}/settings-switch.png` });
  console.log(`${outDir}/settings-switch.png`);
  await page.close();
}

await browser.close();
console.log('settings chrome: the narrow nav is named at every width, the Remote button paints, the case ladder holds, and the switch reads as one.');
