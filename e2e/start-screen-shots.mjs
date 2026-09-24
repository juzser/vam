/**
 * THE START SCREEN, SEEN. A pane vam opened with nothing in it yet is a row
 * (`status: 'unstarted'`, `main/sources/claude-code/pane-row.ts`); its
 * Response view is the provider picker and Start session
 * (`DetailPanel.tsx`, `StartSession`), and its Terminal view is the pane.
 * `docs/design/vam-owns-the-session.md` §3 and Stage 2, and the operator's
 * own words twice over.
 *
 * WHAT A BROWSER PROVES THAT THE UNIT FILE CANNOT. `DetailPanel.start-
 * session.test.tsx` holds the DOM: a fieldset, two pressed-state buttons, one
 * Start, no textarea. What it cannot hold is anything painted: whether the
 * hollow status dot in the sidebar is actually the same size and lane as its
 * five neighbours (a `Record<SessionStatus, …>` compiles whatever the glyph
 * draws), whether the screen's three sentences fit a 408px pane and a 390px
 * phone without wrapping the button off the bottom, and whether the Terminal
 * view of a pane row draws a pane at all rather than the `ambiguous` refusal
 * -- which is the thing `targetSession`'s pane-row branch exists to prevent,
 * and which only a real bundle with a real `terminal.read` can answer.
 *
 * THREE SHOTS, TWO SOURCES. The Response shots run against `?demo=1`, whose
 * `notes` project carries the fixture row beside four real neighbours -- the
 * sidebar column is the point of the first picture. The Terminal shot cannot:
 * the demo source has no terminal, so it stubs `window.api` the way
 * `terminal-chrome-shots.mjs` does, with a `load` that serves the same row and
 * a `read` that answers a shell prompt, which is what a fresh vam pane shows.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/start-screen-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/** The fixture row, as `src/renderer/fixtures/demo.ts` spells it. */
const ROW = 'pane:vam-notes-k3f9zq';
const PANE = 'vam-notes-k3f9zq';

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

/**
 * THE STUBBED DESKTOP BRIDGE, shared by every block below that needs a REAL
 * `kind: 'session'` source rather than the demo fixture: `App.tsx` picks
 * `DesktopCanvas` the moment `window.api` exists, before it ever reads
 * `?demo=1`, so installing this is what turns the query param into a no-op
 * and hands the loading indicator a source it can actually write through.
 *
 * PASSED TO `page.addInitScript` BY REFERENCE, not called here -- Playwright
 * serialises the function body into the page itself, so it can take only
 * JSON-safe arguments (`hangRecordPrompt`, a plain boolean) and not a real
 * function; `recordPrompt`'s own body branches on that flag instead. A
 * promise that never resolves is "the agent registers a moment later" held
 * open for exactly as long as the screenshot below needs it.
 */
function stubApiScript({ row, pane, hangRecordPrompt }) {
  const SCREEN = ['Last login: Mon Sep 21 10:12:03 on ttys006', `~/w/notes $ `].join('\n');
  const unavailable = () =>
    Promise.resolve({
      kind: 'unavailable',
      error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
    });
  globalThis.window.api = {
    describe: async () => ({
      id: 'claude-code',
      label: 'Claude Code',
      capabilities: {
        liveUpdates: false,
        recordPrompt: true,
        deliverPrompt: true,
        promptAttachments: false,
        slashCommands: false,
        renameSession: false,
        closeSession: true,
        createSession: true,
        governance: false,
        pullRequests: false,
        terminal: true,
        agentRoster: false,
        resumeSession: false,
      },
      declines: {},
      viewerScope: { kind: 'connection', note: 'stub' },
    }),
    load: async () => [
      {
        id: 'notes',
        name: 'notes',
        source: 'claude-code',
        sessions: [
          {
            id: 'notes-1',
            title: 'notes-1',
            epic: null,
            branch: 'main',
            status: 'idle',
            runningAgents: 0,
            activity: null,
            age: '4m',
            decisions: [
              { id: 'd1', label: 'plan', input: 'a turn', output: 'an answer', commands: [] },
            ],
            source: 'claude-code',
            vamControlled: true,
          },
          {
            id: row,
            title: pane,
            pane,
            epic: null,
            branch: null,
            status: 'unstarted',
            runningAgents: 0,
            activity: null,
            age: null,
            decisions: [],
            source: 'claude-code',
            vamControlled: true,
          },
        ],
      },
    ],
    subscribe: () => () => {},
    // `hangRecordPrompt` is what draws the loading screenshot below: the
    // write never resolves, exactly as `typeIntoOwnPane` would sit unresolved
    // for however long a slow tmux spawn takes.
    recordPrompt: hangRecordPrompt ? () => new Promise(() => {}) : async () => {},
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
        name: pane,
        text: SCREEN,
        cursor: { kind: 'at', column: 12, row: 1 },
      }),
      resize: async () => true,
      send: async () => 'sent',
      answer: async () => ({ kind: 'unavailable' }),
      prompt: async () => ({ kind: 'unavailable' }),
    },
  };
}

