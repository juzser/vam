/**
 * Settings -> Integrations -> GitHub, painted in a real engine.
 *
 * Operator: "add an Integrations section in Settings, to connect a GitHub
 * account." `GithubPanel.tsx` is unit-tested against
 * happy-dom (`test/settings/github-panel.test.tsx`); what jsdom/happy-dom
 * cannot answer, and this file does, is whether the section actually PAINTS:
 * a real box for the status line and the Connect/Disconnect controls, in
 * both themes, logged out and logged in -- and, since the
 * settings-views restructure gave this card the Skills-card shape (item F),
 * whether the status PILL paints its own three words honestly, "gh" and
 * all.
 *
 * A DESKTOP-ONLY SECTION, WITH NO PRELOAD BRIDGE IN THE BROWSER BUILD --
 * `settings-chrome-shots.mjs`'s own Remote example is the template: `?demo=1`
 * with `window.api.github` supplied by `addInitScript`, never a real `gh`
 * spawn or a real Keychain read. Every account name and host below is
 * invented.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/integrations-github-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const LOGGED_OUT = { kind: 'logged-out' };
const CLI_MISSING = { kind: 'cli-missing', message: 'gh: command not found' };
const LOGGED_IN = {
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

const browser = await chromium.launch();

/** A page with `window.api.github` answering `status`, and Settings open on
 *  the Integrations section. Mirrors `settings-chrome-shots.mjs`'s own
 *  `REMOTE_STUB` page: `window.api` holds ONLY what this section reads, so a
 *  missing member elsewhere in the app is exactly as absent as it is on a
 *  real browser build with no bridge at all.
 *
 * ONE MEASURED CONSEQUENCE OF THAT TECHNIQUE, shared with every other guard
 * in this file's family: `App.tsx`'s own top-level branch is
 * `window.api !== undefined ? DesktopCanvas : isDemo() ? DemoCanvas : ...`,
 * so setting ANY `window.api` before navigation -- exactly what this stub and
 * `REMOTE_STUB` both do -- makes the app render `DesktopCanvas` with this
 * incomplete stub, never `DemoCanvas` with its fixture projects. Verified:
 * the same page, with only `REMOTE_STUB` applied, shows "No sessions yet"
 * too. Every OTHER guard in this family draws a panel that does not need a
 * project (Remote, Update), and so does this one now that the repo picker is
 * gone from the card (vam-ux-1 task-7). */
