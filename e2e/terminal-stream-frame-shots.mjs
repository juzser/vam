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
 * ── WHAT IS NOT MEASURED, NAMED RATHER THAN SILENTLY SKIPPED ──────────────
 * `backgroundOpacity` under 1: xterm's own canvas/DOM renderer paints an
 * OPAQUE `theme.background`, so the frame's own composited (translucent)
 * background and the screen's opaque one can only be pixel-identical at the
 * shipped default, opacity 1 -- see `docs/design/terminal-streaming.md`'s own
 * comparison table for the gap this guard does not close.
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
 *  writing the whole prefs object back over a live edit). */
async function openTerminal(streaming, theme = 'dark') {
  await page.addInitScript(
    ({ on, appTheme }) => {
      globalThis.localStorage.setItem(
        'vam.prefs.v1',
        JSON.stringify({ streamingTerminal: on, theme: appTheme }),
      );
    },
    { on: streaming, appTheme: theme },
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

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll terminal streaming frame-parity checks passed.');
