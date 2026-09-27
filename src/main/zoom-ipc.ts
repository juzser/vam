/**
 * The renderer's route into `main/zoom-state.ts` -- see that module's own
 * header for why the factor is module state at all, and `setPrRepos`
 * (`ipc/handlers.ts`) for the precedent this follows: a preference the
 * renderer's `prefs` owns, pushed into main on every read and write
 * (`activatePrefs`) because what it changes -- `webContents.setZoomFactor` --
 * happens over here, not in the renderer's own DOM.
 *
 * ITS OWN FILE, NOT `ipc/handlers.ts`'s BIG `registerSourceIpc`, because it
 * answers no source at all -- the same reasoning `clipboard/ipc.ts` and
 * `update/ipc.ts` give for their own files.
 */

import { CHANNELS, type IpcResult } from './ipc/channels.js';
import type { IpcMainLike } from './ipc/handlers.js';
import { setZoomPercent } from './zoom-state.js';

/** The slice of `WebContents` this needs off `event.sender` -- so a fake
 *  event is enough to test this without electron. */
export type ZoomSenderLike = { setZoomFactor(factor: number): void };

/**
 * `setZoomPercent` IS TOTAL -- see its own header -- so nothing here needs a
 * `validate` call before it: any shape the renderer sends reads back as
 * either a clamped number or the shipped default, never a throw.
 *
 * APPLIED TO THE CALLING WINDOW IMMEDIATELY, via `event.sender`, so the
 * operator sees the new size the moment they press the chord or move the
 * Settings stepper rather than waiting for the next `web-contents-created`
 * reset. A LATER window (a reload, a second one) reads the same factor off
 * `currentZoomFactor()` through `lockZoom`'s own getter -- see
 * `main/zoom-state.ts`'s header for why storing it here is what makes that
 * true without re-registering anything.
 *
 * `event.sender` IS OPTIONAL BY TYPE, and a missing one is answered `ok`
 * rather than thrown: the shared `IpcMainLike#handle` types its event
 * `unknown` (`ipc/handlers.ts`), so a caller that hands this a bare object in
 * a test, or a future electron whose invoke event shape moves, must not turn
 * a preference write into an unhandled rejection main has no top-level
 * handler for.
 */
export function registerZoomIpc(ipcMain: IpcMainLike): void {
  ipcMain.handle(CHANNELS.setUiZoom, async (event, ...args): Promise<IpcResult<void>> => {
    const percent = setZoomPercent(args[0]);
    const sender = (event as { readonly sender?: ZoomSenderLike } | null | undefined)?.sender;
    sender?.setZoomFactor(percent / 100);
    return { ok: true, value: undefined };
  });
}
