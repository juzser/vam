/**
 * The updater's one owner of state. It holds the current `UpdateStatus`,
 * feeds every change through `reduce` (`src/shared/update-state.ts`), and
 * broadcasts each new state; everything with a side effect -- the network, the
 * disk, the installer, `app.quit()` -- is injected, so the whole flow runs in
 * tests with fakes.
 *
 * THE QUIT. Installing means the app has to go away first. The controller
 * prepares the install, remembers the handle, and asks for a normal
 * `app.quit()` (never `app.exit`, which would skip the unsaved-edits guard).
 * `index.ts` forwards two events:
 *   - `before-quit`, after the guard has had its say: if the event was
 *     prevented while an install was pending, the operator cancelled, so the
 *     controller raises `quit-cancelled` and forgets the handle. The verified
 *     download stays on disk, and the next press of Update finds it with
 *     `isVerified` and skips straight to prepare.
 *   - `will-quit`: the quit is real, so the installer is launched now, and only
 *     now.
 */

import { join } from 'node:path';
import type { UpdateErrorCode, UpdateStatus } from '../../shared/update.js';
import { isNewer } from '../../shared/update.js';
import { reduce, type UpdateEvent } from '../../shared/update-state.js';
import type { CheckResult, CheckTarget, UpdateAsset } from './check.js';
import { DownloadError, type DownloadOptions } from './download.js';
import type { InstallFailure, InstallHandle, PrepareInput, PrepareResult } from './install.js';
import type { UpdateState, UpdateStatePatch } from './state-file.js';

/** After `app.quit()`, how long before a quit that never reached will-quit counts as cancelled. */
export const QUIT_SETTLE_MS = 5_000;

export const QUIT_CANCELLED_MESSAGE = 'Save or discard your edits, then press Update again';

