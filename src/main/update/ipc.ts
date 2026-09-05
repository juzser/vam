/**
 * The update channel. Like `../usage/ipc.ts` it answers BARE -- an
 * `UpdateStatus`, never an `IpcResult` -- because that type already carries
 * its own four-branch answer and there is no source to refuse anything in the
 * words of.
 *
 * PULL-BASED ON PURPOSE. vam is a local-first tool, so nothing here runs on a
 * timer and nothing runs at launch: registering this handler makes no
 * request, and the first packet leaves the machine only when a surface the
 * operator is looking at asks. That is the opt-in -- not a preference that
 * has already been read once by the time anyone could set it.
 *
 * How often the request goes out is not the renderer's to choose, for the
 * same reason `MIN_READ_INTERVAL_MS` exists: a convention in a component is
 * not a boundary. The floor is measured in hours, so a caller in a render
 * loop gets the cached answer.
 */

import type { UpdateStatus } from '../../shared/update.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';

/** Six hours between two real requests, whatever the renderer does. */
export const MIN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function registerUpdateIpc(
  ipcMain: IpcMainLike,
  check: () => Promise<UpdateStatus>,
  now: () => number = Date.now,
): void {
  let last: { at: number; status: UpdateStatus } | null = null;
  let inFlight: Promise<UpdateStatus> | null = null;

  ipcMain.handle(CHANNELS.updateCheck, async (): Promise<UpdateStatus> => {
    if (last !== null && now() - last.at < MIN_CHECK_INTERVAL_MS) return last.status;
    if (inFlight !== null) return inFlight;
    inFlight = (async () => {
      let status: UpdateStatus;
      try {
        status = await check();
      } catch {
        // `checkForUpdate` turns every ordinary failure into a value, so a
        // throw is the case neither it nor this handler anticipated. It is
        // still not an error the operator must act on.
        status = { kind: 'unknown', reason: 'network' };
      }
      // Recorded whatever the outcome: a FAILING check must be throttled too,
      // or a machine with no network makes one request per ask forever.
      last = { at: now(), status };
      inFlight = null;
      return status;
    })();
    return inFlight;
  });
}