async function openIntegrations(status, theme) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((state) => {
    globalThis.window.api = {
      ...(globalThis.window.api ?? {}),
      github: {
        authStatus: async () => state,
        connectStart: async () => null,
        connectRead: async () => ({ kind: 'none' }),
        reposList: async () => ({ kind: 'ok', repos: [] }),
        orgsList: async () => ({ kind: 'ok', orgs: [] }),
        projectRemotes: async () => [],
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
  await page.waitForSelector('[data-github-status]', { timeout: 5_000 });
  return page;
}

console.log('=== Settings -> Integrations -> GitHub, logged out and logged in, both themes');
for (const theme of ['dark', 'light']) {
  for (const [name, status] of [
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
      const pill = document.querySelector('[data-github-status-pill]');
      return {
        status: document.querySelector('[data-github-status]')?.textContent ?? null,
        pillKind: pill?.getAttribute('data-github-status-pill') ?? null,
        pillBox: box('[data-github-status-pill]'),
        account: document.querySelector('[data-github-account]')?.textContent ?? null,
        connect: box('[data-github-connect]'),
        disconnect: box('[data-github-disconnect]'),
        repoPicker: document.querySelector('[data-github-repo-current], [data-github-repo-noproject]') !== null,
        overflowX: port === null ? null : port.scrollWidth - port.clientWidth,
      };
    });
    console.log(
      `  [${theme}/${name}] status="${state.status}" pill=${state.pillKind} account=${state.account}`,
    );

    if (state.status === null || state.status === '') {
      throw new Error(`[${theme}/${name}] the Integrations panel drew no status line at all`);
    }
    // THE SKILLS-CARD SHAPE'S OWN PILL (item F), painted -- not merely typed.
    if (state.pillBox === null || state.pillBox.height === 0) {
      throw new Error(`[${theme}/${name}] the status pill did not paint`);
    }
    if (name === 'logged-out' && state.pillKind !== 'not-connected') {
      throw new Error(`[${theme}/${name}] the pill reads ${state.pillKind}, not "not-connected"`);
    }
    if (name === 'logged-in' && state.pillKind !== 'connected') {
      throw new Error(`[${theme}/${name}] the pill reads ${state.pillKind}, not "connected"`);
    }
    if (name === 'logged-out' && state.account !== null) {
      throw new Error(`[${theme}/${name}] an account line drew while logged out`);
    }
    if (name === 'logged-in' && (state.account === null || !state.account.includes('octocat'))) {
      throw new Error(`[${theme}/${name}] "Logged in as" did not name the fixture's own account`);
    }
    if (name === 'logged-out' && (state.connect === null || state.connect.height === 0)) {
      throw new Error(`[${theme}/${name}] no painted Connect button while logged out`);
    }
    if (name === 'logged-in' && (state.disconnect === null || state.disconnect.height === 0)) {
      throw new Error(`[${theme}/${name}] no painted Disconnect button while logged in`);
    }
    // NO HORIZONTAL OVERFLOW, at the width this dialog actually opens at --
    // the operator's own rule for every surface in this app.
    if (state.overflowX !== null && state.overflowX > 1) {
      throw new Error(
        `[${theme}/${name}] the settings scrollport overflows sideways by ${state.overflowX}px`,
      );
    }
    // The repo picker was removed from this card on purpose (vam-ux-1 task-7).
    if (state.repoPicker) {
      throw new Error(`[${theme}/${name}] the removed repo picker is drawn again`);
    }

    await page.screenshot({ path: `${outDir}/settings-integrations-github-${theme}-${name}.png` });
    console.log(`${outDir}/settings-integrations-github-${theme}-${name}.png`);
    await page.close();
  }
}

// THE THIRD PILL STATE (item F): "gh not installed", painted with the one
// letter-case exception `GithubStatusPill`'s own comment argues for -- `gh`
// stays lower case rather than being title-cased by this surface's shared
// `capitalize` rule. AND, per the gh-missing GUIDE (operator request): the
// short sentence, the `brew install gh` code block with its copy button, the
// `gh auth login` step, "Check again" and both links (cli.github.com,
// brew.sh) all have to actually PAINT -- not merely exist in `github-panel
// .test.tsx`'s happy-dom tree, which cannot measure a box at all. Both
// themes, since the operator asked for before/after shots in both.
console.log('\n=== the "gh not installed" pill and its guide, both themes');
for (const theme of ['dark', 'light']) {
  const page = await openIntegrations(CLI_MISSING, theme);
  const state = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      return el === null ? null : el.getBoundingClientRect();
    };
    const pill = document.querySelector('[data-github-status-pill]');
    return {
      kind: pill?.getAttribute('data-github-status-pill') ?? null,
      text: pill?.textContent ?? null,
      verbatim: pill?.hasAttribute('data-verbatim') ?? false,
      connect: document.querySelector('[data-github-connect]') !== null,
      guide: box('[data-github-cli-guide]'),
      brewCode: document.querySelector('[data-github-guide-brew]')?.textContent ?? null,
      brewCodeBox: box('[data-github-guide-brew]'),
      copyBrew: box('[data-github-guide-copy-brew]'),
      loginCode: document.querySelector('[data-github-guide-login]')?.textContent ?? null,
      checkAgain: box('[data-github-guide-check]'),
      cliLink: document.querySelector('[data-github-cli-guide] a[href="https://cli.github.com"]') !== null,
      brewLink: document.querySelector('[data-github-cli-guide] a[href="https://brew.sh"]') !== null,
      mark: box('[data-github-mark]'),
    };
  });
  console.log(`  [${theme}] pill=${state.kind} text="${state.text}" verbatim=${state.verbatim}`);
  if (state.kind !== 'cli-missing') {
    throw new Error(`[${theme}] the pill reads ${state.kind}, not "cli-missing"`);
  }
  if (state.text !== 'gh not installed') {
    throw new Error(
      `[${theme}] the pill reads ${JSON.stringify(state.text)}, not the literal "gh not installed"`,
    );
  }
  if (!state.verbatim) {
    throw new Error(
      `[${theme}] the "gh not installed" pill is not marked data-verbatim, so capitalize would title-case "gh"`,
    );
  }
  if (state.connect) {
    throw new Error(`[${theme}] a Connect button drew with the CLI itself missing, nothing to press`);
  }
  if (state.mark === null || state.mark.height === 0) {
    throw new Error(`[${theme}] the GitHub mark did not paint on the card`);
  }
  if (state.guide === null || state.guide.height === 0) {
    throw new Error(`[${theme}] the gh-missing guide did not paint`);
  }
  if (state.brewCode !== 'brew install gh') {
    throw new Error(`[${theme}] the guide's brew command reads ${JSON.stringify(state.brewCode)}`);
  }
  if (state.brewCodeBox === null || state.brewCodeBox.height === 0) {
    throw new Error(`[${theme}] the brew command did not paint`);
  }
  if (state.copyBrew === null || state.copyBrew.height === 0) {
    throw new Error(`[${theme}] the guide's copy button did not paint`);
  }
  if (state.loginCode !== 'gh auth login') {
    throw new Error(`[${theme}] the guide's second step reads ${JSON.stringify(state.loginCode)}`);
  }
  if (state.checkAgain === null || state.checkAgain.height === 0) {
    throw new Error(`[${theme}] "Check again" did not paint`);
  }
  if (!state.cliLink) {
    throw new Error(`[${theme}] the guide draws no link to cli.github.com`);
  }
  if (!state.brewLink) {
    throw new Error(`[${theme}] the guide draws no link to brew.sh`);
  }
  await page.screenshot({ path: `${outDir}/settings-integrations-github-${theme}-cli-missing.png` });
  console.log(`${outDir}/settings-integrations-github-${theme}-cli-missing.png`);
  await page.close();
}

