/**
 * SETTINGS -> UPDATE, STUCK AND SETTLED -- the visible half of the bug this
 * fix closes.
 *
 * `main/update/check.ts`'s `checkForUpdate` used to make one outbound `fetch`
 * with no timeout at all. A connection that neither refuses nor answers (a
 * captive portal, a firewall that drops packets instead of resetting the
 * socket, a dead VPN tunnel) left that request unsettled forever, and
 * `UpdatePanel.tsx`'s "check for updates" button -- disabled for exactly the
 * length of the request, on purpose, per `main/update/ipc.ts`'s own reasoning
 * for having no separate throttle -- stayed disabled and reading "checking…"
 * with no calm sentence ever arriving. `AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS)`
 * bounds it at 10s, after which the SAME "unknown"/"network" outcome every
 * other network failure already gets (`sentenceFor`, `UpdatePanel.tsx`)
 * arrives instead of nothing.
 *
 * This browser build has no `window.api` at all (no preload here), so the
 * two states are drawn by stubbing the bridge exactly the way
 * `settings-panels-shots.mjs` already stubs `window.api.adhdSkill` for its
 * own screenshots: `recheck()` that never resolves for BEFORE, and one that
 * resolves to the bounded timeout's own answer for AFTER. The bound itself is
 * proven for real over the real network in `test/update/check.test.ts`
 * (an injected fetcher, a fake `AbortSignal`) and `test/electron/
 * settings-update.test.ts` (the real Electron shell, the real preload, the
 * real GitHub round trip); this file's job is only the paint two operators
 * would have seen and now see instead.
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

console.log('=== the Update card, stuck (a connection that neither refuses nor answers)');
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  // A promise that never settles -- the exact defect `UPDATE_CHECK_TIMEOUT_MS`
  // exists to close, reproduced here at the bridge rather than the network.
  await page.addInitScript(() => {
    globalThis.window.api = {
      ...(globalThis.window.api ?? {}),
      update: {
        check: async () => ({ kind: 'none' }),
        recheck: () => new Promise(() => {}),
        open: async () => true,
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
  const outcomeCount = await page.locator('[data-update-outcome]').count();
  check('no outcome sentence has arrived -- nothing to show yet, on purpose', outcomeCount === 0);

  await screenshotBothThemes(page, 'before');
  await page.close();
}

console.log(
  '\n=== the Update card, settled (the bounded timeout, or any other network fact reaching the same sentence)',
);
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  // Resolves immediately, to the exact status the real bound now guarantees
  // a black-holed connection eventually reaches (`{ kind: 'unknown', reason:
  // 'network' }`, `sentenceFor`'s "GitHub could not be reached…").
  await page.addInitScript(() => {
    globalThis.window.api = {
      ...(globalThis.window.api ?? {}),
      update: {
        check: async () => ({ kind: 'none' }),
        recheck: async () => ({ kind: 'unknown', reason: 'network' }),
        open: async () => true,
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
  await page.waitForSelector('[data-update-outcome]', { timeout: 5_000 });

  const outcomeText = await page.locator('[data-update-outcome]').textContent();
  check(
    'a calm sentence, never a raw code or a stack',
    typeof outcomeText === 'string' && /reach|network|connect/i.test(outcomeText),
    outcomeText ?? '(none)',
  );
  const busy = await page.locator('[data-update-check]').getAttribute('aria-busy');
  check('the button is no longer busy -- an operator can ask again', busy === 'false');

  await screenshotBothThemes(page, 'after');
  await page.close();
}

await browser.close();
console.log(
  '\nsettings -> update: a stuck request now settles into the same calm sentence every other network failure already gets.',
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in settings-update-shots.mjs`);
  process.exit(1);
}
