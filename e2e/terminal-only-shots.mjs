/**
 * THE TERMINAL-ONLY STATE, SEEN -- `docs/design/vam-terminal-only.md`. A vam
 * pane whose agent exited but whose conversation vam still knows is a row
 * (`status: 'terminal'`, `main/sources/claude-code/pane-row.ts`,
 * `terminalRow`); its Response view is the getting-started screen
 * (`DetailPanel.tsx`, `TerminalOnlyStart` -- the operator's own revision of
 * this design, replacing an earlier transcript-plus-footer-bar draft), and
 * its Terminal view is unaffected: the plain shell.
 *
 * WHAT A BROWSER PROVES THAT THE UNIT FILES CANNOT. `DetailPanel.terminal-
 * only.test.tsx` and `Canvas.terminal-only-resume.test.tsx` hold the DOM and
 * the write path. What they cannot hold is anything PAINTED: whether the
 * `terminal` status mark actually sits in the same lane as its five
 * neighbours in a real sidebar column (a `Record<SessionStatus, …>` compiles
 * whatever the glyph draws), whether the tab strip's own mark is visible
 * without a click, whether the getting-started screen's mark, info line,
 * three shortcuts and two buttons all fit inside a 408px pane and a 390px
 * phone without the Start button sliding off the fold, and whether Resume
 * actually reaches `window.api.recordPrompt` with the row's own command --
 * through the REAL preload contract shape, not a mocked callback.
 *
 * ONE FULLY-STUBBED SOURCE, the shape `sidebar-ownership-shots.mjs`'s own
 * header explains is required: `App.tsx` takes the page off `?demo=1` the
 * moment `window.api` is merely defined, so a partial stub reddens the whole
 * page before a single check here runs. `recordPrompt` is the one write this
 * file actually exercises, and it CAPTURES rather than merely resolving, so
 * "Resume calls the bridge with the right command" is a claim this file can
 * check by value rather than merely by the click not throwing.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/terminal-only-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const ROW = 'pane:vam-atlas-aa11bb';
const PANE = 'vam-atlas-aa11bb';
const TITLE = 'fix the flaky test';
const RESUME_COMMAND = 'claude --resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SHELL_SCREEN = ['Last login: Mon Sep 21 10:12:03 on ttys006', `~/w/atlas $ `].join('\n');

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

/** A full, minimal `PreloadSourceApi` -- see this file's own header for why
 *  it must be complete. Handed to `addInitScript` as an argument, never
 *  closed over: that function serialises what it is given rather than
 *  capturing anything from this module's scope. */
function install({ row, pane, title, resumeCommand, screen }) {
  const unavailable = () =>
    Promise.resolve({
      kind: 'unavailable',
      error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
    });
  window.__recorded = [];
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
        id: 'claude-code:atlas',
        name: 'atlas',
        source: 'claude-code',
        sessions: [
          // A neighbour of every OTHER status, so the sidebar column holds
          // all seven marks at once -- the same reason `start-screen-
          // shots.mjs`'s `notes` project carries `idle` beside `unstarted`.
          {
            id: 'neighbour-running',
            title: 'a running neighbour',
            epic: null,
            branch: 'main',
            status: 'running',
            runningAgents: 0,
            activity: null,
            age: '1m',
            decisions: [],
            source: 'claude-code',
            vamControlled: true,
          },
          {
            id: row,
            title,
            pane,
            epic: null,
            branch: 'feature/x',
            status: 'terminal',
            runningAgents: 0,
            activity: null,
            age: '4m',
            decisions: [
              { id: 'd1', label: 'you', input: 'fix it', output: 'fixed', commands: [] },
            ],
            source: 'claude-code',
            vamControlled: true,
            resumeCommand,
          },
        ],
      },
    ],
    subscribe: () => () => {},
    recordPrompt: async (sessionId, prompt) => {
      window.__recorded.push([sessionId, prompt]);
    },
    renameSession: async () => {},
    closeSession: async () => {},
    createSession: async () => {},
    createSessionIn: async () => {},
    resumeSession: async () => {},
    pickImageAttachment: async () => null,
    history: async () => unavailable(),
    agentWork: async () => unavailable(),
    applyWaivers: async () => {},
    transitionLesson: async () => {},
    usage: { get: async () => ({ kind: 'unavailable' }) },
    terminal: {
      read: async () => ({ kind: 'ok', name: pane, text: screen, cursor: { kind: 'at', column: 12, row: 1 } }),
      resize: async () => true,
      send: async () => 'sent',
      answer: async () => ({ kind: 'unavailable' }),
      prompt: async () => ({ kind: 'unavailable' }),
    },
  };
}

const browser = await chromium.launch();

