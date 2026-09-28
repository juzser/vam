/**
 * Settings -> Update, under the REAL Electron shell: opens the dialog,
 * navigates to the Update card, presses "check for updates", and reports
 * whatever the page actually did -- console errors, an uncaught page error,
 * a tripped `ErrorBoundary`, or a render-process crash -- none of which a
 * `jsdom` unit test or the browser e2e harness can see (the browser build has
 * no `window.api.update` at all; see `settings/sections.ts`'s own note on
 * why Update is desktop-only).
 *
 * `app.setAppPath(...)` BEFORE `require(MAIN)`: Electron resolves
 * `app.getAppPath()` from the entry script's OWN directory when it is handed
 * a bare `.js`/`.cjs` file (measured: an entry under `test/electron/` reads
 * back `.../test/electron`, not the repo root), which is one directory short
 * of `resources/skills/i-have-adhd` -- a path `main/index.ts` builds off
 * `app.getAppPath()` for a DIFFERENT card in this same always-mounted
 * dialog (`AdhdSkillCard`, in Agents). Every other probe in this directory
 * never opens Settings, so that mismatch has never been observed before;
 * this one does, and a probe-only artifact in an unrelated card is not this
 * file's bug to report. Setting the path explicitly, before the built main
 * bundle ever reads it, keeps this run's `app.getAppPath()` answering the
 * way a real launch (packaged, or `electron .` from the repo root) already
 * does.
 */
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const REPO_ROOT = path.join(__dirname, '..', '..');
app.setAppPath(REPO_ROOT);

const { ensureHarnessRemotePort } = require('./free-port.cjs');

const MAIN = path.join(REPO_ROOT, 'out', 'main', 'index.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 30s, not the 10s `probe.cjs`/`getting-started-image-probe.cjs` use --
 * measured against a machine already busy running other work: a FRESH
 * `userData` profile pays Chromium's own cold-start cost every launch
 * (`getting-started-image-probe.cjs`'s own header), and this file additionally
 * clicks into Settings and waits out a real network round trip before it can
 * even finish, so the whole run has more contention to lose CPU time to than
 * either of those does.
 */
async function waitForWindow() {
  for (let i = 0; i < 600; i += 1) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0 && !windows[0].webContents.isLoading()) {
      return windows[0];
    }
    await sleep(50);
  }
  throw new Error('settings-update-probe: no BrowserWindow finished loading within 30s');
}

async function waitForSelector(run, selector, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await run(`document.querySelector(${JSON.stringify(selector)}) !== null`)) return;
    await sleep(50);
  }
  throw new Error(`settings-update-probe: ${selector} did not appear within ${timeoutMs}ms`);
}

async function main() {
  await ensureHarnessRemotePort();
  require(MAIN);
  await app.whenReady();
  const win = await waitForWindow();
  const contents = win.webContents;
  const run = (code) => contents.executeJavaScript(code, true);

  const consoleErrors = [];
  // `level` 2 is 'error' in the (deprecated but still current in this
  // Electron) five-arg `console-message` signature `probe.cjs` already uses.
  contents.on('console-message', (_event, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });

  let renderProcessGone = null;
  contents.on('render-process-gone', (_event, details) => {
    renderProcessGone = details;
  });

  await waitForSelector(run, '[aria-label="settings"]');

  // A page-level net this probe's own console-message listener cannot be
  // certain covers -- `window.onerror`/`unhandledrejection` are the two
  // routes a render throw or a rejected promise reach the page itself by,
  // installed before anything here clicks a single control.
  await run(`(() => {
    window.__vamProbeErrors = [];
    window.addEventListener('error', (e) => {
      window.__vamProbeErrors.push('error: ' + (e.message || String(e)));
    });
    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason;
      window.__vamProbeErrors.push(
        'unhandledrejection: ' + (reason && reason.message ? reason.message : String(reason)),
      );
    });
  })(); undefined`);

  await run(`document.querySelector('[aria-label="settings"]').click(); undefined`);
  await waitForSelector(run, '[data-settings-overlay]');

  await run(`document.querySelector('[data-settings-nav-item="update"]').click(); undefined`);
  await waitForSelector(run, '[data-settings-panel="update"]');

  const versionText = await run(
    "document.querySelector('[data-update-version]')?.textContent ?? null",
  );

  await run(`document.querySelector('[data-update-check]')?.click(); undefined`);
  // The real GitHub endpoint answers in well under a second on an ordinary
  // connection; `UPDATE_CHECK_TIMEOUT_MS` bounds the unbounded case at 10s
  // (`main/update/check.ts`), so 12s covers a genuine reply and the bounded
  // one both, without this probe waiting the full worst case every run.
  await run(`(async () => {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const el = document.querySelector('[data-update-outcome]');
      if (el && el.textContent) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })()`);

  const outcomeText = await run(
    "document.querySelector('[data-update-outcome]')?.textContent ?? null",
  );
  const checkButtonState = await run(`(() => {
    const btn = document.querySelector('[data-update-check]');
    return btn ? { disabled: btn.disabled, ariaBusy: btn.getAttribute('aria-busy'), text: btn.textContent } : null;
  })()`);
  const renderFailureText = await run(
    "document.querySelector('[data-testid=\"render-failure\"]')?.textContent ?? null",
  );
  const pageErrors = await run('window.__vamProbeErrors ?? []');

  const result = {
    versionText,
    outcomeText,
    checkButtonState,
    renderFailureText,
    pageErrors,
    consoleErrors,
    renderProcessGone,
  };

  process.stdout.write(`VAM_SETTINGS_UPDATE_RESULT ${JSON.stringify(result)}\n`);
  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`VAM_SETTINGS_UPDATE_ERROR ${error?.stack ?? error}\n`);
  app.exit(1);
});
