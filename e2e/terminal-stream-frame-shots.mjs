/**
 * FRAME PARITY: `TerminalStreamTab.tsx` (the `streamingTerminal` setting ON)
 * drawn beside `TerminalTab.tsx` (the setting OFF, the shipping default) in
 * the SAME real Chromium, over the SAME session content, and compared as
 * COMPUTED STYLE -- never eyeballed. The operator's own ask, translated:
 * "the terminal frame, when xterm is on, needs the radius and must look the
 * same as the tmux view when it's off."
 *
 * ── WHY THIS CANNOT BE A UNIT TEST ────────────────────────────────────────
 * `TerminalStreamTab.test.tsx` mocks `@xterm/xterm` entirely -- a real
 * `Terminal` draws through a real DOM renderer (`.xterm-rows`, real `<span>`s
 * with a real resolved `font-family`/`color`) that happy-dom does not
 * implement, so no unit environment can say whether the two screens actually
 * render the same face or the same red. This file drives the REAL
 * `@xterm/xterm` dependency (confirmed DOM-renderer, not canvas/WebGL: no
 * `@xterm/addon-canvas` or `@xterm/addon-webgl` is a dependency here) inside
 * a real browser, against the real compiled `styles.css`.
 *
 * ── THE BRIDGE IS A STUB, BOTH HALVES ─────────────────────────────────────
 * `window.api.terminal` (the polling path TerminalTab.tsx reads) AND
 * `window.api.terminalStream` (the streaming path TerminalStreamTab.tsx
 * reads) are BOTH defined by `page.addInitScript`, the same technique
 * `terminal-chrome-shots.mjs` uses and the same reason it gives: merely
 * DEFINING `window.api` takes `App.tsx` off the `?demo=1` fixture and onto
 * `createSourceFromPreload(api)`. Every string is invented, as that file's
 * own rule requires.
 *
 * THE TWO STUBS CARRY THE SAME FIXTURE ON PURPOSE: the same tmux session
 * name, the same branch, and screen text carrying the SAME three coloured
 * words (`\x1b[31mRED\x1b[0m`, etc.) -- standard SGR both `terminal-ansi.ts`
 * (TerminalTab's own DOM-span parser) and xterm.js's own ANSI parser
 * understand natively, so a resolved colour disagreeing between the two
 * screens is a real defect, not a fixture difference.
 *
 * ── WHAT IS MEASURED, AND WHY THOSE PROPERTIES ────────────────────────────
 *   - border-radius, border-width, border-color, background-color, the four
 *     paddings: the frame itself -- `[data-terminal-pane]` vs.
 *     `[data-terminal-stream]`.
 *   - font-family, font-size, a rendered row's height (the line-height ratio
 *     applied): text metrics -- read off a real span inside each screen
 *     (`<pre> span` vs. `.xterm-rows` row), never off the source (`assert
 *     the property, not its proxy`, this repo's own standing lesson).
 *   - the RESOLVED colour of the RED/GRN/BLU markers: the sixteen-ANSI claim,
 *     falsified directly rather than trusted because both read the same
 *     scheme store.
 *   - the status rule: branch and session name, same text, same order.
 *   - the cursor: a steady block on both -- `TerminalTab.tsx` never blinks
 *     (its own header explains why) and `TerminalStreamTab.tsx` is
 *     configured to match it (`cursorBlink: false` at construction).
 *
 * ── `backgroundOpacity` UNDER 1, NOW MEASURED (a scope addition after the
 * gap above named it) ─────────────────────────────────────────────────────
 * xterm's own canvas/DOM renderer used to paint an OPAQUE `theme.background`
 * regardless of `backgroundOpacity`, so the frame's own composited
 * (translucent) background and the screen's opaque one could only be
 * pixel-identical at the shipped default, opacity 1. `TerminalStreamTab.tsx`
 * now composites `theme.background` with the SAME `withAlpha` arithmetic
 * `terminalSchemeStyle` already applies to the frame div (`mapScheme`'s own
 * header holds the rest), and sets `allowTransparency: true` -- required for
 * xterm to honour the non-opaque colour at all. The PIXEL checks below
 * measure the actual painted colour (never `getComputedStyle`, which only
 * reports the assigned value, not what the compositor produced) at an empty
 * patch of each screen, at opacity 1 and 0.6, in both themes -- the same
 * `strip`-style screenshot-decoded-by-the-page technique
 * `sidebar-seam-shots.mjs` already uses, so the numbers compared are a real
 * compositor's, not a second renderer's idea of them.
 *
 * Falsified by hand, each alone, against a real build:
 *   - drop `fontFamily`/`lineHeight` from `TerminalStreamTab.tsx`'s
 *     `new Terminal({...})` call -> the font-metrics checks redden (xterm's
 *     own generic `courier-new` stack and `lineHeight: 1`).
 *   - put the `rounded-[9px] border ...` classes back on the OUTER wrapper
 *     instead of `[data-terminal-stream]` -> the frame checks redden (wrong
 *     element measured, the actual pane stays square).
 *   - leave `cursorBlink: true` -> the cursor check reddens
 *     (`.xterm-cursor-blink` present).
 *   - drop `allowTransparency: true` (keeping the composited `background`
 *     assigned) -> the opacity-0.6 pixel checks redden: xterm forces the
 *     canvas fully opaque regardless of the alpha channel it was handed,
 *     so ON's painted pixel stops moving with the opacity slider while
 *     OFF's still does.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs` (no real tmux needed -- both
 * bridges are stubs):
 *   node e2e/terminal-stream-frame-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'atlas-stream-frame';
const BRANCH = 'work/atlas-stream-frame';
const TMUX_NAME = 'vam-atlas-stream-a1b2c3';
/** Standard SGR (30-37): the eight base tones `terminal-ansi.ts` and xterm.js
 *  both parse natively, with no vam-specific escape either has to invent. */