// --------------------------------------------- 1. DESKTOP, RESPONSE VIEW
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(install, {
    row: ROW,
    pane: PANE,
    title: TITLE,
    resumeCommand: RESUME_COMMAND,
    screen: SHELL_SCREEN,
  });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator(`[data-session-row="${ROW}"]`).first().click();
  await page.waitForSelector('[data-terminal-only-start]');

  // THE MARK, IN THE SIDEBAR, BESIDE ITS SIX NEIGHBOURS.
  const marks = await page.evaluate(() =>
    [...document.querySelectorAll('[data-session-row] [data-status-mark]')].map((el) => {
      const b = el.getBoundingClientRect();
      return { status: el.getAttribute('data-status-mark'), lane: Math.round(b.width) };
    }),
  );
  console.log('sidebar marks:', JSON.stringify(marks));
  const terminalMark = marks.filter((m) => m.status === 'terminal');
  check('the terminal mark is in the sidebar', terminalMark.length === 1, JSON.stringify(marks));
  check(
    'in the same lane as its neighbour',
    terminalMark.length === 1 && marks.every((m) => m.lane === terminalMark[0].lane),
    JSON.stringify(marks),
  );

  // THE MARK, ON THE TAB -- visible without a click, unlike idle/unstarted.
  const tabMark = await page.evaluate(
    () => document.querySelector('[data-session-tab][data-tab-status="terminal"] [data-status-mark]') !== null,
  );
  check('the tab wears the same mark, quietly, without being clicked', tabMark);

  const shape = await page.evaluate((pane) => {
    const screenEl = document.querySelector('[data-terminal-only-start]');
    const paneBox = r2(screenEl?.closest('[data-split-pane]'));
    const button = document.querySelector('[data-start-session-button]');
    const resume = document.querySelector('[data-resume-in-pane]');
    const options = [...document.querySelectorAll('[data-start-provider]')];
    const shortcuts = [...document.querySelectorAll('[data-terminal-only-shortcuts] li')].map((li) => ({
      text: li.textContent,
      chip: li.querySelector('[data-inline-chord]')?.textContent ?? null,
    }));
    const text = screenEl?.textContent ?? '';
    function r2(el) {
      const b = el?.getBoundingClientRect();
      return b === undefined
        ? null
        : { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    }
    return {
      pane: paneBox,
      button: r2(button),
      resume: r2(resume),
      options: options.map((o) => o.getAttribute('data-start-provider')),
      shortcuts,
      namesConversation: text.includes('fix the flaky test'),
      namesPane: text.includes(pane),
      namesShellPrompt: /shell prompt/.test(text),
      namesResumeTitle: (resume?.textContent ?? '').includes('fix the flaky test'),
      // THE SESSION'S OWN AGENT, NOT VAM'S -- "start-polish" (2026-09-23):
      // this screen belongs to ONE session, so its mark names the agent that
      // ran it (`SourceMark`), never vam's own (that is `GettingStarted.tsx`'s
      // screen alone, the WHOLE APP's, which names no session). This fixture's
      // rows are all `source: 'claude-code'`, so the register must be `brand`
      // and there must be no `<img>` at all -- an `<img>` here would mean vam's
      // mark leaked back onto a screen that now belongs to a named session.
      markRegister: document.querySelector('[data-terminal-only-mark]')?.getAttribute('data-source-mark') ?? null,
      markFrameBox: r2(document.querySelector('[data-terminal-only-start] [data-icon-frame]')),
      hasImg: document.querySelector('[data-terminal-only-start] img') !== null,
      textarea: document.querySelector('[data-split-pane] textarea') !== null,
      screenBox: r2(screenEl),
    };
  }, PANE);
  console.log('terminal-only screen:', JSON.stringify(shape));
  check('the getting-started screen is in the focused pane', shape.pane !== null && shape.screenBox !== null);
  check('it carries the SESSION’S OWN agent mark (claude-code, a brand register), never vam’s', shape.markRegister === 'brand' && shape.hasImg === false);
  // THE MACOS APP-ICON FRAME, MEASURED -- same shape `getting-started-shots.
  // mjs` pins for vam's own mark; this screen's agent mark must be painted
  // inside the identical frame, not a smaller or differently-shaped one.
  check(
    'the mark is painted at ~64px, inside its own frame',
    shape.markFrameBox !== null && Math.abs(shape.markFrameBox.w - 64) <= 1 && Math.abs(shape.markFrameBox.h - 64) <= 1,
    JSON.stringify(shape.markFrameBox),
  );
  check('it names the conversation, not just the pane', shape.namesConversation);
  check('it also names the pane', shape.namesPane);
  check('and says the pane is at a shell prompt', shape.namesShellPrompt);
  check('three shortcuts, each with a chord chip', shape.shortcuts.length === 3 && shape.shortcuts.every((s) => s.chip !== null && s.chip !== ''), JSON.stringify(shape.shortcuts));
  check('two providers offered', shape.options.length === 2, JSON.stringify(shape.options));
  check('a Start session button is drawn, inside the pane', shape.button !== null && shape.pane !== null && shape.button.y + shape.button.h <= shape.pane.y + shape.pane.h, JSON.stringify({ button: shape.button, pane: shape.pane }));
  check('a Resume button is drawn too, inside the pane, naming the conversation', shape.resume !== null && shape.namesResumeTitle && shape.pane !== null && shape.resume.y + shape.resume.h <= shape.pane.y + shape.pane.h, JSON.stringify({ resume: shape.resume, pane: shape.pane }));
  check('no composer: nothing to prompt from a getting-started screen', shape.textarea === false);

  // RESUME REACHES THE REAL BRIDGE, WITH THE ROW'S OWN COMMAND -- not a
  // second implementation of it, and not merely "the click did not throw".
  await page.locator('[data-resume-in-pane]').click();
  await page.waitForFunction(() => window.__recorded.length === 1, { timeout: 5_000 });
  const recorded = await page.evaluate(() => window.__recorded);
  check('Resume calls recordPrompt with (rowId, the row’s own resumeCommand)', JSON.stringify(recorded) === JSON.stringify([[ROW, RESUME_COMMAND]]), JSON.stringify(recorded));

  await page.screenshot({ path: `${outDir}/terminal-only-desktop-response.png` });
  await page.close();
}

