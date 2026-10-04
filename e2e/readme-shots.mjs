/**
 * THE README'S OWN SCREENSHOTS, RETAKEN AGAINST THE CURRENT BUILD.
 *
 * Ten pictures, all `docs/assets/readme/`, all `?demo=1` fixture data or an
 * in-page `window.api` stub whose every value is invented (the same
 * technique `start-screen-shots.mjs`, `usage-popover-shots.mjs`,
 * `settings-chrome-shots.mjs`, `integrations-github-shots.mjs` and
 * `worktrees-shots.mjs` already use, each cited at its own block below) --
 * never a real session, path, token or account name:
 *
 *   status-usage.png     the avatar bar's usage popover, Claude + Codex.
 *   question-card.png    an AskUserQuestion card, open mid-conversation.
 *   sidebar-filters.png  Workspace options — group/sort/status filters and
 *                        the worktree toggles.
 *   phone-pairing.png    Settings → Remote — the pairing QR over Tailscale
 *                        Serve.
 *   phone-session.png    that same session, answered from a 390px phone.
 *   settings-overlay.png the full-window Settings overlay and its section
 *                        list.
 *   integrations.png     the GitHub (`gh`) and GitLab (`glab`) cards.
 *   command-suggest.png  the `!` command-suggestion list open in the prompt.
 *   keyboard-settings.png Settings → Keyboard, a contested chord's red
 *                        conflict dot with its tooltip open (PR #553).
 *   hero.png             the tab shell itself — sidebar, sessions as tabs,
 *                        one session's Response view with its IN/OUT.
 *
 * WHY NO TERMINAL OR IMAGE-ATTACH SHOT. `terminalTab` in `canvas/Canvas.tsx`
 * is `source.kind === 'session' && source.source.capabilities.terminal` —
 * always `false` for `?demo=1` (`source: { kind: 'demo', ... }` in `App.tsx`),
 * so `visibleTabs()` (`panels/tabs.ts`) withdraws the Terminal tab from the bar
 * entirely in demo mode; there is no button to click. That is by design, not
 * an oversight: the Terminal tab reads a real `tmux capture-pane`, and demo
 * mode has no pane to read — showing one would mean either a fabricated
 * transcript-shaped string (dishonest) or routing through a stub HTTP source
 * instead of `?demo=1` (breaks the "every screenshot is `?demo=1`" rule this
 * repo holds elsewhere, `phone-list-shots.mjs`'s own header states why: "live
 * mode would put a real workspace, with real paths and real session ids, into
 * a public repo"). The image-attach button (`data-attach-image`,
 * `DetailPanel.tsx`) is drawn only when `pickImageAttachment !== undefined`,
 * and `Canvas.tsx` passes that prop only for `source.kind === 'session'` —
 * `undefined` for `?demo=1`, same gate, same reason: it opens a native OS
 * dialog only the Electron desktop shell has. Both stay documented in prose
 * and undepicted.
 *
 * Run by hand, against a running preview server:
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5529
 *   node e2e/readme-shots.mjs http://localhost:5529 docs/assets/readme
 *
 * Not wired into `e2e/run-web-guards.mjs`: like `phone-list-shots.mjs` and
 * `pane-refinements-shots.mjs`, this asserts very little and exists to
 * produce pictures for docs, not to gate CI. See `e2e/README.md`.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5529';
const outDir = process.argv[3] ?? 'docs/assets/readme';
// Hides ONLY the demo strip's text (the `text-waiting` span `SourceReadout`
// draws for `source.kind === 'demo'`), not the whole `[data-source]` cell.
const DEMO_STRIP_CSS = '[data-source] > .text-waiting { visibility: hidden !important; }';
mkdirSync(outDir, { recursive: true });

/**
 * `Mod`, AS THIS MACHINE SPELLS IT. `chords.ts` resolves `Mod-<letter>` to the
 * COMMAND key, and on macOS that is Meta alone -- `digitChord`/`chordOf` accept
 * Control for exactly two gestures (`d` and `u`) and for nothing else. So the
 * literal `Control+k` this script used to press produced `Ctrl-k`, which is
 * bound to nothing, and the palette never opened: the script worked on CI's
 * Linux and could not be run on the maintainer's own machine, which is where
 * README screenshots actually get taken. Measured here 2026-09-18 -- the
 * palette shot timed out on `getByPlaceholder('go to session…')` until this
 * line existed.
 */
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const browser = await chromium.launch();

