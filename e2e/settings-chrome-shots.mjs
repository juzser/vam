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

await browser.close();
console.log('settings chrome: the narrow nav is named at every width, and the Remote button paints.');