const browser = await chromium.launch();

// ------------------------------------------------ 1. DESKTOP, RESPONSE VIEW
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator(`[data-session-row="${ROW}"]`).first().click();
  await page.waitForSelector('[data-start-session]');

  const shape = await page.evaluate((pane) => {
    const screen = document.querySelector('[data-start-session]');
    const r = (el) => {
      const b = el?.getBoundingClientRect();
      return b === undefined
        ? null
        : { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const paneEl = screen?.closest('[data-split-pane]');
    const paneBox = r(paneEl);
    const button = document.querySelector('[data-start-session-button]');
    const options = [...document.querySelectorAll('[data-start-provider]')];
    const text = screen?.textContent ?? '';
    return {
      pane: paneBox,
      button: r(button),
      options: options.map((o) => ({
        id: o.getAttribute('data-start-provider'),
        pressed: o.getAttribute('aria-pressed'),
        box: r(o),
      })),
      namesPane: text.includes(pane),
      namesTerminal: /Terminal view/.test(text),
      textarea: document.querySelector('[data-split-pane] textarea') !== null,
      screenBox: r(screen),
    };
  }, PANE);
  console.log('desktop start screen:', JSON.stringify(shape));
  check('the start screen is in the focused pane', shape.pane !== null && shape.screenBox !== null);
  check(
    'two providers, exactly one pressed',
    shape.options.length === 2 && shape.options.filter((o) => o.pressed === 'true').length === 1,
    JSON.stringify(shape.options),
  );
  check('a Start session button is drawn', shape.button !== null);
  check(
    'and it sits inside the pane, not below its fold',
    shape.button !== null &&
      shape.pane !== null &&
      shape.button.y + shape.button.h <= shape.pane.y + shape.pane.h,
    JSON.stringify({ button: shape.button, pane: shape.pane }),
  );
  check('the screen names the pane it will start in', shape.namesPane);
  check('and says the Terminal view is the other door', shape.namesTerminal);
  check('no composer under it: nothing to prompt yet', shape.textarea === false);

  // THE HOLLOW DOT, MEASURED BESIDE THE OTHER FIVE. `status-mark.tsx` draws
  // it in idle's lane at idle's size; the sidebar column holds all six
  // statuses in `notes` + `factory`, so every mark's box is read and the
  // unstarted one must share a lane width with its neighbours.
  const marks = await page.evaluate(() => {
    return [...document.querySelectorAll('[data-session-row] [data-status-mark]')].map((el) => {
      const b = el.getBoundingClientRect();
      const inner = el.firstElementChild?.getBoundingClientRect();
      return {
        status: el.getAttribute('data-status-mark'),
        lane: Math.round(b.width),
        glyph: inner === undefined ? null : Math.round(inner.width),
        fill: inner === undefined ? null : getComputedStyle(el.firstElementChild).backgroundColor,
        border: inner === undefined ? null : getComputedStyle(el.firstElementChild).borderTopWidth,
      };
    });
  });
  console.log('sidebar marks:', JSON.stringify(marks));
  const unstarted = marks.filter((m) => m.status === 'unstarted');
  const idle = marks.filter((m) => m.status === 'idle');
  check('the unstarted mark is in the sidebar', unstarted.length === 1, JSON.stringify(marks));
  check(
    'in the same lane as every other mark',
    unstarted.length === 1 && marks.every((m) => m.lane === unstarted[0].lane),
    JSON.stringify(marks.map((m) => [m.status, m.lane])),
  );
  check(
    'at idle’s size, hollow where idle is filled',
    unstarted.length === 1 &&
      idle.length >= 1 &&
      unstarted[0].glyph === idle[0].glyph &&
      unstarted[0].border !== '0px' &&
      /rgba\(0, 0, 0, 0\)|transparent/.test(unstarted[0].fill ?? ''),
    JSON.stringify({ unstarted, idle }),
  );

  await page.screenshot({ path: `${outDir}/start-screen-desktop-response.png` });
  await page.close();
}

// ------------------------------------------------ 2. DESKTOP, TERMINAL VIEW
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(stubApiScript, { row: ROW, pane: PANE, hangRecordPrompt: false });
  await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator(`[data-session-row="${ROW}"]`).first().click();
  await page.waitForSelector('[data-start-session]');
  await page.locator('[data-view="terminal"]').click();
  const paneDrawn = await page
    .waitForSelector('[data-terminal-pane]', { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  check('the Terminal view of a pane row draws the pane -- not a refusal', paneDrawn);
  const screen = await page.evaluate(
    () => document.querySelector('[data-terminal-pane]')?.textContent ?? '',
  );
  check('and it is the shell prompt the pane holds', /\$/.test(screen), JSON.stringify(screen));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/start-screen-desktop-terminal.png` });
  await page.close();
}

// -------------------------------------------------- 3. PHONE, RESPONSE VIEW
{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-phone-shell]');
  const row = page.locator(`[data-phone-shell] [data-session-row="${ROW}"]`).first();
  // The fixture row is the last of nine and sits below the 844px fold; a tap
  // at its unscrolled coordinates lands on nothing (measured: y=1004).
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  check('the phone list has the row', box !== null);
  if (box !== null) {
    await page.touchscreen.tap(box.x + 60, box.y + box.height / 2);
  }
  await page.waitForSelector('[data-phone-shell] [data-start-session]', { timeout: 5_000 });
  const phone = await page.evaluate(() => {
    const r = (el) => {
      const b = el?.getBoundingClientRect();
      return b === undefined
        ? null
        : { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      button: r(document.querySelector('[data-start-session-button]')),
      options: [...document.querySelectorAll('[data-start-provider]')].map((o) => r(o)),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      textarea: document.querySelector('[data-phone-shell] textarea') !== null,
    };
  });
  console.log('phone start screen:', JSON.stringify(phone));
  check(
    'the Start button is on the 390px screen, whole',
    phone.button !== null &&
      phone.button.x >= 0 &&
      phone.button.x + phone.button.w <= phone.viewport.w &&
      phone.button.y + phone.button.h <= phone.viewport.h,
    JSON.stringify(phone),
  );
  check(
    'each control clears 44px to the touch',
    phone.button !== null &&
      phone.button.h >= 44 &&
      phone.options.every((o) => o !== null && o.h >= 44 && o.w >= 44),
    JSON.stringify({ button: phone.button, options: phone.options }),
  );
  check('no composer on the phone either', phone.textarea === false);
  await page.screenshot({ path: `${outDir}/start-screen-phone-response.png` });
  await page.close();
}

/**
 * THE LOADING STATE, between the press and the agent registering.
 *
 * Operator: "After clicking Start session on the start screen, there needs
 * to be a loading state while the session is being created." `hangRecordPrompt`
 * (`stubApiScript`) is what a real write looks like the instant AFTER it
 * lands and BEFORE an agent has registered -- `typeIntoOwnPane` resolves in
 * milliseconds and the agent takes seconds, so a promise that never resolves
 * is the honest stand-in for that whole gap, not a shortcut around it.
 * `Canvas.start-session-loading.test.tsx` holds the DOM (disabled, `aria-
 * busy`, the label); what only a real bundle can show is the PAINT: whether
 * the spinner is actually the same `LoaderCircle`/`vam-spin` the rest of the
 * app uses, and whether the frozen picker still fits the pane it always did.
 */
async function loadingStateShot({ viewport, phone, outName }) {
  const page = await browser.newPage(
    phone ? { viewport, hasTouch: true, isMobile: true } : { viewport },
  );
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(stubApiScript, { row: ROW, pane: PANE, hangRecordPrompt: true });
  await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector(phone ? '[data-phone-shell]' : '[data-tab-strip]');
  if (phone) {
    const row = page.locator(`[data-phone-shell] [data-session-row="${ROW}"]`).first();
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    check(`${outName}: the phone list has the row`, box !== null);
    if (box !== null) await page.touchscreen.tap(box.x + 60, box.y + box.height / 2);
  } else {
    await page.locator(`[data-session-row="${ROW}"]`).first().click();
  }
  await page.waitForSelector('[data-start-session]');
  await page.locator('[data-start-session-button]').click();
  // 20s, not this suite's usual 5s: the button freezes on a synchronous
  // `setState` inside the click handler -- normally sub-20ms -- but a
  // machine running many concurrent guard suites has measured that exact
  // shape starved to 5022ms before now (a documented finding, not a guess);
  // a tight bound here would flag starvation as a broken feature.
  await page.waitForSelector('[data-start-session-button][aria-busy="true"]', { timeout: 20_000 });

  const shape = await page.evaluate(() => {
    const button = document.querySelector('[data-start-session-button]');
    const fieldset = document.querySelector('[data-start-providers]');
    return {
      buttonText: button?.textContent ?? '',
      buttonDisabled: button?.hasAttribute('disabled') ?? false,
      spinning: button?.querySelector('.vam-spin') !== null,
      pickerDisabled: fieldset?.hasAttribute('disabled') ?? false,
    };
  });
  console.log(`${outName}:`, JSON.stringify(shape));
  check(`${outName}: the button names the provider it is starting`, /Starting Claude Code/.test(shape.buttonText), shape.buttonText);
  check(`${outName}: the button is frozen`, shape.buttonDisabled);
  check(`${outName}: it is spinning, this early`, shape.spinning);
  check(`${outName}: the provider picker is frozen too`, shape.pickerDisabled);

  await page.screenshot({ path: `${outDir}/${outName}.png` });
  await page.close();
}

await loadingStateShot({ viewport: { width: 1280, height: 800 }, phone: false, outName: 'start-session-loading' });
await loadingStateShot({
  viewport: { width: 390, height: 844 },
  phone: true,
  outName: 'start-session-loading-phone',
});

await browser.close();
console.log(failures.length === 0 ? '\nstart-screen-shots: all checks passed.' : '');
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
