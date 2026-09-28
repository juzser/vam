/**
 * SETTINGS FILLS THE WHOLE WINDOW -- MEASURED, NOT READ OFF A CLASS NAME.
 *
 * Operator (settings-views restructure, item A): "Make Settings (and Stats
 * & Usage) a full-width overlay -- like a separate screen, not a popup.
 * ... It should cover the whole app window below the title bar. No card-
 * modal look, no backdrop margins." `vam-modal-lg` -- the shared
 * "nearly the whole window, but not quite" class this file used to measure
 * both panels against -- is gone (`styles.css`); `[data-settings-overlay]`
 * now wears `inset-0` directly and there is no separate panel div or scrim
 * button inside it to measure instead (`SettingsOverlay.tsx`'s own comment
 * on its host `className` explains why a full-window screen has no scrim
 * left to click through to).
 *
 * STATS & USAGE IS NOT A SECOND SURFACE ANY MORE (item B): the standalone
 * `StatsScreen` overlay is deleted; the sidebar's stats icon now opens
 * Settings directly at its own "stats" section (`Canvas.tsx`'s
 * `onSidebarStats`). So this guard measures ONE host, opened two ways, and
 * checks both opens land on the same full-window rectangle.
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

/** `[data-settings-overlay]` IS the panel now -- `inset-0` on the host
 *  itself, no wrapping panel div and no scrim button beside it to pick out
 *  from a sibling. */
async function rectOf(page) {
  const box = await page.locator('[data-settings-overlay]').first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, top: r.top, left: r.left };
  });
  return box;
}

async function openViaGear(page) {
  await page.locator('button[aria-label="settings"]').first().click();
  await page.waitForSelector('[data-settings-overlay]', { timeout: 5_000 });
  const rect = await rectOf(page);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-settings-overlay]', { state: 'detached', timeout: 5_000 });
  return rect;
}

async function openViaStatsIcon(page) {
  await page.locator('button[aria-label="stats"]').first().click();
  await page.waitForSelector('[data-settings-overlay]', { timeout: 5_000 });
  // Landed on the "stats" section specifically, not merely on Settings --
  // `data-settings-panel="stats"` is the `SettingsCard` wrapper's own hook,
  // present regardless of the bridge. NOT `data-stats-panel`
  // (`StatsPanel.tsx`'s own wrapper): this fixture's `?demo=1` installs no
  // `window.api.stats`, so `StatsPanel` takes its bridge-less early return
  // (`stats are only available in the desktop app`) and never paints that
  // hook at all -- the same absence this file's own header already expects
  // of the demo fixture.
  const onStats = (await page.locator('[data-settings-panel="stats"]').count()) > 0;
  const rect = await rectOf(page);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-settings-overlay]', { state: 'detached', timeout: 5_000 });
  return { rect, onStats };
}

const round = (n) => Math.round(n * 100) / 100;
const fmt = (r) => `${round(r.width)}x${round(r.height)} @ (${round(r.left)},${round(r.top)})`;

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('button[aria-label="settings"]', { timeout: 15_000 });

  const label = `${viewport.width}x${viewport.height}`;

  const viaGear = await openViaGear(page);
  check(
    `${label}: Settings fills the window's own width (no backdrop margin)`,
    round(viaGear.width) === viewport.width,
    `${round(viaGear.width)}px !== ${viewport.width}px`,
  );
  check(
    `${label}: Settings fills the window's own height (no backdrop margin)`,
    round(viaGear.height) === viewport.height,
    `${round(viaGear.height)}px !== ${viewport.height}px`,
  );
  check(`${label}: Settings starts flush at the top-left corner`, viaGear.top === 0 && viaGear.left === 0, fmt(viaGear));

  const { rect: viaStats, onStats } = await openViaStatsIcon(page);
  check(`${label}: the sidebar stats icon opens the "stats" section, not a second surface`, onStats);
  check(
    `${label}: the stats-icon open paints the same full-window rectangle as the gear`,
    round(viaStats.width) === round(viaGear.width) && round(viaStats.height) === round(viaGear.height),
    `gear ${fmt(viaGear)} vs stats-icon ${fmt(viaStats)}`,
  );

  await page.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(
  'modal-size: Settings fills the whole window at 1280x800, 1440x900 and 1920x1080, however it is opened.',
);