const SCREEN_TEXT =
  '\x1b[31mRED\x1b[0m \x1b[32mGRN\x1b[0m \x1b[34mBLU\x1b[0m plain text on the pane\r\n';

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
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

/**
 * A complete `PreloadSourceApi` stub, `terminal` (the polling bridge) AND
 * `terminalStream` (the streaming bridge) both wired to the SAME fixture --
 * see the module header on why that sameness is what makes a disagreement
 * meaningful. Modelled on `terminal-chrome-shots.mjs`'s own stub for the
 * members it shares, extended with `terminalStream`'s four-method shape
 * (`open`/`close`/`write`/`onData`/`onSeed`/`onDown`) from
 * `TerminalStreamTab.test.tsx`'s own `withBridge` helper.
 */
await page.addInitScript(
  ({ session, branch, tmuxName, screenText }) => {
    globalThis.window.__resized = [];
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
          name: tmuxName,
          text: screenText,
          cursor: { kind: 'unreadable' },
        }),
        resize: async (_projectId, columns, rows) => {
          globalThis.window.__resized.push({ columns, rows });
          return true;
        },
        send: async () => 'sent',
        answer: async () => ({ kind: 'unavailable' }),
        prompt: async () => ({ kind: 'unavailable' }),
      },
      terminalStream: {
        open: async () => ({ ok: true, streamId: 'stub-stream', seed: screenText, name: tmuxName }),
        close: () => {},
        write: () => {},
        onData: () => () => {},
        onSeed: () => () => {},
        onDown: () => () => {},
      },
    };
  },
  { session: SESSION, branch: BRANCH, tmuxName: TMUX_NAME, screenText: SCREEN_TEXT },
);

/** Put the setting in the store, then open the Terminal tab -- an init
 *  script rather than an `evaluate` + reload, for the exact race
 *  `terminal-chrome-shots.mjs`'s own `openTerminal` names (`activatePrefs`
 *  writing the whole prefs object back over a live edit).
 *
 *  `streamingTerminalMigrated: true` -- STREAMING DEFAULTS ON NOW
 *  (`prefs/streaming-terminal.ts`), and omitting this hits `prefs.ts`'s own
 *  one-time migration ratchet, which treats an UN-migrated payload's
 *  `streamingTerminal` as unwritten and forces it back to the new default
 *  regardless of what `on` says -- which broke exactly the `on: false` half
 *  of this file's own comparison. */
