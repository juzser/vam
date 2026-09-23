/**
 * THE GETTING-STARTED SCREEN, SEEN -- the detail pane's Response view (and,
 * on a phone, the list screen's own body) when vam has NO session to show
 * anywhere: first launch, or every row hidden by `hideForeign` (PR 456).
 * `DetailPanel.getting-started.test.tsx` and `Canvas.getting-started.
 * test.tsx` hold the DOM and the write path; what they cannot hold is
 * anything PAINTED -- whether the mark, the info line, the three shortcuts
 * and the primary button all fit inside a real 1280px detail pane and a
 * real 390px phone screen without sliding off the fold, whether New project
 * actually reaches `window.api.dialog.chooseDirectory` and
 * `write.createSessionIn` through the REAL preload contract shape (not a
 * mocked callback), and whether the phone's own Show control clears the
 * 44px floor `vam-tap` promises.
 *
 * ONE FULLY-STUBBED SOURCE, the shape `terminal-only-shots.mjs`'s own header
 * explains is required: `App.tsx` takes the page off `?demo=1` the moment
 * `window.api` is merely defined, so a partial stub reddens the whole page
 * before a single check here runs. This is also the FIRST guard in this
 * repo to stub `window.api.dialog` at all -- no existing one drives New
 * project through a real click, so `createSessionIn`'s (cwd, name) pair is
 * captured rather than merely not throwing.
 *
 * THE PHONE STATE OMITS `dialog` ENTIRELY, on purpose: a real phone reaches
 * vam over Tailscale Serve (`docs/design/...`, the operator's own mobile
 * rule), which is the browser build with no Electron behind it and
 * therefore no picker at all -- never a state this repo's desktop actually
 * runs in. That is what proves the screen's OWN "needs the desktop app"
 * sentence rather than assuming it from the unit file's boolean prop.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/getting-started-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'e2e/test-results';

const CHOSEN_DIR = '/srv/work/orchard';

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

const CAPABILITIES = {
  liveUpdates: false,
  recordPrompt: true,
  deliverPrompt: false,
  promptAttachments: false,
  slashCommands: false,
  renameSession: false,
  closeSession: false,
  createSession: true,
  governance: false,
  pullRequests: false,
  terminal: false,
  agentRoster: false,
  resumeSession: false,
};

/** A full, minimal `PreloadSourceApi` PLUS `dialog` -- see this file's own
 *  header for why both must be complete. `projects` is the whole of what
 *  varies between the three states below; everything else is the same
 *  stub `terminal-only-shots.mjs`/`sidebar-ownership-shots.mjs` already use.
 *  `withDialog: false` omits the `dialog` key entirely, simulating the
 *  browser/phone build's own missing bridge. */
function install({ projects, withDialog }) {
  const unavailable = () =>
    Promise.resolve({
      kind: 'unavailable',
      error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
    });
  window.__spawned = [];
  const api = {
    describe: async () => ({
      id: 'claude-code',
      label: 'Claude Code',
      capabilities: window.__capabilities,
      declines: {},
      viewerScope: { kind: 'connection', note: 'stub' },
    }),
    load: async () => projects,
    subscribe: () => () => {},
    recordPrompt: async () => {},
    renameSession: async () => {},
    closeSession: async () => {},
    createSession: async () => {},
    createSessionIn: async (cwd, title) => {
      window.__spawned.push([cwd, title]);
    },
    resumeSession: async () => {},
    pickImageAttachment: async () => null,
    history: async () => unavailable(),
    agentWork: async () => unavailable(),
    applyWaivers: async () => {},
    transitionLesson: async () => {},
    usage: { get: async () => ({ kind: 'unavailable' }) },
    terminal: {
      read: async () => unavailable(),
      resize: async () => true,
      send: async () => 'sent',
      answer: async () => ({ kind: 'unavailable' }),
      prompt: async () => ({ kind: 'unavailable' }),
    },
  };
  if (withDialog) {
    api.dialog = { chooseDirectory: async () => window.__chosenDir };
  }
  globalThis.window.api = api;
}

const browser = await chromium.launch();

