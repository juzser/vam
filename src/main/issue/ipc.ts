/**
 * The one channel that actually gets an issue filed.
 *
 * WHAT IT CLOSES. `src/renderer/errors/report.ts` composes a prefilled
 * `issues/new` URL and the panel copies it to the clipboard, because
 * `window.open` and every off-origin navigation are denied by policy
 * (`src/main/csp.ts`). That left exactly one route to github.com: the operator
 * selecting a four-kilobyte URL and pasting it into a browser by hand -- and
 * the panel's text could not be selected either. Reported from use as "the
 * error log cannot create an issue", which is what it meant: there was no
 * route, only a string.
 *
 * THE RENDERER STILL NAMES NO DESTINATION. `CHANNELS.remoteOpenLink` states
 * the rule this is built inside rather than around: a channel that took a URL
 * from the renderer would be the navigate-anywhere capability the policy
 * exists to refuse. This one takes a TITLE and a BODY -- text, never a
 * location -- and the address comes from `src/shared/issue.ts`. There is no
 * argument shape that reaches another host: a URL sent as a title arrives as a
 * query parameter of vam's own issues page, which is inert.
 *
 * AND IT STILL DOES NOT POST. What opens is the prefilled FORM in the
 * operator's own browser. Pressing submit there is their decision and their
 * last chance to read the body before it becomes public -- `report.ts`'s
 * argument, unchanged; this only means they can get to the page.
 */

import { issueUrl } from '../../shared/issue.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';

/**
 * The bound on each field.
 *
 * Not a guess about GitHub. It is the same reasoning `MAX_CLIPBOARD_LENGTH`
 * carries one directory over: the renderer is the least trusted process here,
 * and a huge string would be percent-encoded and concatenated on main's single
 * event loop before anything else ran. 8,000 is far above the longest report
 * vam can compose -- a `cli-failed` whose stderr is already clipped to 600
 * characters by `deliver.ts` measures around a thousand -- and below the
 * request-line limit a server will answer at all, so a report that would be
 * refused with a 414 is refused here instead, where it can be said out loud.
 */
export const MAX_ISSUE_FIELD = 8_000;

export function registerIssueIpc(
  ipcMain: IpcMainLike,
  openExternal: (url: string) => Promise<void> = async () => {},
): void {
  ipcMain.handle(CHANNELS.issueOpen, async (_event, ...args: unknown[]): Promise<boolean> => {
    const [title, body] = args;
    if (
      args.length !== 2 ||
      typeof title !== 'string' ||
      typeof body !== 'string' ||
      // An empty title opens a blank form, which is worse than a refusal: the
      // operator believes they have reported something.
      title.length === 0 ||
      title.length > MAX_ISSUE_FIELD ||
      body.length > MAX_ISSUE_FIELD
    ) {
      return false;
    }
    try {
      await openExternal(issueUrl(title, body));
      return true;
    } catch {
      // No browser, or a shell that refused. A refusal is data on this bridge,
      // like everywhere else -- the panel still shows the URL, which is the
      // whole answer, and must not be told a browser opened.
      return false;
    }
  });
}