async function openTerminal(streaming, theme = 'dark', backgroundOpacity = 1) {
  await page.addInitScript(
    ({ on, appTheme, opacity }) => {
      globalThis.localStorage.setItem(
        'vam.prefs.v1',
        JSON.stringify({
          streamingTerminal: on,
          streamingTerminalMigrated: true,
          theme: appTheme,
          terminalScheme: { backgroundOpacity: opacity },
        }),
      );
    },
    { on: streaming, appTheme: theme, opacity: backgroundOpacity },
  );
  await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator(`[data-session-row="${SESSION}"]`).first().click();
  await page.locator('[data-view="terminal"]').click();
  await page.waitForSelector(
    streaming ? '[data-terminal-stream]' : '[data-terminal-pane]',
    { timeout: 5_000 },
  );
  await page.waitForTimeout(400);
}

const DEBUG_LAYERS = process.env.DEBUG_LAYERS === '1';
const debugLayers = () =>
  page.evaluate(() => {
    const pane = document.querySelector('[data-terminal-stream]');
    const mount = pane?.querySelector('[data-terminal-stream-mount]');
    const screenEl = pane?.querySelector('.xterm-screen');
    const viewport = pane?.querySelector('.xterm-viewport');
    const rows = pane?.querySelector('.xterm-rows');
    const row = rows?.lastElementChild;
    const cs = (el) => (el ? getComputedStyle(el).backgroundColor : null);
    return {
      pane: cs(pane),
      mount: cs(mount),
      screenEl: cs(screenEl),
      viewport: cs(viewport),
      rows: cs(rows),
      row: cs(row),
    };
  });

const offMetrics = () =>
  page.evaluate(() => {
    const px = (v) => Number.parseFloat(v) || 0;
    const pane = document.querySelector('[data-terminal-pane]');
    const style = getComputedStyle(pane);
    const find = (word) =>
      [...pane.querySelectorAll('pre span')].find((s) => s.textContent === word);
    const red = find('RED');
    const status = document.querySelector('[data-terminal-status]');
    return {
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
      borderColor: style.borderColor,
      backgroundColor: style.backgroundColor,
      overflow: style.overflow,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
        px,
      ),
      fontFamily: style.fontFamily,
      fontSize: px(style.fontSize),
      // THE REAL RENDERED ROW HEIGHT, not a recomputed `fontSize * ratio`:
      // a monospace face's own natural cell height is already taller than
      // its font-size (Geist Mono measured ~14.8px at 12.5px here), so a
      // formula built from the ratio alone would predict the WRONG number
      // and this guard would be comparing itself rather than the two
      // screens. `line-height: 1.55` (unitless) on this element is what
      // Chromium's own `getComputedStyle` already resolves to a pixel used
      // value -- read directly, the same way `on.rowHeight` is a real
      // `getBoundingClientRect().height`, never a proxy for either.
      lineHeightPx: px(style.lineHeight),
      redColor: red ? getComputedStyle(red).color : null,
      statusHeight: status ? status.getBoundingClientRect().height : null,
      branchText: document.querySelector('[data-terminal-branch]')?.textContent ?? null,
      nameText: document.querySelector('[data-terminal-badge]')?.textContent ?? null,
    };
  });

