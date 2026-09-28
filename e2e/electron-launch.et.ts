/**
 * AC-18: the packaged app is a real app.
 *
 * Playwright's `_electron` launcher resolves the Electron binary from ITS
 * OWN resolution root, `e2e/` -- and `e2e/node_modules` holds only the
 * Playwright harness, no `electron` (see the task brief; not something to
 * fix by installing electron into `e2e/`). So this spec never launches via
 * the bare `electron` binary at all: it points `executablePath` straight at
 * electron-builder's `--dir` output, the actual packaged application
 * produced from the repo root's `out/` build, built and packaged by the
 * operator before this spec runs.
 *
 * Re-runs AC-13's three core launch assertions (boots, exactly one window,
 * the window finishes loading and reaches the known title) and AC-14's six
 * security clauses against that packaged binary -- where `app.isPackaged`
 * is true and the renderer loads from `out/renderer/index.html` rather than
 * `ELECTRON_RENDERER_URL`, the one path this criterion exists to catch a
 * regression in.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distAppDir = path.join(repoRoot, 'dist-app');
const OFF_ORIGIN = 'https://example.invalid/';

/**
 * ISOLATES EVERY TMUX CALL THIS SPEC'S LAUNCH MAKES from the operator's own
 * default tmux server -- see `test/support/tmux-harness-env.ts`'s header for
 * the full rationale and the measured evidence; this file inlines the
 * identical, small mechanism rather than importing across the `e2e/` /
 * root-`test/` boundary, which nothing else in this directory does (`e2e/`
 * keeps its own toolchain -- `e2e/node_modules`, no shared `tsconfig` --
 * exactly so a spec here never depends on the root project's own test tree).
 *
 * THIS SPEC IS THE ONE MOST LIKELY TO ACTUALLY REACH TMUX FOR REAL: unlike
 * every `test/electron/*.test.ts` launch, it sets NO `VAM_FIXTURE_SOURCE` --
 * `src/main/index.ts`'s `DESKTOP_SOURCES` therefore serves the operator's
 * REAL Claude Code and Codex sessions, and a live one on screen is exactly
 * what drives vam's Terminal machinery (`createControlTmuxRunner`,
 * `src/main/sources/tmux/control.ts`) to open its `-C new-session -A -s
 * vamctl` control connection -- the exact session the evidence for this fix
 * found sitting on the operator's real default server, with a pane cwd
 * inside an agent's worktree.
 */
const TMUX_SOCKET_ROOT = '/tmp';
const NO_SERVER = /no server running|error connecting to .*\(no such file/i;

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function stderrOf(error: unknown): string {
  return error !== null && typeof error === 'object' && 'stderr' in error
    ? String((error as { stderr: unknown }).stderr)
    : '';
}

function isolatedTmuxEnv(base: NodeJS.ProcessEnv, tmuxTmpdir: string): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...base, TMUX_TMPDIR: tmuxTmpdir };
  delete next.TMUX;
  return next;
}

