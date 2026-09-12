/**
 * AC-13 and AC-14: the application actually launches, and the window it opens
 * is locked down.
 *
 * Every other criterion in this epic is satisfiable by a repository that never
 * starts a binary. This one builds the three targets and runs the real Electron
 * binary against them, then asserts through `webContents.executeJavaScript`.
 *
 * Deliberately NOT a Playwright spec: Playwright's `_electron` needs a spec file
 * under `e2e/`, and `e2e/` is read-only for this task (AC-11).
 */

import { execFileSync, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_MODEL } from '../../src/renderer/fixtures/demo.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = (name: string) => path.join(repoRoot, 'node_modules', '.bin', name);

interface SmokeResult {
  windowCount: number;
  finishedLoading: boolean;
  contextIsolation: boolean;
  nodeIntegration: boolean;
  sandbox: boolean;
  webSecurity: boolean;
  title: string;
  rootHtmlLength: number;
  bridgeKeys: string[];
  bridgeLoadType: string;
  bridgeUsageGetType: string;
  bridgeClipboardWriteType: string;
  crossOriginRead: string;
  windowCountAfterOpen: number;
  urlBeforeNavigate: string;
  urlAfterNavigate: string;
  sourceLoad:
    | { ok: true; projectKeys: string[]; sessionKeys: string[] }
    | { ok: false; message: string };
  streamTicks: { beforeUnsub: number; afterUnsub: number };
  streamSubscribeErrors: string[];
  mainEventSource: string;
  notificationPermission: string;
  offOriginRedirectPrevented: boolean;
  sameOriginRedirectPrevented: boolean;
  secondWindowCountAfterOpen: number;
  secondWindowNavigated: boolean;
  cspHeader: string | null;
  menu: MenuRow[];
  clipboardAfterContentsCopy: string;
  bridgeClipboardWriteAnswer: unknown;
  clipboardAfterBridgeWrite: string;
  zoomFactorAtRest: number;
  zoomLevelAtRest: number;
  zoomLevelAfterCtrlWheel: number;
  zoomFactorAfterCtrlWheel: number;
  zoomLevelAfterMetaWheel: number;
  zoomLevelAfterZoomChanged: number;
  zoomLevelAfterReload: number;
  zoomFactorAfterReload: number;
}

interface MenuRow {
  path: string;
  role: string | null;
  type: string;
  accelerator: string | null;
  enabled: boolean;
  visible: boolean;
}

/**
 * Gone from the menu, in the spelling `MenuItem.accelerator` reports. Zoom is
 * the operator's request; Cmd+W is what `src/renderer/keyboard/chords.ts`
 * binds to close-the-focused-session, and a menu key equivalent would swallow
 * it before the page ever saw it.
 */
const FORBIDDEN_ACCELERATORS = [
  'CommandOrControl+0',
  'CommandOrControl+Plus',
  'CommandOrControl+=',
  'CommandOrControl+-',
  'CommandOrControl+Shift+Plus',
  'CommandOrControl+W',
];

/**
 * LOWERCASE ON PURPOSE: a live `MenuItem.role` reads back `resetzoom`, not the
 * `resetZoom` the template and the docs use. Written in camelCase, these rows
 * passed against the UNMODIFIED default menu, matching nothing -- guards that
 * could not fail. Measured, then fixed.
 */
const FORBIDDEN_ROLES = ['resetzoom', 'zoomin', 'zoomout', 'close'];

const roleOf = (row: MenuRow): string => (row.role ?? '').toLowerCase();
const withRole = (rows: MenuRow[], role: string): MenuRow[] =>
  rows.filter((row) => roleOf(row) === role);

interface Launch {
  code: number | null;
  stdout: string;
  stderr: string;
  result: SmokeResult | null;
}

/**
 * A server that answers, on an origin that is not the window's, and sends no
 * CORS header while doing it. Without one, an off-machine probe would fail on
 * DNS whether `webSecurity` was on or off, and prove nothing.
 */
async function startNoCorsServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><head><title>cross-origin</title></head><body>x</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('probe server did not bind a port');
  }
  return { server, port: address.port };
}

/**
 * factory's wire format, minimally: one `hello` and then a `change`
 * frame every 300ms for as long as the connection stays open. Real enough
 * for `createNodeEventSource` to parse and for AC-15(e2e)/AC-17/AC-18 to
 * observe pushes actually arriving and actually stopping.
 */
