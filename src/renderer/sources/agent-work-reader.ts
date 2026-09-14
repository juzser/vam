/**
 * The one way a pane reaches the source's agent reader.
 *
 * A CONTEXT, ON THE ARGUMENT `history-reader.ts` ALREADY MAKES -- read it
 * there rather than have it restated here, because a second copy of a
 * justification is a second thing to keep true. It applies to this member
 * without a word changed: `agentWork` is a property of the SOURCE, there is
 * one per app, it takes the session id it acts on as an argument, and every
 * pane that draws an Agents tab wants the same function. `Canvas.tsx` mounts
 * one `DetailPanel` per split leaf and `PhoneShell` mounts another; drilling
 * one app-wide function through both to reach a component that already has
 * the session id is prop-drilling a singleton.
 *
 * NULL IS A REAL VALUE HERE, likewise: absent means this source cannot report
 * what an agent is doing, which the pane says in one sentence. It is never a
 * stub that resolves empty, because a stub is how "this agent has done
 * nothing" and "vam could not ask" become one sentence -- the confusion
 * `pull-requests.ts` has been warning about since the repo's first month.
 */

import { createContext, useContext } from 'react';
import type { SessionSource } from './port.js';

/**
 * The port's own `agentWork` member, named. Derived from the port rather than
 * re-declared so the two cannot drift: change the signature there and every
 * consumer of this stops compiling.
 */
export type AgentWorkReader = NonNullable<SessionSource['agentWork']>;

const Reader = createContext<AgentWorkReader | null>(null);

/**
 * Publishes the assembled source's agent reader to every pane below. Mounted
 * in `App.tsx`, beside `HistoryReaderProvider` and for the same reasons.
 */
export const AgentWorkReaderProvider = Reader.Provider;

/**
 * The reader, or `null` when this source has none.
 *
 * The default is `null` deliberately: a `DetailPanel` rendered with no
 * provider at all -- every existing test fixture, and any shell not yet taught
 * about agents -- gets the same honest answer as a source that cannot look,
 * rather than a control that would throw when pressed.
 */
export function useAgentWorkReader(): AgentWorkReader | null {
  return useContext(Reader);
}
