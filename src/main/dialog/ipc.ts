/**
 * The directory channel: Electron's own `showOpenDialog`, and nothing else.
 *
 * WHY IT EXISTS AT ALL. "New project" in vam means choosing a directory and
 * starting a session in it, and a renderer cannot choose a directory. The web
 * platform's own picker is a file input or `showDirectoryPicker`, both of
 * which go through Chromium's permission system -- which this app denies by
 * default (`src/main/index.ts`) -- and neither of which yields a filesystem
 * PATH that tmux could be given as a cwd. Only main can ask.
 *
 * THE ANSWER IS BARE -- a path, or `null` -- never an `IpcResult`, for the
 * reason the clipboard channel answers bare: there is no source behind this
 * to refuse anything in the words of. Cancelling is not a failure; it is one
 * of the two normal answers, and the caller renders it as "nothing started".
 *
 * A THROWN DIALOG ALSO ANSWERS NULL. It resolves rather than throws for
 * `handlers.ts`'s reason: a listener that throws reaches the renderer as a
 * rejection electron has rewritten, and here there would be nothing left in
 * it worth reading anyway.
 */

import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';

/** What `showOpenDialog` answers with -- the two members this reads. */
export type OpenDialogResult = {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
};

/**
 * The slice of electron's `dialog` used here, so this is testable without it.
 *
 * `properties` is a mutable array of the one literal this module ever asks
 * for, because that is what electron's own signature accepts -- a
 * `readonly string[]` does not assign to it, and widening the literal would
 * let a future edit slip `openFile` past the type system.
 */
export type DialogLike = {
  showOpenDialog(options: { properties: 'openDirectory'[] }): Promise<OpenDialogResult>;
};

export function registerDialogIpc(ipcMain: IpcMainLike, dialog: DialogLike): void {
  ipcMain.handle(CHANNELS.chooseDirectory, async (): Promise<string | null> => {
    try {
      // `openDirectory` alone. With `openFile` also set, an operator who
      // clicked a file would get that file's path, and a session would start
      // in a directory nobody chose.
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    } catch {
      return null;
    }
  });
}