async function startChangeStreamServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('event: hello\ndata: {"heartbeatMs":15000,"floorMs":10000}\n\n');
    const timer = setInterval(() => {
      res.write(`event: change\ndata: {"sessions":["s1"],"at":"${new Date().toISOString()}"}\n\n`);
    }, 300);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('stream server did not bind a port');
  }
  return { server, port: address.port };
}

function launch(port: number, streamPort: number): Promise<Launch> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin('electron'), [path.join('test', 'electron', 'probe.cjs')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        VAM_SMOKE_PORT: String(port),
        VAM_STREAM_URL: `http://127.0.0.1:${streamPort}/api/stream`,
        // A clean runner (this one, and CI) has no Claude Code sessions on
        // disk, so the real source's load() legitimately answers `[]` and
        // "resolves to at least the Project/Session shape" below has nothing
        // to check. This seeds a deterministic one-project fixture instead,
        // per src/main/index.ts's LAUNCH_FIXTURE_SOURCE.
        VAM_FIXTURE_SOURCE: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`electron did not exit within 60s\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 60_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout.split('\n').find((l) => l.startsWith('VAM_SMOKE_RESULT '));
      resolve({
        code,
        stdout,
        stderr,
        result:
          line === undefined
            ? null
            : (JSON.parse(line.slice('VAM_SMOKE_RESULT '.length)) as SmokeResult),
      });
    });
  });
}

describe('the Electron shell launches', () => {
  let server: Server;
  let streamServer: Server;
  let launched: Launch;

  beforeAll(async () => {
    execFileSync(bin('electron-vite'), ['build'], { cwd: repoRoot, stdio: 'pipe' });
    const started = await startNoCorsServer();
    server = started.server;
    const startedStream = await startChangeStreamServer();
    streamServer = startedStream.server;
    launched = await launch(started.port, startedStream.port);
  }, 180_000);

  afterAll(() => {
    server?.close();
    streamServer?.close();
  });

  const smoke = (): SmokeResult => {
    if (launched.result === null) {
      throw new Error(`no smoke result\nstdout:\n${launched.stdout}\nstderr:\n${launched.stderr}`);
    }
    return launched.result;
  };

  // (1) the process starts and stays up past `ready`, exiting non-zero at no point.
  it('boots and exits zero', () => {
    expect(`${launched.code} ${launched.stderr}`).toBe(`0 ${launched.stderr}`);
    expect(
      launched.result,
      `no VAM_SMOKE_RESULT line.\nstderr:\n${launched.stderr}`,
    ).not.toBeNull();
  });

  // (2) exactly one BrowserWindow, whose web contents finished loading.
  it('opens exactly one window', () => {
    expect(smoke().windowCount).toBe(1);
  });

  it('finishes loading the window contents', () => {
    expect(smoke().finishedLoading).toBe(true);
  });

  // (3) the renderer reached a known state. A blank white window passes (1) and
  // (2) and must fail here.
  it('mounts the renderer into a non-empty root', () => {
    expect(smoke().rootHtmlLength).toBeGreaterThan(0);
  });

  it('reaches the known document title', () => {
    expect(smoke().title).toBe('VAM');
  });

  // The preload actually LOADED and exposed the bridge. Until this existed the
  // preload path was untested: `webPreferences.preload` could name a file that
  // does not exist and all eleven other assertions still passed.
  //
  // SUPERSET, not exact equality -- this list was exact until it silently
  // drifted for three days while `createSessionIn`, `dialog`,
  // `pickImageAttachment`, `remote`, `terminal` and `update` were added to the
  // preload and nobody updated a hard-coded array here. `arrayContaining`
  // still fails the moment any of these is renamed or removed, which is the
  // actual regression this guards against; a PR that earns the bridge a new
  // member is not one.
  it('runs the preload, which exposes the bridge', () => {
    expect(smoke().bridgeKeys).toEqual(
      expect.arrayContaining([
        'applyWaivers',
        'clipboard',
        'closeSession',
        'createSession',
        'createSessionIn',
        'describe',
        'dialog',
        'load',
        'pickImageAttachment',
        'recordPrompt',
        'remote',
        'renameSession',
        'subscribe',
        'terminal',
        'transitionLesson',
        'update',
        'usage',
      ]),
    );
    expect(smoke().bridgeLoadType).toBe('function');
    // Not just that `usage` is among the keys above: that it carries a
    // callable `get`. The key-presence assertion would pass over a `usage`
    // that was an empty object, which is a bridge the status bar cannot use.
    expect(smoke().bridgeUsageGetType).toBe('function');
    // And the same question for `clipboard`. Copying is the one thing the
    // renderer CANNOT do for itself here -- the permission policy denies a
    // page-side clipboard write -- so a `clipboard` key without a callable
    // `writeText` is a packaged app in which every copy silently fails.
    expect(smoke().bridgeClipboardWriteType).toBe('function');
  });

  // `subscribe` now joins the bridge over `ipcRenderer.on`, not `invoke`
  // (task 5). Present unconditionally per `src/shared/preload-api.ts`'s rule
  // that the bridge's own shape never depends on runtime state -- capability
  // travels as data, through `describe()`.
  it('exposes a subscribe function', () => {
    expect(smoke().bridgeKeys).toContain('subscribe');
  });

  // AC-14, one assertion per clause: a single assertion covering six passes
  // while five are wrong.
  it('runs the renderer with contextIsolation', () => {
    expect(smoke().contextIsolation).toBe(true);
  });

  it('runs the renderer without nodeIntegration', () => {
    expect(smoke().nodeIntegration).toBe(false);
  });

  it('runs the renderer sandboxed', () => {
    expect(smoke().sandbox).toBe(true);
  });

  it('never disables webSecurity, so another origin stays unreadable', () => {
    expect(smoke().webSecurity).toBe(true);
    // `read:cross-origin` is the title of the other origin's document, and
    // means the same-origin policy did not hold.
    expect(smoke().crossOriginRead).toMatch(/^(blocked:|read:null$)/);
  });

  it('denies window.open, so no second window results', () => {
    expect(smoke().windowCountAfterOpen).toBe(1);
  });

  // AC-20: the EventSource question, answered by the running main process on
  // every harness run. `src/main/stream/event-source.ts` -- a hand-written SSE
  // client over node:http -- exists ONLY because main has no global
  // EventSource. That justification is a measurement, so it is checked here
  // rather than left in a comment: if it ever changes, this fails and someone
  // reconsiders the adapter instead of maintaining it forever.
  it('has no global EventSource in main, which is why the node adapter exists', () => {
    expect(smoke().mainEventSource).toBe('undefined');
  });

  it('refuses off-origin navigation, so the URL is unchanged', () => {
    expect(smoke().urlAfterNavigate).toBe(smoke().urlBeforeNavigate);
  });

  // AC-15: the launched app, not the unit suite, proves `registerSourceIpc`
  // is actually wired into main's startup. `window.api.load()` is the exact
  // call the mounted `DesktopCanvas` makes through its assembled
  // `SessionSource` (see `test/electron/probe.cjs`), so a rejection here means
  // the running process has no `vam:source:load` handler -- the failure this
  // criterion exists to catch.
  it("resolves the renderer's assembled SessionSource.load()", () => {
    const result = smoke().sourceLoad;
    expect(result.ok, result.ok ? '' : `rejected: ${result.message}`).toBe(true);
  });

  /**
   * SUPERSET, not equality. What this guards is the bridge DROPPING a field:
   * `contextBridge` structured-clones what it copies, so a `Project` main
   * built can arrive in the renderer missing members, and every key the
   * browser build renders must survive that trip. Missing keys still fail.
   *
   * It was exact equality until main began serving real sessions instead of a
   * fixture that mirrored the demo. `Session.origin` and `Session.source` are
   * OPTIONAL on the model and the demo fixture omits both, so equality did not
   * assert bridge fidelity any more -- it forbade a richer source from setting
   * a documented optional field, which is not a defect and is not what the
   * title of this test claims to check.
   */
  it('resolves to at least the Project/Session shape the browser build produces', () => {
    const result = smoke().sourceLoad;
    if (!result.ok) {
      throw new Error(`sourceLoad rejected: ${result.message}`);
    }
    const demoProject = DEMO_MODEL.projects[0];
    const demoSession = demoProject?.sessions[0];
    expect(result.projectKeys).toEqual(expect.arrayContaining(Object.keys(demoProject ?? {})));
    expect(result.sessionKeys).toEqual(expect.arrayContaining(Object.keys(demoSession ?? {})));
  });

  // AC-15(e2e)/task 5: `registerStreamIpc` is actually wired into `createWindow`
  // in src/main/index.ts, not merely present in src/main/stream/. The probe
  // subscribes through the real, launched bridge while a local SSE server
  // (`startChangeStreamServer`) emits a `change` frame every 300ms; a push
  // arriving at all proves the registration, exactly as `sourceLoad` above
  // proves `registerSourceIpc`'s. Falsified by commenting out the
  // `registerStreamIpc(...)` call in `createWindow`: `beforeUnsub` stays 0
  // and the message below names the missing registration.
  it('pushes at least one payload-free tick while subscribed (AC-15 e2e, AC-18)', () => {
    const ticks = smoke().streamTicks;
    expect(
      ticks.beforeUnsub,
      'no push arrived -- is registerStreamIpc(...) called in createWindow (src/main/index.ts)?',
    ).toBeGreaterThan(0);
  });

  // AC-17: after the returned unsubscribe runs, a later change delivers NONE.
  // The stream server keeps emitting every 300ms regardless -- only the
  // preload's own `ipcRenderer.removeListener` can be why the count stops
  // moving.
  it('delivers no further ticks after unsubscribing (AC-17)', () => {
    const ticks = smoke().streamTicks;
    expect(ticks.afterUnsub).toBe(ticks.beforeUnsub);
  });

  // The falsifier for AC-17 lives at the unit level (test/electron/stream-subscribe.test.ts),
  // where `ipcRenderer.removeListener(ch, cb)` is deliberately given the
  // renderer's own callback instead of the preload's closure and the second
  // change is shown still arriving. This assertion instead guards the OTHER
  // half of the same bug class: main's own registration missing entirely
  // must surface as a NAMED rejection, not a silent nothing. `subscribe()`
  // fires `ipcRenderer.invoke(CHANNELS.streamSubscribe)` and logs any
  // rejection; with `registerStreamIpc` never called that invoke rejects
  // with electron's own "No handler registered for 'vam:stream:subscribe'".
  it('never logs a stream-subscribe rejection when main is registered correctly', () => {
    expect(smoke().streamSubscribeErrors).toEqual([]);
  });

  // Followup security gap 1: with no permission handler at all, Electron's own
  // default is to APPROVE. `Notification.requestPermission()` is a real call
  // that routes through `session.setPermissionRequestHandler` for the
  // `notifications` permission, so this is denied only if the handler exists
  // and actually denies.
  it('denies a permission request by default (no permission handler means Electron auto-approves)', () => {
    expect(smoke().notificationPermission).toBe('denied');
  });

  // Followup security gap 3: a same-origin URL that then 302s off-origin never
  // fires `will-navigate` -- only `will-redirect` sees it. Both directions are
  // asserted so the handler is shown to discriminate, not to always prevent.
  it('blocks a redirect to an off-origin URL', () => {
    expect(smoke().offOriginRedirectPrevented).toBe(true);
  });

  it('lets a same-origin redirect through', () => {
    expect(smoke().sameOriginRedirectPrevented).toBe(false);
  });

  // Followup security gap 2: the window-open and navigation policy must apply
  // to a SECOND `webContents`, created after startup -- the one a per-window
  // binding (`window.webContents.setWindowOpenHandler(...)`) cannot reach.
  it('denies window.open on a second window created after startup', () => {
    expect(smoke().secondWindowCountAfterOpen).toBe(2);
  });

  it('refuses off-origin navigation on a second window created after startup', () => {
    expect(smoke().secondWindowNavigated).toBe(false);
  });

  // Followup security gap 4: the CSP must be present on the delivered
  // response, not merely configured somewhere main never wires up.
  it('serves the document with a Content-Security-Policy header', () => {
    expect(smoke().cspHeader).toContain("script-src 'self'");
  });

  // The application menu vam builds for itself, read off the BUILT menu.
  // A menu that failed to install reads as an empty walk, and every "no
  // forbidden accelerator" below would then be vacuously true.
  it('installs an application menu with a real tree behind it', () => {
    expect(smoke().menu.length).toBeGreaterThan(10);
    expect(smoke().menu.map((row) => row.path.split(' > ')[0])).toContain('Edit');
  });

  it.each(FORBIDDEN_ACCELERATORS)('never claims %s anywhere in the menu', (accelerator) => {
    const claimed = smoke().menu.filter((row) => row.accelerator === accelerator);
    expect(claimed.map((row) => `${row.path} [${row.role}]`)).toEqual([]);
  });

  it.each(FORBIDDEN_ROLES)(
    'carries no %s role, so no key equivalent can be derived for it',
    (role) => {
      // Accelerator alone is not enough: a role-derived key equivalent comes
      // from the platform and can read back null while still being matched.
      expect(withRole(smoke().menu, role).map((row) => row.path)).toEqual([]);
    },
  );

  // COPY AND PASTE MUST SURVIVE. On macOS the clipboard works THROUGH the
  // menu: a hand-built menu that drops the Edit roles kills Cmd+C/V/X/A in
  // the whole app while every other test here still passes.
  it.each(['undo', 'redo', 'cut', 'copy', 'paste', 'selectall'])(
    'keeps the %s role, without which the clipboard dies app-wide',
    (role) => {
      expect(withRole(smoke().menu, role)).toHaveLength(1);
    },
  );

  // ...and the clipboard PERFORMED, not merely wired: this selects text in the
  // real renderer, runs the action the `copy` role invokes, and reads the real
  // system clipboard back. Seeded with a sentinel first, so "the value was
  // already there" cannot pass it.
  it('really copies the renderer selection to the system clipboard', () => {
    expect(smoke().clipboardAfterContentsCopy).toBe('vam-clipboard-proof');
  });

  // The other clipboard route, and the only coverage main's handler has that
  // is not holding an injected fake. `src/main/clipboard/ipc.ts` AWAITS
  // electron's `writeText` -- a promise since Electron 44 -- so the handler is
  // `async`, and `ipcMain.handle` has to settle it before the answer crosses
  // the process boundary. A unit test cannot see that boundary; this drives
  // the renderer's own `window.api.clipboard.writeText` and then reads the
  // real system clipboard back from main.
  it('really writes to the system clipboard through the bridge channel', () => {
    // The channel's whole contract: `true` means the text landed. A handler
    // that answered a bare Promise, or resolved before the write, fails here.
    expect(smoke().bridgeClipboardWriteAnswer).toBe(true);
    expect(smoke().clipboardAfterBridgeWrite).toBe('vam-bridge-clipboard-proof');
  });

  it.each(['quit', 'minimize'])('keeps the %s role a desktop app needs', (role) => {
    expect(withRole(smoke().menu, role)).toHaveLength(1);
  });

  // REFRESH, off the built menu rather than off the template.
  //
  // Operator: "Cmd+R to refresh vam." Owning the menu had removed Electron's
  // default `reload` with everything else, so the packaged app answered that
  // key with nothing. It is a menu item and not a chord for the reason the
  // rest of this file treats as a hazard: a native key equivalent is matched
  // BEFORE the page sees it -- which is exactly what a wedged renderer needs,
  // since it cannot answer a keydown at all.
  it('offers a reload, with the accelerator written down rather than inherited', () => {
    const reload = withRole(smoke().menu, 'reload');
    expect(reload.map((row) => row.path)).toHaveLength(1);
    expect(reload[0]?.accelerator).toBe('CommandOrControl+R');
  });

  // Zoom, route by route.
  it('rests at zoom factor 1 and zoom level 0', () => {
    expect(smoke().zoomFactorAtRest).toBe(1);
    expect(smoke().zoomLevelAtRest).toBe(0);
  });

  // MEASURED, AND NOT A GUARD. Synthetic Ctrl+wheel and Cmd+wheel move the
  // zoom level by nothing -- and moved it by nothing against the UNLOCKED
  // build too, so `sendInputEvent` does not reach Chromium's wheel-zoom path
  // and this cannot fail either way. Kept as a recorded measurement, not
  // dressed up as protection; the wheel route's real cover is `zoom-changed`
  // below, which IS falsifiable.
  it('records what a synthetic modifier + wheel does to the zoom level', () => {
    expect(smoke().zoomLevelAfterCtrlWheel).toBe(0);
    expect(smoke().zoomLevelAfterMetaWheel).toBe(0);
    expect(smoke().zoomFactorAfterCtrlWheel).toBe(1);
  });

  it('restores the zoom level when Chromium reports a zoom change', () => {
    expect(smoke().zoomLevelAfterZoomChanged).toBe(0);
  });

  // The route that was NOT predicted: Chromium re-applies a stored per-origin
  // zoom on navigation, so a level outlives a reload here and a relaunch in
  // the wild.
  it('does not restore a persisted zoom level after a reload', () => {
    expect(smoke().zoomLevelAfterReload).toBe(0);
    expect(smoke().zoomFactorAfterReload).toBe(1);
  });
});