/** Stop every running CSS animation (breathing dots, the "..." ellipsis) so
 *  two runs of this script produce the same pixels rather than whichever
 *  frame the animation happened to be on. */
async function freeze(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.currentTime = 0;
      a.pause();
    }
  });
}

/** The README rewrite's own desktop viewport: 1440x900, retina, dark --
 *  held constant across every block below so all ten pictures read as one
 *  consistent set. The phone blocks (6, 7 below) are the one deliberate
 *  exception -- 390px is the point of them. */
const DESKTOP = { width: 1440, height: 900 };
const RETINA = 2;

function assert(label, ok, detail) {
  if (!ok) throw new Error(`${label}${detail === undefined ? '' : ` — ${detail}`}`);
  console.log(`  ok  ${label}`);
}

/** A minimal `describe()` answer, shared by every block below that merges a
 *  single feature's stub onto `...(window.api ?? {})` (the `settings-chrome-
 *  shots.mjs` / `integrations-github-shots.mjs` idiom): whatever calls
 *  `window.api.describe()` on load needs SOME answer, or the page throws
 *  "e.describe is not a function" and paints a red error banner over
 *  everything else -- measured here, the first pass through blocks 9, 11 and
 *  12 before this existed. */
function baseApiStub() {
  globalThis.window.api = {
    describe: async () => ({
      id: 'claude-code',
      label: 'Claude Code',
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
        terminal: false,
        agentRoster: false,
        resumeSession: false,
      },
      declines: {},
      viewerScope: { kind: 'connection', note: 'stub' },
    }),
    load: async () => [],
    subscribe: () => () => {},
  };
}

// ── 2. STATUS & USAGE — the avatar bar's popover, Claude + Codex together ──
// `?demo=1` cannot reach this either (`usage-popover-shots.mjs`'s own
// header): the demo fixture installs no `window.api` at all, so this reuses
// that file's exact `install` stub and its two invented snapshots.
{
  const CLAUDE_SNAPSHOT = {
    kind: 'ok',
    windows: {
      fiveHour: {
        kind: 'known',
        percent: 42,
        resetsAt: new Date(Date.now() + 75 * 60_000).toISOString(),
      },
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

  function installUsage(args) {
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

  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: RETINA });
  page.on('pageerror', (err) => console.error('STATUS-USAGE PAGE ERROR:', err));
  await page.addInitScript(installUsage, { claude: CLAUDE_SNAPSHOT, codex: CODEX_SNAPSHOT });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-avatar-bar]');
  await page.getByLabel('usage').click();
  await page.waitForSelector('[data-usage-panel]', { timeout: 5_000 });
  // UsagePopover lazy-loads UsagePopoverPanel inside Suspense, so the panel
  // shell can appear before its provider sections do: wait for what is read.
  const before = await page.locator('[data-usage-provider]').count();
  await page.waitForSelector('[data-usage-provider="codex"]', { timeout: 5_000 });
  console.log('usage providers before wait:', before);
  const providers = await page
    .locator('[data-usage-provider]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-usage-provider')));
  console.log('usage popover providers:', JSON.stringify(providers));
  assert(
    'both Claude Code and Codex are shown',
    providers.includes('claude-code') && providers.includes('codex'),
    JSON.stringify(providers),
  );

  await page.waitForTimeout(150);
  await freeze(page);
  await page.screenshot({ path: `${outDir}/status-usage.png` });
  console.log(`${outDir}/status-usage.png`);
  await page.close();
}

