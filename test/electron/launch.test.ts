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
}

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
 * black-smith's wire format, minimally: one `hello` and then a `change`
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
  it('runs the preload, which exposes the bridge', () => {
    expect(smoke().bridgeKeys).toEqual([
      'applyWaivers',
      'closeSession',
      'createSession',
      'describe',
      'load',
      'recordPrompt',
      'renameSession',
      'subscribe',
      'transitionLesson',
    ]);
    expect(smoke().bridgeLoadType).toBe('function');
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

  it('resolves to the same Project/Session shape the browser build produces', () => {
    const result = smoke().sourceLoad;
    if (!result.ok) {
      throw new Error(`sourceLoad rejected: ${result.message}`);
    }
    const demoProject = DEMO_MODEL.projects[0];
    const demoSession = demoProject?.sessions[0];
    expect(result.projectKeys).toEqual(Object.keys(demoProject ?? {}).sort());
    expect(result.sessionKeys).toEqual(Object.keys(demoSession ?? {}).sort());
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
});
