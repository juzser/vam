/**
 * THE TERMINAL'S SCHEME, AS PAINT: what the screen's ground, ink, bold ink,
 * caret and selection RESOLVE to in a real engine, in both app themes.
 *
 * ── WHY THIS CANNOT BE A UNIT TEST ────────────────────────────────────────
 * `test/panels/TerminalTab.scheme.test.tsx` holds that the pane carries the
 * twenty-three custom properties and that each span wears the right CLASS.
 * A class is a promise about a stylesheet: `text-term-bold` paints Hans's
 * peach only if Tailwind emitted a rule for it, only if that rule reads
 * `var(--vam-term-bold)` INLINE rather than a value substituted on `:root`,
 * and only if the property set on the pane is the one the rule reads. Each
 * of those has failed silently in this repo before, and none of them is
 * visible to happy-dom, which computes no style. So this file asks Chromium,
 * with `getComputedStyle`, and compares to the values the unit suite pins:
 *
 *   1. THE DEFAULTS ARE HANS IN DARK AND TANGO LIGHT IN LIGHT -- ground,
 *      ink, the caret's pair, the selection's pair (read off `::selection`,
 *      which Chromium exposes to `getComputedStyle`), and the sixteen ANSI
 *      tones, each read off a span the stub painted in that tone.
 *   2. THE BOLD RULE HOLDS ON A REAL PAINT: a bold run with no colour of its
 *      own is drawn in `bold`; a bold run the agent coloured red is drawn in
 *      the scheme's red, not in `bold`.
 *   3. THE SCHEME STOPS AT THE SCREEN'S EDGE. The document root computes no
 *      `--vam-term-*` at all and still computes the STYLESHEET's `--vam-ansi-*`
 *      pair -- Hans's red is on the pane and nowhere else -- and the status
 *      rule under the screen is still drawn in the app's own ink.
 *   4. THE SCHEME FOLLOWS THE THEME WITHOUT A RELOAD, by both paths that
 *      exist: the operator's own click on the sidebar's sun (a prefs write,
 *      so `activatePrefs`), and the OS flipping under `system` (no write at
 *      all -- only `Canvas.tsx`'s theme effect hears it, driven here with
 *      Playwright's `emulateMedia`). The second is the one a reload-only
 *      check cannot fail on, for the reason `terminal-chrome-shots.mjs`
 *      gives for its own live block.
 *   5. THE OPACITY REALLY THINS THE GROUND: at 0.5 the pane's computed
 *      background is an `rgba` with that alpha, over a parent that is opaque.
 *
 * ── THE BRIDGE IS A STUB ──────────────────────────────────────────────────
 * Injected with `page.addInitScript`, exactly as `terminal-chrome-shots.mjs`
 * does and for the reason recorded there: defining `window.api` takes
 * `App.tsx` off the `?demo=1` fixture and onto the preload source, so the stub
 * has to be a complete `PreloadSourceApi`. Every string in it is invented.
 *
 * Falsified by hand, each alone, against a real build:
 *   - change one Hans hex in `terminal-scheme.ts` -> the matching dark check
 *     reddens (and the unit pin does too).
 *   - drop the scheme's inline style off the pane (`...terminalSchemeStyle`)
 *     -> every dark and light colour check reddens at once.
 *   - make `spanClasses` emit `text-term-bold` for every bold run -> the
 *     `bold red stays red` check reddens.
 *   - take `setActiveTerminalScheme` out of `Canvas.tsx`'s theme effect ->
 *     the `emulateMedia` block reddens while the sun-click block stays green.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/terminal-scheme-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'atlas-scheme';
const BRANCH = 'work/atlas-scheme';
/** The escape byte itself, spelled rather than typed -- as `terminal-ansi.ts` does. */
const ESC = '\u001b';

/**
 * The two defaults, spelled here because a browser script cannot import from
 * `src/`; `test/prefs/terminal-scheme.test.ts` pins both tables digit for
 * digit against the source, which is what holds the two copies together.
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
/** The stylesheet's own dark red, which the ROOT must still compute: the
 *  scheme's red belongs to the pane. Read off `styles.css` `:root`. */
const STYLESHEET_DARK_RED = '#f87171';

/** SGR code -> the scheme key a span in that tone should resolve to. */
const TONES = [
  [30, 'black'],
  [31, 'red'],
  [32, 'green'],
  [33, 'yellow'],
  [34, 'blue'],
  [35, 'magenta'],
  [36, 'cyan'],
  [37, 'white'],
  [90, 'brightBlack'],
  [91, 'brightRed'],
  [92, 'brightGreen'],
  [93, 'brightYellow'],
  [94, 'brightBlue'],
  [95, 'brightMagenta'],
  [96, 'brightCyan'],
  [97, 'brightWhite'],
];

/**
 * The screen the stub answers with. Line 0 carries the caret at column 2;
 * line 1 the two bold cases; lines 2 and 3 the sixteen tones, one word each,
 * named by the key so the reader below can find them by text -- eight to a
 * line so the committed picture shows all of them at the pane's width.
 */
