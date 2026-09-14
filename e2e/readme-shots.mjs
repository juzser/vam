/**
 * THE README'S OWN SCREENSHOTS, RETAKEN AGAINST THE CURRENT BUILD.
 *
 * `README.md` referenced four images (`canvas-dark.png`, `palette.png`,
 * `terminal.png`, `image-attach.png`), all four added before PR #260
 * ("collapse vam to two panes and drop the canvas layout presets", the 0.2
 * tab-shell migration). All four showed the deleted node-graph canvas, or
 * were rendered against the pre-lift dark palette (`--vam-ground` #131313,
 * `--vam-pane`/`--vam-sidebar` #1d1d1d — see the "A UNIFORM LIFT..." comment
 * in `styles.css`), or both. This script replaces them:
 *
 *   hero-dark.png       the tab shell itself — sidebar, sessions as tabs, one
 *                        session's Response view with its IN/OUT.
 *   palette.png          Mod-k's command palette, over the current shell
 *                        instead of the deleted canvas.
 *   composer-attach.png  the composer's text-file attach in action.
 *   agents-tab.png       an agent's own IN/OUT/PROGRESS, replacing the old
 *                        Terminal screenshot (see below for why).
 *
 * WHY NOT A LIKE-FOR-LIKE TERMINAL RETAKE. `terminalTab` in `canvas/Canvas.tsx`
 * is `source.kind === 'session' && source.source.capabilities.terminal` —
 * always `false` for `?demo=1` (`source: { kind: 'demo', ... }` in `App.tsx`),
 * so `visibleTabs()` (`panels/tabs.ts`) withdraws the Terminal tab from the bar
 * entirely in demo mode; there is no button to click. That is by design, not
 * an oversight: the Terminal tab reads a real `tmux capture-pane`, and demo
 * mode has no pane to read — showing one would mean either a fabricated
 * transcript-shaped string (dishonest) or routing through a stub HTTP source
 * instead of `?demo=1` (breaks the "every screenshot is `?demo=1`" rule this
 * repo holds elsewhere, `phone-list-shots.mjs`'s own header states why: "live
 * mode would put a real workspace, with real paths and real session ids, into
 * a public repo" — and a stubbed non-demo source is the same shell, still
 * worth keeping off the one path every other screenshot here is pinned to).
 * So the Terminal tab stays documented in prose (the keyboard reference table
 * already lists it) and undepicted, and `agents-tab.png` takes its slot with
 * a capability demo mode CAN show honestly.
 *
 * WHY NOT A LIKE-FOR-LIKE IMAGE-ATTACH RETAKE, either. The image-attach button
 * (`data-attach-image`, `DetailPanel.tsx`) is drawn only when
 * `pickImageAttachment !== undefined`, and `Canvas.tsx` passes that prop only
 * for `source.kind === 'session'` — `undefined` for `?demo=1`, same shape as
 * the Terminal gate and for the same reason: it opens a native OS dialog,
 * which only the Electron desktop shell has. The text-file attach
 * (`data-attach`, a plain `<input type=file>` read client-side) carries none
 * of that gate, so `composer-attach.png` demonstrates that one instead, and
 * the README prose keeps describing both — it was already true of both
 * before this pass and stays true; only the screenshot's own subject changed.
 *
 * Run by hand, against a running preview server:
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5529
 *   node e2e/readme-shots.mjs http://localhost:5529 docs/images
 *
 * Not wired into `e2e/run-web-guards.mjs`: like `phone-list-shots.mjs` and
 * `pane-refinements-shots.mjs`, this asserts very little and exists to
 * produce pictures for docs, not to gate CI. See `e2e/README.md`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5529';
const outDir = process.argv[3] ?? 'docs/images';

const browser = await chromium.launch();

/** Stop every running CSS animation (breathing dots, the "..." ellipsis) so
 *  two runs of this script produce the same pixels rather than whichever
 *  frame the animation happened to be on. */
async function freeze(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.currentTime = 0;
      a.pause();
    }
  });
}

