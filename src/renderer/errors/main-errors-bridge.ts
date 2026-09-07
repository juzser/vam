/**
 * Feeds main-process failures (`src/main/errors/log.ts`) into THIS renderer's
 * own error log (`./log.ts`) -- the route the module comment on the PR this
 * shipped in exists for: without it, a main-process startup failure lands in
 * `console.error` and nowhere a packaged app's operator will ever look.
 *
 * THE ORDERING PROBLEM, SOLVED BY NEVER TRUSTING A PUSH ALONE. A failure can
 * happen before this renderer exists at all -- `startRemoteTransport`
 * (`src/main/index.ts`) attempts the remote endpoint's bind BEFORE
 * `createWindow()` runs -- so a naive `webContents.send` would drop exactly
 * the earliest and most interesting failures, the ones that happened before
 * anyone was listening. `MainErrorsApi.list()` never answers a delta; it
 * always answers the WHOLE backlog, oldest first (`src/main/errors/log.ts`
 * buffers unconditionally, whether or not anyone is subscribed). So the
 * FIRST call this makes, on mount, recovers everything recorded before this
 * bridge existed -- and `subscribe`'s tick is not itself new data, only "call
 * `list()` again", the same "ask, don't wait" shape `vam:stream:change`
 * already uses. `lastId` is what keeps a repeated pull from re-recording an
 * entry `recordFailure` already has.
 *
 * EVERY EVENT FED IN BECOMES AN ORDINARY `LoggedEvent`. `recordFailure` is
 * the SAME call site every renderer-originated failure already goes through
 * -- there is no second log, no second report path, and no second scrub: the
 * `{code, message}` shape here is exactly what `recordFailure`'s own
 * `partsOf` already recognises (see `./log.ts`).
 */

import type { MainErrorsApi } from '../../preload/api.js';
import { recordFailure } from './log.js';

/**
 * Starts the bridge and returns its cleanup. Call once, for the life of the
 * desktop shell -- `src/renderer/App.tsx`'s `DesktopCanvas` is the one
 * caller, in a `useEffect` with no dependency that changes across the
 * session.
 */
export function bridgeMainErrors(api: MainErrorsApi): () => void {
  let lastId = 0;
  const pull = (): void => {
    void api.list().then((events) => {
      for (const event of events) {
        if (event.id <= lastId) continue;
        lastId = event.id;
        recordFailure(event.action, { code: event.code, message: event.message });
      }
    });
  };
  pull();
  return api.subscribe(pull);
}