// ------------------------------------------------- 2. DESKTOP, TERMINAL VIEW
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(install, {
    row: ROW,
    pane: PANE,
    title: TITLE,
    resumeCommand: RESUME_COMMAND,
    screen: SHELL_SCREEN,
  });
  // STREAMING DEFAULTS ON NOW (`prefs/streaming-terminal.ts`) -- this block is
  // about the CLASSIC `[data-terminal-pane]` renderer specifically, and
  // `install` above carries no `terminalStream` member at all, so the
  // explicit opt-out is what keeps it testing the renderer it names.
  // `streamingTerminalMigrated: true` too -- omitting it hits `prefs.ts`'s
  // own one-time migration ratchet, which treats an UN-migrated payload's
  // `streamingTerminal` as unwritten and forces it back to the new default
  // regardless of what this sets.
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({ streamingTerminal: false, streamingTerminalMigrated: true }),
    );
  });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator(`[data-session-row="${ROW}"]`).first().click();
  await page.waitForSelector('[data-terminal-only-start]');
  await page.locator('[data-view="terminal"]').click();
  const paneDrawn = await page
    .waitForSelector('[data-terminal-pane]', { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  check('the Terminal view of a terminal-only row draws the pane, unaffected', paneDrawn);
  const screen = await page.evaluate(() => document.querySelector('[data-terminal-pane]')?.textContent ?? '');
  check('and it is the real shell prompt, not a second copy of the getting-started screen', /\$/.test(screen), JSON.stringify(screen));
  check(
    'the getting-started screen is not drawn under the Terminal tab',
    (await page.locator('[data-terminal-only-start]').count()) === 0,
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/terminal-only-desktop-terminal.png` });
  await page.close();
}

// ----------------------------------------------------- 3. PHONE, RESPONSE VIEW
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(install, {
    row: ROW,
    pane: PANE,
    title: TITLE,
    resumeCommand: RESUME_COMMAND,
    screen: SHELL_SCREEN,
  });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-phone-shell]');
  const row = page.locator(`[data-phone-shell] [data-session-row="${ROW}"]`).first();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  check('the phone list has the row', box !== null);
  if (box !== null) {
    await page.touchscreen.tap(box.x + 60, box.y + box.height / 2);
  }
  await page.waitForSelector('[data-phone-shell] [data-terminal-only-start]', { timeout: 5_000 });
  const phone = await page.evaluate(() => {
    const rr = (el) => {
      const b = el?.getBoundingClientRect();
      return b === undefined
        ? null
        : { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      button: rr(document.querySelector('[data-start-session-button]')),
      resume: rr(document.querySelector('[data-resume-in-pane]')),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      textarea: document.querySelector('[data-phone-shell] textarea') !== null,
    };
  });
  console.log('phone terminal-only screen:', JSON.stringify(phone));
  check(
    'the Start button is on the 390px screen, whole',
    phone.button !== null &&
      phone.button.x >= 0 &&
      phone.button.x + phone.button.w <= phone.viewport.w &&
      phone.button.y + phone.button.h <= phone.viewport.h,
    JSON.stringify(phone),
  );
  check(
    'and clears 44px to the touch, same as Resume beside it',
    phone.button !== null && phone.button.h >= 44 && phone.resume !== null && phone.resume.h >= 44,
    JSON.stringify(phone),
  );
  check('no composer on the phone either', phone.textarea === false);
  await page.screenshot({ path: `${outDir}/terminal-only-phone-response.png` });
  await page.close();
}

await browser.close();
console.log(failures.length === 0 ? '\nterminal-only-shots: all checks passed.' : '');
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
