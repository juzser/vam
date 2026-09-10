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
