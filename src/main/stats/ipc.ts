/**
 * The Stats screen's two channels — see `CHANNELS.statsScan`/`statsPrs`'s
 * own headers for the full split. `statsScan` answers the fold the moment
 * it is done (`forceRefresh` threaded straight through to `runScan` —
 * `false` from `get()`, `true` from the Refresh button, bypassing the PR
 * count's own TTL); `statsPrs` answers that SAME scan's PR-count follow-up
 * once it settles, for the screen to call only when `statsScan` said
 * `'loading'`.
 *
 * CONCURRENT `statsScan` CALLERS JOIN THE SAME SCAN, on `usage/ipc.ts`'s own
 * `registerCachedRead` shape — a caller that arrives while a scan is already
 * running gets THAT scan's answer rather than starting a second walk of the
 * same filesystem. Unlike `registerCachedRead` there is no time floor: a
 * scan finishing does not throttle the NEXT call, because there is no
 * Keychain or network resource to protect here, only a filesystem scan the
 * incremental cache already makes cheap on repeat. (A caller that arrives
 * mid-scan gets whichever `forceRefresh` the FIRST caller asked for — the
 * Stats screen never has two callers in flight at once in practice, since
 * the refresh button does not even render until the first scan answers.)
 */

import type { PrsCreated, StatsSnapshot } from '../../shared/stats.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import type { ScanOutcome } from './scan-runner.js';

export type StatsResult =
  | { readonly kind: 'ok'; readonly snapshot: StatsSnapshot }
  | { readonly kind: 'error'; readonly message: string };

const FALLBACK_PRS: PrsCreated = {
  kind: 'unavailable',
  hint: 'connect GitHub in Settings → Integrations',
  reason: 'error',
};

function wantsForceRefresh(arg: unknown): boolean {
  return (
    typeof arg === 'object' &&
    arg !== null &&
    (arg as Record<string, unknown>)['forceRefresh'] === true
  );
}

export function registerStatsIpc(
  ipcMain: IpcMainLike,
  runScan: (forceRefresh: boolean) => Promise<ScanOutcome>,
): void {
  let inFlight: Promise<StatsResult> | null = null;
  /** The MOST RECENT scan's own PR-count follow-up — `null` once it is
   *  either not needed (`statsScan` already carried a settled answer) or
   *  has never run at all yet. `statsPrs` reads this, never `inFlight`:
   *  it answers well after `statsScan` itself has already resolved. */
  let pendingPrs: Promise<PrsCreated> | null = null;

  ipcMain.handle(CHANNELS.statsScan, async (_event, arg: unknown): Promise<StatsResult> => {
    if (inFlight !== null) return inFlight;
    const forceRefresh = wantsForceRefresh(arg);
    inFlight = (async () => {
      try {
        const outcome = await runScan(forceRefresh);
        if (outcome.kind === 'error') {
          pendingPrs = null;
          return outcome;
        }
        pendingPrs = outcome.prsUpdate;
        return { kind: 'ok', snapshot: outcome.snapshot };
      } catch {
        // `runScan` (`scan-runner.ts`'s outcome, mapped) already turns every
        // ordinary failure into a value; a throw here is the one case
        // neither it nor this handler anticipated.
        pendingPrs = null;
        return { kind: 'error', message: 'the stats scan failed unexpectedly' };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  });

  ipcMain.handle(
    CHANNELS.statsPrs,
    async (): Promise<{ readonly kind: 'ok'; readonly prsCreated: PrsCreated }> => {
      if (pendingPrs === null) return { kind: 'ok', prsCreated: FALLBACK_PRS };
      const prsCreated = await pendingPrs;
      return { kind: 'ok', prsCreated };
    },
  );
}
