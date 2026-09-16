/**
 * Screenshots for the mode control that moved into the prompt block as one
 * icon, taken off the WEB build with the demo fixture — the only thing safe to
 * point a public screenshot at (`?demo=1`, App.tsx's own rule). Modelled on
 * `split-panes-shots.mjs`, and it ASSERTS: a shot of a control that failed to
 * draw is worse than no shot, because it looks like evidence.
 *
 * AND SINCE THE MODE ICON TOOK A COLOUR, it measures the PAINT. The operator
 * asked for two things at once — "show the current mode in the tooltip" and
 * "the icon needs to be filled with colour (for example auto is yellow)" — and
 * neither is answerable in a unit environment: no stylesheet is loaded there,
 * so `getComputedStyle` would only report that a class was typed. This reads
 * the resolved `color`, `fill` and `stroke-width` off the real bundle's own
 * nodes, holds the three hues apart from each other and from the ink they
 * replaced, and holds each to WCAG 1.4.11's 3:1 against the chip it is drawn
 * on. That is the check a content scan cannot make: this repo has shipped a
 * selector that matched nothing through review and merge before.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
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

// ---------------------------------------------------------------------------
// THE TOOLTIP NAMES THE MODE, measured as a real opened tooltip rather than as
// the `data-note` attribute the unit tests read.
//
// A `Note` is Radix, so its content lives in a PORTAL that only exists once
// the trigger is hovered or focused. That is the whole reason this check is
// here and not in jsdom: the string could be right on the trigger and never
// reach a surface, which is the shape of defect `tooltip-shots.mjs` exists
// for.
// ---------------------------------------------------------------------------
await toggle.hover();
const tip = await page
  .waitForSelector('[role="tooltip"]', { timeout: 3000 })
  .then((h) => h.evaluate((el) => el.textContent ?? ''))
  .catch(() => null);
console.log('mode icon tooltip:', JSON.stringify(tip));
if (tip === null || !/mode:\s*(Auto|Manual|Plan)\b/.test(tip)) {
  throw new Error(
    `the mode tooltip does not name the current mode: ${JSON.stringify(tip)} — the operator ` +
      'asked for exactly this, and an eye reads the tip while only a screen reader reads the ' +
      'accessible name.',
  );
}
// The tip is where the colour gets its legend, so it has to say what the mode
// DOES and not only what it is called.
if (!/decides its own next step|a hand on each step|writes the list before/.test(tip)) {
  throw new Error(`the mode tooltip names the mode but not what it means: ${JSON.stringify(tip)}`);
}
await page.mouse.move(0, 0);
await page.waitForTimeout(150);

// ---------------------------------------------------------------------------
// WHAT THE THREE GLYPHS ACTUALLY PAINT.
//
// WCAG relative luminance, over the resolved `rgb(...)` the browser hands
// back — the same arithmetic `composer-bar-shots.mjs` installs, kept local so
// neither guard can be made vacuous by a change to the other.
// ---------------------------------------------------------------------------
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
    groundOf: (el) => {
      let node = el.parentElement;
      while (node !== null) {
        const fill = getComputedStyle(node).backgroundColor;
        if (opaque(fill)) return fill;
        node = node.parentElement;
      }
      return 'rgba(0, 0, 0, 0)';
    },
  };
});

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

// --- The three hues, read off the open picker: it is the one place all three
// glyphs are on screen at once, so it is where they can be held apart.
const inks = await page.evaluate(() => {
  const resting = getComputedStyle(document.documentElement).getPropertyValue('--vam-ink-dim');
  return [...document.querySelectorAll('[data-mode-option] [data-mode-glyph]')].map((el) => {
    const cs = getComputedStyle(el);
    const ground = window.vamInk.groundOf(el);
    return {
      mode: el.getAttribute('data-mode-glyph'),
      colour: cs.color,
      fill: cs.fill,
      strokeWidth: cs.strokeWidth,
      ground,
      opaque: window.vamInk.opaque(cs.color) && window.vamInk.opaque(ground),
      ratio: window.vamInk.opaque(cs.color)
        ? Number(window.vamInk.ratio(cs.color, ground).toFixed(3))
        : null,
      restingInk: resting.trim(),
    };
  });
});
console.log('mode glyph paint:', JSON.stringify(inks, null, 1));
if (inks.length !== 3) {
  throw new Error(`found ${inks.length} mode glyphs to measure, expected 3.`);
}
if (new Set(inks.map((i) => i.colour)).size !== 3) {
  throw new Error(
    `the three modes do not paint three colours: ${inks.map((i) => `${i.mode}=${i.colour}`).join(', ')}`,
  );
}
for (const ink of inks) {
  if (!ink.opaque || ink.ratio < 3) {
    throw new Error(
      `${ink.mode} paints ${ink.colour} on ${ink.ground} — ${ink.ratio}:1, under the 3:1 a ` +
        'non-text mark owes (WCAG 1.4.11).',
    );
  }
  // THE FILL, WHERE IT SURVIVES AND WHERE IT DOES NOT. `Sparkles` fills into a
  // solid star; `Hand` filled closes into a fist and `ListChecks` into
  // arrowheads, so those two carry their colour on the stroke instead (see
  // `MODE_SKIN` in `DetailPanel.tsx`). Asserted per mode, because "some of
  // them are filled" is exactly the state a half-done change leaves.
  const wantsFill = ink.mode === 'auto';
  if (wantsFill && ink.fill !== ink.colour) {
    throw new Error(`auto is meant to be FILLED in its own colour: fill=${ink.fill} vs ${ink.colour}`);
  }
  if (!wantsFill && ink.fill !== 'none') {
    throw new Error(
      `${ink.mode} is meant to take its colour on the stroke, not a fill that smudges it: ` +
        `fill=${ink.fill}`,
    );
  }
  if (Number.parseFloat(ink.strokeWidth) < (wantsFill ? 1.7 : 2.2)) {
    throw new Error(`${ink.mode} draws a lighter stroke than it was measured at: ${ink.strokeWidth}`);
  }
}

// --- Shot 2b: one frame per mode, so the operator can see all three toggles.
// Picking a mode writes a `mode:` line into the DRAFT, which is the whole
// mechanism, so this also proves the pick lands.
for (const mode of ['auto', 'manual', 'plan']) {
  if ((await page.locator('[data-mode-picker]').count()) === 0) {
    await toggle.click();
    await page.waitForTimeout(120);
  }
  await page.locator(`[data-mode-option="${mode}"]`).click();
  await page.waitForTimeout(150);
  const shown = await page.evaluate(() => {
    const el = document.querySelector('[data-mode-toggle] [data-mode-glyph]');
    if (el === null) return null;
    const cs = getComputedStyle(el);
    return { mode: el.getAttribute('data-mode-glyph'), colour: cs.color, fill: cs.fill };
  });
  console.log(`  toggle after picking ${mode}: ${JSON.stringify(shown)}`);
  if (shown === null || shown.mode !== mode) {
    throw new Error(`picked ${mode} and the toggle shows ${JSON.stringify(shown)}`);
  }
  const expected = inks.find((i) => i.mode === mode);
  if (shown.colour !== expected.colour) {
    throw new Error(
      `the toggle paints ${mode} as ${shown.colour}, the picker as ${expected.colour} — one ` +
        'control, two answers.',
    );
  }
  const box = await tools.boundingBox();
  await page.screenshot({
    path: `${outDir}/prompt-mode-icon-${mode}.png`,
    clip: { x: box.x - 12, y: box.y - 10, width: box.width + 24, height: box.height + 20 },
  });
  console.log(`${outDir}/prompt-mode-icon-${mode}.png`);
}

// --- The same three hues in LIGHT, which is a separate set of values and not
// the dark ones inverted: a glyph on a white card has to come a long way DOWN
// to clear its floor, so the amber reads brown there. Measured on the painted
// node for the same reason as the dark pass -- the token guard proves the
// values are in the stylesheet, only a browser proves they reach the element.
await page.evaluate(() => document.documentElement.classList.add('light'));
await page.waitForTimeout(200);
if ((await page.locator('[data-mode-picker]').count()) === 0) {
  await toggle.click();
  await page.waitForTimeout(150);
}
const lightInks = await page.evaluate(() =>
  [...document.querySelectorAll('[data-mode-option] [data-mode-glyph]')].map((el) => {
    const cs = getComputedStyle(el);
    const ground = window.vamInk.groundOf(el);
    return {
      mode: el.getAttribute('data-mode-glyph'),
      colour: cs.color,
      fill: cs.fill,
      ground,
      opaque: window.vamInk.opaque(cs.color) && window.vamInk.opaque(ground),
      ratio: window.vamInk.opaque(cs.color)
        ? Number(window.vamInk.ratio(cs.color, ground).toFixed(3))
        : null,
    };
  }),
);
console.log('mode glyph paint, light:', JSON.stringify(lightInks));
if (lightInks.length !== 3 || new Set(lightInks.map((i) => i.colour)).size !== 3) {
  throw new Error(`light does not paint three distinct mode hues: ${JSON.stringify(lightInks)}`);
}
for (const ink of lightInks) {
  if (!ink.opaque || ink.ratio < 3) {
    throw new Error(
      `light ${ink.mode} paints ${ink.colour} on ${ink.ground} — ${ink.ratio}:1, under 3:1.`,
    );
  }
  const dark = inks.find((i) => i.mode === ink.mode);
  // RE-DERIVED, NOT INHERITED. If a theme block were missing a token the var
  // would fall through to the other theme's value and nothing else here would
  // notice -- the hues would still be three and would still clear the floor.
  if (ink.colour === dark.colour) {
    throw new Error(
      `light ${ink.mode} paints the DARK value (${ink.colour}) — the light block is not being ` +
        'read, so this theme is wearing the other one.',
    );
  }
}
await page.screenshot({
  path: `${outDir}/prompt-mode-picker-light.png`,
  clip: (() => {
    const p = pickerBox;
    return {
      x: toolsBox.x - 12,
      y: p.y - 24,
      width: toolsBox.width + 24,
      height: toolsBox.y + toolsBox.height - p.y + 40,
    };
  })(),
});
console.log(`${outDir}/prompt-mode-picker-light.png`);
await page.evaluate(() => document.documentElement.classList.remove('light'));
await page.waitForTimeout(150);

// --- Shot 3: the composer with the waiting notice gone. The demo's
// `factory-sse-1` is exactly the session that used to carry it
// (`waitingFor: 'permission prompt'`), so its absence here is the change.
await page.keyboard.press('Escape');
// AND `Control+[`, WHICH IS THE WAY OUT OF THE COMPOSER NOW. Escape typed in
// the prompt box is the agent's interrupt since the composer-escape change, so
// it no longer releases the keyboard. Escape stays first, because it is still
// what closes an overlay; `Mod-[` folds Ctrl and Cmd, and is a no-op anywhere
// but in that box.
await page.keyboard.press('Control+[');
await page.waitForTimeout(150);
if ((await page.locator('[data-session-waiting]').count()) !== 0) {
  throw new Error('the waiting notice is still drawn — this PR claims it is gone.');
}
await browser.close();
