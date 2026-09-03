/**
 * The usage channel: request/response, but unlike every channel in
 * `../ipc/handlers.ts` it answers with a bare `UsageSnapshot`, never an
 * `IpcResult` envelope. `UsageSnapshot` already carries its own success/
 * failure story (`kind: 'ok' | 'unknown'`) and a reading failure is not a
 * `SourceError` — there is no source and no session to refuse anything on.
 * Wrapping it would only add a shape the renderer has to unwrap for no
 * information gained, and it is the ONLY thing that crosses: `getSnapshot`
 * is `reader.ts`'s `readUsage`, which never returns or throws a token.
 */

import type { UsageSnapshot } from '../../shared/usage.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';

/**
 * The floor between two real readings.
 *
 * The renderer polls every five minutes, but that is the RENDERER's decision,
 * and a security audit was right that a convention is not a boundary: before
 * this, `window.api.usage.get()` in a loop drove one `security` subprocess and
 * one authenticated request to Anthropic per call, with the operator's own
 * bearer token. How often the operator's Keychain is read is not the
 * renderer's to choose, so the limit lives on this side of the bridge.
 *
 * Thirty seconds is far below the five-minute poll -- no legitimate caller
 * ever meets it -- and far above what any loop could exploit. It is well
 * inside `STALE_AFTER_MS`, so a reading served from here is never one
 * `describeUsage` would have called stale.
 */
export const MIN_READ_INTERVAL_MS = 30_000;

export function registerUsageIpc(
  ipcMain: IpcMainLike,
  getSnapshot: () => Promise<UsageSnapshot>,
  now: () => number = Date.now,
): void {
  let last: { at: number; snapshot: UsageSnapshot } | null = null;
  let inFlight: Promise<UsageSnapshot> | null = null;

  ipcMain.handle(CHANNELS.usageGet, async (): Promise<UsageSnapshot> => {
    if (last !== null && now() - last.at < MIN_READ_INTERVAL_MS) {
      return last.snapshot;
    }
    // A read already running serves every caller that arrives during it. Two
    // concurrent callers must not become two subprocesses.
    if (inFlight !== null) {
      return inFlight;
    }
    inFlight = (async () => {
      let snapshot: UsageSnapshot;
      try {
        snapshot = await getSnapshot();
      } catch {
        // `readUsage` already turns every ordinary failure into a value; a
        // throw here would be the one case neither it nor this handler
        // anticipated, and 'unavailable' is the honest reason for that.
        snapshot = { kind: 'unknown', reason: 'unavailable' };
      }
      // Recorded whatever the outcome. A FAILING read must be throttled too:
      // caching only successes would leave a permanently broken Keychain
      // spawning a subprocess per call, which is the hole this closes rather
      // than a smaller version of it.
      last = { at: now(), snapshot };
      inFlight = null;
      return snapshot;
    })();
    return inFlight;
  });
}