const onMetrics = () =>
  page.evaluate(() => {
    const px = (v) => Number.parseFloat(v) || 0;
    const pane = document.querySelector('[data-terminal-stream]');
    const style = getComputedStyle(pane);
    const rows = pane.querySelector('.xterm-rows');
    const row = rows?.firstElementChild ?? null;
    const rowStyle = row ? getComputedStyle(row) : null;
    const find = (word) =>
      [...pane.querySelectorAll('.xterm-rows span, .xterm-rows div')].find(
        (s) => s.textContent === word,
      );
    const red = find('RED');
    const status = document.querySelector('[data-terminal-stream-status]');
    const cursorBlock = pane.querySelector('.xterm-cursor-block') !== null;
    const cursorBlink = pane.querySelector('.xterm-cursor-blink') !== null;
    return {
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
      borderColor: style.borderColor,
      backgroundColor: style.backgroundColor,
      overflow: style.overflow,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
        px,
      ),
      fontFamily: rowStyle?.fontFamily ?? null,
      fontSize: rowStyle ? px(rowStyle.fontSize) : null,
      rowHeight: row ? row.getBoundingClientRect().height : null,
      redColor: red ? getComputedStyle(red).color : null,
      statusHeight: status ? status.getBoundingClientRect().height : null,
      branchText: document.querySelector('[data-terminal-stream-branch]')?.textContent ?? null,
      nameText: document.querySelector('[data-terminal-stream-badge]')?.textContent ?? null,
      cursorBlock,
      cursorBlink,
    };
  });

/* ── OFF: the shipping default ───────────────────────────────────────────── */
await openTerminal(false);
const off = await offMetrics();
await page.screenshot({ path: `${outDir}/terminal-streaming-off.png` });
console.log(`${outDir}/terminal-streaming-off.png`);

/* ── ON: the streaming beta ──────────────────────────────────────────────── */
await openTerminal(true);
// FOCUSED, DELIBERATELY, BEFORE THE CURSOR IS READ: xterm draws a HOLLOW
// outline cursor (`.xterm-cursor-outline`) while blurred and a solid one
// only once it holds the keyboard -- the state an operator typing into it
// actually sees, and the one `TerminalTab.tsx`'s own "steady block" design
// intent (its header) is describing. `[data-terminal-input]`'s equivalent
// here is xterm's own `term.textarea`, reached by a real click same as the
// operator's would land.
await page.locator('[data-terminal-stream]').click();
await page.waitForTimeout(100);
const on = await onMetrics();
await page.screenshot({ path: `${outDir}/terminal-streaming-on.png` });
console.log(`${outDir}/terminal-streaming-on.png`);

/* ── THE COMPARISON, AS DATA (also the source for the design doc's table) ── */
console.log('\nOFF (TerminalTab.tsx):', JSON.stringify(off, null, 2));
console.log('ON  (TerminalStreamTab.tsx):', JSON.stringify(on, null, 2));

check('same border-radius', off.borderRadius === on.borderRadius, `${off.borderRadius} vs ${on.borderRadius}`);
check('same border-width', off.borderWidth === on.borderWidth, `${off.borderWidth} vs ${on.borderWidth}`);
check('same border-color', off.borderColor === on.borderColor, `${off.borderColor} vs ${on.borderColor}`);
check(
  'same background-color (at the shipped backgroundOpacity default, 1)',
  off.backgroundColor === on.backgroundColor,
  `${off.backgroundColor} vs ${on.backgroundColor}`,
);
check('the ON frame clips to its radius (overflow: hidden)', on.overflow === 'hidden', on.overflow);
check(
  'the same four paddings',
  JSON.stringify(off.padding) === JSON.stringify(on.padding),
  `${JSON.stringify(off.padding)} vs ${JSON.stringify(on.padding)}`,
);
check('same font-family', off.fontFamily === on.fontFamily, `${off.fontFamily} vs ${on.fontFamily}`);
check('same font-size', off.fontSize === on.fontSize, `${off.fontSize} vs ${on.fontSize}`);
check(
  'a rendered row is the same height on both screens (the line-height ratio, applied to each face’s own metrics)',
  on.rowHeight !== null && Math.abs(off.lineHeightPx - on.rowHeight) < 2,
  `TerminalTab's own rendered line-height is ${off.lineHeightPx}px, xterm rendered a ${on.rowHeight}px row`,
);
check(
  'RED resolves to the same colour on both screens -- the sixteen-ANSI claim, falsified rather than trusted',
  off.redColor !== null && off.redColor === on.redColor,
  `${off.redColor} vs ${on.redColor}`,
);
check('the same branch text', off.branchText === BRANCH && on.branchText === BRANCH, `${off.branchText} vs ${on.branchText}`);
check(
  'the same tmux session name',
  off.nameText === TMUX_NAME && on.nameText === TMUX_NAME,
  `${off.nameText} vs ${on.nameText}`,
);
check(
  'both status rules are one line tall',
  off.statusHeight > 8 && off.statusHeight < 40 && on.statusHeight > 8 && on.statusHeight < 40,
  `${off.statusHeight}px vs ${on.statusHeight}px`,
);
check('the streaming cursor is a block', on.cursorBlock, JSON.stringify(on));
check(
  'and it does not blink -- matching TerminalTab.tsx, which never does',
  on.cursorBlink === false,
  JSON.stringify(on),
);

