/**
 * SETTINGS AND STATS & USAGE ARE THE SAME SIZE -- MEASURED, NOT READ OFF A
 * CLASS NAME.
 *
 * Operator: "Make the Settings popup bigger. The Stats & Usage screen should
 * be the same size." Both panels now wear one shared class, `vam-modal-lg`
 * (`styles.css`; `test/renderer/modal-size.test.ts` holds that as a content
 * scan). This is the real-browser half of that claim: at 1280x800 and
 * 1920x1080, opened one at a time in the same page, the two panels'
 * `getBoundingClientRect()` are pixel-IDENTICAL, and each clears 90% of the
 * viewport's own width once the shared 64px margin is subtracted -- "nearly
 * the whole window", not merely "bigger than it used to be". A stylesheet
 * read cannot tell the two apart from a pair of arbitrary values that merely
 * happen to agree; only a paint can.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/modal-size-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';

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

/** The panel div itself -- the element `vam-modal-lg` is on, never the
 *  full-bleed scrim button beside it. */
async function rectOf(page, hostSelector) {
  const box = await page.locator(`${hostSelector} > :not(button)`).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, top: r.top, left: r.left };
  });
  return box;
}

async function settingsRect(page) {
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-overlay]', { timeout: 5_000 });
  const rect = await rectOf(page, '[data-settings-overlay]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-settings-overlay]', { state: 'detached', timeout: 5_000 });
  return rect;
}

async function statsRect(page) {
  await page.locator('[aria-label="stats"]').click();
  await page.waitForSelector('[data-stats-screen]', { timeout: 5_000 });
  const rect = await rectOf(page, '[data-stats-screen]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-stats-screen]', { state: 'detached', timeout: 5_000 });
  return rect;
}

const round = (n) => Math.round(n * 100) / 100;
const fmt = (r) => `${round(r.width)}x${round(r.height)} @ (${round(r.left)},${round(r.top)})`;

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });

  const settings = await settingsRect(page);
  const stats = await statsRect(page);

  const label = `${viewport.width}x${viewport.height}`;
  const identical =
    round(settings.width) === round(stats.width) &&
    round(settings.height) === round(stats.height) &&
    round(settings.top) === round(stats.top) &&
    round(settings.left) === round(stats.left);
  check(
    `${label}: Settings and Stats & Usage paint the identical rectangle`,
    identical,
    `settings ${fmt(settings)} vs stats ${fmt(stats)}`,
  );

  // The operator's own floor: 90% of the viewport's width once the shared
  // 64px margin (`vam-modal-lg`'s own `calc(100vw - 64px)`) is subtracted.
  const MARGIN = 64;
  const floorWidth = (viewport.width - MARGIN) * 0.9;
  check(
    `${label}: Settings clears 90% of the viewport width minus margin`,
    settings.width >= floorWidth,
    `${round(settings.width)}px < ${round(floorWidth)}px`,
  );
  check(
    `${label}: Stats & Usage clears 90% of the viewport width minus margin`,
    stats.width >= floorWidth,
    `${round(stats.width)}px < ${round(floorWidth)}px`,
  );

  await page.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(
  'modal-size: Settings and Stats & Usage paint the identical, near-full-window rectangle at 1280x800 and 1920x1080.',
);
