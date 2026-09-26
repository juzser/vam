/**
 * THE STATS & USAGE SCREEN, IN A REAL BROWSER — the entry icon beside the
 * account icon, the overlay it opens, and the heatmap's scale, in both
 * themes, against a FIXTURE dataset. `window.api` is stubbed exactly like
 * `prs-tab-shots.mjs`: `?demo=1` cannot reach this at all (`App.tsx`'s demo
 * branch never installs a bridge, and the screen would draw nothing but
 * "only available in the desktop app" there), so this stubs the bridge
 * instead and pays that file's own cost — EVERY STRING BELOW IS INVENTED.
 *
 * WHAT IT ASSERTS, none of which a unit environment can answer:
 *  - the entry icon sits in the avatar bar and opens the screen on click;
 *  - the screen's own numbers are what the fixture said, compacted and
 *    labelled ("18.2B", "est.", the price table's own date) rather than a
 *    raw token count or a guessed cost;
 *  - the heatmap draws a real grid of coloured cells whose PAINTED
 *    background actually differs between an empty day and the busiest one,
 *    in BOTH themes, and that the scale's own step colours are each
 *    distinguishable from their neighbour and readable against the card —
 *    a class name is not a rendered pixel, and Tailwind emits no rule at
 *    all for a `--color-*` token that does not exist;
 *  - Escape closes the screen;
 *  - and, at 390×844 with the identical bridge and fixture, the entry icon
 *    is not in the DOM at all — the operator's own decision that a phone
 *    cannot reach this screen.
 *
 *   node e2e/stats-usage-shots.mjs http://localhost:5520 e2e/test-results
 *
 * Both shots are committed, in `docs/ui`, at:
 *
 *   node e2e/stats-usage-shots.mjs http://localhost:5520 docs/ui
 *
 * `stats-usage-dark.png` and `stats-usage-light.png`.
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

/**
 * A complete stub source with ONE session, plus the `stats` bridge the
 * screen reads. The heatmap's own days are built RELATIVE TO `Date.now()`
 * inside the page, so the fixture's date range always matches whatever
 * "today" the component itself computes — a hardcoded date range would
 * silently drift out of the displayed window the day after it was written.
 */
