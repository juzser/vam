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

function launch(port: number): Promise<Launch> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin('electron'), [path.join('test', 'electron', 'probe.cjs')], {
      cwd: repoRoot,
      env: { ...process.env, VAM_SMOKE_PORT: String(port) },
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
  let launched: Launch;

  beforeAll(async () => {
    execFileSync(bin('electron-vite'), ['build'], { cwd: repoRoot, stdio: 'pipe' });
    const started = await startNoCorsServer();
    server = started.server;
    launched = await launch(started.port);
  }, 180_000);

  afterAll(() => {
    server?.close();
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
      'transitionLesson',
    ]);
    expect(smoke().bridgeLoadType).toBe('function');
  });

  // `subscribe` needs `ipcRenderer.on`, not `invoke`, and is a later task. It
  // must be ABSENT rather than present-and-broken, so the descriptor's
  // `liveUpdates: false` and the bridge agree.
  it('exposes no subscribe member yet', () => {
    expect(smoke().bridgeKeys).not.toContain('subscribe');
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

  it('refuses off-origin navigation, so the URL is unchanged', () => {
    expect(smoke().urlAfterNavigate).toBe(smoke().urlBeforeNavigate);
  });
});
