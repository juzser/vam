/**
 * `app.on('before-quit')`, and the one question it is allowed to ask.
 *
 * ── THE HOLE THIS FILLS ───────────────────────────────────────────────────
 * The Files tab holds unsaved edits in renderer memory and guards them with
 * `beforeunload`, which is a PAGE-level hook: it covers the window closing and
 * a browser tab closing. Cmd-Q is not either of those. It reaches
 * `app.on('before-quit')` in main, where a renderer's `beforeunload` has no
 * standing at all, and the window is torn down after. That is the one exit
 * where the operator's typed text can vanish with no warning -- exactly the
 * outcome the Files tab was built to prevent, left open because the guard for
 * it lives in a process the tab cannot reach.
 *
 * `beforeunload` IS NOT REPLACED AND IS NOT DUPLICATED. It still owns the
 * window-close path, and both mechanisms read the SAME derivation in the
 * renderer (`FilesTab.tsx` computes its dirty set once and feeds both), so
 * they cannot disagree about what is dirty -- only about which exit they
 * cover, which is the whole point of there being two.
 *
 * ── THE DIALOG IS SYNCHRONOUS, AND THAT IS THE DESIGN ─────────────────────
 * `ask` is a plain synchronous function -- `dialog.showMessageBoxSync` at the
 * call site -- and the alternative was considered and rejected.
 *
 * `before-quit` is a VETO: the handler must decide, before it returns, whether
 * to call `preventDefault()`. An async dialog cannot do that. It has to
 * prevent FIRST, then call `app.quit()` again once the operator answers, which
 * needs a latch ("the operator has already agreed, do not ask again") that
 * survives between two quits. That latch is the bug: it is state that can be
 * left stuck on (quit anyway, silently, forever) or stuck off (a pending
 * dialog that never settles, and every later Cmd-Q vetoed -- an app that
 * cannot be quit). A synchronous ask has no such state. There is nothing to
 * leave hanging, nothing to time out, and a second Cmd-Q after a cancel simply
 * runs the handler again from rest.
 *
 * The cost is that main's event loop is blocked while the sheet is up. That is
 * acceptable here and nowhere else: the app is being quit, nothing else needs
 * main, and the modal is the only thing the operator is looking at.
 *
 * ── AND IT CANNOT MAKE THE APP UNQUITTABLE ────────────────────────────────
 * Five separate ways in, all guarded in `test/main/quit/guard.test.ts`:
 *
 *  1. Main is never WAITING on the renderer -- it reads a value the renderer
 *     pushed (`./unsaved.ts` explains why it is a push). A wedged renderer
 *     cannot delay a quit by so much as a tick.
 *  2. A report main cannot read, or no report at all, is `NOTHING_UNSAVED`,
 *     and `NOTHING_UNSAVED` never prevents anything.
 *  3. A window that has gone away calls `clear()`; the text went with it, so
 *     there is nothing left to ask about.
 *  4. An `ask` that THROWS -- a sheet that could not be attached, say -- lets
 *     the quit through. A prompt that cannot be drawn is not a veto.
 *  5. And the one that comes from the OTHER direction, once the operator has
 *     said yes: the renderer's own `beforeunload` is still armed at that
 *     moment and electron lets it cancel the close that follows, silently.
 *     `release` is what stops "Quit anyway" from meaning "stay open with no
 *     explanation" -- see `QuitGuardDeps.release`.
 *
 * The one flag that exists, `asking`, is set and cleared inside a single
 * synchronous frame (`try`/`finally`), so the only way to leave it set is for
 * the operating system's own modal never to return -- a hang this app neither
 * introduces nor could work around.
 */

import { CHANNELS, type IpcResult } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { NOTHING_UNSAVED, readUnsavedReport, type UnsavedReport } from './unsaved.js';

/** What the operator chose. `cancel` means "stay open"; anything else quits. */
export type QuitDecision = 'cancel' | 'quit';

/**
 * Draws the prompt and answers it. Synchronous -- see the header. It may
 * throw; the guard treats that as "could not ask", never as "do not quit".
 */
export type AskToQuit = (report: UnsavedReport) => QuitDecision;

