/**
 * The update channels. Like `../usage/ipc.ts` they answer BARE -- an
 * `UpdateStatus`, never an `IpcResult` -- because that type already carries
 * its own four-branch answer and there is no source to refuse anything in the
 * words of.
 *
 * The click DOES NOT DOWNLOAD ANYTHING. `updateOpen` hands the release page
 * to `shell.openExternal`, which is the operating system's browser and not
 * this window -- vam still fetches no bytes and writes no file, the same
 * bargain `src/renderer/errors/report.ts` makes when it prepares an issue
 * rather than posting one. The URL opened is the one the launch check itself
 * found; the handler takes no argument, so the renderer cannot name a
 * destination.
 *
 * ONE CHECK, AT LAUNCH. `check()` is called here, while the handler is being
 * registered, and its promise is what every ask is answered from: there is no
 * timer, no interval and no second request for the life of the process. What
 * goes out is the single unauthenticated GET described in `./check.ts` --
 * no token, no query, and nothing about the operator's sessions, projects,
 * paths or machine.
 *
 * Nothing is awaited on this path. Registration is synchronous and the window
 * is created a few statements later in `../index.ts`, so a check that is slow
 * -- or hanging on a dead network -- delays nothing the operator can see. Its
 * failure is caught HERE rather than left to reject, because an update check
 * that could surface as a startup error would be worse than no update check.
 *
 * NO TIME-BASED THROTTLE. Launch is already the rate limit: one request per
 * start of the app. The only thing an interval would additionally stop is a
 * crash-restart loop, and it would cost the author of this repository the
 * ordinary case of cutting a release and restarting vam to see it. GitHub
 * allows 60 unauthenticated requests an hour per IP and `rate-limited` is
 * already a distinct, quiet outcome, so the loop's cost is visible and small.
 */

import type { UpdateStatus } from '../../shared/update.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';

export function registerUpdateIpc(
  ipcMain: IpcMainLike,
  check: () => Promise<UpdateStatus>,
  openExternal: (url: string) => Promise<void> = async () => {},
): void {
  // `checkForUpdate` turns every ordinary failure into a value, so a rejection
  // here is the case neither it nor this module anticipated. It is still not
  // an error the operator must act on, and the surface stays silent for it.
  const answer = (): Promise<UpdateStatus> =>
    check().catch((): UpdateStatus => ({ kind: 'unknown', reason: 'network' }));

  // THE STORED ANSWER, AND THE ONE PLACE IT IS WRITTEN. `let` rather than
  // `const` because the operator can ask again (`updateRecheck` below), and
  // everything that reads the status -- the notice, and `updateOpen`'s refusal
  // -- has to be reading what they are looking at rather than what launch
  // found. One holder, replaced; never two answers in flight to compare.
  let status: Promise<UpdateStatus> = answer();
  ipcMain.handle(CHANNELS.updateCheck, () => status);

  // ASKED AGAIN, BY A PERSON. Every argument this file makes against polling
  // is about vam asking on its own initiative: no timer, no interval, launch
  // as the rate limit. A button is not that. The bound here is the hand
  // pressing it -- GitHub allows 60 unauthenticated requests an hour per IP,
  // and `rate-limited` is already its own quiet outcome -- so there is no
  // time-based throttle, for the same reason there is none above.
  ipcMain.handle(CHANNELS.updateRecheck, () => {
    status = answer();
    return status;
  });

  ipcMain.handle(CHANNELS.updateOpen, async (): Promise<boolean> => {
    const current = await status;
    // Nothing to go to. A surface only offers the click for `available`, so
    // this is a caller that got ahead of the answer rather than an error.
    if (current.kind !== 'available') return false;
    try {
      await openExternal(current.url);
      return true;
    } catch {
      // No browser, or a shell that refused. The popover keeps showing the
      // URL, which is still the whole answer.
      return false;
    }
  });
}
