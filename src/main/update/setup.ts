/**
 * Builds the running updater from the real pieces -- the state file, the
 * GitHub check, the verified download and the installers -- so `../index.ts`
 * only has to say where `userData` is, how to quit and whom to tell.
 *
 * Electron-free on purpose: the app-shaped inputs arrive as arguments.
 */

import type { UpdateStatus } from '../../shared/update.js';
import { checkForUpdate, DEFAULT_UPDATE_DEPS } from './check.js';
import { createUpdateController, type UpdateController } from './controller.js';
import { cleanUpdatesDir, downloadAsset, isVerified, updatesDir } from './download.js';
import { detectInstallKind, installBlocker, launchInstall, prepareInstall } from './install.js';
import { createScheduler, type Scheduler } from './scheduler.js';
import { openUpdateState, updateStatePath } from './state-file.js';

export type UpdaterOptions = {
  readonly currentVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execPath: string;
  readonly pid: number;
  readonly userData: string;
  /** `app.quit()`. */
  readonly quit: () => void;
  readonly broadcast: (status: UpdateStatus) => void;
  readonly openExternal: (url: string) => Promise<void>;
};

export type Updater = {
  readonly controller: UpdateController;
  readonly scheduler: Scheduler;
};

export async function createUpdater(options: UpdaterOptions): Promise<Updater> {
  const dir = updatesDir(options.userData);
  // EVERY startup, not only after `--updated`: the mac install relaunches with
  // no arguments, and a leftover download or staging directory is dead weight
  // either way. `install.log` is kept.
  void cleanUpdatesDir(dir);

  const store = await openUpdateState(updateStatePath(options.userData));
  const platform =
    options.platform === 'darwin' || options.platform === 'win32' ? options.platform : 'linux';
  const arch = options.arch === 'arm64' ? 'arm64' : 'x64';
  const installKind = detectInstallKind(options.platform, options.env, options.execPath);

  const controller = createUpdateController({
    currentVersion: options.currentVersion,
    target: { platform, arch, installKind },
    env: options.env,
    execPath: options.execPath,
    pid: options.pid,
    updatesDir: dir,
    store,
    check: (current, target) => checkForUpdate(current, target, DEFAULT_UPDATE_DEPS),
    download: downloadAsset,
    isVerified,
    installBlocker,
    prepareInstall,
    launchInstall,
    openExternal: options.openExternal,
    quit: options.quit,
    broadcast: options.broadcast,
    now: Date.now,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });

  const scheduler = createScheduler({
    clock: Date.now,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    run: async () => {
      await controller.check({ manual: false });
    },
    getAutoCheck: controller.getAutoCheck,
    getLastCheckAt: controller.getLastCheckAt,
  });

  return { controller, scheduler };
}