export type UpdateControllerDeps = {
  readonly currentVersion: string;
  readonly target: CheckTarget;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly execPath: string;
  readonly pid: number;
  readonly updatesDir: string;
  readonly store: {
    get(): UpdateState;
    update(patch: UpdateStatePatch): Promise<void>;
  };
  readonly check: (current: string, target: CheckTarget) => Promise<CheckResult>;
  readonly download: (options: DownloadOptions) => Promise<string>;
  readonly isVerified: (path: string, asset: UpdateAsset) => Promise<boolean>;
  readonly installBlocker: (
    kind: CheckTarget['installKind'],
    ctx: { readonly env: Readonly<Record<string, string | undefined>>; readonly execPath: string },
  ) => InstallFailure | null;
  readonly prepareInstall: (input: PrepareInput) => Promise<PrepareResult>;
  readonly launchInstall: (handle: InstallHandle) => Promise<void>;
  readonly openExternal: (url: string) => Promise<void>;
  /** `app.quit()`. */
  readonly quit: () => void;
  readonly broadcast: (status: UpdateStatus) => void;
  readonly now: () => number;
  /** Timer seam, as in the scheduler. */
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

export type UpdateController = {
  getStatus(): UpdateStatus;
  check(options: { readonly manual: boolean }): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  dismiss(): Promise<UpdateStatus>;
  setAutoCheck(enabled: boolean): Promise<void>;
  getAutoCheck(): boolean;
  getLastCheckAt(): number | null;
  /** Open the release notes page main itself found; false when there is none. */
  openNotes(): Promise<boolean>;
  /** `before-quit`, after the quit guard ran. */
  onBeforeQuit(prevented: boolean): void;
  /** `will-quit`. A promise to wait for when an installer is launching, else null. */
  onWillQuit(): Promise<void> | null;
};

/** What a `before-quit` means for a pending install. Pure. */
export function onQuitOutcome(input: {
  readonly pending: boolean;
  readonly prevented: boolean;
}): 'ignore' | 'vetoed' | 'proceed' {
  if (!input.pending) return 'ignore';
  return input.prevented ? 'vetoed' : 'proceed';
}

const DOWNLOAD_MESSAGES: Record<'network' | 'checksum' | 'too-large', string> = {
  network: 'Could not download the update. Check your connection and try again',
  checksum: 'The download did not match its checksum and was discarded. Try again',
  'too-large': 'The download was larger than the release said it would be',
};

const CHECK_MESSAGES: Record<'network' | 'rate-limited' | 'malformed', string> = {
  network: 'Could not reach GitHub to check for updates',
  'rate-limited': 'GitHub is rate-limiting update checks right now. Try again later',
  malformed: 'GitHub answered with something vam could not read',
};

type Offer = {
  readonly version: string;
  readonly notesUrl: string;
  readonly asset: UpdateAsset | null;
};

export function createUpdateController(deps: UpdateControllerDeps): UpdateController {
  let status: UpdateStatus = { kind: 'idle' };
  let offer: Offer | null = null;
  let pending: InstallHandle | null = null;
  let quitTimer: unknown = null;

  const disarmQuitTimer = (): void => {
    if (quitTimer === null) return;
    deps.clearTimeout(quitTimer);
    quitTimer = null;
  };
  const cancelPending = (): void => {
    disarmQuitTimer();
    pending = null;
    failWith('quit-cancelled', QUIT_CANCELLED_MESSAGE);
  };

  const set = (next: UpdateStatus): void => {
    if (next === status) return;
    status = next;
    deps.broadcast(status);
  };
  const apply = (event: UpdateEvent): void => set(reduce(status, event));
  const failWith = (code: UpdateErrorCode, message: string): void => {
    const next = reduce(status, { type: 'fail', message, code });
    // `reduce` only fails from checking/downloading/installing; a failure
    // found before any of those (a blocker) is still an error to show.
    set(next === status ? { kind: 'error', message, code } : next);
  };

  async function persist(patch: UpdateStatePatch): Promise<void> {
    try {
      await deps.store.update(patch);
    } catch {
      // Losing a preference write must never break an update.
    }
  }

  async function check({ manual }: { readonly manual: boolean }): Promise<UpdateStatus> {
    if (
      status.kind === 'checking' ||
      status.kind === 'downloading' ||
      status.kind === 'installing'
    ) {
      return status;
    }
    apply({ type: 'check-start', manual });
    let result: CheckResult;
    try {
      result = await deps.check(deps.currentVersion, deps.target);
    } catch {
      result = { kind: 'error', code: 'network' };
    }
    // Recorded for every attempt, failures included, so a broken network does
    // not turn the scheduler into a retry loop.
    await persist({ lastCheckAt: deps.now() });

    offer = null;
    switch (result.kind) {
      case 'available': {
        if (!isNewer(result.version, deps.currentVersion)) {
          apply({
            type: 'check-result',
            status: { kind: 'not-available', manual, reason: 'up-to-date' },
          });
          break;
        }
        offer = { version: result.version, notesUrl: result.notesUrl, asset: result.asset };
        if (!manual && deps.store.get().dismissedVersion === result.version) {
          // The operator said "Later" to this one; only a person asking again
          // brings it back.
          set({ kind: 'idle' });
          break;
        }
        apply({
          type: 'check-result',
          status: { kind: 'available', version: result.version, notesUrl: result.notesUrl },
        });
        break;
      }
      case 'error':
        if (manual) {
          apply({
            type: 'check-result',
            status: { kind: 'error', code: result.code, message: CHECK_MESSAGES[result.code] },
          });
        } else {
          set({ kind: 'idle' });
        }
        break;
      default:
        apply({
          type: 'check-result',
          status: { kind: 'not-available', manual, reason: result.kind },
        });
    }
    return status;
  }

  async function download(): Promise<UpdateStatus> {
    if (status.kind === 'error' && offer !== null) {
      // A retry: back to the offer the error interrupted.
      set({ kind: 'available', version: offer.version, notesUrl: offer.notesUrl });
    }
    if (status.kind !== 'available' || offer === null) return status;
    const { version, asset } = offer;

    if (asset === null) {
      failWith('unsupported-install', 'This install of vam cannot update itself');
      return status;
    }
    const blocker = deps.installBlocker(deps.target.installKind, {
      env: deps.env,
      execPath: deps.execPath,
    });
    if (blocker !== null) {
      failWith(blocker.code, blocker.message);
      return status;
    }

    apply({ type: 'download-start' });
    const filePath = join(deps.updatesDir, asset.name);
    try {
      if (await deps.isVerified(filePath, asset)) {
        apply({ type: 'progress', percent: 100 });
      } else {
        await deps.download({
          asset,
          dir: deps.updatesDir,
          onProgress: (percent) => apply({ type: 'progress', percent }),
        });
      }
    } catch (error) {
      const code = error instanceof DownloadError ? error.code : 'network';
      failWith(code, DOWNLOAD_MESSAGES[code]);
      return status;
    }

    apply({ type: 'install-start' });
    let prepared: PrepareResult;
    try {
      prepared = await deps.prepareInstall({
        kind: deps.target.installKind,
        version,
        filePath,
        updatesDir: deps.updatesDir,
        execPath: deps.execPath,
        env: deps.env,
        pid: deps.pid,
      });
    } catch {
      prepared = {
        ok: false,
        code: 'install-failed',
        message: 'Could not prepare the update',
      };
    }
    if (!prepared.ok) {
      failWith(prepared.code, prepared.message);
      return status;
    }

    pending = prepared.handle;
    deps.quit();
    // A window close / beforeunload veto can cancel the quit AFTER before-quit,
    // and then neither hook fires again. No will-quit in time: it was cancelled.
    disarmQuitTimer();
    quitTimer = deps.setTimeout(() => {
      quitTimer = null;
      if (pending !== null) cancelPending();
    }, QUIT_SETTLE_MS);
    return status;
  }

  return {
    getStatus: () => status,
    check,
    download,

    async dismiss(): Promise<UpdateStatus> {
      if (status.kind === 'available') {
        await persist({ dismissedVersion: status.version });
        apply({ type: 'dismiss' });
      } else {
        apply({ type: 'reset' });
      }
      return status;
    },

    setAutoCheck: (enabled) => persist({ autoCheck: enabled }),
    getAutoCheck: () => deps.store.get().autoCheck,
    getLastCheckAt: () => deps.store.get().lastCheckAt,

    async openNotes(): Promise<boolean> {
      if (offer === null) return false;
      try {
        await deps.openExternal(offer.notesUrl);
        return true;
      } catch {
        return false;
      }
    },

    onBeforeQuit(prevented: boolean): void {
      if (onQuitOutcome({ pending: pending !== null, prevented }) !== 'vetoed') return;
      cancelPending();
    },

    onWillQuit(): Promise<void> | null {
      const handle = pending;
      if (handle === null) return null;
      disarmQuitTimer();
      pending = null;
      return deps.launchInstall(handle).catch(() => {});
    },
  };
}
