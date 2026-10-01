/**
 * Settings -> Integrations -> GitLab, painted in a real engine --
 * `integrations-github-shots.mjs`'s own corpus, mirrored and narrowed:
 * `GitlabPanel.tsx` is unit-tested against happy-dom
 * (`test/settings/gitlab-panel.test.tsx`); what jsdom/happy-dom cannot
 * answer, and this file does, is whether the card actually PAINTS: a real
 * box for the status line and the Connect/Disconnect controls, in both
 * themes, across the three states the operator asked to see -- not
 * installed, logged out, connected.
 *
 * A DESKTOP-ONLY SECTION, WITH NO PRELOAD BRIDGE IN THE BROWSER BUILD --
 * `integrations-github-shots.mjs`'s own `openIntegrations` helper, mirrored:
 * `?demo=1` with `window.api.gitlab` (and `window.api.github`, so the
 * sibling card does not itself draw an off-state) supplied by
 * `addInitScript`, never a real `glab` spawn or a real keyring read. Every
 * account name and host below is invented.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/integrations-gitlab-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const LOGGED_OUT = { kind: 'logged-out' };
const CLI_MISSING = { kind: 'cli-missing', message: 'glab: command not found' };
const LOGGED_IN = {
  kind: 'logged-in',
  accounts: [{ host: 'gitlab.com', login: 'octocat' }],
};

const browser = await chromium.launch();

/** A page with `window.api.gitlab` answering `status`, and Settings open on
 *  the Integrations section -- `integrations-github-shots.mjs`'s own
 *  `openIntegrations`, mirrored. The GitHub card is stubbed logged-out
 *  throughout: this file's own claims are about the GitLab card, and a
 *  GitHub card left undefined would draw this section's `api === undefined`
 *  branch instead of its ordinary one, which is not what a real desktop
 *  build ever shows once one integration card is wired. */
async function openIntegrations(status, theme) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((state) => {
    globalThis.window.api = {
      ...(globalThis.window.api ?? {}),
      // `describe`/`load` answer the app's own startup read; without them the
      // page paints a red "e.describe is not a function" banner over Settings.
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
      github: {
        authStatus: async () => ({ kind: 'logged-out' }),
        connectStart: async () => null,
        connectRead: async () => ({ kind: 'none' }),
        reposList: async () => ({ kind: 'ok', repos: [] }),
        orgsList: async () => ({ kind: 'ok', orgs: [] }),
        projectRemotes: async () => [],
      },
      gitlab: {
        authStatus: async () => state,
        connectStart: async () => null,
        connectRead: async () => ({ kind: 'none' }),
      },
      clipboard: { writeText: async () => true },
    };
  }, status);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('light', t === 'light');
  }, theme);
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator('[data-settings-nav-item="integrations"]').click();
  await page.waitForSelector('[data-gitlab-status-pill]', { timeout: 5_000 });
  return page;
}

