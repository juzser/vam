/**
 * What ONE subagent is doing, fetched for the Agents pane's detail side.
 *
 * THREE STATES, AND THE MIDDLE ONE IS THE POINT. "Nothing is picked", "vam is
 * still asking" and "vam has an answer" are three different things to draw,
 * and the version that collapses the middle two draws "this agent has done
 * nothing yet" out of vam's own latency -- a claim about the agent made from
 * no evidence. This repo has a standing rule about exactly that shape
 * (`useSourceModel`: "Empty `model.projects` and `loading: true` are two
 * different sentences").
 *
 * IT POLLS, because a running agent changes while you watch it. A static
 * snapshot of a live agent is the staleness this pane exists to end -- and the
 * poll is cheap for the reason `agent-work.ts` sets out: two 128 KiB windows of
 * one file, never a walk, and only while a person has the pane open on it.
 */

import { useEffect, useState } from 'react';
import type { AgentWork } from '../../shared/agent-work.js';

/**
 * How often an open Agents pane asks again.
 *
 * The same ten seconds `useSourceModel` polls the session list on, and
 * deliberately not faster: the row beside it updates on that cadence, and a
 * detail that refreshed out of step with its own list would show a turn the
 * list has not heard of yet.
 */
export const AGENT_WORK_POLL_MS = 10_000;

/** What a source with no agent surface answers, said once. */
const NO_SURFACE: AgentWork = {
  kind: 'unavailable',
  error: {
    kind: 'refused',
    code: 'unsupported:agent-work',
    message: 'this source cannot report what a session’s agents are doing',
  },
};

export type AgentWorkState = {
  /**
   * `idle` -- nothing is picked and nobody has been asked.
   * `loading` -- a read is in flight and there is nothing honest to draw yet.
   * `ready` -- `work` is the answer, `unavailable` arm included.
   */
  readonly state: 'idle' | 'loading' | 'ready';
  readonly work: AgentWork | null;
};

const IDLE: AgentWorkState = { state: 'idle', work: null };
const LOADING: AgentWorkState = { state: 'loading', work: null };

export function useAgentWork(
  sessionId: string,
  agentId: string | null,
  read: ((sessionId: string, agentId: string) => Promise<AgentWork>) | undefined,
): AgentWorkState {
  const [answer, setAnswer] = useState<AgentWorkState>(IDLE);

  useEffect(() => {
    if (agentId === null) {
      setAnswer(IDLE);
      return;
    }
    if (read === undefined) {
      // Not a failure and not a silence: the source said it has no such
      // surface, in the arm the type carries for saying it.
      setAnswer({ state: 'ready', work: NO_SURFACE });
      return;
    }

    let live = true;
    // NEW AGENT, NEW QUESTION. Clearing to `loading` here is what stops the
    // previous agent's turns from sitting under the new agent's name while the
    // next read is in flight -- the pane would be captioned one thing and
    // drawn as another.
    setAnswer(LOADING);

    const ask = () => {
      void read(sessionId, agentId)
        .then((work) => {
          if (live) setAnswer({ state: 'ready', work });
        })
        .catch((reason: unknown) => {
          // The port promises this never rejects. A hook that TRUSTED that
          // promise would white-screen the pane the day an adapter written
          // later breaks it, and `port.ts` cannot enforce it on one.
          if (!live) return;
          setAnswer({
            state: 'ready',
            work: {
              kind: 'unavailable',
              error: {
                kind: 'unreachable',
                code: 'read-failed',
                message: reason instanceof Error ? reason.message : String(reason),
              },
            },
          });
        });
    };

    ask();
    const timer = setInterval(ask, AGENT_WORK_POLL_MS);
    return () => {
      // `live` and not just the interval: a read already in flight when the
      // operator picks another agent must not write, or a slow answer lands
      // under a name it does not belong to.
      live = false;
      clearInterval(timer);
    };
  }, [sessionId, agentId, read]);

  return answer;
}
