/**
 * The one way a pane reaches the source's backward pager.
 *
 * A CONTEXT, AND THIS FILE OWES AN ARGUMENT FOR THAT, because everything else
 * this repo hands a panel is handed at the call site: `DetailPanel.tsx` says
 * outright that "a member wired invisibly is one refactor away from being
 * dropped with nothing to notice", and `answer`, `prompt`, `pickImageAttachment`
 * and the terminal's three members are all passed as props for exactly that
 * reason.
 *
 * The argument is that this member is not like those. Each of them is about
 * ONE PANE -- which session it answers, which pane it types into -- so a pane
 * is the right place to name it. `history` is a property of the SOURCE: there
 * is one per app, it takes the session id it acts on as an argument, and every
 * pane that draws a column wants the same function. `Canvas.tsx` mounts one
 * `DetailPanel` per split leaf and `PhoneShell` mounts another; drilling one
 * app-wide function through both to reach a component that already has the
 * session id is prop-drilling a singleton, and it would put the same value in
 * three prop lists where two of them could drift.
 *
 * NULL IS A REAL VALUE HERE, not a placeholder. `SessionSource.history` is
 * optional (`port.ts` says why: it is present on every source the factories
 * assemble, and optional only so a source built by hand is not obliged to
 * invent a transcript it does not have). Absent is `unsupported` -- a stated
 * refusal at the top of the column -- and NOT "there is nothing older", which
 * is the confusion `pull-requests.ts` has been warning about since the repo's
 * first month. The provider therefore passes `source.history ?? null` and the
 * column draws the difference; it never passes a stub that resolves empty,
 * because a stub is how the two answers become one.
 */

import { createContext, useContext } from 'react';
import type { SessionSource } from './port.js';

/**
 * The port's own `history` member, named. Derived from the port rather than
 * re-declared so the two cannot drift: change the signature there and every
 * consumer of this stops compiling.
 */
export type TranscriptReader = NonNullable<SessionSource['history']>;

const Reader = createContext<TranscriptReader | null>(null);

/**
 * Publishes the assembled source's pager to every pane below.
 *
 * Mounted in `App.tsx`, beside the `Canvas` it wraps -- the one place that
 * holds an assembled `SessionSource` and also knows whether this is the demo.
 */
export const HistoryReaderProvider = Reader.Provider;

/**
 * The pager, or `null` when this source has none.
 *
 * The default is `null` and that is deliberate: a `DetailPanel` rendered with
 * no provider at all (every existing test fixture, and any shell that has not
 * been taught about paging) gets the same honest answer as a source that
 * cannot page, rather than a control that would throw when pressed.
 */
export function useHistoryReader(): TranscriptReader | null {
  return useContext(Reader);
}