// AND AT THE NARROWEST DESKTOP WIDTH, NEVER SIDEWAYS. NOT 390PX: this is a
// DESKTOP-ONLY section (`sections.ts`'s own `PHONE_SECTIONS` leaves it out),
// and 390px never reaches the desktop settings shell at all -- measured, the
// same `window.api` stub every guard in this file's family uses puts the app
// on `DesktopCanvas` rather than `DemoCanvas` (see the header note above),
// and at 390px `DesktopCanvas` draws the phone shell, which has no
// `button[aria-label="settings"]` for this to click (`settings-chrome-shots
// .mjs`'s own comment: "390 is the phone shell, which draws no Keyboard
// section for this to measure" -- the same fact, for a different section).
// `NARROWEST_DESKTOP` (520px, `settings-chrome-shots.mjs`'s own constant) is
// the narrowest width the desktop shell actually draws itself at.
const NARROWEST_DESKTOP = 520;
console.log(`\n=== no horizontal overflow at ${NARROWEST_DESKTOP}px (narrowest desktop width)`);
for (const [name, status] of [
  ['logged-in', LOGGED_IN],
  // THE GUIDE'S OWN CODE BLOCKS, the width risk this file's other narrow
  // check cannot see: `LOGGED_IN` never mounts `[data-github-cli-guide]` at
  // all.
  ['cli-missing', CLI_MISSING],
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
      `[${name}] the Integrations panel overflows sideways by ${overflowX}px at ${NARROWEST_DESKTOP}px`,
    );
  }
  await page.close();
}

await browser.close();
console.log('\nSettings -> Integrations -> GitHub paints its status and its controls in both themes, with no sideways overflow.');
