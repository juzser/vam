/**
 * Screenshots for the mode control that moved into the prompt block as one
 * icon, taken off the WEB build with the demo fixture — the only thing safe to
 * point a public screenshot at (`?demo=1`, App.tsx's own rule). Modelled on
 * `split-panes-shots.mjs`, and it ASSERTS: a shot of a control that failed to
 * draw is worse than no shot, because it looks like evidence.
 *
 * Run by hand; nothing runs it automatically:
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5512 --strictPort
 *   node e2e/prompt-mode-icon-shots.mjs http://localhost:5512 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5512';
const outDir = process.argv[3] ?? 'docs/ui';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});
/**
 * THE ONE THING THIS HARNESS FORCES, and why.
 *
 * The demo source reports NO terminal (`Canvas.tsx`: `terminalTab` is
 * `source.kind === 'session' && ...capabilities.terminal`, and the demo source
 * is neither), and the mode control is drawn only where a mode can really be
 * chosen — a vam-started session on a source that HAS a pane. So the control
 * cannot appear under `?demo=1` at all; nor could the mode row it replaces,
 * which is why no screenshot of it has ever existed
 * (`pane-refinements-shots.mjs`: "every demo session lacks one").
 *
 * So the served bundle is intercepted and that ONE expression is forced true,
 * which is what the desktop app computes for the ordinary case: a session vam
 * started, in tmux. Nothing else is touched — the component, the fixture and
 * the styles are the shipped ones — and the throw below is what keeps this
 * honest: if the patch ever stops matching, the script fails rather than
 * quietly photographing a pane with no control in it.
 */
const CAPABILITY = 't.kind===`session`&&t.source.capabilities.terminal';
await page.route('**/assets/*.js', async (route) => {
  const response = await route.fetch();
  const body = await response.text();
  if (!body.includes(CAPABILITY)) {
    await route.fulfill({ response, body });
    return;
  }
  console.log('forced the terminal capability in', route.request().url());
  await route.fulfill({ response, body: body.split(CAPABILITY).join('!0') });
});

await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');

// `factory-sse-1` is the demo's vam-controlled session — the one case where a
// mode is really choosable, and so the only one that draws the icon at all.
await page.locator('[data-session-row="factory-sse-1"]').click();
await page.waitForTimeout(200);

// The demo's factory-sse-1 opens with a question card, and a card with an open
// step stands the composer down by design. "Chat about this" is the documented
// way back to the box -- and it is the only demo session vam started, so it is
// the only one that can draw a mode control at all.
await page.locator('[data-question-chat]').first().click();
await page.waitForTimeout(200);

const tools = page.locator('[data-prompt-tools]').first();
const toggle = page.locator('[data-mode-toggle]').first();
if ((await toggle.count()) === 0) {
  throw new Error(
    'no [data-mode-toggle] on screen — the mode icon did not draw, so the shot below would ' +
      'have recorded its absence as if it were the feature.',
  );
}
const label = await toggle.getAttribute('aria-label');
console.log('mode icon accessible name:', label);
if (label === null || !label.includes('mode:')) {
  throw new Error(`the mode icon has no mode in its accessible name: ${String(label)}`);
}

// --- Shot 1: the prompt block at rest — one icon, beside the model field.
const toolsBox = await tools.boundingBox();
if (toolsBox === null) {
  throw new Error('could not measure the prompt tools row — it did not render.');
}
await page.screenshot({
  path: `${outDir}/prompt-mode-icon.png`,
  clip: {
    x: toolsBox.x - 12,
    y: toolsBox.y - 96,
    width: toolsBox.width + 24,
    height: toolsBox.height + 112,
  },
});
console.log(`${outDir}/prompt-mode-icon.png`);

// --- Shot 2: the popover open, all three modes reachable.
await toggle.click();
await page.waitForTimeout(150);
const options = await page.locator('[data-mode-option]').count();
console.log('mode options:', options);
if (options !== 3) {
  throw new Error(`the mode popover listed ${options} modes, expected 3.`);
}
const pickerBox = await page.locator('[data-mode-picker]').boundingBox();
if (pickerBox === null) {
  throw new Error('the mode popover did not render, so the shot would show a closed control.');
}
await page.screenshot({
  path: `${outDir}/prompt-mode-picker.png`,
  clip: {
    x: toolsBox.x - 12,
    y: pickerBox.y - 24,
    width: toolsBox.width + 24,
    height: toolsBox.y + toolsBox.height - pickerBox.y + 40,
  },
});
console.log(`${outDir}/prompt-mode-picker.png`);

// --- Shot 3: the composer with the waiting notice gone. The demo's
// `factory-sse-1` is exactly the session that used to carry it
// (`waitingFor: 'permission prompt'`), so its absence here is the change.
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
if ((await page.locator('[data-session-waiting]').count()) !== 0) {
  throw new Error('the waiting notice is still drawn — this PR claims it is gone.');
}
await browser.close();
