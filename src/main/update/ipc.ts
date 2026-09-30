/**
 * The update channels: thin handlers over the controller (`./controller.ts`).
 * Like `../usage/ipc.ts` they answer BARE -- an `UpdateStatus` or a boolean,
 * never an `IpcResult` -- because the status type carries its own error
 * branch.
 *
 * WHAT THE RENDERER CAN SAY is deliberately tiny: check, download, dismiss,
 * open the notes, read or set the auto-check switch. None of them takes a URL,
 * a path or a version; main decides what is fetched and installed. A press
 * that arrives at the wrong moment (a second "Update" while one runs) is
 * ignored by the controller and answered with the status as it stands.
 *
 * Status CHANGES are pushed on `updateStatusChanged` by the `broadcast` given
 * to the controller in `../index.ts`, not from here: the controller's state
 * moves on timers and downloads as well as on presses.
 */

import type { UpdateStatus } from '../../shared/update.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import type { UpdateController } from './controller.js';

export function registerUpdateIpc(ipcMain: IpcMainLike, controller: UpdateController): void {
  // The controller turns every ordinary failure into a status, so a rejection
  // is the case it did not anticipate. The renderer still gets an answer -- the
  // status as it stands -- rather than a broken channel.
  const answer = (act: () => Promise<UpdateStatus>): Promise<UpdateStatus> =>
    act().catch(() => controller.getStatus());

  ipcMain.handle(CHANNELS.updateGetStatus, () => controller.getStatus());
  // Every press from the renderer is a person asking; only the scheduler in
  // main makes automatic checks.
  ipcMain.handle(CHANNELS.updateCheck, () => answer(() => controller.check({ manual: true })));
  ipcMain.handle(CHANNELS.updateDownload, () => answer(() => controller.download()));
  ipcMain.handle(CHANNELS.updateDismiss, () => answer(() => controller.dismiss()));
  ipcMain.handle(CHANNELS.updateGetAutoCheck, () => controller.getAutoCheck());
  ipcMain.handle(CHANNELS.updateGetLastCheck, () => controller.getLastCheckAt());
  ipcMain.handle(CHANNELS.updateSetAutoCheck, async (_event, ...args): Promise<boolean> => {
    if (typeof args[0] === 'boolean') await controller.setAutoCheck(args[0]);
    return controller.getAutoCheck();
  });
  ipcMain.handle(CHANNELS.updateOpen, async (): Promise<boolean> => {
    try {
      return await controller.openNotes();
    } catch {
      return false;
    }
  });
}
