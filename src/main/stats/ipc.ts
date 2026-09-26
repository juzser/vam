/**
 * The Stats screen's one channel — see `CHANNELS.statsScan`'s own header for
 * why a single action serves both the screen's mount and its refresh
 * button.
 *
 * CONCURRENT CALLERS JOIN THE SAME SCAN, on `usage/ipc.ts`'s own
 * `registerCachedRead` shape — a caller that arrives while a scan is already
 * running gets THAT scan's answer rather than starting a second walk of the
 * same filesystem. Unlike `registerCachedRead` there is no time floor: a
 * scan finishing does not throttle the NEXT call, because there is no
 * Keychain or network resource to protect here, only a filesystem scan the
 * incremental cache already makes cheap on repeat.
 */

import type { StatsSnapshot } from '../../shared/stats.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';

export type StatsResult =
  | { readonly kind: 'ok'; readonly snapshot: StatsSnapshot }
  | { readonly kind: 'error'; readonly message: string };

export function registerStatsIpc(ipcMain: IpcMainLike, runScan: () => Promise<StatsResult>): void {
  let inFlight: Promise<StatsResult> | null = null;

  ipcMain.handle(CHANNELS.statsScan, async (): Promise<StatsResult> => {
    if (inFlight !== null) return inFlight;
    inFlight = (async () => {
      try {
        return await runScan();
      } catch {
        // `runScan` (`scan-runner.ts`'s outcome, mapped) already turns every
        // ordinary failure into a value; a throw here is the one case
        // neither it nor this handler anticipated.
        return { kind: 'error', message: 'the stats scan failed unexpectedly' };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  });
}