const tone = ([code, key]) => `${ESC}[${code}m${key}${ESC}[0m`;
const SCREEN = [
  '$ vam --scheme',
  `${ESC}[1mBOLDDEFAULT${ESC}[0m ${ESC}[1;31mBOLDRED${ESC}[0m plain`,
  TONES.slice(0, 8).map(tone).join(' '),
  TONES.slice(8).map(tone).join(' '),
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

const browser = await chromium.launch();
// Short on purpose: nothing here scrolls, and the two committed pictures are
// clipped to the tab, so the height is what decides how much empty screen
// they carry under six lines of content.
const page = await browser.newPage({ viewport: { width: 1100, height: 420 } });
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
          name: 'vam-atlas-scheme-a1b2c3',
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
 * Put a prefs payload in the store and open the Terminal tab on it. An init
 * script rather than an `evaluate` + `reload`, for the race
 * `terminal-chrome-shots.mjs` records: init scripts stack in registration
 * order, so the last one registered is the payload in force.
 */
async function openTerminal(prefs) {
  await page.addInitScript((payload) => {
    globalThis.localStorage.setItem('vam.prefs.v1', JSON.stringify(payload));
  }, prefs);
  await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator(`[data-session-row="${SESSION}"]`).first().click();
  await page.locator('[data-view="terminal"]').click();
  await page.waitForSelector('[data-terminal-cursor]', { timeout: 5_000 });
  await page.waitForTimeout(200);
}

/** Everything the engine resolved, off the nodes that carry it. */
const readPaint = () =>
  page.evaluate(() => {
    const pane = document.querySelector('[data-terminal-pane]');
    const spans = [...pane.querySelectorAll('pre span')];
    const byText = (text) => spans.find((el) => el.textContent === text) ?? null;
    const colourOf = (text) => {
      const el = byText(text);
      return el === null ? null : getComputedStyle(el).color;
    };
    const cursor = pane.querySelector('[data-terminal-cursor]');
    const selection = getComputedStyle(pane.querySelector('pre'), '::selection');
    const root = getComputedStyle(document.documentElement);
    const status = document.querySelector('[data-terminal-status]');
    const tones = {};
    for (const key of [
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite',
    ]) {
      tones[key] = colourOf(key);
    }
    // The nearest ancestor that paints an opaque fill: what a thinned ground
    // is composited over. The immediate parent is `OverlayScroll`'s wrapper,
    // which paints nothing, so the walk is what finds the pane surface.
    let behind = pane.parentElement;
    while (behind !== null && !/^rgb\(\s*\d/.test(getComputedStyle(behind).backgroundColor)) {
      behind = behind.parentElement;
    }
    return {
      ground: getComputedStyle(pane).backgroundColor,
      parentGround: behind === null ? null : getComputedStyle(behind).backgroundColor,
      ink: getComputedStyle(pane).color,
      boldDefault: colourOf('BOLDDEFAULT'),
      boldRed: colourOf('BOLDRED'),
      plain: colourOf(' plain'),
      cursorGround: cursor === null ? null : getComputedStyle(cursor).backgroundColor,
      cursorInk: cursor === null ? null : getComputedStyle(cursor).color,
      cursorText: cursor === null ? null : cursor.textContent,
      selectionGround: selection.backgroundColor,
      selectionInk: selection.color,
      tones,
      rootTermBg: root.getPropertyValue('--vam-term-bg'),
      rootTermFg: root.getPropertyValue('--vam-term-fg'),
      rootAnsiRed: root.getPropertyValue('--vam-ansi-red').trim(),
      statusInk: status === null ? null : getComputedStyle(status).color,
      lightClass: document.documentElement.classList.contains('light'),
      rect: document.querySelector('[data-terminal]').getBoundingClientRect().toJSON(),
    };
  });

/** Every colour the scheme decides, against one table. */
function checkScheme(label, paint, want) {
  check(`${label}: the ground is the scheme's background`, paint.ground === rgb(want.background), paint.ground);
  check(`${label}: the default ink is the scheme's foreground`, paint.ink === rgb(want.foreground), paint.ink);
  check(
    `${label}: a plain run inherits that ink`,
    paint.plain === rgb(want.foreground),
    paint.plain,
  );
  check(
    `${label}: a bold run with no colour of its own is drawn in the bold ink`,
    paint.boldDefault === rgb(want.bold),
    `${paint.boldDefault} vs ${rgb(want.bold)}`,
  );
  check(
    `${label}: a bold run the agent coloured red stays red`,
    paint.boldRed === rgb(want.red),
    `${paint.boldRed} vs ${rgb(want.red)}`,
  );
  check(
    `${label}: the caret paints cursor under cursorAccent, on the cell tmux named`,
    paint.cursorText === 'v' &&
      paint.cursorGround === rgb(want.cursor) &&
      paint.cursorInk === rgb(want.cursorAccent),
    JSON.stringify([paint.cursorText, paint.cursorGround, paint.cursorInk]),
  );
  check(
    `${label}: a selection inside the screen paints the scheme's pair`,
    paint.selectionGround === rgb(want.selectionBackground) &&
      paint.selectionInk === rgb(want.selectionForeground),
    JSON.stringify([paint.selectionGround, paint.selectionInk]),
  );
  const wrong = Object.entries(paint.tones).filter(([key, got]) => got !== rgb(want[key]));
  check(
    `${label}: all sixteen ANSI tones resolve to the scheme's`,
    wrong.length === 0,
    JSON.stringify(wrong.map(([key, got]) => [key, got, rgb(want[key])])),
  );
}

/** The scheme stops at the screen. */
function checkScope(label, paint, want) {
  check(
    `${label}: the document root computes no --vam-term-* at all`,
    paint.rootTermBg === '' && paint.rootTermFg === '',
    JSON.stringify([paint.rootTermBg, paint.rootTermFg]),
  );
  check(
    `${label}: the root still computes the stylesheet's own ANSI red, not the scheme's`,
    paint.rootAnsiRed !== want.red && (label.startsWith('dark') ? paint.rootAnsiRed === STYLESHEET_DARK_RED : true),
    `root --vam-ansi-red is ${paint.rootAnsiRed}`,
  );
  check(
    `${label}: the status rule under the screen is still drawn in the app's ink, not the scheme's`,
    paint.statusInk !== null && paint.statusInk !== rgb(want.foreground),
    paint.statusInk,
  );
}

// ── 1 + 2 + 3: EACH DEFAULT, ON A FRESH LOAD ──────────────────────────────
const dark = (await openTerminal({ theme: 'dark' }), await readPaint());
console.log('\n=== dark');
check('dark: the document is dark', dark.lightClass === false);
checkScheme('dark', dark, HANS);
checkScope('dark', dark, HANS);
await page.screenshot({
  path: `${outDir}/terminal-scheme-hans.png`,
  clip: dark.rect,
});
console.log(`${outDir}/terminal-scheme-hans.png`);

const light = (await openTerminal({ theme: 'light' }), await readPaint());
console.log('\n=== light');
check('light: the document is light', light.lightClass === true);
checkScheme('light', light, TANGO_LIGHT);
checkScope('light', light, TANGO_LIGHT);
await page.screenshot({
  path: `${outDir}/terminal-scheme-tango-light.png`,
  clip: light.rect,
});
console.log(`${outDir}/terminal-scheme-tango-light.png`);

// ── 4a: THE OPERATOR'S OWN CLICK, WITH NO RELOAD ─────────────────────────
console.log('\n=== live: the sun in the sidebar');
await openTerminal({ theme: 'dark' });
await page.locator('button[aria-label="switch to light theme"]').first().click();
await page.waitForTimeout(200);
const clicked = await readPaint();
check('clicking the sun turns the document light', clicked.lightClass === true);
check(
  'and the open screen turns Tango Light without a reload',
  clicked.ground === rgb(TANGO_LIGHT.background) && clicked.boldDefault === rgb(TANGO_LIGHT.bold),
  JSON.stringify([clicked.ground, clicked.boldDefault]),
);

// ── 4b: THE OS FLIPPING UNDER `system`, WHICH WRITES NOTHING ─────────────
// THIS BLOCK EXISTS BECAUSE EVERYTHING ABOVE PASSES WITHOUT THE CANVAS
// WIRING. A fresh load and a click both go through `activatePrefs`; the OS
// changing its mind goes through `Canvas.tsx`'s theme effect and nothing
// else. Take that one call out and the sun-click block stays green while
// this one reddens.
console.log('\n=== live: the OS under system');
await page.emulateMedia({ colorScheme: 'dark' });
await openTerminal({ theme: 'system' });
const systemDark = await readPaint();
check('system on a dark OS opens on Hans', systemDark.ground === rgb(HANS.background), systemDark.ground);
await page.emulateMedia({ colorScheme: 'light' });
await page.waitForTimeout(200);
const systemLight = await readPaint();
check('the OS flipping to light turns the document light', systemLight.lightClass === true);
check(
  'and the open screen follows it to Tango Light, with nothing written',
  systemLight.ground === rgb(TANGO_LIGHT.background) &&
    systemLight.cursorGround === rgb(TANGO_LIGHT.cursor),
  JSON.stringify([systemLight.ground, systemLight.cursorGround]),
);
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(200);
const systemBack = await readPaint();
check('and back to Hans when the OS goes dark again', systemBack.ground === rgb(HANS.background), systemBack.ground);
await page.emulateMedia({ colorScheme: null });

// ── 5: THE OPACITY ────────────────────────────────────────────────────────
console.log('\n=== opacity');
await openTerminal({ theme: 'dark', terminalScheme: { backgroundOpacity: 0.5 } });
const thin = await readPaint();
check(
  'at 0.5 the ground is the scheme background at that alpha',
  thin.ground === 'rgba(30, 31, 41, 0.5)',
  thin.ground,
);
check(
  'over a parent that paints an opaque ground of its own, so there is something to see through to',
  /^rgb\(\s*\d/.test(thin.parentGround),
  thin.parentGround,
);
check(
  'and the ink is untouched by it',
  thin.ink === rgb(HANS.foreground) && thin.boldDefault === rgb(HANS.bold),
  JSON.stringify([thin.ink, thin.boldDefault]),
);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll terminal scheme checks passed.');
