/**
 * SETTINGS -> UPDATE, STUCK AND SETTLED, in the browser harness.
 *
 * This browser build has no `window.api` (no preload), so the bridge is stubbed
 * the way `settings-panels-shots.mjs` stubs `window.api.adhdSkill`. The stub
 * carries every member of `UpdateApi` (`getStatus`, `check`, `download`,
 * `dismiss`, `getAutoCheck`, `setAutoCheck`, `getLastCheck`, `openNotes`, `onStatus`).
 *
 * Two states are drawn: a `check` that never settles (the button is busy and
 * the status line reads "checking…") and a `check` that settles into the calm
 * network sentence, with the "automatically check for updates" switch present
 * in both. The real bridge is exercised by `test/electron/settings-update.test.ts`.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/settings-update-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

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

async function screenshotBothThemes(page, slug) {
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('light', t === 'light');
    }, theme);
    await page.waitForTimeout(120);
    await page.locator('[data-settings-panel="update"]').screenshot({
      path: `${outDir}/settings-update-${slug}-${theme}.png`,
    });
    console.log(`${outDir}/settings-update-${slug}-${theme}.png`);
  }
}

console.log('=== the Update section, stuck (a check that never answers)');
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  // A check that never settles, reproduced at the bridge rather than the network.
  await page.addInitScript(() => {
    globalThis.window.api = {
      ...(globalThis.window.api ?? {}),
      update: {
        getStatus: async () => ({ kind: 'idle' }),
        check: () => new Promise(() => {}),
        download: async () => ({ kind: 'idle' }),
        dismiss: async () => ({ kind: 'idle' }),
        getAutoCheck: async () => true,
        setAutoCheck: async (enabled) => enabled,
        getLastCheck: async () => null,
        openNotes: async () => true,
        onStatus: () => () => {},
      },
    };
  });
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator('[data-settings-nav-item="update"]').click();
  await page.waitForSelector('[data-update-check]', { timeout: 5_000 });
  await page.locator('[data-update-check]').click();
  // A moment for the click to register `asking`, never for the request to
  // settle -- this fetcher never does.
  await page.waitForTimeout(300);

  const busy = await page.locator('[data-update-check]').getAttribute('aria-busy');
  check('the button is busy -- the click registered', busy === 'true');
  const pending = await page.locator('[data-update-outcome]').textContent();
  check('the status line says it is checking', /checking/i.test(pending ?? ''), pending ?? '(none)');
  const switchCount = await page.locator('[data-switch="auto-update"]').count();
  check('the automatic-check switch is drawn', switchCount === 1);
  const never = await page.locator('[data-update-last-check]').textContent();
  check('the last-check line says it never checked', /never checked/i.test(never ?? ''), never ?? '(none)');

  await screenshotBothThemes(page, 'before');
  await page.close();
}

console.log(
  '\n=== the Update card, settled (the bounded timeout, or any other network fact reaching the same sentence)',
);
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  // Resolves at once to a network error, whose sentence is "GitHub could not
  // be reached…".
  await page.addInitScript(() => {
    // Main stamps the time when a check goes out; the stub does the same.
    let lastCheckAt = null;
    globalThis.window.api = {
      ...(globalThis.window.api ?? {}),
      update: {
        getStatus: async () => ({ kind: 'idle' }),
        check: async () => {
          lastCheckAt = Date.now();
          return { kind: 'error', code: 'network', message: 'network' };
        },
        download: async () => ({ kind: 'idle' }),
        dismiss: async () => ({ kind: 'idle' }),
        getAutoCheck: async () => true,
        setAutoCheck: async (enabled) => enabled,
        getLastCheck: async () => lastCheckAt,
        openNotes: async () => true,
        onStatus: () => () => {},
      },
    };
  });
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-nav]', { timeout: 5_000 });
  await page.locator('[data-settings-nav-item="update"]').click();
  await page.waitForSelector('[data-update-check]', { timeout: 5_000 });
  await page.locator('[data-update-check]').click();
  await page.waitForFunction(
    () => /reach/i.test(document.querySelector('[data-update-outcome]')?.textContent ?? ''),
    undefined,
    { timeout: 5_000 },
  );

  const outcomeText = await page.locator('[data-update-outcome]').textContent();
  check(
    'a calm sentence, never a raw code or a stack',
    typeof outcomeText === 'string' && /reach|network|connect/i.test(outcomeText),
    outcomeText ?? '(none)',
  );
  const busy = await page.locator('[data-update-check]').getAttribute('aria-busy');
  check('the button is no longer busy -- an operator can ask again', busy === 'false');
  await page.waitForFunction(
    () => /just now/i.test(document.querySelector('[data-update-last-check]')?.textContent ?? ''),
    undefined,
    { timeout: 5_000 },
  );
  const lastCheck = await page.locator('[data-update-last-check]').textContent();
  check('the last-check line moves on once the check has finished', /last checked just now/i.test(lastCheck ?? ''), lastCheck ?? '(none)');

  await screenshotBothThemes(page, 'after');
  await page.close();
}

await browser.close();
console.log(
  '\nsettings -> update: checked.',
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in settings-update-shots.mjs`);
  process.exit(1);
}
