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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distAppDir = path.join(repoRoot, 'dist-app');
const OFF_ORIGIN = 'https://example.invalid/';

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
  for (const entry of fs.readdirSync(distAppDir)) {
    const binaryPath = path.join(distAppDir, entry, unpackedSuffix, binaryName);
    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  }
  throw new Error(`no ${unpackedSuffix}/${binaryName} found under ${distAppDir}`);
}

test('the packaged app launches, is packaged, and stays locked down', async () => {
  const electronApp = await electron.launch({ executablePath: resolveExecutablePath() });

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
  } finally {
    await electronApp.close();
  }
});