console.log('=== Settings -> Integrations -> GitLab, not-installed / logged-out / connected, both themes');
for (const theme of ['dark', 'light']) {
  for (const [name, status] of [
    ['not-installed', CLI_MISSING],
    ['logged-out', LOGGED_OUT],
    ['logged-in', LOGGED_IN],
  ]) {
    const page = await openIntegrations(status, theme);

    const state = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        return el === null ? null : el.getBoundingClientRect();
      };
      const port = document.querySelector('[data-settings-scroll]');
      const pill = document.querySelector('[data-gitlab-status-pill]');
      return {
        status: document.querySelector('[data-gitlab-status]')?.textContent ?? null,
        pillKind: pill?.getAttribute('data-gitlab-status-pill') ?? null,
        pillText: pill?.textContent ?? null,
        pillVerbatim: pill?.hasAttribute('data-verbatim') ?? false,
        pillBox: box('[data-gitlab-status-pill]'),
        account: document.querySelector('[data-gitlab-account]')?.textContent ?? null,
        connect: box('[data-gitlab-connect]'),
        disconnect: box('[data-gitlab-disconnect]'),
        mark: box('[data-gitlab-mark]'),
        guide: box('[data-gitlab-cli-guide]'),
        overflowX: port === null ? null : port.scrollWidth - port.clientWidth,
      };
    });
    console.log(
      `  [${theme}/${name}] status="${state.status}" pill=${state.pillKind} account=${state.account}`,
    );

    // Logged in, the account line carries the login and the sentence row is not drawn.
    if (name !== 'logged-in' && (state.status === null || state.status === '')) {
      throw new Error(`[${theme}/${name}] the GitLab card drew no status line at all`);
    }
    if (state.mark === null || state.mark.height === 0) {
      throw new Error(`[${theme}/${name}] the GitLab mark did not paint`);
    }
    if (state.pillBox === null || state.pillBox.height === 0) {
      throw new Error(`[${theme}/${name}] the status pill did not paint`);
    }
    if (name === 'not-installed') {
      if (state.pillKind !== 'cli-missing') {
        throw new Error(`[${theme}/${name}] the pill reads ${state.pillKind}, not "cli-missing"`);
      }
      if (state.pillText !== 'glab not installed') {
        throw new Error(
          `[${theme}/${name}] the pill reads ${JSON.stringify(state.pillText)}, not the literal "glab not installed"`,
        );
      }
      if (!state.pillVerbatim) {
        throw new Error(
          `[${theme}/${name}] the "glab not installed" pill is not marked data-verbatim, so capitalize would title-case "glab"`,
        );
      }
      if (state.connect !== null) {
        throw new Error(`[${theme}/${name}] a Connect button drew with glab itself missing`);
      }
      if (state.guide === null || state.guide.height === 0) {
        throw new Error(`[${theme}/${name}] the glab-missing guide did not paint`);
      }
    }
    if (name === 'logged-out') {
      if (state.pillKind !== 'not-connected') {
        throw new Error(`[${theme}/${name}] the pill reads ${state.pillKind}, not "not-connected"`);
      }
      if (state.account !== null) {
        throw new Error(`[${theme}/${name}] an account line drew while logged out`);
      }
      if (state.connect === null || state.connect.height === 0) {
        throw new Error(`[${theme}/${name}] no painted Connect button while logged out`);
      }
    }
    if (name === 'logged-in') {
      if (state.pillKind !== 'connected') {
        throw new Error(`[${theme}/${name}] the pill reads ${state.pillKind}, not "connected"`);
      }
      if (state.account === null || !state.account.includes('octocat')) {
        throw new Error(`[${theme}/${name}] "logged in as" did not name the fixture's own account`);
      }
      if (state.disconnect === null || state.disconnect.height === 0) {
        throw new Error(`[${theme}/${name}] no painted Disconnect button while logged in`);
      }
    }
    // NO HORIZONTAL OVERFLOW, at the width this dialog actually opens at --
    // `integrations-github-shots.mjs`'s own rule, restated.
    if (state.overflowX !== null && state.overflowX > 1) {
      throw new Error(
        `[${theme}/${name}] the settings scrollport overflows sideways by ${state.overflowX}px`,
      );
    }

    await page.screenshot({ path: `${outDir}/settings-integrations-gitlab-${theme}-${name}.png` });
    console.log(`${outDir}/settings-integrations-gitlab-${theme}-${name}.png`);
    await page.close();
  }
}

// AT THE NARROWEST DESKTOP WIDTH, NEVER SIDEWAYS -- `integrations-github-
// shots.mjs`'s own final check, mirrored, including its guide-code-block
// case (the not-installed state never mounts `[data-gitlab-cli-guide]` in
// the logged-in/out checks above).
const NARROWEST_DESKTOP = 520;
console.log(`\n=== no horizontal overflow at ${NARROWEST_DESKTOP}px (narrowest desktop width)`);
for (const [name, status] of [
  ['logged-in', LOGGED_IN],
  ['not-installed', CLI_MISSING],
]) {
  const page = await openIntegrations(status, 'dark');
  await page.setViewportSize({ width: NARROWEST_DESKTOP, height: 844 });
  const overflowX = await page.evaluate(() => {
    const port = document.querySelector('[data-settings-scroll]');
    return port === null ? 0 : port.scrollWidth - port.clientWidth;
  });
  console.log(`  [${name}] ${NARROWEST_DESKTOP}px overflowX=${overflowX}`);
  if (overflowX > 1) {
    throw new Error(
      `[${name}] the GitLab card overflows sideways by ${overflowX}px at ${NARROWEST_DESKTOP}px`,
    );
  }
  await page.close();
}

await browser.close();
console.log('\nSettings -> Integrations -> GitLab paints its status and its controls in both themes, with no sideways overflow.');
