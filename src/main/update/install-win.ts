/**
 * Windows installer: run the downloaded NSIS setup silently over the install.
 *
 * Flag semantics, from electron-builder's own NSIS scripts
 * (app-builder-lib 26.x):
 *  - `/S` is NSIS's standard silent switch (`${Silent}`).
 *  - `--updated` and `--force-run` are declared as flags in
 *    `out/targets/nsis/NsisTarget.js` (`scriptGenerator.flags([...])`) and
 *    tested with `StdUtils.TestParameter`, i.e. as `--updated`/`--force-run`.
 *  - `templates/nsis/installSection.nsh`: for a non-one-click (assisted)
 *    installer, `${if} ${isForceRun} ${andIf} ${Silent}` starts the app after
 *    install ("assisted installer has run after finish option" otherwise).
 *    The app is started through `common.nsh` `StartApp`, which appends
 *    `--updated` to the launch when `${isUpdated}`.
 *  - `include/allowOnlyOneInstallerInstance.nsh` `_CHECK_APP_RUNNING`: with
 *    `${isUpdated}` the installer waits for the app to exit by itself
 *    (Sleep 300 / 1000) and goes on to stop it without a prompt, instead of
 *    the "vam is running" MessageBox.
 *  - `assistedInstaller.nsh` / `skipPageIfUpdated`: `--updated` skips the
 *    directory page, so the existing install directory is reused.
 *
 * Known, untested without a real install: a per-machine install still raises
 * a UAC prompt even with `/S`.
 */

import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { type InstallFailure, type Spawner, spawnDetached } from './install-mac.js';

export function winInstallArgs(): string[] {
  return ['/S', '--updated', '--force-run'];
}

/** The NSIS uninstaller electron-builder writes beside the app executable. */
export function nsisUninstallerPath(execPath: string, productName = 'vam'): string {
  return win32.join(win32.dirname(execPath), `Uninstall ${productName}.exe`);
}

export type WinHandle = { readonly kind: 'nsis'; readonly installerPath: string };
export type WinPrepareResult =
  | { readonly ok: true; readonly handle: WinHandle }
  | ({ readonly ok: false } & InstallFailure);

/** The download must be the setup exe, present, inside the updates dir. */
export function prepareWinInstall(
  input: { readonly installerPath: string; readonly updatesDir: string },
  deps: { readonly isFile: (p: string) => boolean } = {
    isFile: (p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    },
  },
): WinPrepareResult {
  const isWinPath = input.installerPath.includes('\\') || /^[A-Za-z]:/.test(input.installerPath);
  const p = isWinPath ? win32 : posix;
  const rel = p.relative(input.updatesDir, input.installerPath);
  const inside = rel !== '' && !rel.startsWith('..') && !p.isAbsolute(rel);
  if (!inside || !input.installerPath.toLowerCase().endsWith('.exe')) {
    return { ok: false, code: 'install-failed', message: 'Unexpected installer location' };
  }
  if (!deps.isFile(input.installerPath)) {
    return { ok: false, code: 'install-failed', message: 'The downloaded installer is missing' };
  }
  return { ok: true, handle: { kind: 'nsis', installerPath: input.installerPath } };
}

export type WinSpawner = Spawner;

/** Start the setup detached, so it outlives this process. Call at will-quit. */
export function launchWinInstall(
  handle: WinHandle,
  spawner: WinSpawner = spawn,
  settleMs?: number,
): Promise<void> {
  return spawnDetached(
    spawner,
    handle.installerPath,
    winInstallArgs(),
    { detached: true, stdio: 'ignore', windowsHide: true },
    settleMs,
  );
}
