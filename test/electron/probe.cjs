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

  // Task 5: captures the preload's own `console.error` when
  // `ipcRenderer.invoke(CHANNELS.streamSubscribe)` rejects -- the only way a
  // missing `registerStreamIpc` registration in main is observable from here,
  // since the push channel itself is fire-and-forget `webContents.send`.
  const streamSubscribeErrors = [];
  contents.on('console-message', (_event, _level, message) => {
    if (typeof message === 'string' && message.includes('stream subscribe failed')) {
      streamSubscribeErrors.push(message);
    }
  });

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
    // The preload, observed from the page. Nothing else in this harness can
    // see it: with `webPreferences.preload` pointed at a file that does not
    // exist, every other assertion here still passes -- the window opens, the
    // renderer mounts, the security clauses hold -- and the bridge is simply
    // absent. This is the field that notices.
    bridgeKeys: await run('Object.keys(window.api ?? {}).sort()'),
    bridgeLoadType: await run("typeof (window.api ?? {}).load"),
    // AC-20, measured rather than asserted, and measured in the RIGHT
    // process: this file runs in main, so `typeof EventSource` here is main's
    // answer. Plain `node` is a different runtime and would be the wrong
    // process to ask. `src/main/stream/event-source.ts` exists only because
    // this is 'undefined'; if a future Electron ships a global EventSource,
    // this field changes and the harness says so, rather than the adapter
    // quietly outliving its reason.
    mainEventSource: typeof EventSource,
  };

  // AC-15: the running app's `SessionSource.load()`, not an in-process handler
  // registry. `window.api.load()` IS what the assembled source's `load` member
  // calls (`src/renderer/sources/preload-factory.ts`: `load: () => api.load()`
  // -- no other logic sits between them for this member), so invoking it here,
  // through the real `contextBridge` in the launched renderer, over the real
  // `ipcRenderer.invoke`, is the same round trip the mounted `DesktopCanvas`
  // makes. A rejection (no handler registered) and a resolution are both
  // reported, never thrown out of the probe, so the harness can assert either.
  result.sourceLoad = await run(`(async () => {
    try {
      const projects = await window.api.load();
      const project = projects[0] ?? {};
      const session = (project.sessions ?? [])[0] ?? {};
      return {
        ok: true,
        projectKeys: Object.keys(project).sort(),
        sessionKeys: Object.keys(session).sort(),
      };
    } catch (error) {
      return { ok: false, message: error && error.message ? String(error.message) : String(error) };
    }
  })()`);

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

  // Task 5, AC-15(e2e)/AC-17/AC-18: subscribe through the real bridge while
  // the local SSE server (see launch.test.ts's `startChangeStreamServer`)
  // emits a change every 300ms. `beforeUnsub` proves a push arrived and
  // carried no argument (the callback takes none); `afterUnsub` staying equal
  // proves the unsubscribe actually stopped delivery.
  result.streamTicks = await run(`(async () => {
    const ticks = [];
    const unsub = window.api.subscribe(() => { ticks.push(Date.now()); });
    await new Promise((resolve) => setTimeout(resolve, 900));
    const beforeUnsub = ticks.length;
    unsub();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const afterUnsub = ticks.length;
    return { beforeUnsub, afterUnsub };
  })()`);
  result.streamSubscribeErrors = streamSubscribeErrors;

  process.stdout.write(`VAM_SMOKE_RESULT ${JSON.stringify(result)}\n`);
  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`VAM_SMOKE_ERROR ${error?.stack ?? error}\n`);
  app.exit(1);
});
