/**
 * The clipboard channel, and why the renderer is not allowed to use its own.
 *
 * `navigator.clipboard.writeText` goes through Chromium's permission system,
 * and this app denies every permission by default (`src/main/index.ts`
 * `registerPermissionPolicy`). Measured in a reproduction of that exact
 * wiring, the call rejects with `NotAllowedError: Write permission denied` --
 * and it rejects again, for a different reason, whenever the document is not
 * focused. Allowlisting the write back in does not fix it either: Chromium
 * asks for `clipboard-read` FIRST, and granting that would let the page read
 * the operator's clipboard, which is a real widening for one copy button.
 *
 * Electron's own `clipboard` module is subject to none of that. It runs in
 * main, needs no permission and does not care about focus, so the renderer
 * asks for a write here instead of performing one itself.
 *
 * The answer is a bare `boolean`, never an `IpcResult`: the only thing the
 * caller can do with a failure is say so in the status bar, and the renderer
 * must be able to tell "written" from "refused" -- the whole defect this
 * channel closes was a status line that could not.
 */

import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';

/** The slice of electron's `clipboard` used here, so this is testable without it. */
export type ClipboardLike = { writeText(text: string): void };

/**
 * Commands are short, but they are joined by `yy` and they arrive from the
 * least trusted process in the app. The bound keeps a compromised renderer
 * from parking a huge string on main's single event loop, and is far above
 * anything a real command list reaches.
 */
export const MAX_CLIPBOARD_LENGTH = 1_000_000;

export function registerClipboardIpc(ipcMain: IpcMainLike, clipboard: ClipboardLike): void {
  ipcMain.handle(CHANNELS.clipboardWrite, (_event, ...args: unknown[]): boolean => {
    const [text] = args;
    if (
      args.length !== 1 ||
      typeof text !== 'string' ||
      text.length === 0 ||
      text.length > MAX_CLIPBOARD_LENGTH
    ) {
      return false;
    }
    try {
      clipboard.writeText(text);
      return true;
    } catch {
      // A refusal is data here, like everywhere else on this bridge: a throw
      // would reach the renderer as an electron-rewritten rejection, and the
      // caller would have to guess whether the text landed.
      return false;
    }
  });
}