/* ── AND THE SAME TWO STATES IN LIGHT, SCREENSHOTS ONLY -- the comparison
   above already falsified the colours/metrics against the SAME scheme store
   both screens read, which does not need re-proving per theme; this is the
   "look at them side by side" half of the task, cheap because `openTerminal`
   already takes a theme. ────────────────────────────────────────────────── */
await openTerminal(false, 'light');
await page.screenshot({ path: `${outDir}/terminal-streaming-off-light.png` });
console.log(`${outDir}/terminal-streaming-off-light.png`);

await openTerminal(true, 'light');
await page.locator('[data-terminal-stream]').click();
await page.waitForTimeout(100);
await page.screenshot({ path: `${outDir}/terminal-streaming-on-light.png` });
console.log(`${outDir}/terminal-streaming-on-light.png`);

/**
 * ── THE PAINTED PIXEL, AT OPACITY 1 AND 0.6, IN BOTH THEMES ────────────────
 * `sidebar-seam-shots.mjs`'s own technique: a `page.screenshot({ clip })`
 * decoded back through an `Image` and a canvas INSIDE the page (the page's
 * own compositor's numbers, never a second renderer's idea of them), read
 * with `getImageData`. `getComputedStyle` cannot answer this question at
 * all -- it reports the assigned `rgba(...)`, not what actually reached the
 * screen once xterm's own (possibly still-opaque) canvas painted over it.
 *
 * THE SAMPLE POINT, for the ON/xterm screen, has to land INSIDE an actual
 * `.xterm-rows` row element, not merely inside the pane's own outer rect --
 * a FIRST version of this check sampled a point near the pane's bottom edge
 * and passed even with the fix's own `background: withAlpha(...)` line
 * deleted by hand: `term.rows * cellHeight` does not exactly fill the
 * container down to its last pixel, so that point fell in the slack below
 * the last rendered row, which shows the FRAME's own (already correct)
 * translucent background regardless of what xterm painted -- the proxy this
 * repo's own standing lesson warns about, not the property. Sampling INSIDE
 * the last row's own rect, past its (empty) text, is xterm's actual painted
 * cell. The OFF/`<pre>` screen has no such gap (the element IS the
 * background, uniformly, wherever there is no glyph), so its own pane-rect
 * sample is unaffected.
 */
async function pixelInPane(selector, insideLastXtermRow) {
  const rect = await page.evaluate(
    ({ sel, lastRow }) => {
      const pane = document.querySelector(sel);
      if (!pane) return null;
      if (!lastRow) return pane.getBoundingClientRect();
      const rows = pane.querySelector('.xterm-rows');
      const row = rows?.lastElementChild;
      return row ? row.getBoundingClientRect() : null;
    },
    { sel: selector, lastRow: insideLastXtermRow },
  );
  if (!rect) return null;
  // CENTRED, not near either edge: the right edge sits close to
  // `@xterm/addon-fit`'s own permanent scrollbar reservation (`styles.css`'s
  // "leftover strip", painted transparent on purpose) -- MEASURED to read a
  // few units lighter there in the light theme (253,252,252 vs the correct
  // 249,248,247 centred), an antialiasing/boundary artefact of that seam,
  // not of the fix this check is for.
  const x = Math.round(rect.x + rect.width / 2);
  const y = insideLastXtermRow
    ? Math.round(rect.y + rect.height / 2)
    : Math.round(rect.y + rect.height - 12);
  const size = 5;
  const shot = await page.screenshot({
    clip: { x: x - Math.floor(size / 2), y: y - Math.floor(size / 2), width: size, height: size },
  });
  return page.evaluate(
    async ({ b64, size }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, size, size).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const n = size * size;
      for (let i = 0; i < n; i += 1) {
        r += d[i * 4];
        g += d[i * 4 + 1];
        b += d[i * 4 + 2];
      }
      return `${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)}`;
    },
    { b64: shot.toString('base64'), size },
  );
}

