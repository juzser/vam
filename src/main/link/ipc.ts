/**
 * The channel that opens a link an agent wrote, and the check that is the only
 * reason it may exist.
 *
 * WHAT IT CLOSES. `out-markdown.tsx` rendered every markdown link as a
 * `<span>` with the address in parentheses, because a real `<a href>` in this
 * window navigates THE WHOLE APPLICATION away -- the window IS the app, there
 * is no back button -- and `window.open` plus every off-origin navigation are
 * denied by policy (`src/main/index.ts`, `src/main/csp.ts`). That policy is
 * correct and is untouched. What was wrong is that it left the operator
 * copying an address out of a panel by hand, which is exactly the defect
 * `issue/ipc.ts` one directory over was filed about.
 *
 * THE CHECK IS HERE, NOT ONLY IN THE RENDERER, AND THAT IS THE WHOLE POINT.
 * `src/shared/link.ts` holds the decision and both processes run it, but only
 * this side of the process boundary is a guarantee: the renderer is the least
 * trusted process in the app, its call is a convenience that saves a round
 * trip and lets a refused link be drawn differently, and deleting it would
 * change nothing about what can be opened. `test/main/link/ipc.test.ts` drives
 * this handler directly, with no renderer in the room, for that reason.
 *
 * IT OPENS THE PARSED ADDRESS, never the string it was handed -- so what the
 * shell is given is exactly what the panel showed the operator, punycode host
 * and all. A gap between those two is the entire homograph attack.
 *
 * AND IT ANSWERS IN WORDS. A refusal travels as data on this bridge like
 * everywhere else (throwing would reach the renderer as an electron-rewritten
 * rejection), and the sentence is drawn beside the control that was pressed:
 * a control which can only refuse says so.
 */

import { checkLink, type LinkOutcome } from '../../shared/link.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';

export function registerLinkIpc(
  ipcMain: IpcMainLike,
  openExternal: (url: string) => Promise<void> = async () => {},
): void {
  ipcMain.handle(CHANNELS.linkOpen, async (_event, ...args: unknown[]): Promise<LinkOutcome> => {
    if (args.length !== 1) {
      return { ok: false, reason: 'vam opens one address at a time.' };
    }
    // `checkLink` takes `unknown` and answers a sentence for every bad shape,
    // so there is no separate validation pass to drift from it.
    const outcome = checkLink(args[0]);
    if (!outcome.ok) return outcome;
    try {
      await openExternal(outcome.url);
      return outcome;
    } catch {
      // No browser, or a shell that declined. The panel still shows the
      // address, which is the whole answer it had before this channel existed
      // -- it must not be told a browser opened.
      return { ok: false, reason: `vam could not get a browser to open ${outcome.url}.` };
    }
  });
}
