/**
 * Linux installer: replace the running AppImage file in place.
 *
 * Only an AppImage launch (the runtime exports `APPIMAGE`, the absolute path
 * of the file) can be updated. The new file is copied next to the old one
 * (same directory, so the final rename is atomic), made executable, and
 * renamed over it at will-quit. Renaming over a running AppImage is safe on
 * Linux: the old inode lives on until the process exits.
 */

import { type SpawnOptions, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { chmod, copyFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { defaultIsWritable, type InstallFailure } from './install-mac.js';

export const APPIMAGE_MODE = 0o755;

export type LinuxPlan = {
  readonly target: string;
  readonly tempPath: string;
  readonly mode: number;
};

/** Where the new file goes: beside the old one, so rename() cannot cross devices. */
export function linuxInstallPlan(appImagePath: string): LinuxPlan {
  return {
    target: appImagePath,
    tempPath: join(dirname(appImagePath), `.${basename(appImagePath)}.update-tmp`),
    mode: APPIMAGE_MODE,
  };
}

export type LinuxCheckDeps = {
  readonly isFile: (path: string) => boolean;
  readonly isWritable: (dir: string) => boolean;
};

export const realLinuxCheckDeps: LinuxCheckDeps = {
  isFile: (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
  isWritable: defaultIsWritable,
};

/** Is this an AppImage launch we can replace? Null when yes. */
export function linuxInstallBlocker(
  env: Readonly<Record<string, string | undefined>>,
  deps: LinuxCheckDeps = realLinuxCheckDeps,
): InstallFailure | null {
  const path = env.APPIMAGE;
  if (path === undefined || path === '' || !isAbsolute(path) || !deps.isFile(path)) {
    return {
      code: 'unsupported-install',
      message: 'Automatic updates need the AppImage build of vam',
    };
  }
  if (!deps.isWritable(dirname(path))) {
    return {
      code: 'not-writable',
      message: `vam cannot write to ${dirname(path)}; move the AppImage somewhere you own`,
    };
  }
  return null;
}

export type LinuxHandle = { readonly kind: 'appimage'; readonly plan: LinuxPlan };
export type LinuxPrepareResult =
  | { readonly ok: true; readonly handle: LinuxHandle }
  | ({ readonly ok: false } & InstallFailure);

export type LinuxPrepareDeps = LinuxCheckDeps & {
  readonly copyFile: (from: string, to: string) => Promise<void>;
  readonly chmod: (path: string, mode: number) => Promise<void>;
  readonly rm: (path: string) => Promise<void>;
};

export const realLinuxPrepareDeps: LinuxPrepareDeps = {
  ...realLinuxCheckDeps,
  copyFile: (a, b) => copyFile(a, b),
  chmod: (p, m) => chmod(p, m),
  rm: (p) => rm(p, { force: true }),
};

/** Stage the verified download beside the running AppImage. Replaces nothing yet. */
export async function prepareLinuxInstall(
  input: { readonly filePath: string; readonly env: Readonly<Record<string, string | undefined>> },
  deps: LinuxPrepareDeps = realLinuxPrepareDeps,
): Promise<LinuxPrepareResult> {
  const blocker = linuxInstallBlocker(input.env, deps);
  if (blocker !== null) return { ok: false, ...blocker };
  const plan = linuxInstallPlan(input.env.APPIMAGE as string);
  try {
    await deps.copyFile(input.filePath, plan.tempPath);
    await deps.chmod(plan.tempPath, plan.mode);
    return { ok: true, handle: { kind: 'appimage', plan } };
  } catch (e) {
    await deps.rm(plan.tempPath).catch(() => undefined);
    return {
      ok: false,
      code: 'install-failed',
      message: `Could not stage the update: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export type LinuxLaunchDeps = {
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly rm: (path: string) => Promise<void>;
  readonly spawn: (cmd: string, args: readonly string[], opts: SpawnOptions) => { unref(): void };
};

export const realLinuxLaunchDeps: LinuxLaunchDeps = {
  rename: (a, b) => rename(a, b),
  rm: (p) => rm(p, { force: true }),
  spawn,
};

/**
 * At will-quit: rename the staged file over the AppImage, then start it.
 * If the rename fails the staged copy is dropped and the OLD file is
 * relaunched: the operator is never left with no app.
 */
export async function launchLinuxInstall(
  handle: LinuxHandle,
  deps: LinuxLaunchDeps = realLinuxLaunchDeps,
): Promise<{ readonly replaced: boolean }> {
  let replaced = false;
  try {
    await deps.rename(handle.plan.tempPath, handle.plan.target);
    replaced = true;
  } catch {
    await deps.rm(handle.plan.tempPath).catch(() => undefined);
  }
  deps.spawn(handle.plan.target, ['--updated'], { detached: true, stdio: 'ignore' }).unref();
  return { replaced };
}