// ── 3. THE QUESTION CARD — an AskUserQuestion mid-conversation ─────────────
// Pure `?demo=1`: `vam-preview-1` ("notes" project) carries one open
// single-select question (`key-truth-shots.mjs`'s own `PREVIEW_SESSION`),
// reached with no stub at all.
{
  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: RETINA });
  page.on('pageerror', (err) => console.error('QUESTION-CARD PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator('[data-session-row="vam-preview-1"]').first().click();
  await page.waitForSelector('[data-question-option]', { timeout: 5_000 });

  const shape = await page.evaluate(() => ({
    open: document.querySelector('[data-question]')?.getAttribute('data-question-open'),
    options: document.querySelectorAll('[data-question-option]').length,
    text: document.querySelector('[data-question-text]')?.textContent ?? null,
  }));
  console.log('question card:', JSON.stringify(shape));
  assert('the question card is open, mid-conversation', shape.open === 'true', JSON.stringify(shape));
  assert('it has options to pick from', shape.options > 0, JSON.stringify(shape));

  await page.waitForTimeout(150);
  await freeze(page);
  await page.screenshot({ path: `${outDir}/question-card.png` });
  console.log(`${outDir}/question-card.png`);
  await page.close();
}

// ── 4. SIDEBAR FILTERS + WORKTREE GROUPING ──────────────────────────────────
// `WorktreesSection` reads `window.api.worktrees` directly (`worktrees-
// shots.mjs`'s own header), so the sidebar's own filter popover (which
// `?demo=1` alone CAN open) is combined here with that file's own minimal
// `PreloadSourceApi` + `worktrees` stub so one picture proves both: the
// "N hidden" filter affordance, and a project's own nested worktree rows.
{
  const PROJECT_ID = 'claude-code:vam-11112222';
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
  const INITIAL_WORKTREE = {
    worktreeId: '/Users/operator/code/vam-worktrees/fix-terminal-echo',
    path: '/Users/operator/code/vam-worktrees/fix-terminal-echo',
    branch: 'fix-terminal-echo',
    projectId: 'claude-code:fix-terminal-echo-99998888',
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    detached: false,
    external: false,
  };

  function installWorktrees({ projectId, worktrees }) {
    globalThis.window.__worktreesStore = worktrees.map((w) => ({ ...w }));
    globalThis.window.api = {
      describe: async () => ({
        id: 'worktrees-stub',
        label: 'Worktrees stub',
        capabilities: window.__worktreesCapabilities,
        declines: {},
        viewerScope: 'operator',
      }),
      load: async () => [
        {
          id: projectId,
          name: 'vam',
          source: 'claude-code',
          sessions: [
            {
              id: 'claude:main-session',
              title: 'main session',
              epic: null,
              branch: 'main',
              status: 'idle',
              runningAgents: 0,
              activity: null,
              age: '2m',
              decisions: [],
              source: 'claude-code',
            },
            {
              id: 'claude:waiting-session',
              title: 'waiting session',
              epic: null,
              branch: 'main',
              status: 'waiting',
              runningAgents: 0,
              activity: null,
              age: '4m',
              decisions: [],
              source: 'claude-code',
            },
          ],
        },
        {
          id: 'claude-code:vam-notes-33334444',
          name: 'notes',
          source: 'claude-code',
          sessions: [
            {
              id: 'claude:notes-1',
              title: 'notes-1',
              epic: null,
              branch: 'main',
              status: 'done',
              runningAgents: 0,
              activity: null,
              age: '9m',
              decisions: [],
              source: 'claude-code',
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
      resumeSession: async () => {},
      pickImageAttachment: async () => null,
      history: async () => ({
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'not in this picture' },
      }),
      agentWork: async () => ({
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'not in this picture' },
      }),
      applyWaivers: async () => {},
      transitionLesson: async () => {},
      worktrees: {
        list: async (askedProjectId) =>
          askedProjectId === projectId ? window.__worktreesStore : [],
        create: async (input) => {
          const worktree = {
            worktreeId: `/Users/operator/code/vam-worktrees/${input.name}`,
            path: `/Users/operator/code/vam-worktrees/${input.name}`,
            branch: input.name,
            projectId: `claude-code:${input.name}-00000000`,
            locked: false,
            lockReason: null,
            prunable: false,
            prunableReason: null,
            detached: false,
            external: false,
          };
          window.__worktreesStore = [...window.__worktreesStore, worktree];
          return worktree;
        },
        remove: async (input) => {
          window.__worktreesStore = window.__worktreesStore.filter(
            (w) => w.worktreeId !== input.worktreeId,
          );
          return { preservedBranch: false };
        },
        status: async () => [],
      },
    };
  }

  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: RETINA });
  page.on('pageerror', (err) => console.error('SIDEBAR-FILTERS PAGE ERROR:', err));
  await page.addInitScript((caps) => {
    window.__worktreesCapabilities = caps;
  }, CAPABILITIES);
  await page.addInitScript(installWorktrees, { projectId: PROJECT_ID, worktrees: [INITIAL_WORKTREE] });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-session-row]', { timeout: 10_000 });
  // `hideWorktrees` ships ON (no Worktrees section is drawn), so turn "Show
  // worktrees" on from the filter popover first, as `worktrees-shots.mjs` does.
  await page.locator('button[aria-label="filter sessions"]').click();
  await page.waitForSelector('[data-origin-toggle="worktrees"]', { timeout: 5_000 });
  await page.locator('[data-origin-toggle="worktrees"]').click();
  await page.locator('button[aria-label="filter sessions"]').click();
  await page.waitForSelector('[data-worktree-row]', { timeout: 5_000 });

  await page.locator('button[aria-label="filter sessions"]').click();
  await page.waitForSelector('[data-filter-menu]', { timeout: 5_000 });

  const shape = await page.evaluate(() => ({
    groups: document.querySelectorAll('[data-project-heading]').length,
    worktreeRows: document.querySelectorAll('[data-worktree-row]').length,
    filterOpen: document.querySelector('[data-filter-menu]') !== null,
  }));
  console.log('sidebar filters:', JSON.stringify(shape));
  assert('two projects are in the sidebar', shape.groups >= 2, JSON.stringify(shape));
  assert('a worktree row is nested under its project', shape.worktreeRows >= 1, JSON.stringify(shape));
  assert('the filter popover is open', shape.filterOpen);

  await page.waitForTimeout(150);
  await freeze(page);
  await page.screenshot({ path: `${outDir}/sidebar-filters.png` });
  console.log(`${outDir}/sidebar-filters.png`);
  await page.close();
}

