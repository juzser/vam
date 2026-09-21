/**
 * THE TERMINAL COLOUR SETTINGS, AS PAINT: what the swatches, the hex fields
 * and the theme chips RESOLVE to in a real engine, and whether pressing them
 * repaints a Terminal tab that is open behind the dialog.
 *
 * ── WHY THIS CANNOT BE A UNIT TEST ────────────────────────────────────────
 * `test/settings/terminal-colours.test.tsx` holds that every control writes
 * the right bucket through the right setter, and that a mounted tab follows
 * the store. What it cannot hold is a PIXEL: happy-dom lays nothing out, so a
 * swatch's colour read back there is the string the component put in its
 * `value`, and a `ring-2 ring-ink` is a class name rather than a 2px edge in
 * a colour that clears 3:1. So this file asks Chromium:
 *
 *   1. THE SWATCHES PAINT THE RESOLVED SCHEME -- Hans in dark, Tango Light in
 *      light -- read THREE ways that have to agree: the input's `value`, the
 *      element's computed background, and THE PIXEL AT THE DISC'S CENTRE off
 *      a screenshot. The third is the one that is not a tautology. Chromium
 *      paints a colour input's fill in a shadow part whose paint no
 *      `getComputedStyle` answers (measured: `::-webkit-color-swatch` computes
 *      `rgba(0, 0, 0, 0)`), which is why the element carries the same colour
 *      as its own background and why this guard decodes the PNG rather than
 *      trusting either.
 *   2. PRESSING A THEME CHIP REPAINTS THE OPEN TERMINAL: Dracula's ground on
 *      the pane and Dracula's red on a red run, with the dialog still open.
 *      And a LIGHT chip pressed from a dark dashboard moves nothing on screen
 *      -- until the sun is clicked, when the screen wears the light choice.
 *   3. AN OVERRIDE TYPED INTO THE HEX FIELD reaches the swatch's pixel, the
 *      pane's `--vam-ansi-red`, and the red run itself; the row wears the
 *      2px ink ring and its reset; "reset dark terminal colours" takes all of
 *      that back to the theme.
 *   4. THE SLIDER THINS THE GROUND: at 0.5 the pane computes an `rgba` with
 *      that alpha and the printed value reads 50%.
 *   5. CONTRAST, IN BOTH THEMES: every hex field's ink on its own fill and
 *      every label on the panel clear WCAG 1.4.3's 4.5:1 -- the bar the app
 *      palette's swatch labels already meet -- and every swatch ring, the
 *      slider's thumb and track, and the pressed chip's edge clear 1.4.11's
 *      3:1 against the surface they identify the control on.
 *
 * ── THE BRIDGE IS A STUB ──────────────────────────────────────────────────
 * Injected with `page.addInitScript`, exactly as `terminal-scheme-shots.mjs`
 * does and for the reason recorded there: defining `window.api` takes
 * `App.tsx` off the `?demo=1` fixture and onto the preload source, so the
 * stub has to be a complete `PreloadSourceApi`. Every string in it is
 * invented.
 *
 * Falsified by hand, each alone, against a real build:
 *   - a chip writing the theme into the mode ON SCREEN rather than its own
 *     row's (`setTerminalTheme(prefs, theme, id)`) -> the light-chip block
 *     reddens: the light id is rejected for dark and the sun click lands on
 *     Tango Light.
 *   - the per-row reset drawn on every row -> the "only the moved row" and
 *     "no reset after reset all" checks redden.
 *   - the slider's `min`/`max` dropped -> the 0.5 check still passes and the
 *     "bounded" check reddens on `min`; the setter's clamp is the model's own.
 *   - the swatch painting the THEME value under an override
 *     (`theme.scheme[key]` for `value`) -> the pixel and value checks on
 *     `red` redden together, while the pane's property check stays green.
 *   - the element background left off the swatch -> the computed-background
 *     read reddens while the pixel read stays green, which is the point of
 *     reading both.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/terminal-settings-shots.mjs http://localhost:5520 docs/ui
 */
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'atlas-settings';
const BRANCH = 'work/atlas-settings';
const ESC = '';

