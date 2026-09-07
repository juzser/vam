/**
 * Wires `src/main/errors/log.ts` (main's own failure buffer) onto the
 * bridge, the same shape `src/main/stream/register.ts` already uses for
 * `vam:stream:change`: `vam:errors:get` is a plain pull answering the WHOLE
 * backlog, oldest first; `vam:errors:changed` is a payload-free tick meaning
 * "call `get` again", never a payload of its own.
 *
 * That shape, not this registration call, is what solves the ordering
 * problem. `recordMainFailure` (`src/main/errors/log.ts`) appends
 * unconditionally, whether or not this has run yet -- a remote-endpoint bind
 * failure recorded before `createWindow()` exists still lands in the buffer,
 * and the FIRST `vam:errors:get` a renderer ever makes returns it along with
 * everything else recorded since. This registration only adds the live half:
 * a renderer already up and running gets ticked about anything recorded
 * AFTER it asked, instead of having to poll.
 *
 * Registered inside `createWindow()`, same as `registerStreamIpc`: it needs
 * THIS window's `webContents.send` to push to, so it cannot be registered any
 * earlier -- but nothing is lost by that, because the backlog above does not
 * depend on it.
 */

import { CHANNELS } from '../ipc/channels.js';
import { mainFailures, subscribeMainFailures } from './log.js';

export type IpcMainLike = {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
};

export type WebContentsLike = {
  send(channel: string, ...args: unknown[]): void;
};

export function registerMainErrorIpc(ipcMain: IpcMainLike, webContents: WebContentsLike): void {
  ipcMain.handle(CHANNELS.mainErrorsGet, () => mainFailures());
  subscribeMainFailures(() => {
    webContents.send(CHANNELS.mainErrorsChanged);
  });
}