// ── 5. PHONE PAIRING — the QR, from Settings → Remote ───────────────────────
// The QR (`QrAddress`, `data-testid="pairing-qr"`) only ever draws once
// `tailscale serve` is reported `enabled` AND the viewport is not itself a
// phone's (`usePhoneViewport`) -- it is the code a PHONE camera reads, drawn
// on the machine running vam, exactly `settings-chrome-shots.mjs`'s own
// `REMOTE_STUB` pattern with `serve.enabled: true` and a pairing code
// present. Every address and code below is invented.
{
  const REMOTE_STUB = {
    view: {
      code: '4829 1067',
      expiresAtMs: Date.now() + 8 * 60_000,
      burned: false,
      throttledUntilMs: 0,
      awaiting: null,
      pairedName: null,
    },
    devices: [],
    address: { kind: 'found', url: 'https://example-host.example-tailnet.ts.net:7777' },
    allowWrites: false,
    registry: null,
    serve: { enabled: true, lastError: null, timedOut: false, tailnetServeDisabledUrl: null },
    serverError: null,
    writesPreference: false,
    nowMs: Date.now(),
  };

  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: RETINA });
  page.on('pageerror', (err) => console.error('PHONE-PAIRING PAGE ERROR:', err));
  await page.addInitScript(baseApiStub);
  await page.addInitScript((state) => {
    const answer = () => Promise.resolve(state);
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
  await page.waitForSelector('[data-testid="pairing-qr"]', { timeout: 5_000 });

  const shape = await page.evaluate(() => ({
    qr: document.querySelector('[data-testid="pairing-qr"]') !== null,
    code: document.querySelector('[data-testid="pairing-code"]')?.textContent ?? null,
  }));
  console.log('phone pairing:', JSON.stringify(shape));
  assert('the pairing QR is drawn', shape.qr, JSON.stringify(shape));

  await page.waitForTimeout(150);
  await freeze(page);
  await page.screenshot({ path: `${outDir}/phone-pairing.png` });
  console.log(`${outDir}/phone-pairing.png`);
  await page.close();
}

// ── 6. A LIVE SESSION, FROM THE PHONE — answering a question ───────────────
// `phone-question-shots.mjs`'s own fixture: `vam-preview-1` ("notes"
// project), `vamControlled: true`, one open single-select question, now
// inline in the transcript's own scroller. Pure `?demo=1`, 390px, no stub.
{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: RETINA,
    hasTouch: true,
    isMobile: true,
  });
  page.on('pageerror', (err) => console.error('PHONE-SESSION PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-phone-shell="list"]');
  await page.locator('[data-session-row="vam-preview-1"]').first().click();
  await page.waitForSelector('[data-phone-shell="session"]');
  await page.waitForSelector('[data-phone-shell] [data-question-option]', { timeout: 5_000 });

  const shape = await page.evaluate(() => ({
    inline: document.querySelector('[data-phone-shell] [data-question-bar-inline]') !== null,
    options: document.querySelectorAll('[data-phone-shell] [data-question-option]').length,
  }));
  console.log('phone session:', JSON.stringify(shape));
  assert('the question sits inline in the phone transcript', shape.inline, JSON.stringify(shape));
  assert('it has options to pick from', shape.options > 0, JSON.stringify(shape));

  await page.waitForTimeout(150);
  await freeze(page);
  await page.screenshot({ path: `${outDir}/phone-session.png` });
  console.log(`${outDir}/phone-session.png`);
  await page.close();
}

