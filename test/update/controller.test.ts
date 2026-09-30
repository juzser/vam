import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckResult } from '../../src/main/update/check.js';
import {
  createUpdateController,
  onQuitOutcome,
  type UpdateControllerDeps,
} from '../../src/main/update/controller.js';
import { DownloadError } from '../../src/main/update/download.js';
import type { InstallHandle } from '../../src/main/update/install.js';
import { DEFAULT_UPDATE_STATE, type UpdateState } from '../../src/main/update/state-file.js';
import type { UpdateStatus } from '../../src/shared/update.js';

const ASSET = {
  name: 'vam-0.2.0-mac-arm64.zip',
  url: 'https://github.com/juzser/vam/releases/download/v0.2.0/vam-0.2.0-mac-arm64.zip',
  size: 10,
  sha512: 'x'.repeat(88),
  kind: 'mac-zip' as const,
};
const NOTES = 'https://github.com/juzser/vam/releases/tag/v0.2.0';
const AVAILABLE: CheckResult = {
  kind: 'available',
  version: '0.2.0',
  notesUrl: NOTES,
  asset: ASSET,
};
const HANDLE = { kind: 'appimage' } as unknown as InstallHandle;
const DIR = '/u/updates';

function make(over: Partial<UpdateControllerDeps> = {}, initial: Partial<UpdateState> = {}) {
  let state: UpdateState = { ...DEFAULT_UPDATE_STATE, ...initial };
  const broadcasts: UpdateStatus[] = [];
  const order: string[] = [];
  const deps: UpdateControllerDeps = {
    currentVersion: '0.1.0',
    target: { platform: 'darwin', arch: 'arm64', installKind: 'mac-zip' },
    env: {},
    execPath: '/Applications/vam.app/Contents/MacOS/vam',
    pid: 42,
    updatesDir: DIR,
    store: {
      get: () => state,
      update: async (patch) => {
        state = { ...state, ...patch };
      },
    },
    check: vi.fn(async () => AVAILABLE),
    download: vi.fn(async ({ asset, dir, onProgress }) => {
      onProgress?.(50);
      onProgress?.(100);
      return join(dir, asset.name);
    }),
    isVerified: vi.fn(async () => false),
    installBlocker: vi.fn(() => null),
    prepareInstall: vi.fn(async () => ({ ok: true as const, handle: HANDLE })),
    launchInstall: vi.fn(async () => {
      order.push('launch');
    }),
    openExternal: vi.fn(async () => {}),
    quit: vi.fn(() => {
      order.push('quit');
    }),
    broadcast: (s) => broadcasts.push(s),
    now: () => 1_000,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    ...over,
  };
  return { controller: createUpdateController(deps), deps, broadcasts, order, state: () => state };
}

