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

/**
 * The slice of electron's `clipboard` used here, so this is testable without
 * it.
 *
 * `Promise<void>` is measured, not guessed. Electron 44 rewrote the
 * MAIN-PROCESS clipboard into the W3C shape -- `readText`/`writeText` return
 * promises, and the historical synchronous `void` API is gone.
 * `test/electron/probe.cjs` ran into the same change from the other side.
 *
 * This was declared `void` until it was checked, and nothing caught it:
 * TypeScript lets a `Promise<void>`-returning function satisfy a
 * `void`-returning signature by design, so the real module went on matching a
 * declaration that misdescribed it. `test/main/clipboard/ipc.test.ts` now pins
 * the return type against electron's own shipped `electron.d.ts`.
 */
export type ClipboardLike = { writeText(text: string): Promise<void> };

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
      // DELIBERATELY NOT AWAITED, and that is a measured answer rather than an
      // oversight -- it is the first thing a reader of the line above will ask.
      //
      // Electron 44's `Clipboard::WriteText` commits the text through a
      // `ScopedClipboardWriter` whose scope closes BEFORE the function returns,
      // and then calls `promise.Resolve()` unconditionally. There is no reject
      // path in it (`shell/browser/api/electron_api_clipboard.cc`), and
      // `lib/browser/api/clipboard.ts` forwards `writeText` straight to it
      // without adding one. So the promise carries no news: the write has
      // already happened by the time it exists, and awaiting it could only
      // report success later -- never failure.
      //
      // The one way this call fails is a SYNCHRONOUS throw out of gin's
      // argument conversion, which the `catch` below answers. If some future
      // Electron gives `writeText` a reject path, this discard turns into both
      // a `true` for a write that did not happen and an unhandled rejection in
      // main -- nothing in `src/` installs a handler for those. That upstream
      // function is the thing to re-read on an Electron bump.
      void clipboard.writeText(text);
      return true;
    } catch {
      // A refusal is data here, like everywhere else on this bridge: a throw
      // would reach the renderer as an electron-rewritten rejection, and the
      // caller would have to guess whether the text landed.
      return false;
    }
  });
}