// ── 7. SETTINGS — the full-window overlay, its section list ────────────────
// `skills` hides wherever `window.api` is absent (`isDesktopOnlySection`,
// `settings-panels-shots.mjs`'s own header); this stubs the ADHD skill
// bridge that file already uses, the minimal member Settings' Skills section
// reads, so the nav's own section list includes it honestly.
{
  const NOT_INSTALLED = {
    overall: 'not-installed',
    agents: [
      { agent: 'claude', state: 'not-installed', dir: '~/.claude/skills/i-have-adhd' },
      { agent: 'codex', state: 'not-installed', dir: '~/.agents/skills/i-have-adhd' },
    ],
  };

  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: RETINA });
  page.on('pageerror', (err) => console.error('SETTINGS-OVERLAY PAGE ERROR:', err));
  await page.addInitScript(baseApiStub);
  await page.addInitScript((status) => {
    const answer = () => Promise.resolve(status);
    globalThis.window.api = {
      ...(globalThis.window.api ?? {}),
      adhdSkill: { status: answer, install: answer, remove: answer },
      clipboard: { writeText: async () => true },
      link: { open: async () => true },
    };
  }, NOT_INSTALLED);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });

  const sections = await page
    .locator('[data-settings-nav-item]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-settings-nav-item')));
  console.log('settings sections:', JSON.stringify(sections));
  assert('Skills is one of the sections', sections.includes('skills'), JSON.stringify(sections));

  await page.waitForTimeout(150);
  await freeze(page);
  await page.screenshot({ path: `${outDir}/settings-overlay.png` });
  console.log(`${outDir}/settings-overlay.png`);
  await page.close();
}

