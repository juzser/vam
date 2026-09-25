/**
 * THE USAGE POPOVER, IN A REAL BROWSER -- the account icon that replaced the
 * sidebar's letter avatar, and the panel it opens, at the desktop width and
 * at 390px.
 *
 * WHY A BROWSER AND NOT A UNIT TEST. `test/panels/UsagePopover.test.tsx`
 * already holds the DOM shape and the dismissal state machine in happy-dom;
 * what it cannot hold is whether the panel actually FITS the screen it opens
 * on -- a rectangle question, and this repo has already shipped a 390px
 * defect through a fully green local gate once (`prs-tab-shots.mjs`'s own
 * header). Both viewports are measured here: the panel's own bounding box
 * must stay inside the viewport at 1280px and at 390px, never clipped.
 *
 * `?demo=1` CANNOT REACH THIS WITH REAL PROVIDER DATA -- the demo fixture has
 * no `window.api` behind it at all, so its usage popover would only ever show
 * the browser-build "desktop app" sentence. Like `getting-started-shots.mjs`
 * and `prs-tab-shots.mjs` before it, this guard stubs a full `window.api`
 * instead and pays for that exception the same way: EVERY NUMBER BELOW IS
 * INVENTED, not a real reading from any real Claude or Codex account.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5746 --strictPort
 *   node e2e/usage-popover-shots.mjs http://localhost:5746 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'e2e/test-results';

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

/** A fixture reading for each provider -- one known window, one unknown, and
 *  a per-model Claude row, so a single screenshot exercises every branch the
 *  popover draws. All of it invented; see this file's own header. */
const CLAUDE_SNAPSHOT = {
  kind: 'ok',
  windows: {
    fiveHour: { kind: 'known', percent: 42, resetsAt: new Date(Date.now() + 75 * 60_000).toISOString() },
    sevenDay: {
      kind: 'known',
      percent: 61,
      resetsAt: new Date(Date.now() + (4 * 24 + 20) * 60 * 60_000).toISOString(),
    },
  },
  observedAt: new Date().toISOString(),
  limits: [
    {
      id: 'weekly_scoped',
      label: 'Weekly · Opus',
      window: {
        kind: 'known',
        percent: 18,
        resetsAt: new Date(Date.now() + (4 * 24 + 20) * 60 * 60_000).toISOString(),
      },
    },
  ],
};
const CODEX_SNAPSHOT = {
  kind: 'ok',
  limits: {
    primary: {
      kind: 'known',
      percent: 11,
      windowMinutes: 300,
      resetsAt: new Date(Date.now() + 75 * 60_000).toISOString(),
    },
    secondary: {
      kind: 'known',
      percent: 2,
      windowMinutes: 10_080,
      resetsAt: new Date(Date.now() + (4 * 24 + 20) * 60 * 60_000).toISOString(),
    },
  },
  observedAt: new Date().toISOString(),
};

/** A full, minimal `PreloadSourceApi` plus the `usage` member -- the shape
 *  `getting-started-shots.mjs`'s own header explains is required: `App.tsx`
 *  takes the page off `?demo=1` the moment `window.api` is merely defined, so
 *  a partial stub reddens the whole page before a single check here runs. */
function install(args) {
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
      },
      declines: {},
      viewerScope: { kind: 'connection', note: 'stub' },
    }),
    load: async () => [],
    subscribe: () => () => {},
    recordPrompt: async () => {},
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
    usage: {
      get: async () => args.claude,
      getCodex: async () => args.codex,
    },
  };
}

const browser = await chromium.launch();

async function openPopoverOn(viewport, shotName) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
  });
  await page.addInitScript(install, { claude: CLAUDE_SNAPSHOT, codex: CODEX_SNAPSHOT });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-avatar-bar]');

  const toggle = page.getByLabel('usage');
  check(`${shotName}: the usage toggle is drawn, in place of the old letter avatar`, (await toggle.count()) === 1);
  check(`${shotName}: no panel is open at rest`, (await page.locator('[data-usage-panel]').count()) === 0);

  await toggle.click();
  await page.waitForSelector('[data-usage-panel]');
  await page.waitForTimeout(150);

  // THE PROPERTY, NOT A PROXY: the panel's own painted rectangle must sit
  // fully inside the viewport it opened in, never clipped off either edge.
  const box = await page.locator('[data-usage-panel]').boundingBox();
  const vw = viewport.width;
  const vh = viewport.height;
  check(
    `${shotName}: the panel's rectangle is entirely inside the ${vw}px viewport`,
    box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= vw && box.y + box.height <= vh,
    JSON.stringify({ box, viewport }),
  );

  const sections = await page.locator('[data-usage-provider]').evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute('data-usage-provider')),
  );
  check(`${shotName}: both providers are drawn, in table order`, JSON.stringify(sections) === JSON.stringify(['claude-code', 'codex']));

  const claudeText = await page.locator('[data-usage-provider="claude-code"]').innerText();
  const codexText = await page.locator('[data-usage-provider="codex"]').innerText();
  check(`${shotName}: Claude's 5-hour percent is on screen`, claudeText.includes('42%'), claudeText);
  check(`${shotName}: Claude's per-model weekly row is on screen`, claudeText.includes('Weekly · Opus'), claudeText);
  check(`${shotName}: Codex's 5-hour percent is on screen`, codexText.includes('11%'), codexText);
  check(`${shotName}: Codex names when it read, not just a number`, /as of .+ from the last codex session/i.test(codexText), codexText);

  await page.screenshot({ path: `${outDir}/${shotName}.png`, clip: { x: 0, y: 0, width: vw, height: Math.min(vh, box ? Math.ceil(box.y + box.height) + 20 : vh) } });
  console.log(`${outDir}/${shotName}.png`);

  // Escape closes it -- a real keyboard event, the class of bug a unit
  // environment's synthetic dispatch cannot be trusted to catch (this
  // repo's own standing lesson, `prompt-popovers-shots.mjs`'s header).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check(`${shotName}: Escape closes the panel`, (await page.locator('[data-usage-panel]').count()) === 0);

  await page.close();
}

await openPopoverOn({ width: 1280, height: 800 }, 'usage-popover-desktop');
await openPopoverOn({ width: 390, height: 844 }, 'usage-popover-phone');

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} usage popover guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('usage popover guards: all assertions passed');
