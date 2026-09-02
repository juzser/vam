/**
 * The scripted Electron entry AC-13's harness drives.
 *
 * Electron is spawned against THIS file rather than the packaged app, so the
 * shipped `src/main` carries no test scaffolding: the probe loads the built
 * main bundle for its side effect (it opens the window), observes the result
 * from the main process, prints one JSON line and exits. Everything the
 * harness asserts is gathered here because only the main process can see
 * `BrowserWindow.getAllWindows()` and the live `webPreferences`.
 *
 * CommonJS on purpose: the built main is CJS (see electron.vite.config.ts) and
 * Electron's own entry is loaded by `require`.
 */
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const MAIN = path.join(__dirname, '..', '..', 'out', 'main', 'index.cjs');
const OFF_ORIGIN = 'https://example.invalid/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForWindow() {
  for (let i = 0; i < 200; i += 1) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0 && !windows[0].webContents.isLoading()) {
      return windows[0];
    }
    await sleep(50);
  }
  throw new Error('probe: no BrowserWindow finished loading within 10s');
}

async function main() {
  require(MAIN);
  await app.whenReady();
  const win = await waitForWindow();
  const contents = win.webContents;
  const run = (code) => contents.executeJavaScript(code, true);

  const prefs = contents.getLastWebPreferences() ?? {};
  const result = {
    windowCount: BrowserWindow.getAllWindows().length,
    finishedLoading: !contents.isLoading(),
    contextIsolation: prefs.contextIsolation,
    nodeIntegration: prefs.nodeIntegration,
    sandbox: prefs.sandbox,
    webSecurity: prefs.webSecurity,
    title: await run('document.title'),
    rootHtmlLength: await run("(document.getElementById('root')?.innerHTML ?? '').length"),
  };

  // webSecurity, probed rather than read. The probe is a cross-origin DOCUMENT
  // read, not a fetch: a `fetch` from this window's `file:` origin to a
  // same-machine http server returns 200 with webSecurity ON (measured), so it
  // would prove nothing. Reading another origin's document through an iframe is
  // what the same-origin policy exists to stop, and it is exactly what
  // `webSecurity: false` re-permits.
  const probeUrl = `http://127.0.0.1:${process.env.VAM_SMOKE_PORT}/cross-origin.html`;
  result.crossOriginRead = await run(`new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.src = ${JSON.stringify(probeUrl)};
    frame.onload = () => {
      try {
        resolve('read:' + String(frame.contentDocument && frame.contentDocument.title));
      } catch (error) {
        resolve('blocked:' + error.name);
      }
    };
    frame.onerror = () => resolve('blocked:load-error');
    document.body.appendChild(frame);
    setTimeout(() => resolve('blocked:timeout'), 5000);
  })`);

  // setWindowOpenHandler, behaviourally: a handler that allows would leave a
  // second window standing, and no read of webPreferences could tell.
  await run(`window.open(${JSON.stringify(OFF_ORIGIN)}); undefined`);
  await sleep(700);
  result.windowCountAfterOpen = BrowserWindow.getAllWindows().length;

  // will-navigate, behaviourally: the URL must be the one we started on.
  result.urlBeforeNavigate = contents.getURL();
  await run(`window.location.href = ${JSON.stringify(OFF_ORIGIN)}; undefined`);
  await sleep(700);
  result.urlAfterNavigate = contents.getURL();

  process.stdout.write(`VAM_SMOKE_RESULT ${JSON.stringify(result)}\n`);
  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`VAM_SMOKE_ERROR ${error?.stack ?? error}\n`);
  app.exit(1);
});