// ── 1. THE HERO — the tab shell itself, replacing the deleted canvas ───────
// `factory-sse-1` is 'waiting': the README's own pitch ("colours it by
// whether it needs you... makes the waiting state impossible to miss") is
// what the hero should actually show, not an idle screen.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (err) => console.error('HERO PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  // Sessions as tabs, across two projects.
  await page.locator('[data-session-row="factory-sse-1"]').click();
  await page.locator('[data-session-row="crosscheck-2"]').click();
  await page.locator('[data-session-row="dogfood-4"]').click();
  // Land back on the waiting one, Response view, so its IN/OUT is on screen.
  await page.locator('[data-session-row="factory-sse-1"]').click();
  await page.waitForSelector('[data-column-turn]');
  const tabCount = await page.locator('[data-session-tab]').count();
  console.log(`hero: ${tabCount} tabs open`);
  if (tabCount < 3) throw new Error(`expected 3 open tabs for the hero, got ${tabCount}`);
  await page.keyboard.press('Control+[');
  await page.waitForTimeout(300);
  await freeze(page);
  await page.screenshot({ path: `${outDir}/hero-dark.png` });
  console.log(`${outDir}/hero-dark.png`);
  await page.close();
}

// ── 2. THE COMMAND PALETTE — same shell, Mod-k open ─────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (err) => console.error('PALETTE PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator('[data-session-row="factory-sse-1"]').click();
  await page.locator('[data-session-row="crosscheck-2"]').click();
  await page.locator('[data-session-row="dogfood-4"]').click();
  await page.keyboard.press('Control+[');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('go to session…');
  await input.waitFor({ state: 'visible', timeout: 3000 });
  const groups = await page.locator('[cmdk-group-heading]').allTextContents();
  console.log(`palette groups: ${JSON.stringify(groups)}`);
  if (!groups.some((g) => /needs you/i.test(g))) {
    throw new Error(`expected a "needs you" group in the palette, got ${JSON.stringify(groups)}`);
  }
  await freeze(page);
  await page.screenshot({ path: `${outDir}/palette.png` });
  console.log(`${outDir}/palette.png`);
  await page.close();
}

// ── 3. THE COMPOSER'S TEXT-FILE ATTACH ──────────────────────────────────────
// `crosscheck-2` has no open question, so the composer is the block on
// screen (same choice `composer-bar-shots.mjs` makes, for the same reason).
{
  // Gitignored, like every other script's own `test-results/` output — this
  // fixture never needs to be committed, only to exist on disk for the
  // duration of the run.
  const fixtureDir = 'e2e/test-results/readme-shots';
  mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = `${fixtureDir}/release-notes.md`;
  writeFileSync(
    fixturePath,
    '# Release notes\n\nFictional build, fictional notes — nothing here is real.\n',
  );

  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on('pageerror', (err) => console.error('COMPOSER PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator('[data-session-row="crosscheck-2"]').first().click();
  await page.waitForSelector('[data-prompt-record]');
  await page.locator('[data-prompt-box] textarea').click();
  await page.keyboard.type('Ship the release notes for this build');
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.waitForSelector('[data-attach-chip]');
  const chipText = await page.locator('[data-attach-chip]').innerText();
  console.log(`composer attach chip: ${JSON.stringify(chipText)}`);
  if (!chipText.includes('release-notes.md')) {
    throw new Error(`expected the attach chip to name the fixture file, got ${JSON.stringify(chipText)}`);
  }
  await page.waitForTimeout(150);
  await freeze(page);
  await page.locator('[data-composer-bar]').screenshot({ path: `${outDir}/composer-attach.png` });
  console.log(`${outDir}/composer-attach.png`);
  await page.close();
}

// ── 4. AN AGENT'S OWN IN/OUT/PROGRESS — replacing the old Terminal shot ────
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on('pageerror', (err) => console.error('AGENTS PAGE ERROR:', err));
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator('[data-session-row="factory-sse-1"]').click();
  await page.click('[data-view="agents"]');
  await page.waitForSelector('[data-agents]');
  await page.click('[data-agent-pick="agent-coder"]');
  await page.waitForSelector('[data-agent-turn]');
  await page.waitForTimeout(150);
  await freeze(page);
  await page.screenshot({ path: `${outDir}/agents-tab.png` });
  console.log(`${outDir}/agents-tab.png`);
  await page.close();
}

await browser.close();
console.log('\nreadme-shots: done.');