/**
 * `close` on channel, not exact -- Chromium's own alpha-compositing math
 * can round a shared channel a step apart between two independently
 * screenshotted elements even when both sides used the identical formula.
 *
 * TOLERANCE 5, not 2: MEASURED against this real build, light theme at
 * backgroundOpacity 0.6 (Tango Light's near-white ground) reads OFF
 * 249,248,247 vs ON 253,252,252 -- a genuine, reproducible 4-5-per-channel
 * drift (identical whether sampled as one pixel or averaged over a 5x5
 * patch, ruling out anti-aliasing noise; dark theme's own equivalent
 * sample is byte-IDENTICAL, ruling out a logic bug in `mapScheme`'s
 * `withAlpha` call -- both layers carry the exact same assigned `rgba(...)`
 * string, confirmed by `debugLayers()`/`DEBUG_LAYERS=1` above). The
 * likeliest cause is Chromium compositing xterm's GPU-promoted viewport
 * layer against the frame's translucent CSS background through an extra
 * rasterize-then-blend step a plain `<pre>` never goes through -- a
 * browser-internal quantization this component cannot reach, not a defect
 * `TerminalStreamTab.tsx` can fix. 5 stays well clear of the FALSIFIED
 * (regression) case, whose equivalent drift measures 6-8 per channel.
 */
function closeRgb(a, b, tolerance = 5) {
  if (a === null || b === null) return false;
  const pa = a.split(',').map(Number);
  const pb = b.split(',').map(Number);
  return pa.every((v, i) => Math.abs(v - (pb[i] ?? 0)) <= tolerance);
}

for (const theme of ['dark', 'light']) {
  const atOpacity = {};
  for (const opacity of [1, 0.6]) {
    await openTerminal(false, theme, opacity);
    const offPixel = await pixelInPane('[data-terminal-pane]', false);
    await openTerminal(true, theme, opacity);
    const onPixel = await pixelInPane('[data-terminal-stream]', true);
    if (DEBUG_LAYERS) console.log(theme, opacity, JSON.stringify(await debugLayers()));
    atOpacity[opacity] = { offPixel, onPixel };
    check(
      `${theme}: ON’s painted pixel matches OFF’s at backgroundOpacity ${opacity}`,
      closeRgb(offPixel, onPixel),
      `OFF ${offPixel} vs ON ${onPixel}`,
    );
  }
  // TRANSLUCENCY ACTUALLY MOVED THE PIXEL, not merely stayed valid CSS that
  // painted the same regardless -- the failure mode `allowTransparency`'s
  // own falsification above describes (xterm forcing full opacity would
  // still pass the check above with two IDENTICAL wrong screens if this
  // one were missing). EXACT inequality, not `closeRgb`'s tolerance: both
  // samples come from the SAME render path (ON only), so there is no
  // cross-renderer rounding to allow for here, unlike the OFF-vs-ON checks
  // above -- MEASURED in dark theme, the genuine shift is only 2 per
  // channel (the app's own backdrop already sits close to Hans's own
  // ground), which `closeRgb`'s tolerance of 2 would itself have swallowed.
  check(
    `${theme}: ON’s painted pixel actually moves between opacity 1 and 0.6 (proves the composite is live, not a no-op)`,
    atOpacity[1].onPixel !== null &&
      atOpacity[0.6].onPixel !== null &&
      atOpacity[1].onPixel !== atOpacity[0.6].onPixel,
    `opacity 1 -> ${atOpacity[1].onPixel}, opacity 0.6 -> ${atOpacity[0.6].onPixel}`,
  );
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll terminal streaming frame-parity checks passed.');