// ── 8. INTEGRATIONS — GitHub and GitLab cards together ──────────────────────
// `integrations-gitlab-shots.mjs`'s own note: "window.api.gitlab (and
// window.api.github, so the card sits beside its neighbour)" -- both stubbed
// logged in at once, neither a real `gh`/`glab` account.
{
  const GITHUB_LOGGED_IN = {
    kind: 'logged-in',
    accounts: [
      {
        host: 'github.com',
        login: 'octocat',
        active: true,
        tokenSource: 'keyring',
        scopes: ['gist', 'read:org', 'repo'],
        missingScopes: [],
      },
    ],
  };
  const GITLAB_LOGGED_IN = { kind: 'logged-in', accounts: [{ host: 'gitlab.com', login: 'octocat' }] };

  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: RETINA });
  page.on('pageerror', (err) => console.error('INTEGRATIONS PAGE ERROR:', err));
  await page.addInitScript(baseApiStub);
  await page.addInitScript(
    (state) => {
      globalThis.window.api = {
        ...(globalThis.window.api ?? {}),
        github: {
          authStatus: async () => state.github,
          connectStart: async () => null,
          connectRead: async () => ({ kind: 'none' }),
          reposList: async () => ({ kind: 'ok', repos: [] }),
          orgsList: async () => ({ kind: 'ok', orgs: [] }),
          projectRemotes: async () => [],
        },
        gitlab: {
          authStatus: async () => state.gitlab,
          connectStart: async () => null,
          connectRead: async () => ({ kind: 'none' }),
        },
        clipboard: { writeText: async () => true },
      };
    },
    { github: GITHUB_LOGGED_IN, gitlab: GITLAB_LOGGED_IN },
  );
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator('[data-settings-nav-item="integrations"]').click();
  await page.waitForSelector('[data-github-status-pill]', { timeout: 5_000 });
  await page.waitForSelector('[data-gitlab-status-pill]', { timeout: 5_000 });

  const shape = await page.evaluate(() => ({
    github: document.querySelector('[data-github-account-line]')?.textContent ?? null,
    gitlab: document.querySelector('[data-gitlab-account-line]')?.textContent ?? null,
  }));
  console.log('integrations:', JSON.stringify(shape));
  assert('both GitHub and GitLab cards are drawn', shape.github !== null && shape.gitlab !== null, JSON.stringify(shape));

  await page.waitForTimeout(150);
  await freeze(page);
  await page.screenshot({ path: `${outDir}/integrations.png` });
  console.log(`${outDir}/integrations.png`);
  await page.close();
}