/**
 * The two defaults and Dracula, spelled here because a browser script cannot
 * import from `src/`; `test/prefs/terminal-scheme.test.ts` pins the two
 * defaults digit for digit against the source, and `terminal-scheme-shots.mjs`
 * carries the same two tables.
 */
const HANS = {
  background: '#1e1f29',
  foreground: '#9a9b97',
  bold: '#dba780',
  cursor: '#ae7af7',
  cursorAccent: '#1e1f29',
  selectionBackground: '#0f0e19',
  selectionForeground: '#9a9b97',
  black: '#343648',
  red: '#fc3b44',
  green: '#48ff68',
  yellow: '#eefc7a',
  blue: '#645036',
  magenta: '#fc5dba',
  cyan: '#7ce4fc',
  white: '#f6f6ef',
  brightBlack: '#505d93',
  brightRed: '#fc555b',
  brightGreen: '#5eff82',
  brightYellow: '#ffff95',
  brightBlue: '#cb97ff',
  brightMagenta: '#fc78d7',
  brightCyan: '#96ffff',
  brightWhite: '#ffffff',
};
const TANGO_LIGHT = {
  background: '#ffffff',
  foreground: '#2e3434',
  bold: '#2e3434',
  cursor: '#2e3434',
  cursorAccent: '#ffffff',
  selectionBackground: '#accef7',
  selectionForeground: '#2e3434',
  black: '#2e3436',
  red: '#cc0000',
  green: '#4e9a06',
  yellow: '#8e7700',
  blue: '#3465a4',
  magenta: '#75507b',
  cyan: '#05727e',
  white: '#6a6a6a',
  brightBlack: '#555753',
  brightRed: '#ef2929',
  brightGreen: '#1b7a1b',
  brightYellow: '#6d5a00',
  brightBlue: '#204a87',
  brightMagenta: '#ad7fa8',
  brightCyan: '#034b50',
  brightWhite: '#3d3d3d',
};
/** Dracula's ground and red, off the same table the source carries. */
const DRACULA = { background: '#282a36', red: '#ff5555' };
/** Solarized Light's ground, for the light-chip block. */
const SOLARIZED_LIGHT_BG = '#fdf6e3';
/** A colour no shipped theme uses, so a read-back that finds it found the
 *  override and not a coincidence. */
const PICK = '#3a2f5f';
const KEYS = Object.keys(HANS);

const SCREEN = [
  '$ vam --scheme',
  `${ESC}[31mred${ESC}[0m plain`,
  '',
  'the rest of the screen, at the scheme’s own ink',
].join('\n');

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

/** `#rrggbb` as Chromium spells an opaque computed colour. */
const rgb = (hex) =>
  `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
/** The three channels of `#rrggbb` or `rgb(a, b, c)`. */
const channels = (colour) =>
  colour.startsWith('#')
    ? [1, 3, 5].map((i) => Number.parseInt(colour.slice(i, i + 2), 16))
    : colour.match(/[\d.]+/g).slice(0, 3).map(Number);