function defaultServerPaneCwds(): string[] {
  try {
    const stdout = execFileSync('tmux', ['list-sessions', '-F', '#{pane_current_path}'], {
      env: process.env,
      encoding: 'utf8',
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  } catch (error) {
    if (NO_SERVER.test(stderrOf(error))) return [];
    throw error;
  }
}

function assertNoNewSessionUnderOnDefaultServer(input: {
  before: readonly string[];
  after: readonly string[];
  watchDir: string;
}): void {
  const { before, after, watchDir } = input;
  const beforeSet = new Set(before);
  const isUnder = (cwd: string): boolean => cwd === watchDir || cwd.startsWith(watchDir + path.sep);
  const introduced = after.filter((cwd) => !beforeSet.has(cwd) && isUnder(cwd));
  if (introduced.length > 0) {
    throw new Error(
      `a new session appeared on the OPERATOR'S DEFAULT tmux server with a pane cwd under ` +
        `${watchDir}, which the isolated launch must never reach: ${introduced.join(', ')}`,
    );
  }
}

/**
 * THE INCIDENT THIS GUARDS AGAINST -- identical mechanism to `test/support/
 * tmux-harness-env.ts`'s own `resolveIsolatedSocket`, inlined here rather
 * than imported (see this file's own header). tmux resolves a NAMED socket
 * (`-L name`, including the implicit `default` name a bare `tmux` call
 * always uses) by searching `"$TMUX_TMPDIR:/tmp/"` for the first entry whose
 * `realpath` succeeds, SKIPPING rather than erroring on one that fails (a
 * deleted directory). So `TMUX_TMPDIR=<a deleted dir> tmux -L default
 * kill-server` falls through to `/tmp/tmux-<uid>/default` -- the OPERATOR'S
 * REAL default server -- and kills it. This computes the absolute socket
 * path itself and addresses it with `-S`, which opens that exact path
 * directly with no search-list fallback at all; a `tmuxTmpdir` that no
 * longer resolves to a real socket does nothing, rather than ever letting
 * tmux guess. Defence in depth: throws if the computed path is not safely
 * under `/tmp`/`os.tmpdir()`, or if it exactly equals either real
 * default-server path -- both checks run before any filesystem check, so
 * they fire even when a real default socket happens to sit there.
 */
function resolveIsolatedSocket(tmuxTmpdir: string, uid: number = process.getuid?.() ?? 0): string | null {
  const socketPath = path.join(tmuxTmpdir, `tmux-${uid}`, 'default');

  const tmpRoots = new Set<string>(['/tmp', os.tmpdir()]);
  if (process.env.TMPDIR) tmpRoots.add(process.env.TMPDIR);
  const underATmpRoot = [...tmpRoots].some(
    (root) => socketPath === path.join(root, `tmux-${uid}`, 'default') || socketPath.startsWith(`${root}${path.sep}`),
  );
  if (!underATmpRoot) {
    throw new Error(
      `refusing to resolve a tmux socket outside /tmp or os.tmpdir(): ${socketPath} (from tmuxTmpdir=${tmuxTmpdir})`,
    );
  }

  const forbiddenDefaultPaths = [...tmpRoots].map((root) => path.join(root, `tmux-${uid}`, 'default'));
  if (forbiddenDefaultPaths.includes(socketPath)) {
    throw new Error(
      `refusing to target the operator's own default tmux socket (${socketPath}) -- ` +
        `an isolated/destructive call must never be able to reach it, even via TMUX_TMPDIR's own fallback`,
    );
  }

  try {
    return fs.lstatSync(socketPath).isSocket() ? socketPath : null;
  } catch {
    return null;
  }
}

/** Strips `TMUX` and `TMUX_PANE` from the env handed to an explicit-socket
 *  tmux call, so nothing about this process's own possible tmux nesting
 *  leaks into it. */
function withoutTmuxNesting(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...base };
  delete next.TMUX;
  delete next.TMUX_PANE;
  return next;
}

function isolatedServerSessionCount(tmuxTmpdir: string): number {
  const socket = resolveIsolatedSocket(tmuxTmpdir);
  if (socket === null) return 0;
  try {
    const stdout = execFileSync('tmux', ['-S', socket, 'list-sessions'], {
      env: withoutTmuxNesting(process.env),
      encoding: 'utf8',
    });
    return stdout.split('\n').filter((line) => line.trim() !== '').length;
  } catch (error) {
    if (NO_SERVER.test(stderrOf(error))) return 0;
    throw error;
  }
}

function killIsolatedServer(tmuxTmpdir: string): void {
  const socket = resolveIsolatedSocket(tmuxTmpdir);
  if (socket === null) return;
  try {
    execFileSync('tmux', ['-S', socket, 'kill-server'], {
      env: withoutTmuxNesting(process.env),
      stdio: 'ignore',
    });
  } catch {
    // Gone already between the isSocket() check and this call -- fine.
  }
}

/** `/tmp` itself, never `os.tmpdir()` -- see `TMUX_SOCKET_ROOT`'s own note:
 *  a tmux socket is a real AF_UNIX path, and macOS's per-process
 *  `os.tmpdir()` is already close to the kernel's ~104-byte `sun_path`
 *  ceiling before this file's own `tmux-<uid>/<name>` suffix is added. */
function mkIsolatedTmuxTmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(TMUX_SOCKET_ROOT, `${prefix}-`));
}

/**
 * electron-builder's `--dir` output layout is platform-specific; this walks
 * it rather than hardcoding one machine's arch folder (e.g. `mac-arm64`),
 * so the spec keeps working under any arch this repo builds on.
 */
function resolveExecutablePath(): string {
  if (!fs.existsSync(distAppDir)) {
    throw new Error(
      `${distAppDir} does not exist -- run "electron-builder --dir --config electron-builder.config.cjs" first`,
    );
  }
  if (process.platform === 'darwin') {
    for (const entry of fs.readdirSync(distAppDir)) {
      const macOsDir = path.join(distAppDir, entry, 'vam.app', 'Contents', 'MacOS');
      if (fs.existsSync(macOsDir)) {
        const [binary] = fs.readdirSync(macOsDir);
        if (binary === undefined) {
          throw new Error(`${macOsDir} contains no executable`);
        }
        return path.join(macOsDir, binary);
      }
    }
    throw new Error(`no vam.app found under ${distAppDir}`);
  }
  const unpackedSuffix = process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked';
  const binaryName = process.platform === 'win32' ? 'vam.exe' : 'vam';
  // TWO LAYOUTS, not one. On macOS electron-builder nests its output under an
  // arch directory (`dist-app/mac-arm64/vam.app`), which is what the loop below
  // walks. On Linux and Windows it does NOT: the unpacked tree sits directly at
  // `dist-app/linux-unpacked/vam`. Walking entries there looks for
  // `dist-app/linux-unpacked/linux-unpacked/vam` and finds nothing -- which is
  // exactly how this failed the first time it ever ran on Linux, reporting a
  // missing binary for a package that had built perfectly.
  const direct = path.join(distAppDir, unpackedSuffix, binaryName);
  if (fs.existsSync(direct)) {
    return direct;
  }
  for (const entry of fs.readdirSync(distAppDir)) {
    const binaryPath = path.join(distAppDir, entry, unpackedSuffix, binaryName);
    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  }
  throw new Error(`no ${unpackedSuffix}/${binaryName} found under ${distAppDir}`);
}

