/**
 * What the error log actually looks like with failures in it — the surface the
 * operator reported as "cannot copy text and cannot create an issue".
 *
 * Four frames: desktop and 390px phone, light and dark. Run by hand against a
 * vite dev server on `?demo=1`, the committed fixture and the only thing safe
 * to point a camera at.
 *
 *   node_modules/.bin/vite --port 5277
 *   node e2e/error-log-shots.mjs http://127.0.0.1:5277 <out-dir>
 *
 * THE DEMO RECORDS NO FAILURES — every write is refused before it reaches a
 * source (`App.tsx`), so the panel would otherwise photograph as its empty
 * state. Two events are seeded by rewriting the SERVED text of
 * `errors/log.ts`, never the file on disk: the same technique
 * `branch-overlap.spec.ts` uses on `fixtures/demo.ts`. The two messages are
 * the real ones from `tmux/spawn.ts` and `claude-code/deliver.ts`, with
 * invented project and session names.
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://127.0.0.1:5277';
const outDir = process.argv[3] ?? 'shots';

const SEED = `
recordFailure('new session', {
  code: 'tmux-failed',
  message: "tmux failed while creating session vam-acme-payroll-a1b2c3: can't create session: /Users/opname/code/acme-payroll: No such file or directory",
});
recordFailure('send prompt', {
  code: 'session-running',
  message: 'session 9f1c2a84-3b7e-4d21-9c5a-6e0b8d7f1234 is running, so Claude Code will not resume it here. Error: Session is running as a background session. Use \\'claude attach\\' to attach to it, or \\'claude stop\\' to stop it.',
});
`;

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 800 }],
    ['phone', { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport });
    await page.addInitScript((t) => {
      localStorage.setItem('vam.prefs.v1', JSON.stringify({ theme: t }));
    }, theme);
    await page.route('**/errors/log.ts', async (route) => {
      const response = await route.fetch();
      route.fulfill({ response, body: (await response.text()) + SEED });
    });
    await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
    // The status bar cell appears only once something has failed, which is
    // exactly what the seed above arranges — so clicking it is also a check
    // that the seeding worked.
    await page.locator('[data-error-log-button]').first().click();
    await page.waitForSelector('[data-error-log]');
    await page.locator('button', { hasText: 'Report' }).first().click();
    await page.waitForSelector('[data-testid="report-preview"]');
    await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        a.currentTime = 0;
        a.pause();
      }
    });
    const path = `${outDir}/error-log-${name}-${theme}.png`;
    await page.screenshot({ path });
    console.log(path);
    await page.close();
  }
}
await browser.close();