// --------------------------------------------- 1. DESKTOP, FIRST LAUNCH (CASE A)
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(
    (args) => {
      window.__capabilities = args.capabilities;
      window.__chosenDir = args.chosenDir;
    },
    { capabilities: CAPABILITIES, chosenDir: CHOSEN_DIR },
  );
  await page.addInitScript(install, { projects: [], withDialog: true });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-getting-started]', { timeout: 5_000 });

  const shape = await page.evaluate(() => {
    const r2 = (el) => {
      const b = el?.getBoundingClientRect();
      return b === undefined
        ? null
        : { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const screenEl = document.querySelector('[data-getting-started]');
    const pane = screenEl?.closest('[data-split-pane]');
    const button = document.querySelector('[data-getting-started-new-project]');
    const shortcuts = [...document.querySelectorAll('[data-getting-started-shortcuts] li')].map(
      (li) => ({ text: li.textContent, chip: li.querySelector('[data-inline-chord]')?.textContent ?? null }),
    );
    const sidebarAdd = document.querySelector('[data-sidebar-add]');
    return {
      screenBox: r2(screenEl),
      paneBox: r2(pane),
      button: r2(button),
      hasMark: screenEl?.querySelector('img')?.getAttribute('src')?.includes('favicon.png') ?? false,
      shortcuts,
      hidden: document.querySelector('[data-getting-started-hidden]'),
      sidebarAddLabel: sidebarAdd?.textContent ?? null,
      noSessionsLine: document.body.textContent?.includes('no sessions open'),
    };
  });
  console.log('getting-started desktop (case a):', JSON.stringify(shape));
  check('the screen is in the focused pane', shape.paneBox !== null && shape.screenBox !== null);
  check('it carries vam’s own mark', shape.hasMark);
  check(
    'three shortcuts, each with a chord chip',
    shape.shortcuts.length === 3 && shape.shortcuts.every((s) => s.chip !== null && s.chip !== ''),
    JSON.stringify(shape.shortcuts),
  );
  check('no hidden-count line -- nothing is hidden yet', shape.hidden === null);
  check(
    'a New project button is drawn, inside the pane',
    shape.button !== null &&
      shape.paneBox !== null &&
      shape.button.y + shape.button.h <= shape.paneBox.y + shape.paneBox.h,
    JSON.stringify({ button: shape.button, pane: shape.paneBox }),
  );
  check(
    'the sidebar foot button reads New project, not New session -- never a dead end',
    shape.sidebarAddLabel !== null && shape.sidebarAddLabel.includes('New project'),
    shape.sidebarAddLabel ?? 'null',
  );

  // THE SCREEN ITSELF, BEFORE THE CLICK -- the state this file's shot is
  // actually of. Taken here, not after New project runs: main's own write
  // moves the pane to `StartingSession` (`Canvas.tsx`) the instant it fires,
  // and a shot taken after the click would be a picture of THAT screen, not
  // of this one.
  await page.screenshot({ path: `${outDir}/getting-started-desktop.png` });

  // NEW PROJECT REACHES THE REAL BRIDGE, THROUGH A REAL CLICK -- not a second
  // implementation of it, and not merely "the click did not throw".
  await page.locator('[data-getting-started-new-project]').click();
  await page.waitForFunction(() => window.__spawned.length === 1, { timeout: 5_000 });
  const spawned = await page.evaluate(() => window.__spawned);
  check(
    'New project calls createSessionIn with (the chosen directory, its name)',
    JSON.stringify(spawned) === JSON.stringify([[CHOSEN_DIR, 'orchard']]),
    JSON.stringify(spawned),
  );

  await page.close();
}

// --------------------------------------- 2. DESKTOP, EVERY ROW FOREIGN (CASE B)
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(
    (args) => {
      window.__capabilities = args.capabilities;
      window.__chosenDir = args.chosenDir;
    },
    { capabilities: CAPABILITIES, chosenDir: CHOSEN_DIR },
  );
  await page.addInitScript(install, {
    withDialog: true,
    projects: [
      {
        id: 'claude-code:atlas',
        name: 'atlas',
        source: 'claude-code',
        sessions: [
          {
            id: 'foreign-1',
            title: 'a thread vam did not start',
            epic: null,
            branch: null,
            status: 'done',
            runningAgents: 0,
            activity: null,
            age: '2h',
            decisions: [],
            source: 'claude-code',
            vamControlled: false,
          },
        ],
      },
    ],
  });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-getting-started]', { timeout: 5_000 });

  const hiddenText = await page.evaluate(
    () => document.querySelector('[data-getting-started-hidden]')?.textContent ?? null,
  );
  check(
    'names the one hidden session, and why -- PR 456’s own pref',
    hiddenText !== null && hiddenText.includes('1 session hidden') && hiddenText.includes('vam did not start it'),
    hiddenText ?? 'null',
  );

  await page.locator('[data-getting-started-show]').click();
  const stepsAside = await page
    .waitForSelector('[data-getting-started]', { state: 'detached', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  check('Show flips the pref, and the screen steps aside once the row is visible', stepsAside);
  const rowVisible = (await page.locator('[data-session-row="foreign-1"]').count()) === 1;
  check('the previously-hidden row is now on screen', rowVisible);

  await page.close();
}

// ------------------------------------------- 3. DESKTOP, ANY VISIBLE SESSION
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(
    (args) => {
      window.__capabilities = args.capabilities;
      window.__chosenDir = args.chosenDir;
    },
    { capabilities: CAPABILITIES, chosenDir: CHOSEN_DIR },
  );
  await page.addInitScript(install, {
    withDialog: true,
    projects: [
      {
        id: 'claude-code:atlas',
        name: 'atlas',
        source: 'claude-code',
        sessions: [
          {
            id: 'a1',
            title: 'a real session',
            epic: null,
            branch: null,
            status: 'done',
            runningAgents: 0,
            activity: null,
            age: '2m',
            decisions: [],
            source: 'claude-code',
            vamControlled: true,
          },
        ],
      },
    ],
  });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]', { timeout: 5_000 });
  const gs = await page.locator('[data-getting-started]').count();
  check('the screen is absent the moment any session is visible', gs === 0);
  await page.close();
}