/**
 * A genuinely free loopback port, never the operator's own remote-serve port
 * (58217, `DEFAULT_REMOTE_PORT` in `src/main/remote/launch.ts`) -- main starts
 * a remote transport unconditionally on `whenReady`, defaulting to that port
 * when `VAM_REMOTE_PORT` is unset. A bind against an already-taken port is
 * caught and non-fatal by design (`startRemoteTransport`'s own comment), but
 * this spec does not even attempt it: the packaged app under test is handed
 * its own dynamically allocated port instead.
 */
async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address !== null && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error('no port assigned'));
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

test('the packaged app launches, is packaged, and stays locked down', async () => {
  // A throwaway `userData` for this one launch, never the operator's real
  // profile -- see `src/main/index.ts`'s `VAM_USER_DATA_DIR` handling. This
  // is the packaged app itself (`app.isPackaged` is asserted below), so the
  // same override that isolates `test/electron/launch.test.ts` isolates this
  // spec too.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vam-electron-et-userdata-'));
  const remotePort = await allocatePort();
  // ISOLATES EVERY TMUX CALL THIS LAUNCH MAKES -- see this file's own header
  // note above for why this spec, of every launch in this repo, is the one
  // most likely to actually reach tmux for real.
  const tmuxTmpdir = mkIsolatedTmuxTmpdir('vam-electron-et-tmux');
  const defaultServerBefore = tmuxAvailable() ? defaultServerPaneCwds() : [];
  const electronApp = await electron.launch({
    executablePath: resolveExecutablePath(),
    env: isolatedTmuxEnv(
      {
        ...process.env,
        VAM_USER_DATA_DIR: userDataDir,
        VAM_REMOTE_PORT: String(remotePort),
      },
      tmuxTmpdir,
    ),
  });

  try {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // AC-13 (1) & (2): the process is up and exactly one window opened.
    expect(electronApp.windows().length).toBe(1);

    // AC-13 (3): the renderer reached the known, non-blank state -- and
    // it did so as a packaged app, not against ELECTRON_RENDERER_URL.
    const isPackaged = await electronApp.evaluate(({ app }) => app.isPackaged);
    expect(isPackaged).toBe(true);
    await expect.poll(() => window.title()).toBe('VAM');
    const rootHtmlLength = await window.evaluate(
      () => (document.getElementById('root')?.innerHTML ?? '').length,
    );
    expect(rootHtmlLength).toBeGreaterThan(0);

    // AC-14, one assertion per clause.
    const prefs = await electronApp.evaluate(({ BrowserWindow }) => {
      const [win] = BrowserWindow.getAllWindows();
      return win?.webContents.getLastWebPreferences() ?? {};
    });
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.webSecurity).toBe(true);

    await window.evaluate((offOrigin) => {
      window.open(offOrigin);
    }, OFF_ORIGIN);
    await window.waitForTimeout(700);
    expect(electronApp.windows().length).toBe(1);

    const urlBeforeNavigate = window.url();
    await window.evaluate((offOrigin) => {
      window.location.href = offOrigin;
    }, OFF_ORIGIN);
    await window.waitForTimeout(700);
    expect(window.url()).toBe(urlBeforeNavigate);

    // THE TMUX ISOLATION, PROVEN AT RUNTIME -- see `test/electron/
    // launch.test.ts`'s identical assertion for the full rationale.
    if (tmuxAvailable()) {
      assertNoNewSessionUnderOnDefaultServer({
        before: defaultServerBefore,
        after: defaultServerPaneCwds(),
        watchDir: repoRoot,
      });
      expect(() => isolatedServerSessionCount(tmuxTmpdir)).not.toThrow();
    }
  } finally {
    await electronApp.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    if (tmuxAvailable()) {
      killIsolatedServer(tmuxTmpdir);
      fs.rmSync(tmuxTmpdir, { recursive: true, force: true });
    }
  }
});
