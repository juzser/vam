/**
 * A minimal probe for the userData-isolation fix in `src/main/index.ts`.
 *
 * `test/electron/probe.cjs` (the full AC-13/AC-14 smoke suite) already boots
 * the real app, but this proves a narrower thing much faster: WHERE the real
 * `out/main/index.cjs` -- the exact bundle the app and the smoke harness both
 * load -- resolves `app.getPath('userData')` to, and that Chromium's own
 * storage backend, not just this script, really writes there. Loading the
 * built main by `require`, exactly as `probe.cjs` does, means whatever this
 * observes is the fix under test, not a reimplementation of it.
 *
 * Two modes, selected by env:
 *  - default: collects the result, forces one real localStorage write (so
 *    `Local Storage/` is actually created on disk, the way any real session
 *    does), prints one JSON line, exits.
 *  - `VAM_PROBE_HOLD_MS` set: does the same, THEN stays alive for that many
 *    ms (or until killed) -- used to hold a second, concurrent instance open
 *    against its OWN userData dir while another launch runs against a
 *    different one (the harness's isolation test never uses the operator's
 *    real, running vam.app for this).
 */
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

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
  throw new Error('userdata-probe: no BrowserWindow finished loading within 10s');
}

async function main() {
  require(MAIN);
  await app.whenReady();
  const win = await waitForWindow();
  // A real write through Chromium's own Local Storage backend -- not a file
  // this script wrote itself -- so `Local Storage/` on disk is the fix's own
  // evidence, the same subsystem the operator's real prefs live in.
  await win.webContents.executeJavaScript(
    "window.localStorage.setItem('vam-userdata-probe', String(Date.now())); undefined",
    true,
  );
  // LevelDB flushes asynchronously; give it a moment before this process
  // reads its own writes back off disk.
  await sleep(300);

  const result = { userData: app.getPath('userData'), pid: process.pid };
  process.stdout.write(`VAM_USERDATA_RESULT ${JSON.stringify(result)}\n`);

  const holdMs = Number(process.env.VAM_PROBE_HOLD_MS ?? '0');
  if (holdMs > 0) {
    await sleep(holdMs);
  }
  app.exit(0);
}

main().catch((error) => {
  process.stderr.write(`VAM_USERDATA_ERROR ${error?.stack ?? error}\n`);
  app.exit(1);
});