describe('check', () => {
  it('starts idle', () => {
    expect(make().controller.getStatus()).toEqual({ kind: 'idle' });
  });

  it('a manual check that finds a release shows it, and broadcasts checking then available', async () => {
    const { controller, broadcasts } = make();
    const result = await controller.check({ manual: true });
    expect(result).toEqual({ kind: 'available', version: '0.2.0', notesUrl: NOTES });
    expect(broadcasts.map((s) => s.kind)).toEqual(['checking', 'available']);
  });

  it('passes the current version and target to the checker and records lastCheckAt', async () => {
    const { controller, deps, state } = make();
    await controller.check({ manual: false });
    expect(deps.check).toHaveBeenCalledWith('0.1.0', deps.target);
    expect(state().lastCheckAt).toBe(1_000);
  });

  it('an automatic check hides a dismissed version', async () => {
    const { controller } = make({}, { dismissedVersion: '0.2.0' });
    expect((await controller.check({ manual: false })).kind).toBe('idle');
  });

  it('an automatic check still shows a version newer than the dismissed one', async () => {
    const { controller } = make({}, { dismissedVersion: '0.1.5' });
    expect((await controller.check({ manual: false })).kind).toBe('available');
  });

  it('a manual check surfaces a dismissed version', async () => {
    const { controller } = make({}, { dismissedVersion: '0.2.0' });
    expect((await controller.check({ manual: true })).kind).toBe('available');
  });

  it('reports up-to-date / none / incomplete as not-available, carrying manual', async () => {
    for (const kind of ['up-to-date', 'none', 'incomplete'] as const) {
      const { controller } = make({ check: vi.fn(async () => ({ kind }) as CheckResult) });
      expect(await controller.check({ manual: true })).toEqual({
        kind: 'not-available',
        manual: true,
        reason: kind,
      });
    }
    const { controller } = make({
      check: vi.fn(async () => ({ kind: 'up-to-date' }) as CheckResult),
    });
    expect(await controller.check({ manual: false })).toEqual({
      kind: 'not-available',
      manual: false,
      reason: 'up-to-date',
    });
  });

  it('a manual failed check shows an error card; an automatic one stays quiet', async () => {
    const failing = vi.fn(async () => ({ kind: 'error', code: 'rate-limited' }) as CheckResult);
    const manual = make({ check: failing });
    expect(await manual.controller.check({ manual: true })).toMatchObject({
      kind: 'error',
      code: 'rate-limited',
    });
    const auto = make({ check: failing });
    expect((await auto.controller.check({ manual: false })).kind).toBe('idle');
  });

  it('turns a rejecting checker into a network error, never a throw', async () => {
    const { controller } = make({
      check: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    expect(await controller.check({ manual: true })).toMatchObject({
      kind: 'error',
      code: 'network',
    });
  });

  it('ignores a second check while one is running', async () => {
    let settle: (r: CheckResult) => void = () => {};
    const check = vi.fn(() => new Promise<CheckResult>((r) => (settle = r)));
    const { controller } = make({ check });
    const first = controller.check({ manual: true });
    await controller.check({ manual: true });
    expect(check).toHaveBeenCalledTimes(1);
    settle(AVAILABLE);
    await first;
  });
});

describe('dismiss', () => {
  it('dismissing an available release persists the version and returns to idle', async () => {
    const { controller, state } = make();
    await controller.check({ manual: true });
    expect(await controller.dismiss()).toEqual({ kind: 'idle' });
    expect(state().dismissedVersion).toBe('0.2.0');
  });

  it('closes an error or not-available card without persisting anything', async () => {
    const { controller, state } = make({
      check: vi.fn(async () => ({ kind: 'up-to-date' }) as CheckResult),
    });
    await controller.check({ manual: true });
    expect(await controller.dismiss()).toEqual({ kind: 'idle' });
    expect(state().dismissedVersion).toBeNull();
  });
});

describe('autoCheck', () => {
  it('persists the setting', async () => {
    const { controller, state } = make();
    expect(controller.getAutoCheck()).toBe(true);
    await controller.setAutoCheck(false);
    expect(controller.getAutoCheck()).toBe(false);
    expect(state().autoCheck).toBe(false);
  });
});

describe('download and install', () => {
  it('downloads, prepares, then asks the app to quit -- launching nothing yet', async () => {
    const { controller, deps, broadcasts, order } = make();
    await controller.check({ manual: true });
    broadcasts.length = 0;
    await controller.download();
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(deps.prepareInstall).toHaveBeenCalledWith({
      kind: 'mac-zip',
      version: '0.2.0',
      filePath: join(DIR, ASSET.name),
      updatesDir: DIR,
      execPath: deps.execPath,
      env: deps.env,
      pid: 42,
    });
    expect(broadcasts.map((s) => s.kind)).toEqual([
      'downloading',
      'downloading',
      'downloading',
      'installing',
    ]);
    expect(controller.getStatus()).toEqual({ kind: 'installing', version: '0.2.0' });
    expect(order).toEqual(['quit']);
    expect(deps.launchInstall).not.toHaveBeenCalled();
  });

  it('checks the install blocker BEFORE downloading anything', async () => {
    const { controller, deps } = make({
      installBlocker: vi.fn(() => ({ code: 'translocated' as const, message: 'Move vam' })),
    });
    await controller.check({ manual: true });
    await controller.download();
    expect(controller.getStatus()).toEqual({
      kind: 'error',
      code: 'translocated',
      message: 'Move vam',
    });
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it('an unsupported install still shows the version, then errors on download', async () => {
    const { controller, deps } = make({
      check: vi.fn(async () => ({ ...AVAILABLE, asset: null }) as CheckResult),
    });
    expect((await controller.check({ manual: true })).kind).toBe('available');
    await controller.download();
    expect(controller.getStatus()).toMatchObject({ kind: 'error', code: 'unsupported-install' });
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('maps a checksum failure to an error and does not quit', async () => {
    const { controller, deps } = make({
      download: vi.fn(async () => {
        throw new DownloadError('checksum', 'bad');
      }),
    });
    await controller.check({ manual: true });
    await controller.download();
    expect(controller.getStatus()).toMatchObject({ kind: 'error', code: 'checksum' });
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it('maps an unexpected download rejection to a network error', async () => {
    const { controller } = make({
      download: vi.fn(async () => {
        throw new Error('weird');
      }),
    });
    await controller.check({ manual: true });
    await controller.download();
    expect(controller.getStatus()).toMatchObject({ kind: 'error', code: 'network' });
  });

  it('reports a failed prepare as its own error and does not quit', async () => {
    const { controller, deps } = make({
      prepareInstall: vi.fn(async () => ({
        ok: false as const,
        code: 'install-failed' as const,
        message: 'unzip failed',
      })),
    });
    await controller.check({ manual: true });
    await controller.download();
    expect(controller.getStatus()).toEqual({
      kind: 'error',
      code: 'install-failed',
      message: 'unzip failed',
    });
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it('does nothing unless a release is available', async () => {
    const { controller, deps } = make();
    await controller.download();
    expect(deps.download).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual({ kind: 'idle' });
  });

  it('ignores a second download while one is running', async () => {
    let finish: (p: string) => void = () => {};
    const download = vi.fn(() => new Promise<string>((r) => (finish = r)));
    const { controller } = make({ download });
    await controller.check({ manual: true });
    const first = controller.download();
    await controller.download();
    expect(download).toHaveBeenCalledTimes(1);
    finish(join(DIR, ASSET.name));
    await first;
  });

  it('a check during a download does not interrupt it', async () => {
    let finish: (p: string) => void = () => {};
    const { controller, deps } = make({
      download: vi.fn(() => new Promise<string>((r) => (finish = r))),
    });
    await controller.check({ manual: true });
    const dl = controller.download();
    await controller.check({ manual: true });
    expect(deps.check).toHaveBeenCalledTimes(1);
    finish(join(DIR, ASSET.name));
    await dl;
  });
});

describe('quit flow', () => {
  afterEach(() => vi.useRealTimers());

  it('a quit cancelled AFTER before-quit (window veto) times out into quit-cancelled and forgets the launch', async () => {
    vi.useFakeTimers();
    const { controller, deps } = make();
    await controller.check({ manual: true });
    await controller.download();
    controller.onBeforeQuit(false);
    expect(controller.getStatus().kind).toBe('installing');
    vi.advanceTimersByTime(5_000);
    expect(controller.getStatus()).toMatchObject({ kind: 'error', code: 'quit-cancelled' });
    expect(controller.onWillQuit()).toBeNull();
    expect(deps.launchInstall).not.toHaveBeenCalled();
    // The verified file stays: pressing Update again skips the download.
    vi.mocked(deps.isVerified).mockResolvedValue(true);
    await controller.download();
    expect(deps.download).toHaveBeenCalledTimes(1);
  });

  it('will-quit disarms the timeout', async () => {
    vi.useFakeTimers();
    const { controller } = make();
    await controller.check({ manual: true });
    await controller.download();
    await controller.onWillQuit();
    vi.advanceTimersByTime(10_000);
    expect(controller.getStatus().kind).toBe('installing');
  });

  it('will-quit launches the prepared installer once, and only when one is pending', async () => {
    const { controller, deps } = make();
    expect(controller.onWillQuit()).toBeNull();
    await controller.check({ manual: true });
    await controller.download();
    const launched = controller.onWillQuit();
    expect(launched).not.toBeNull();
    await launched;
    expect(deps.launchInstall).toHaveBeenCalledWith(HANDLE);
    expect(controller.onWillQuit()).toBeNull();
  });

  it('a launch that throws does not reject will-quit', async () => {
    const { controller } = make({
      launchInstall: vi.fn(async () => {
        throw new Error('spawn');
      }),
    });
    await controller.check({ manual: true });
    await controller.download();
    await expect(controller.onWillQuit()).resolves.toBeUndefined();
  });

  it('a vetoed quit raises quit-cancelled and drops the pending launch', async () => {
    const { controller, deps } = make();
    await controller.check({ manual: true });
    await controller.download();
    controller.onBeforeQuit(true);
    expect(controller.getStatus()).toEqual({
      kind: 'error',
      code: 'quit-cancelled',
      message: 'Save or discard your edits, then press Update again',
    });
    expect(controller.onWillQuit()).toBeNull();
    expect(deps.launchInstall).not.toHaveBeenCalled();
  });

  it('a quit that goes ahead changes nothing', async () => {
    const { controller } = make();
    await controller.check({ manual: true });
    await controller.download();
    controller.onBeforeQuit(false);
    expect(controller.getStatus().kind).toBe('installing');
    expect(controller.onWillQuit()).not.toBeNull();
  });

  it('a veto with no update pending is not our business', () => {
    const { controller } = make();
    controller.onBeforeQuit(true);
    expect(controller.getStatus()).toEqual({ kind: 'idle' });
  });

  it('retrying after a veto skips the download when the file is still verified', async () => {
    const { controller, deps, order } = make();
    await controller.check({ manual: true });
    await controller.download();
    controller.onBeforeQuit(true);
    (deps.isVerified as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await controller.download();
    expect(deps.isVerified).toHaveBeenCalledWith(join(DIR, ASSET.name), ASSET);
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(deps.prepareInstall).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['quit', 'quit']);
    expect(controller.getStatus().kind).toBe('installing');
  });

  it('retrying downloads again when the kept file no longer verifies', async () => {
    const { controller, deps } = make();
    await controller.check({ manual: true });
    await controller.download();
    controller.onBeforeQuit(true);
    await controller.download();
    expect(deps.download).toHaveBeenCalledTimes(2);
  });
});

describe('openNotes', () => {
  it('opens the notes URL main found, and nothing when there is none', async () => {
    const { controller, deps } = make();
    expect(await controller.openNotes()).toBe(false);
    await controller.check({ manual: true });
    expect(await controller.openNotes()).toBe(true);
    expect(deps.openExternal).toHaveBeenCalledWith(NOTES);
  });

  it('answers false when the shell refuses', async () => {
    const { controller } = make({
      openExternal: vi.fn(async () => {
        throw new Error('no');
      }),
    });
    await controller.check({ manual: true });
    expect(await controller.openNotes()).toBe(false);
  });
});

describe('onQuitOutcome', () => {
  it('is vetoed only when an install is pending and the quit was prevented', () => {
    expect(onQuitOutcome({ pending: true, prevented: true })).toBe('vetoed');
    expect(onQuitOutcome({ pending: true, prevented: false })).toBe('proceed');
    expect(onQuitOutcome({ pending: false, prevented: true })).toBe('ignore');
    expect(onQuitOutcome({ pending: false, prevented: false })).toBe('ignore');
  });
});