// ── 9b. COMMAND SUGGESTION — `!` plus a partial command, list open ─────────
// Pure `?demo=1`: `factory-sse-1` has a proposed command and no open question,
// and typing `!` in its box lists the shell commands earlier turns proposed (`data-bang-suggest`), narrowing as
// more is typed. Typed one key at a time, as a person does.
{
  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: RETINA });
  page.on('pageerror', (err) => console.error('COMMAND-SUGGEST PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  // `factory-sse-1` carries a proposed command (`smith findings raise ...`).
  // Every demo session that has one also holds a pending card (a permission
  // prompt here, a question on `vam-build-1`) drawn just above the box, which
  // is where the list opens -- so the card is taken off this one page, in the
  // shot script alone, and the list stands over the transcript by itself.
  await page.locator('[data-session-row="factory-sse-1"]').first().click();
  await page.waitForTimeout(200);
  const chat = page.locator('[data-question-chat]');
  if ((await chat.count()) > 0) await chat.click();
  await page.addStyleTag({ content: '[data-question] { display: none !important; }' });
  await page.waitForSelector('[data-prompt-box] textarea');
  const box = page.locator('[data-prompt-box] textarea');
  await box.click();
  await page.keyboard.type('!smith', { delay: 12 });
  await page.waitForSelector('[data-bang-suggest]', { timeout: 5_000 });

  const rows = await page
    .locator('[data-bang-suggestion] [data-bang-command]')
    .allTextContents();
  console.log('command suggestion rows:', JSON.stringify(rows));
  assert('the ! list offers commands from the session', rows.length > 0, JSON.stringify(rows));

  await page.waitForTimeout(150);
  await page.addStyleTag({ content: DEMO_STRIP_CSS });
  await freeze(page);
  await page.screenshot({ path: `${outDir}/command-suggest.png` });
  console.log(`${outDir}/command-suggest.png`);
  await page.close();
}

// ── 10. KEYBOARD SETTINGS — the conflict dot, tooltip open ─────────────────
// PR #553 (merged) also shipped a conflict dot (`data-binding-conflict`,
// `SettingsOverlay.tsx`) on EVERY row a chord is contested on, winner
// included -- `binding-conflict-dot.test.tsx`'s own fixture, replayed here:
// binding `close` to bare `r` leaves the shipped `rename` (`r`) dead behind
// it. Planted through the same `localStorage` key a real override lives in
// (`settings-chrome-shots.mjs`'s own pattern, `vam.prefs.v1`), never a real
// preference. The tooltip opens the way a keyboard does -- focus, no
// pointer -- the same shape `tooltip-shots.mjs` uses on `Note`, with one
// wrinkle THIS row needed that a lone `.focus()` does not: Radix's `Note`
// gates the portal on `:focus-visible`, which a bare programmatic
// `element.focus()` right after two prior pointer clicks (open Settings,
// pick Keyboard) does NOT set in Chromium -- measured here, `:focus-visible`
// read `false` and no tooltip opened. A `Shift+Tab` then `Tab` -- real
// keyboard traversal -- flips it to `true` and the portal opens, same
// element, same click history otherwise.
{
  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: RETINA });
  page.on('pageerror', (err) => console.error('KEYBOARD-SETTINGS PAGE ERROR:', err));
  await page.addInitScript(() => {
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ keyBindings: { close: ['r'] } }));
  });
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator('[data-settings-nav-item="keyboard"]').click();
  await page.waitForSelector('[data-binding-slot]', { timeout: 5_000 });

  const dots = await page
    .locator('[data-binding-conflict]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-binding-conflict')));
  console.log('conflict dots:', JSON.stringify(dots));
  assert(
    'both the winning and losing row carry a dot',
    dots.includes('close') && dots.includes('rename'),
    JSON.stringify(dots),
  );

  // Open the tooltip on the LOSING row, so the frame shows what it names.
  // `.focus()` first (scrolls the row into view and lands focus on it), then
  // a real Shift+Tab/Tab dance so Chromium marks it `:focus-visible` -- see
  // this block's own header for why the bare `.focus()` alone does not.
  await page.locator('[data-binding-conflict="rename"]').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.waitForSelector('[role="tooltip"]', { timeout: 3_000 });
  const tipText = await page.locator('[role="tooltip"]').first().innerText();
  console.log('conflict tooltip:', JSON.stringify(tipText));
  assert('the tooltip names the other action', tipText.toLowerCase().includes('close'), tipText);

  await page.waitForTimeout(150);
  await freeze(page);
  await page.screenshot({ path: `${outDir}/keyboard-settings.png` });
  console.log(`${outDir}/keyboard-settings.png`);
  await page.close();
}

// ── 11. THE HERO — the tab shell itself, sidebar, sessions as tabs ────────
// `factory-sse-1` is 'waiting': the README's own pitch (it colours a session
// by whether it needs you, so the waiting state should be what a reader
// actually sees) is what the hero should show, not an idle screen.
{
  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: RETINA });
  page.on('pageerror', (err) => console.error('HERO PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator('[data-session-row="factory-sse-1"]').click();
  await page.locator('[data-session-row="crosscheck-2"]').click();
  await page.locator('[data-session-row="dogfood-4"]').click();
  await page.locator('[data-session-row="factory-sse-1"]').click();
  await page.waitForSelector('[data-column-turn]');
  const tabCount = await page.locator('[data-session-tab]').count();
  console.log(`hero.png: ${tabCount} tabs open`);
  assert('3 tabs are open for the hero', tabCount >= 3, `${tabCount}`);
  await page.keyboard.press(`${MOD}+[`);
  await page.waitForTimeout(300);
  // The hero is the product's face, so the "demo data -- every write is
  // refused" readout (`[data-source]`, `SourceReadout` in Canvas.tsx) is hidden
  // here by a style injected into this shot's page alone; no product code.
  await page.addStyleTag({ content: DEMO_STRIP_CSS });
  await freeze(page);
  await page.screenshot({ path: `${outDir}/hero.png` });
  console.log(`${outDir}/hero.png`);
  await page.close();
}

await browser.close();
console.log('\nreadme-shots: done.');