/** WCAG relative luminance, over three channels. */
function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [hi, lo] = [luminance(channels(a)), luminance(channels(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A PNG, decoded far enough to read one pixel. Playwright writes 8-bit
 * non-interlaced RGBA, which is one IHDR, some IDATs and the five standard
 * scanline filters -- forty lines, against a dependency the `e2e/` tree does
 * not carry. Anything else in the header is refused loudly rather than read
 * wrong.
 */
function decodePng(buf) {
  let off = 8;
  let width = 0;
  let height = 0;
  let colourType = -1;
  let depth = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colourType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    off += 12 + len;
  }
  const bpp = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (bpp === 0 || depth !== 8 || interlace !== 0) {
    throw new Error(`unexpected PNG: colour type ${colourType}, depth ${depth}, interlace ${interlace}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y === 0 ? null : out.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev === null ? 0 : prev[x];
      const c = prev !== null && x >= bpp ? prev[x - bpp] : 0;
      const v = raw[pos];
      pos += 1;
      let p;
      if (filter === 0) p = v;
      else if (filter === 1) p = v + a;
      else if (filter === 2) p = v + b;
      else if (filter === 3) p = v + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      row[x] = p & 0xff;
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const i = y * stride + x * bpp;
      return `rgb(${out[i]}, ${out[i + 1]}, ${out[i + 2]})`;
    },
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

await page.addInitScript(
  ({ session, branch, screen }) => {
    const unavailable = () =>
      Promise.resolve({
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
      });
    globalThis.window.api = {
      describe: async () => ({
        id: 'stub',
        label: 'Stub',
        capabilities: {
          liveUpdates: false,
          recordPrompt: false,
          deliverPrompt: false,
          promptAttachments: false,
          slashCommands: false,
          renameSession: false,
          closeSession: false,
          createSession: false,
          governance: false,
          pullRequests: false,
          terminal: true,
          agentRoster: false,
          resumeSession: false,
        },
        declines: {},
        viewerScope: 'operator',
      }),
      load: async () => [
        {
          id: 'p1',
          name: 'stub project',
          sessions: [
            {
              id: session,
              title: 'stub session',
              icon: null,
              epic: null,
              branch,
              status: 'waiting',
              runningAgents: 0,
              activity: null,
              age: '2m',
              decisions: [
                { id: 'd1', label: 'step 1', input: 'a turn', output: 'an answer', commands: [] },
              ],
            },
          ],
        },
      ],
      subscribe: () => () => {},
      recordPrompt: async () => {},
      renameSession: async () => {},
      closeSession: async () => {},
      createSession: async () => {},
      createSessionIn: async () => {},
      pickImageAttachment: async () => null,
      history: async () => unavailable(),
      agentWork: async () => unavailable(),
      applyWaivers: async () => {},
      transitionLesson: async () => {},
      usage: { get: async () => ({ kind: 'unavailable' }) },
      terminal: {
        read: async () => ({
          kind: 'ok',
          name: 'vam-atlas-settings-a1b2c3',
          text: screen,
          cursor: { kind: 'at', column: 2, row: 0 },
        }),
        resize: async () => true,
        send: async () => 'sent',
        answer: async () => ({ kind: 'unavailable' }),
        prompt: async () => ({ kind: 'unavailable' }),
      },
    };
  },
  { session: SESSION, branch: BRANCH, screen: SCREEN },
);

/**
 * Put a prefs payload in the store, open the Terminal tab on it, then open
 * Settings over it and scroll the colour grid into the dialog's scrollport.
 * An init script rather than an `evaluate` + `reload`, for the race
 * `terminal-chrome-shots.mjs` records.
 */
async function openSettingsOverTerminal(prefs) {
  await page.addInitScript((payload) => {
    globalThis.localStorage.setItem('vam.prefs.v1', JSON.stringify(payload));
  }, prefs);
  await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator(`[data-session-row="${SESSION}"]`).first().click();
  await page.locator('[data-view="terminal"]').click();
  await page.waitForSelector('[data-terminal-cursor]', { timeout: 5_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-block="terminal-colours"]', { timeout: 5_000 });
  // The BLOCK, not a `.grid` inside it: the rows are grids too, so that
  // selector matched twenty-three elements and Playwright's strict mode
  // refused all of them. The block is the one element this is about.
  await page.locator('[data-settings-block="terminal-colours"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
}

/** Drive a native input the way React can hear (`pane-colour-shots.mjs`). */
async function drive(selector, value) {
  await page.locator(selector).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForTimeout(250);
}

/** Everything the engine resolved for the group and the pane behind it. */
const readAll = () =>
  page.evaluate((keys) => {
    const opaque = (colour) => /^rgb\(\s*\d/.test(colour);
    const ground = (el) => {
      let node = el?.parentElement ?? null;
      while (node !== null) {
        const colour = getComputedStyle(node).backgroundColor;
        if (opaque(colour)) return colour;
        node = node.parentElement;
      }
      return null;
    };
    /** The outermost ring a Tailwind `ring-*` draws: `<colour> 0px 0px 0px <w>px`. */
    const ring = (el) => {
      const shadows = getComputedStyle(el).boxShadow.split(/,(?![^(]*\))/);
      for (const shadow of shadows) {
        const m = shadow.trim().match(/^(rgba?\([^)]*\)) 0px 0px 0px (\d+)px$/);
        if (m !== null && opaque(m[1])) return { colour: m[1], width: Number(m[2]) };
      }
      return null;
    };
    const swatches = {};
    for (const key of keys) {
      const swatch = document.querySelector(`[data-terminal-swatch="${key}"]`);
      const hex = document.querySelector(`[data-terminal-hex="${key}"]`);
      const row = document.querySelector(`[data-terminal-colour="${key}"]`);
      const label = row?.querySelector('span');
      const box = swatch?.getBoundingClientRect();
      swatches[key] = {
        value: swatch?.value ?? null,
        background: swatch === null ? null : getComputedStyle(swatch).backgroundColor,
        centre: box === undefined ? null : { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        ring: swatch === null ? null : ring(swatch),
        ringGround: swatch === null ? null : ground(swatch),
        hex: hex?.value ?? null,
        hexInk: hex === null ? null : getComputedStyle(hex).color,
        hexFill: hex === null ? null : getComputedStyle(hex).backgroundColor,
        hexEdge: hex === null ? null : getComputedStyle(hex).borderTopColor,
        labelInk: label ? getComputedStyle(label).color : null,
        labelGround: label ? ground(label) : null,
        overridden: row?.hasAttribute('data-terminal-overridden') ?? null,
        reset: row?.querySelector('[data-terminal-reset]') !== null,
      };
    }
    const chips = [...document.querySelectorAll('[data-terminal-theme]')].map((el) => {
      const name = el.querySelector('[data-verbatim]');
      return {
        id: el.getAttribute('data-terminal-theme'),
        row: el.closest('[data-terminal-theme-row]')?.getAttribute('data-terminal-theme-row'),
        pressed: el.getAttribute('aria-pressed'),
        ink: getComputedStyle(el).color,
        fill: getComputedStyle(el).backgroundColor,
        edge: getComputedStyle(el).borderTopColor,
        ground: ground(el),
        text: (name?.textContent ?? '').trim(),
        transform: name ? getComputedStyle(name).textTransform : null,
      };
    });
    const slider = document.querySelector('[data-terminal-opacity]');
    const printed = document.querySelector('[data-terminal-opacity-value]');
    const pane = document.querySelector('[data-terminal-pane]');
    const red = [...(pane?.querySelectorAll('pre span') ?? [])].find((el) => el.textContent === 'red');
    const grid = document.querySelector('[data-settings-block="terminal-colours"] .grid');
    const scroll = document.querySelector('[data-settings-scroll]');
    return {
      swatches,
      chips,
      resetAll: document.querySelector('[data-settings-block="terminal-colours"] h4 ~ * button') !== null,
      slider:
        slider === null
          ? null
          : {
              min: slider.min,
              max: slider.max,
              step: slider.step,
              value: slider.value,
              // NO `getComputedStyle(slider, '::-webkit-slider-thumb')` HERE,
              // AND THAT IS A MEASUREMENT, NOT A STYLE CHOICE. Chromium 153
              // does not expose the slider's shadow pseudo-elements to
              // `getComputedStyle`: asked for either one it hands back the
              // INPUT's own box -- 24px tall, 180px wide, `rgba(0, 0, 0, 0)`.
              // A contrast check fed that transparent black scored 21:1 on
              // the light panel and 1.34:1 on the dark one, so it passed in
              // one theme and failed in the other while measuring the same
              // nothing in both. The thumb and the track are read off the
              // PIXELS below, the way the swatches already are.
              ground: ground(slider),
              printed: (printed?.textContent ?? '').trim(),
              printedInk: printed ? getComputedStyle(printed).color : null,
            },
      pane:
        pane === null
          ? null
          : {
              ground: getComputedStyle(pane).backgroundColor,
              red: red ? getComputedStyle(red).color : null,
              ansiRed: getComputedStyle(pane).getPropertyValue('--vam-ansi-red').trim(),
            },
      gridRect: grid?.getBoundingClientRect().toJSON() ?? null,
      scrollRect: scroll?.getBoundingClientRect().toJSON() ?? null,
      lightClass: document.documentElement.classList.contains('light'),
    };
  }, KEYS);

/** The pixel under each swatch's centre, off one screenshot of the grid. */
async function swatchPixels(all) {
  const { gridRect, scrollRect } = all;
  const top = Math.max(gridRect.top, scrollRect.top);
  const bottom = Math.min(gridRect.bottom, scrollRect.bottom);
  const clip = { x: gridRect.left, y: top, width: gridRect.width, height: bottom - top };
  const png = decodePng(await page.screenshot({ clip }));
  const out = {};
  for (const key of KEYS) {
    const { centre } = all.swatches[key];
    const x = Math.round(centre.x - clip.x);
    const y = Math.round(centre.y - clip.y);
    out[key] =
      x < 0 || y < 0 || x >= png.width || y >= png.height ? 'off-screen' : png.at(x, y);
  }
  return out;
}

/**
 * The thumb's ink and the track's, off one screenshot of the slider.
 *
 * THE BOX IS READ HERE, NOT CARRIED IN. `readAll` runs before the group is
 * scrolled and the dialog scrolls between the two, so a rect captured there is
 * stale by the time this screenshot is taken -- and a clip at a stale rect
 * lands on the panel beside the control, which reads as the panel on the
 * panel: 1.11:1 in dark and 1.04:1 in light, a number that says "no contrast"
 * about a part that was never in frame. Measured both ways before this line
 * was written.
 *
 * WHERE THE TWO PIXELS ARE. The thumb is `--vam-slider-thumb-px` wide on a
 * track that spans the input, so its centre travels from half a thumb in from
 * the left to half a thumb in from the right as the value goes from min to
 * max -- derived from the value rather than assumed at either end, because
 * this guard reads the slider at 100% and would read the panel through the
 * gap at any other value. The track is sampled on the FAR side of the input
 * from wherever that puts the thumb, at the vertical middle where both are
 * drawn. Measured on the real paint at 180x24: the track pixels are
 * `rgb(176, 176, 176)` (`--vam-ink-faint`) and the thumb's `rgb(237, 237, 237)`
 * (`--vam-ink`), which is what the stylesheet asks for and what a
 * `getComputedStyle` of either pseudo-element could not see.
 */
const SLIDER_THUMB_PX = 14;
async function sliderPixels(slider) {
  // SCROLLED INTO THE SCROLLPORT FIRST, because a control that is not in frame
  // is not painted: `openSettingsOverTerminal` brings the COLOUR grid into
  // view and the opacity block sits below it, so a clip at the slider's
  // reported box landed on the app's ground behind the dialog and read
  // `rgb(26, 26, 26)` in dark, `rgb(251, 250, 249)` in light -- the ground on
  // the ground, 1.11:1 and 1.04:1, a number about nothing. Measured before
  // this line was written.
  await slider.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const rect = await slider.boundingBox();
  const value = Number(await slider.inputValue());
  const min = Number(await slider.getAttribute('min'));
  const max = Number(await slider.getAttribute('max'));
  const fraction = max > min ? (value - min) / (max - min) : 0;
  const png = decodePng(
    await page.screenshot({ clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }),
  );
  const scale = png.width / rect.width;
  const middle = Math.round(png.height / 2);
  const thumbX = SLIDER_THUMB_PX / 2 + fraction * (rect.width - SLIDER_THUMB_PX);
  // The far quarter from the thumb: track at every value this guard sets.
  const trackX = fraction > 0.5 ? rect.width * 0.25 : rect.width * 0.75;
  return {
    thumb: png.at(Math.round(thumbX * scale), middle),
    track: png.at(Math.round(trackX * scale), middle),
  };
}

/** The whole group against one table: value, background, pixel, hex field. */
async function checkGroup(label, all, want) {
  const pixels = await swatchPixels(all);
  const wrong = { value: [], background: [], pixel: [], hex: [] };
  for (const key of KEYS) {
    const s = all.swatches[key];
    if (s.value !== want[key]) wrong.value.push([key, s.value, want[key]]);
    if (s.background !== rgb(want[key])) wrong.background.push([key, s.background, rgb(want[key])]);
    if (pixels[key] !== rgb(want[key])) wrong.pixel.push([key, pixels[key], rgb(want[key])]);
    if (s.hex !== want[key]) wrong.hex.push([key, s.hex, want[key]]);
  }
  check(`${label}: all twenty-three swatches hold the scheme's value`, wrong.value.length === 0, JSON.stringify(wrong.value));
  check(
    `${label}: and compute it as their own background`,
    wrong.background.length === 0,
    JSON.stringify(wrong.background),
  );
  check(
    `${label}: and PAINT it -- the pixel at each disc's centre is the scheme's colour`,
    wrong.pixel.length === 0,
    JSON.stringify(wrong.pixel),
  );
  check(`${label}: every hex field reads the same colour`, wrong.hex.length === 0, JSON.stringify(wrong.hex));
}

/** WCAG, on the parts of the group that carry text or identify a control. */
async function checkContrast(label, all) {
  const dim = [];
  const edges = [];
  for (const key of KEYS) {
    const s = all.swatches[key];
    const hexOnFill = ratio(s.hexInk, s.hexFill);
    const labelOnPanel = ratio(s.labelInk, s.labelGround);
    if (hexOnFill < 4.5) dim.push(`${key} hex ${hexOnFill.toFixed(2)}`);
    if (labelOnPanel < 4.5) dim.push(`${key} label ${labelOnPanel.toFixed(2)}`);
    if (s.ring === null) edges.push(`${key} has no ring`);
    else if (ratio(s.ring.colour, s.ringGround) < 3) {
      edges.push(`${key} ring ${ratio(s.ring.colour, s.ringGround).toFixed(2)}`);
    }
    if (ratio(s.hexEdge, s.labelGround) < 3) edges.push(`${key} hex edge ${ratio(s.hexEdge, s.labelGround).toFixed(2)}`);
  }
  const first = all.swatches[KEYS[0]];
  console.log(
    `  ${label}: hex ink on fill ${ratio(first.hexInk, first.hexFill).toFixed(2)}:1, label on panel ${ratio(first.labelInk, first.labelGround).toFixed(2)}:1, resting ring ${ratio(first.ring.colour, first.ringGround).toFixed(2)}:1, hex edge ${ratio(first.hexEdge, first.labelGround).toFixed(2)}:1`,
  );
  check(`${label}: every hex field and every swatch label clears 4.5:1`, dim.length === 0, dim.join('; '));
  check(`${label}: every swatch ring and hex field edge clears 3:1 on the panel`, edges.length === 0, edges.join('; '));

  const chips = [];
  for (const chip of all.chips) {
    const fill = /^rgb\(\s*\d/.test(chip.fill) ? chip.fill : chip.ground;
    const r = ratio(chip.ink, fill);
    if (r < 4.5) chips.push(`${chip.id} ${r.toFixed(2)}`);
    if (chip.pressed === 'true' && ratio(chip.edge, chip.ground) < 3 && ratio(fill, chip.ground) < 3) {
      chips.push(`${chip.id} pressed edge ${ratio(chip.edge, chip.ground).toFixed(2)} and fill ${ratio(fill, chip.ground).toFixed(2)}`);
    }
  }
  check(`${label}: every theme chip's name clears 4.5:1 on its fill`, chips.length === 0, chips.join('; '));

  const s = all.slider;
  const painted = await sliderPixels(page.locator('[data-terminal-opacity]'));
  console.log(
    `  ${label}: slider thumb ${ratio(painted.thumb, s.ground).toFixed(2)}:1 (${painted.thumb}), track ${ratio(painted.track, s.ground).toFixed(2)}:1 (${painted.track}), printed value ${ratio(s.printedInk, s.ground).toFixed(2)}:1`,
  );
  check(
    `${label}: the slider's thumb and track clear 3:1 on the panel, and its printed value 4.5:1`,
    ratio(painted.thumb, s.ground) >= 3 &&
      ratio(painted.track, s.ground) >= 3 &&
      ratio(s.printedInk, s.ground) >= 4.5,
  );
}

const pressedIn = (all, row) => all.chips.find((c) => c.row === row && c.pressed === 'true')?.id ?? null;

// ── 1: HANS BY DEFAULT, IN DARK ───────────────────────────────────────────
console.log('\n=== dark: the defaults');
await openSettingsOverTerminal({ theme: 'dark' });
let all = await readAll();
check('the document is dark', all.lightClass === false);
check('twelve chips, eight under dark and four under light', all.chips.length === 12 && all.chips.filter((c) => c.row === 'dark').length === 8);
check('Hans is pressed in the dark row and Tango Light in the light row', pressedIn(all, 'dark') === 'hans' && pressedIn(all, 'light') === 'tango-light', JSON.stringify([pressedIn(all, 'dark'), pressedIn(all, 'light')]));
check(
  'the vam chips paint the product name lower case, verbatim',
  all.chips.filter((c) => /^vam\b/i.test(c.text)).every((c) => c.transform === 'none' && c.text.startsWith('vam')) &&
    all.chips.filter((c) => /^vam\b/i.test(c.text)).length === 2,
  JSON.stringify(all.chips.map((c) => [c.text, c.transform])),
);
await checkGroup('dark', all, HANS);
check('no row is marked overridden and none offers a reset', KEYS.every((k) => !all.swatches[k].overridden && !all.swatches[k].reset));
check('and there is no bulk reset to press', all.resetAll === false);
check(
  'the slider is bounded by the model and opaque by default',
  all.slider.min === '0.3' && all.slider.max === '1' && all.slider.step === '0.05' && all.slider.value === '1' && all.slider.printed === '100%',
  JSON.stringify(all.slider),
);
await checkContrast('dark', all);

// ── 2: A CHIP REPAINTS THE OPEN TERMINAL ──────────────────────────────────
console.log('\n=== dark: pressing Dracula');
await page.locator('[data-terminal-theme="dracula"]').click();
await page.waitForTimeout(250);
all = await readAll();
check('Dracula is pressed and Hans is not', pressedIn(all, 'dark') === 'dracula');
check('the light row is untouched', pressedIn(all, 'light') === 'tango-light');
check(
  "the open terminal's ground is Dracula's, behind the dialog and with no reload",
  all.pane.ground === rgb(DRACULA.background),
  all.pane.ground,
);
check("and its red run is Dracula's red", all.pane.red === rgb(DRACULA.red), all.pane.red);
check("the background swatch follows to Dracula's ground", all.swatches.background.value === DRACULA.background && all.swatches.background.background === rgb(DRACULA.background));

// ── 2b: A LIGHT CHIP FROM A DARK DASHBOARD ────────────────────────────────
console.log('\n=== dark: pressing a light chip');
await page.locator('[data-terminal-theme="solarized-light"]').click();
await page.waitForTimeout(250);
all = await readAll();
check('Solarized Light is pressed in the light row', pressedIn(all, 'light') === 'solarized-light');
check('and the dark row still says Dracula', pressedIn(all, 'dark') === 'dracula');
check("the screen on view does not move: it is dark, and still Dracula's ground", all.pane.ground === rgb(DRACULA.background), all.pane.ground);
await page.keyboard.press('Escape');
await page.locator('button[aria-label="switch to light theme"]').first().click();
await page.waitForTimeout(250);
all = await readAll();
check('clicking the sun turns the document light', all.lightClass === true);
check("and the screen wears the light choice, Solarized Light's ground", all.pane.ground === rgb(SOLARIZED_LIGHT_BG), all.pane.ground);

// ── 3: AN OVERRIDE, TYPED ─────────────────────────────────────────────────
console.log('\n=== dark: an override on red');
await openSettingsOverTerminal({ theme: 'dark', terminalScheme: { dark: { theme: 'dracula' } } });
await page.locator('[data-terminal-hex="red"]').fill(PICK);
await page.waitForTimeout(250);
all = await readAll();
let pixels = await swatchPixels(all);
check('the red swatch holds the override', all.swatches.red.value === PICK && all.swatches.red.background === rgb(PICK), JSON.stringify([all.swatches.red.value, all.swatches.red.background]));
check('and paints it', pixels.red === rgb(PICK), pixels.red);
check("the pane's --vam-ansi-red is the override", all.pane.ansiRed === PICK, all.pane.ansiRed);
check('and the red run on the open screen is drawn in it', all.pane.red === rgb(PICK), all.pane.red);
check("the ground is still Dracula's: one colour moved, not the theme", all.pane.ground === rgb(DRACULA.background));
check('only the moved row is marked and offers its reset', all.swatches.red.overridden && all.swatches.red.reset && KEYS.filter((k) => k !== 'red').every((k) => !all.swatches[k].overridden && !all.swatches[k].reset));
check(
  'the moved row wears the 2px ink ring, the rest the 1px faint one -- weight, not hue',
  all.swatches.red.ring?.width === 2 &&
    all.swatches.green.ring?.width === 1 &&
    all.swatches.red.ring.colour !== all.swatches.green.ring.colour &&
    ratio(all.swatches.red.ring.colour, all.swatches.red.ringGround) > ratio(all.swatches.green.ring.colour, all.swatches.green.ringGround),
  JSON.stringify([all.swatches.red.ring, all.swatches.green.ring]),
);
check('and the bulk reset is now offered', all.resetAll === true);

console.log('\n=== dark: reset all');
await page.getByRole('button', { name: 'reset dark terminal colours' }).click();
await page.waitForTimeout(250);
all = await readAll();
pixels = await swatchPixels(all);
check("the red swatch is Dracula's red again, value and pixel", all.swatches.red.value === DRACULA.red && pixels.red === rgb(DRACULA.red), JSON.stringify([all.swatches.red.value, pixels.red]));
check("and so is the pane's red run", all.pane.red === rgb(DRACULA.red), all.pane.red);
check('no row is marked, no reset is drawn, and the bulk reset is gone', KEYS.every((k) => !all.swatches[k].overridden && !all.swatches[k].reset) && all.resetAll === false);

// ── 4: THE SLIDER ─────────────────────────────────────────────────────────
console.log('\n=== dark: the slider');
await drive('[data-terminal-opacity]', '0.5');
all = await readAll();
check('at 0.5 the pane computes the scheme ground at that alpha', all.pane.ground === 'rgba(40, 42, 54, 0.5)', all.pane.ground);
check('and the printed value reads 50%', all.slider.printed === '50%' && all.slider.value === '0.5', JSON.stringify([all.slider.printed, all.slider.value]));

// ── 5: TANGO LIGHT IN LIGHT, AND THE SAME BARS ────────────────────────────
console.log('\n=== light: the defaults');
await openSettingsOverTerminal({ theme: 'light' });
all = await readAll();
check('the document is light', all.lightClass === true);
check('the grid edits light: Tango Light is pressed there', pressedIn(all, 'light') === 'tango-light');
await checkGroup('light', all, TANGO_LIGHT);
await checkContrast('light', all);

// ── 6: THE PICTURE ────────────────────────────────────────────────────────
// A RIG, AND ONLY FOR THE PICTURE. The group is ~1000px tall and the dialog
// is capped at 600, so no scroll position shows all four rows at once. After
// every measurement above, the dialog is let grow for one frame and the
// group is clipped out of it; nothing is asserted on this paint.
console.log('\n=== the picture');
await openSettingsOverTerminal({
  theme: 'dark',
  terminalScheme: { dark: { theme: 'hans', overrides: { red: PICK } } },
});
await page.setViewportSize({ width: 1100, height: 2600 });
const clip = await page.evaluate(() => {
  const dialog = document.querySelector('[data-settings-overlay] > div:not(button)');
  dialog.style.height = 'auto';
  document.querySelector('[data-settings-scroll]').style.overflow = 'visible';
  const boxes = ['terminal-theme-dark', 'terminal-theme-light', 'terminal-colours', 'terminal-background'].map((name) =>
    document.querySelector(`[data-settings-block="${name}"]`).getBoundingClientRect(),
  );
  const top = Math.min(...boxes.map((b) => b.top));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  const left = Math.min(...boxes.map((b) => b.left));
  const right = Math.max(...boxes.map((b) => b.right));
  return { x: left - 16, y: top - 4, width: right - left + 32, height: bottom - top + 8 };
});
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/terminal-settings.png`, clip });
console.log(`${outDir}/terminal-settings.png`);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll terminal settings checks passed.');
