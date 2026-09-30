/**
 * The installer seam Task 5's controller talks to. Three moves:
 *
 *  - `detectInstallKind` / `installBlocker`: what this install can be updated
 *    as, and whether it can be updated HERE (asked before downloading);
 *  - `prepareInstall`: validate + extract/stage the verified download, return
 *    a handle. Changes nothing about the installed app;
 *  - `launchInstall`: at `will-quit`, start the platform's installer detached.
 *
 * The platform work lives in install-mac/-linux/-win as pure plan builders
 * plus thin spawners.
 */

import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import type { InstallKind } from '../../shared/update-manifest.js';
import {
  type LinuxHandle,
  launchLinuxInstall,
  linuxInstallBlocker,
  prepareLinuxInstall,
} from './install-linux.js';
import {
  appBundleFromExecPath,
  defaultIsWritable,
  type InstallFailure,
  launchMacInstall,
  type MacHandle,
  macInstallBlocker,
  prepareMacInstall,
} from './install-mac.js';
import {
  launchWinInstall,
  nsisUninstallerPath,
  prepareWinInstall,
  type WinHandle,
} from './install-win.js';

export type { InstallFailure } from './install-mac.js';
export type InstallHandle = MacHandle | LinuxHandle | WinHandle;
export type PrepareResult =
  | { readonly ok: true; readonly handle: InstallHandle }
  | ({ readonly ok: false } & InstallFailure);

type Env = Readonly<Record<string, string | undefined>>;

/**
 * What this running install is:
 *  - darwin: inside a `.app` bundle -> mac-zip;
 *  - linux: launched from an AppImage (`APPIMAGE` is an absolute path) -> appimage;
 *  - win32: an NSIS install, recognised by the `Uninstall vam.exe` beside the
 *    executable (the portable zip has none) -> nsis;
 *  - everything else (dev runs, deb/rpm, portable) -> unsupported.
 */
export function detectInstallKind(
  platform: string,
  env: Env,
  execPath: string,
  deps: { readonly exists?: (path: string) => boolean } = {},
): InstallKind {
  const exists = deps.exists ?? existsSync;
  if (platform === 'darwin')
    return appBundleFromExecPath(execPath) === null ? 'unsupported' : 'mac-zip';
  if (platform === 'linux') {
    const p = env.APPIMAGE;
    return p?.startsWith('/') && exists(p) ? 'appimage' : 'unsupported';
  }
  if (platform === 'win32') {
    return win32.isAbsolute(execPath) && exists(nsisUninstallerPath(execPath))
      ? 'nsis'
      : 'unsupported';
  }
  return 'unsupported';
}

/**
 * Can this install be updated where it sits? Null when yes. The mac
 * location rules and the AppImage directory rules, checked before any bytes
 * are downloaded. Windows has no cheap pre-check (the setup elevates itself).
 */
export function installBlocker(
  kind: InstallKind,
  ctx: { readonly env: Env; readonly execPath: string },
  deps: { readonly isWritable?: (dir: string) => boolean } = {},
): InstallFailure | null {
  switch (kind) {
    case 'mac-zip': {
      const app = appBundleFromExecPath(ctx.execPath);
      if (app === null) {
        return { code: 'unsupported-install', message: 'vam is not running from an app bundle' };
      }
      return macInstallBlocker(app, { isWritable: deps.isWritable ?? defaultIsWritable });
    }
    case 'appimage':
      return linuxInstallBlocker(ctx.env);
    case 'nsis':
      return null;
    case 'unsupported':
      return { code: 'unsupported-install', message: 'This install of vam cannot update itself' };
  }
}

export type PrepareInput = {
  readonly kind: InstallKind;
  readonly version: string;
  /** The verified download. */
  readonly filePath: string;
  readonly updatesDir: string;
  readonly execPath: string;
  readonly env: Env;
  readonly pid: number;
};

export async function prepareInstall(input: PrepareInput): Promise<PrepareResult> {
  switch (input.kind) {
    case 'mac-zip':
      return prepareMacInstall({
        version: input.version,
        zipPath: input.filePath,
        updatesDir: input.updatesDir,
        execPath: input.execPath,
        pid: input.pid,
      });
    case 'appimage':
      return prepareLinuxInstall({ filePath: input.filePath, env: input.env });
    case 'nsis':
      return prepareWinInstall({ installerPath: input.filePath, updatesDir: input.updatesDir });
    case 'unsupported':
      return {
        ok: false,
        code: 'unsupported-install',
        message: 'This install of vam cannot update itself',
      };
  }
}

/** Start the installer detached. Call from `will-quit`, never before. */
export async function launchInstall(handle: InstallHandle): Promise<void> {
  switch (handle.kind) {
    case 'mac-zip':
      launchMacInstall(handle);
      return;
    case 'appimage':
      await launchLinuxInstall(handle);
      return;
    case 'nsis':
      launchWinInstall(handle);
      return;
  }
}