// ----------------------------------------------------------- 4. PHONE, CASE B
// (foreign hidden, no picker): the one state that carries both a control to
// measure (Show, PR 456's own pref) and the "needs the desktop app" sentence.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(
    (args) => {
      window.__capabilities = args.capabilities;
    },
    { capabilities: CAPABILITIES },
  );
  await page.addInitScript(install, {
    withDialog: false,
    projects: [
      {
        id: 'claude-code:atlas',
        name: 'atlas',
        source: 'claude-code',
        sessions: [
          {
            id: 'foreign-1',
            title: 'a thread vam did not start',
            epic: null,
            branch: null,
            status: 'done',
            runningAgents: 0,
            activity: null,
            age: '2h',
            decisions: [],
            source: 'claude-code',
            vamControlled: false,
          },
        ],
      },
    ],
  });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-phone-shell] [data-getting-started]', { timeout: 5_000 });

  const phone = await page.evaluate(() => {
    const r2 = (el) => {
      const b = el?.getBoundingClientRect();
      return b === undefined
        ? null
        : { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const show = document.querySelector('[data-getting-started-show]');
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      button: r2(document.querySelector('[data-getting-started-new-project]')),
      decline: document.querySelector('[data-getting-started-decline]')?.textContent ?? null,
      show: r2(show),
      sidebarFootDrawn: document.querySelector('[data-sidebar-add]') !== null,
      standaloneHiddenStrips: document.querySelectorAll('[data-foreign-hidden]').length,
    };
  });
  console.log('getting-started phone (case b, no picker):', JSON.stringify(phone));
  check('no New project button -- the browser/phone build has no picker', phone.button === null);
  check('says plainly what needs the desktop app', phone.decline !== null && /desktop app/.test(phone.decline), phone.decline ?? 'null');
  check(
    'Show clears the 44px floor',
    phone.show !== null && phone.show.h >= 44,
    JSON.stringify(phone.show),
  );
  check(
    'Show is whole on the 390px screen',
    phone.show !== null && phone.show.x >= 0 && phone.show.x + phone.show.w <= phone.viewport.w,
    JSON.stringify(phone),
  );
  check(
    'the sidebar foot strip is withdrawn, not duplicated beside this screen’s own button',
    phone.sidebarFootDrawn === false,
  );
  check(
    'the standalone hidden-count strip is withdrawn too -- one copy of the sentence, not two',
    phone.standaloneHiddenStrips === 0,
    String(phone.standaloneHiddenStrips),
  );

  await page.screenshot({ path: `${outDir}/getting-started-phone.png` });
  await page.close();
}

await browser.close();
console.log(failures.length === 0 ? '\ngetting-started-shots: all checks passed.' : '');
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
