/**
 * A minimal probe for the ONE `<img>` left in this app -- `GettingStarted.
 * tsx`'s own vam mark, wrapped in `IconFrame` -- proving it loads under the
 * REAL `file://` document `loadFile` opens, the one thing no web build or
 * unit environment can see (a root-absolute `src` resolves against the
 * document's own URL, and under `file://` that URL is the filesystem root).
 *
 * `test/electron/probe.cjs` (the full AC-13/AC-14 smoke suite) used to prove
 * this same regression through `TerminalOnlyStart`'s own `<img>` -- the one
 * screen in the app that drew one, reached by clicking into a row
 * `LAUNCH_FIXTURE_PROJECTS` always owns. "start-polish" (2026-09-23) moved
 * that screen's mark to the session's own AGENT (`SourceMark`, an inline
 * SVG), which has no `<img>` to check at all, and `LAUNCH_FIXTURE_PROJECTS`
 * can never reach `GettingStarted.tsx`'s screen either -- it always owns a
 * session, by design, for the composer assertions `probe.cjs` still needs
 * it for. So this is a narrower, SEPARATE launch, `VAM_FIXTURE_SOURCE=2`
 * (`src/main/index.ts`'s `EMPTY_FIXTURE_SOURCE`) -- genuinely nothing, the
 * one state `GettingStarted.tsx`'s screen actually draws in.
 *
 * FALSIFIED by putting a root-absolute `src="/icon.svg"` back in
 * `GettingStarted.tsx` and re-running this file: `naturalWidth` reads `0`
 * for the mark, because `file:///icon.svg` does not exist.
 */
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { ensureHarnessRemotePort } = require('./free-port.cjs');

const MAIN = path.join(__dirname, '..', '..', 'out', 'main', 'index.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForWindow() {
  for (let i = 0; i < 200; i += 1) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0 && !windows[0].webContents.isLoading()) {
      return windows[0];
    }
    await sleep(50);
  }
  throw new Error('getting-started-image-probe: no BrowserWindow finished loading within 10s');
}

/**
 * Polls for the screen rather than a fixed sleep -- a FRESH, throwaway
 * `userData` pays Chromium's own cold-start cost on every launch
 * (`probe.cjs`'s own header measures it), and a fixed margin comfortable
 * against a warm profile is not against a cold one.
 */
async function waitForSelector(run, selector, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await run(`document.querySelector(${JSON.stringify(selector)}) !== null`);
    if (found) return;
    await sleep(50);
  }
  throw new Error(`getting-started-image-probe: ${selector} did not appear within ${timeoutMs}ms`);
}

/**
 * Polls a boolean EXPRESSION (not a selector -- `complete` is an `<img>`
 * element PROPERTY, never a CSS attribute, so no `querySelector` can see it)
 * until it is true, or throws.
 */
async function waitForTrue(run, expression, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await run(expression)) return;
    await sleep(50);
  }
  throw new Error(`getting-started-image-probe: "${expression}" never became true within ${timeoutMs}ms`);
}

async function main() {
  // MUST RUN BEFORE `require(MAIN)` -- see `free-port.cjs`'s own header.
  await ensureHarnessRemotePort();
  require(MAIN);
  await app.whenReady();
  const win = await waitForWindow();
  const contents = win.webContents;
  const run = (code) => contents.executeJavaScript(code, true);

  await waitForSelector(run, '[data-getting-started]');
  // THE SELECTOR APPEARING IS NOT THE IMAGE LOADING -- the `<img>` mounts the
  // instant React commits the screen, but its own network fetch/decode of
  // `icon.svg` is asynchronous and was still `naturalWidth: 0` here on a
  // fresh, cold `userData` profile the moment this ran without a wait of its
  // own (measured: `probe.cjs`'s own equivalent check settled a 300ms sleep
  // after ITS click, which this probe has no click to piggyback on).
  await waitForTrue(run, "document.querySelector('img')?.complete === true");
  const images = await run(
    "Array.from(document.images).map((img) => ({ src: img.getAttribute('src'), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, complete: img.complete }))",
  );

  process.stdout.write(`VAM_GETTING_STARTED_IMAGE_RESULT ${JSON.stringify({ images })}\n`);
  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`VAM_GETTING_STARTED_IMAGE_ERROR ${error?.stack ?? error}\n`);
  app.exit(1);
});