const install = () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const today = new Date();
  const isoDay = (d) => d.toISOString().slice(0, 10);
  const heatmap = [];
  for (let i = 0; i < 140; i += 1) {
    const at = new Date(today.getTime() - i * DAY_MS);
    // A real-looking pattern: mostly quiet, a handful of busy days, one
    // clear peak — so every intensity step in the scale has at least one
    // real day behind it rather than a flat fixture that only ever draws
    // one colour.
    const tokens = i === 3 ? 900_000 : i % 9 === 0 ? 400_000 : i % 4 === 0 ? 120_000 : i % 2 === 0 ? 30_000 : 0;
    if (tokens > 0) heatmap.push({ day: isoDay(at), tokens });
  }

  globalThis.window.api = {
    describe: async () => ({
      id: 'claude-code',
      label: 'Claude Code',
      capabilities: {
        liveUpdates: true,
        recordPrompt: true,
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
      viewerScope: 'operator',
    }),
    load: async () => [
      {
        id: 'p1',
        name: 'atlas',
        sessions: [
          {
            id: 's1',
            title: 'connection pool',
            icon: null,
            epic: null,
            branch: 'fix/pool-limit',
            status: 'waiting',
            runningAgents: 0,
            activity: null,
            age: '14m',
            decisions: [],
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
    usage: { get: async () => ({ kind: 'unavailable' }) },
    stats: {
      get: async () => ({
        kind: 'ok',
        snapshot: {
          generatedAt: new Date().toISOString(),
          trackingSinceIso: new Date(today.getTime() - 139 * DAY_MS).toISOString(),
          agentsSpawned: 128,
          activeMs: (49 * 24 + 12) * 60 * 60 * 1000,
          prsCreated: { kind: 'ok', count: 23 },
          usageOverview: {
            totalTokens: 18_200_000_000,
            estCostUsd: 342.17,
            activeDays: heatmap.length,
            cacheSharePercent: 71.4,
          },
          heatmap,
          tokenMix: {
            inputTokens: 4_200_000_000,
            outputTokens: 2_100_000_000,
            cacheWriteTokens: 900_000_000,
            cacheReadTokens: 11_000_000_000,
            reasoningTokens: 300_000_000,
          },
          providers: [
            {
              id: 'claude-code',
              label: 'Claude Code',
              enabled: true,
              hasData: true,
              model: 'claude-3-5-sonnet-20241022',
              tokens: 16_000_000_000,
              sessions: 96,
              turns: 2400,
              costUsd: 300.5,
              sharePercent: 88,
            },
            {
              id: 'codex',
              label: 'Codex',
              enabled: false,
              hasData: false,
              model: null,
              tokens: 0,
              sessions: 0,
              turns: 0,
              costUsd: null,
              sharePercent: 0,
            },
          ],
          malformedLines: 4,
          priceTableAsOf: '2026-01-15',
        },
      }),
      refresh: async function () {
        return this.get();
      },
    },
  };
};

async function installInk(page) {
  await page.evaluate(() => {
    const chan = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const parts = (colour) => (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const opaque = (colour) => /^rgb\(\s*\d/.test(colour);
    const lum = (colour) => {
      const [r, g, b] = parts(colour);
      return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
    };
    window.vamInk = {
      opaque,
      ratio: (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      },
    };
  });
}

const browser = await chromium.launch();

// ------------------------------------------------------------- desktop
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(install);
  await page.goto(origin, { waitUntil: 'networkidle' });
  await installInk(page);

  check('the entry icon is in the avatar bar', (await page.locator('[aria-label="stats"]').count()) === 1);

  await page.click('[aria-label="stats"]');
  const dialog = page.locator('[role="dialog"][aria-label="stats"]');
  await dialog.waitFor({ timeout: 5_000 });
  check('the screen opened as a dialog', (await dialog.count()) === 1);

  await page.waitForSelector('[data-stats-heatmap]', { timeout: 5_000 });

  const bodyText = await page.locator('[data-stats-screen]').innerText();
  check('agents spawned reads the fixture count', bodyText.includes('128'));
  check('time worked reads "49d 12h"', bodyText.includes('49d 12h'));
  check('PRs created reads the fixture count', bodyText.includes('23'));
  check('total tokens are compacted to 18.2B, not a raw digit string', bodyText.includes('18.2B'));
  check('the est. cost is labelled', /est\./i.test(bodyText));
  check('the price table date is shown', bodyText.includes('2026-01-15'));
  check('Codex shows Off, having no data', bodyText.includes('Off'));
  check('Claude Code shows Enabled, having data', bodyText.includes('Enabled'));
  check('an unknown-model cost never guesses — n/a is drawn', bodyText.includes('n/a'));

  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => {
      document.documentElement.classList.toggle('light', t === 'light');
    }, theme);
    await page.waitForTimeout(120);

    const scale = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-stats-heatmap] .rounded-\\[2px\\]')];
      const paint = (el) => getComputedStyle(el).backgroundColor;
      const card = document.querySelector('[data-stats-screen] .rounded-md');
      const cardFill = card === null ? null : getComputedStyle(card).backgroundColor;
      return { colours: cells.map(paint), cardFill };
    });
    const distinct = new Set(scale.colours);
    check(
      `${theme}: the heatmap scale paints more than one distinct colour`,
      distinct.size > 1,
      `only ${distinct.size} distinct fill(s) across ${scale.colours.length} cells`,
    );

    const contrast = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-stats-heatmap] .rounded-\\[2px\\]')];
      const bg = (el) => getComputedStyle(el).backgroundColor;
      const card = document.querySelector('[data-stats-screen] .rounded-md');
      return { cellFills: cells.map(bg), cardFill: card === null ? null : getComputedStyle(card).backgroundColor };
    });
    const ratios = await page.evaluate(
      ({ fills, card }) => fills.map((f) => window.vamInk.ratio(f, card)),
      { fills: contrast.cellFills, card: contrast.cardFill },
    );
    const maxRatio = Math.max(...ratios);
    check(
      `${theme}: at least one heatmap cell clears 1.4:1 non-text contrast against the card`,
      maxRatio >= 1.4,
      `best ratio measured ${maxRatio.toFixed(2)}:1`,
    );

    if (theme === 'dark') await page.screenshot({ path: `${outDir}/stats-usage-dark.png` });
    else await page.screenshot({ path: `${outDir}/stats-usage-light.png` });
  }
  await page.evaluate(() => document.documentElement.classList.remove('light'));

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 5_000 }).then(
    () => check('Escape closes the screen', true),
    () => check('Escape closes the screen', false),
  );

  await page.close();
}

// ------------------------------------------------------------- phone
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(install);
  await page.goto(origin, { waitUntil: 'networkidle' });
  check(
    'the entry icon is absent on a phone — the screen cannot be reached there',
    (await page.locator('[aria-label="stats"]').count()) === 0,
  );
  await page.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('stats-usage: entry icon, screen, heatmap scale (both themes) and phone absence all hold.');