export type QuitGuardDeps = {
  readonly ask: AskToQuit;
  /**
   * "THE OPERATOR HAS AGREED -- MAKE SURE NOTHING ELSE VETOES THIS." Called
   * once, after a `quit` answer and before the handler returns.
   *
   * ── THE SECOND WAY THIS COULD HAVE MADE THE APP UNQUITTABLE ─────────────
   * It arrives from the opposite direction to every case in the header above.
   * `app.quit()` closes the windows AFTER `before-quit` returns, and electron
   * documents that a window's `beforeunload` may cancel that close -- with NO
   * prompt of its own, unlike a browser: electron's own note is that
   * returning a value there simply prevents the unload. The Files tab arms
   * exactly that handler whenever anything is dirty, which is precisely when
   * this guard has just asked. So without this, an operator who pressed "Quit
   * anyway" could be left looking at an application that silently declines to
   * close, having just been told its text would be discarded.
   *
   * Whether electron actually honours `beforeunload` during a macOS Cmd-Q is
   * the very question this whole guard exists because of -- the observed
   * behaviour is that it does NOT, which is how the text was vanishing. This
   * dependency makes the answer correct under BOTH readings instead of
   * betting on one: `window.destroy()` (main/index.ts) tears the window down
   * without running `beforeunload` at all, which is the honest implementation
   * of the button the operator just pressed.
   *
   * It may throw, and a throw is swallowed: it is a belt on the quit, never a
   * gate in front of it.
   */
  readonly release: () => void;
};

export type QuitGuard = {
  /** The renderer's own report of what it is holding, validated on arrival. */
  readonly report: (raw: unknown) => void;
  /** The window went away: whatever it was holding went with it. */
  readonly clear: () => void;
  /** Wired to `app.on('before-quit')`. Prevents the event, or does not. */
  readonly beforeQuit: (event: { readonly preventDefault: () => void }) => void;
  /** What main currently believes. Diagnostics and tests; nothing acts on it. */
  readonly held: () => UnsavedReport;
};

export function createQuitGuard({ ask, release }: QuitGuardDeps): QuitGuard {
  let held: UnsavedReport = NOTHING_UNSAVED;
  /**
   * True only while a prompt is on screen. `showMessageBoxSync` spins a NESTED
   * run loop, so a second Cmd-Q really can re-enter this handler while the
   * first sheet is still up -- and two stacked sheets about the same files is
   * a dialog the operator has to dismiss twice to learn one thing. The
   * re-entrant quit is vetoed instead: the prompt already on screen is the
   * answer to it.
   */
  let asking = false;
  return {
    report: (raw) => {
      held = readUnsavedReport(raw);
    },
    clear: () => {
      held = NOTHING_UNSAVED;
    },
    held: () => held,
    beforeQuit: (event) => {
      if (held.count === 0) return;
      if (asking) {
        event.preventDefault();
        return;
      }
      asking = true;
      try {
        if (ask(held) === 'cancel') {
          event.preventDefault();
        } else {
          // Agreed. Nothing downstream gets a second veto -- see `release`.
          try {
            release();
          } catch {
            // A window that has already gone is not a reason to stay open.
          }
        }
      } catch {
        // A prompt that could not be drawn is not a veto. Nothing is logged
        // here on purpose: the process is on its way out, main's failure
        // buffer is in memory, and there is no surface left to read it on.
      } finally {
        asking = false;
      }
    },
  };
}

/**
 * The renderer's end of it: `CHANNELS.filesUnsaved`, a state push.
 *
 * It answers the same `IpcResult` envelope every other channel answers even
 * though there is nothing to refuse -- `readUnsavedReport` is total, so a
 * malformed payload is already "nothing unsaved" by the time this returns.
 * Answering `{ok: true}` regardless is deliberate rather than lazy: the
 * renderer has no decision to make about this and nothing to draw if it
 * failed, and a rejection crossing the bridge would only produce an unhandled
 * promise in a page that cannot act on it. The preload half is fire-and-
 * forget for the same reason.
 */
export function registerUnsavedIpc(ipcMain: IpcMainLike, guard: QuitGuard): void {
  ipcMain.handle(CHANNELS.filesUnsaved, async (_event, ...args): Promise<IpcResult<void>> => {
    guard.report(args[0]);
    return { ok: true, value: undefined };
  });
}
