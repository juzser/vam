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

export function registerUsageIpc(
  ipcMain: IpcMainLike,
  getSnapshot: () => Promise<UsageSnapshot>,
): void {
  ipcMain.handle(CHANNELS.usageGet, async (): Promise<UsageSnapshot> => {
    try {
      return await getSnapshot();
    } catch {
      // `readUsage` already turns every ordinary failure into a value; a
      // throw here would be the one case neither it nor this handler
      // anticipated, and 'unavailable' is the honest reason for that.
      return { kind: 'unknown', reason: 'unavailable' };
    }
  });
}
