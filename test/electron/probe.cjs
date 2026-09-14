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
const { app, BrowserWindow, Menu, clipboard } = require('electron');

const MAIN = path.join(__dirname, '..', '..', 'out', 'main', 'index.cjs');
const OFF_ORIGIN = 'https://example.invalid/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Flatten a built `Menu` into rows. `item.accelerator` is whatever the live
 * MenuItem carries -- typed or role-derived -- the only reading that answers
 * "is this key still claimed by the menu?".
 */
function walkMenu(menu, trail) {
  if (menu === null || menu === undefined) return [];
  const rows = [];
  for (const item of menu.items) {
    const path = [...trail, item.label || `(${item.type})`];
    rows.push({
      path: path.join(' > '),
      role: item.role ?? null,
      type: item.type,
      accelerator: item.accelerator ?? null,
      enabled: item.enabled,
      visible: item.visible,
    });
    rows.push(...walkMenu(item.submenu, path));
  }
  return rows;
}


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
    // The same question one level down. `bridgeKeys` proves `usage` is a KEY;
    // a key whose value is an empty object, or whose `get` never got attached,
    // would satisfy it while the status bar could never read a number. This is
    // the field that notices that.
    bridgeUsageGetType: await run("typeof ((window.api ?? {}).usage ?? {}).get"),
    // Likewise for the clipboard member: the renderer's own
    // `navigator.clipboard` is refused by this app's permission policy, so
    // this forwarder is the only route a copy has.
    bridgeClipboardWriteType: await run("typeof ((window.api ?? {}).clipboard ?? {}).writeText"),
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

  // Permission policy, behaviourally: `Notification.requestPermission()` is a
  // real renderer call that routes through `session.setPermissionRequestHandler`
  // for the `notifications` permission. With no handler registered, Electron's
  // own default is to APPROVE, so this resolves 'granted' without the fix.
  result.notificationPermission = await run('Notification.requestPermission()');

  // THE MICROPHONE, AND THE CONTROL THAT USED TO ASK FOR IT.
  //
  // Three fields because the defect needed all three to be seen. The
  // recogniser EXISTS here -- this is Chromium -- so feature detection said
  // yes and a button was drawn; the permission is refused by vam's own
  // deny-all policy, so that button could only ever apologise; and the fix is
  // that the button is now absent in this build alone.
  //
  // NOTHING HERE CAN RAISE A PROMPT. `permissions.query` is a check, not a
  // request, and the policy answers it without a dialog -- which is the whole
  // reason it is the field to read rather than `getUserMedia`.
  result.speechRecognitionType = await run(
    "typeof (window.SpeechRecognition ?? window.webkitSpeechRecognition)",
  );
  result.micPermissionState = await run(`(async () => {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      return status.state;
    } catch (error) {
      return 'threw: ' + (error && error.name ? error.name : String(error));
    }
  })()`);
  // The DOM answer, with its own corpus beside it: a count of zero means
  // nothing unless the composer it would sit in is on screen. `send` is the
  // control it was asked to sit next to.
  result.dictateControls = await run(
    "document.querySelectorAll('[data-prompt-dictate]').length",
  );
  result.sendControls = await run("document.querySelectorAll('[data-prompt-record]').length");

  // `will-redirect`, behaviourally, on the REAL webContents and the REAL
  // listener `app.on('web-contents-created', ...)` attached to it -- fired
  // synthetically here because arranging a genuine same-origin-then-302
  // network redirect against a `file://` origin is not practical, but the
  // listener invoked is the one actually registered on this contents object.
  let offOriginRedirectPrevented = false;
  contents.emit('will-redirect', { preventDefault: () => { offOriginRedirectPrevented = true; } }, OFF_ORIGIN);
  result.offOriginRedirectPrevented = offOriginRedirectPrevented;

  let sameOriginRedirectPrevented = false;
  contents.emit(
    'will-redirect',
    { preventDefault: () => { sameOriginRedirectPrevented = true; } },
    contents.getURL(),
  );
  result.sameOriginRedirectPrevented = sameOriginRedirectPrevented;

  // A SECOND window, created after startup: proves the window-open and
  // navigation policy is bound at `app.on('web-contents-created', ...)`
  // rather than to the first window's `webContents` alone.
  const second = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await second.loadURL('about:blank');
  const secondContents = second.webContents;
  const runSecond = (code) => secondContents.executeJavaScript(code, true);

  await runSecond(`window.open(${JSON.stringify(OFF_ORIGIN)}); undefined`);
  await sleep(700);
  result.secondWindowCountAfterOpen = BrowserWindow.getAllWindows().length;

  const secondUrlBeforeNavigate = secondContents.getURL();
  await runSecond(`window.location.href = ${JSON.stringify(OFF_ORIGIN)}; undefined`);
  await sleep(700);
  result.secondWindowNavigated = secondContents.getURL() !== secondUrlBeforeNavigate;

  second.destroy();

  // CSP, read off the actual delivered response, not off configuration: a
  // self-fetch of the currently loaded document goes through the same
  // `webRequest.onHeadersReceived` path the initial navigation did.
  result.cspHeader = await run(
    `fetch(location.href).then((r) => r.headers.get('content-security-policy')).catch((e) => 'fetch-error:' + e.message)`,
  );

  // THE BUILT MENU, not the template literal in `src/main/menu.ts`: asserting
  // the array that was written reads your own input back. This walks what
  // `Menu.setApplicationMenu` installed, including accelerators Electron
  // derived from a `role` rather than ones this repo typed out.
  result.menu = walkMenu(Menu.getApplicationMenu(), []);

  // COPY, PERFORMED. Every other menu assertion is structural: the `copy`
  // role is present, its accelerator is Cmd+C. None of them proves a copy
  // still lands on the system clipboard, and on macOS the clipboard works
  // THROUGH the menu -- a hand-built menu is exactly where it dies silently.
  // So the Edit > Copy item is CLICKED, over a real selection in the real
  // renderer, and the real system clipboard is read back afterwards.
  // In Electron 44 the main-process `clipboard` follows the W3C shape:
  // `readText()`/`writeText()` return PROMISES and there is no
  // `availableFormats`. Unawaited, `readText()` yields a Promise that
  // `writeText` rejects with "conversion failure from" -- how this was found.
  const previousClipboard = await clipboard.readText();
  try {
    await run(`(() => {
      const box = document.createElement('textarea');
      box.id = 'vam-clipboard-probe';
      box.value = 'vam-clipboard-proof';
      document.body.appendChild(box);
      box.focus();
      box.select();
    })(); undefined`);
    // A sentinel first, so "the value happened to be on the clipboard already"
    // cannot pass the assertion.
    await clipboard.writeText('sentinel-not-overwritten');
    // `contents.copy()` IS what the `copy` role's handler invokes. Clicking
    // the built MenuItem was tried and MEASURED not to work: with window and
    // contents both focused and passed explicitly,
    // `copyItem.click(undefined, win, contents)` left the sentinel untouched,
    // because a role is dispatched natively, not through that property. So
    // the menu's half is the structural assertion in `launch.test.ts`, and
    // this answers the other half -- a copy out of this renderer, under this
    // app's deny-everything permission policy, reaches the system clipboard.
    contents.copy();
    await sleep(500);
    result.clipboardAfterContentsCopy = await clipboard.readText();
    await run("document.getElementById('vam-clipboard-probe')?.remove(); undefined");
  } catch (error) {
    result.clipboardAfterContentsCopy = `error:${error && error.message ? error.message : String(error)}`;
  }

  // THE BRIDGE'S OWN CHANNEL, END TO END. `bridgeClipboardWriteType` above
  // only proves `writeText` is a function; this drives it for real --
  // renderer -> preload -> `vam:clipboard:write` -> main's own electron
  // `clipboard` -- and then reads the system clipboard back from main.
  //
  // It is the only assertion that covers main's handler being `async`:
  // `ipcMain.handle` has to settle the returned promise before the answer
  // crosses the process boundary, and a unit test holding an injected fake
  // cannot see that boundary at all. Seeded with a sentinel first, so "the
  // text was already on the clipboard" cannot pass it.
  try {
    await clipboard.writeText('sentinel-not-overwritten');
    result.bridgeClipboardWriteAnswer = await run(
      "window.api.clipboard.writeText('vam-bridge-clipboard-proof')",
    );
    result.clipboardAfterBridgeWrite = await clipboard.readText();
  } catch (error) {
    result.clipboardAfterBridgeWrite = `error:${error && error.message ? error.message : String(error)}`;
  }

  // The operator's own clipboard is not collateral damage -- best effort, and
  // never at the cost of the run.
  try {
    if (typeof previousClipboard === 'string' && previousClipboard.length > 0) {
      await clipboard.writeText(previousClipboard);
    }
  } catch {
    // A clipboard this could not restore is not a reason to lose the run.
  }

  // ZOOM, ROUTE BY ROUTE, on the real webContents.
  //
  // (a) the resting state, after `lockZoom` ran at `web-contents-created`.
  result.zoomFactorAtRest = contents.getZoomFactor();
  result.zoomLevelAtRest = contents.getZoomLevel();

  // (b) Ctrl/Cmd + mouse wheel, through the renderer's input pipeline rather
  // than a JS listener. See launch.test.ts: measured not to reach Chromium's
  // wheel-zoom path at all, so this records rather than guards.
  for (let i = 0; i < 5; i += 1) {
    contents.sendInputEvent({
      type: 'mouseWheel',
      x: 400,
      y: 300,
      deltaX: 0,
      deltaY: 120,
      modifiers: ['control'],
      canScroll: false,
    });
  }
  await sleep(500);
  result.zoomLevelAfterCtrlWheel = contents.getZoomLevel();
  result.zoomFactorAfterCtrlWheel = contents.getZoomFactor();

  // ...and with the macOS modifier, reported separately.
  for (let i = 0; i < 5; i += 1) {
    contents.sendInputEvent({
      type: 'mouseWheel',
      x: 400,
      y: 300,
      deltaX: 0,
      deltaY: 120,
      modifiers: ['meta'],
      canScroll: false,
    });
  }
  await sleep(500);
  result.zoomLevelAfterMetaWheel = contents.getZoomLevel();

  // (c) the clamp, through the very event Chromium raises for a wheel/pinch
  // zoom. Firing it after a deliberate displacement proves the listener is
  // attached to THIS contents and really restores 0.
  contents.setZoomLevel(2.5);
  contents.emit('zoom-changed', {}, 'in');
  await sleep(200);
  result.zoomLevelAfterZoomChanged = contents.getZoomLevel();

  // (d) a zoom level PERSISTED from an earlier session. Chromium stores it
  // per origin and re-applies it on navigation, so it survives a reload -- and
  // a relaunch, which is how it was found: the harness left 2.5 behind and the
  // next launch came up at zoom factor 1.577.
  contents.setZoomLevel(2.5);
  await contents.reload();
  await new Promise((resolve) => contents.once('did-finish-load', resolve));
  await sleep(300);
  result.zoomLevelAfterReload = contents.getZoomLevel();
  result.zoomFactorAfterReload = contents.getZoomFactor();
  // Leave nothing behind for the next launch to inherit.
  contents.setZoomLevel(0);

  process.stdout.write(`VAM_SMOKE_RESULT ${JSON.stringify(result)}\n`);
  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`VAM_SMOKE_ERROR ${error?.stack ?? error}\n`);
  app.exit(1);
});
