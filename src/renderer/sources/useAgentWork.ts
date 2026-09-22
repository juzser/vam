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
 *
 * VISIBILITY GATING: `hidden: 'pause'`, unlike `useSourceModel`'s `slowBy`.
 * This pane's own `agentId !== null` gate already withdraws the poll the
 * moment nobody has an agent picked, and `notify/waiting.ts`'s own header
 * says its ONE transition-detection loop is `useSourceModel`, not this hook
 * -- so a hidden window may stop this one outright with nothing lost. It
 * resumes the same way `TerminalTab`'s own refresh does: one immediate tick
 * the moment the window is visible again.
 *
 * TWO SEPARATE MECHANISMS FOR TWO SEPARATE REASONS TO ASK AGAIN. Picking a
 * DIFFERENT agent must ask right away regardless of visibility or the poll
 * phase -- the pane would otherwise caption one agent's turns under another's
 * name for up to `AGENT_WORK_POLL_MS` -- so that immediate ask stays a plain
 * effect keyed on `[sessionId, agentId, read]`, exactly as before this hook
 * existed. `useVisibilityInterval` owns only the RECURRING cadence on top of
 * it, reading the latest `ask` through its own ref. The two can both fire
 * once on the very first agent ever picked (the plain effect always asks on
 * change; the hook also asks once when `enabled` turns true) -- a harmless
 * doubled read of a cheap, idempotent 128 KiB tail, once per pane open,
 * traded for not inventing a second "was this really new" signal.
 *
 * `generation`, NOT THE ORIGINAL PER-EFFECT `live` CLOSURE. The hook still
 * needs ONE STABLE `ask` reference to hand to `useVisibilityInterval` (it
 * reads `callback` through a ref, not a dependency array), so `ask` itself
 * is a `useCallback` outside any single effect's closure -- and a boolean
 * ref shared across every call of it would un-isolate exactly the case this
 * file's own test exists for ("never paints a slow answer for an agent that
 * is no longer picked"): flipping one shared `liveRef` back to `true` for
 * the NEW agent would ALSO revive the OLD agent's in-flight promise. A
 * counter, bumped in the reset effect's own cleanup and snapshotted by each
 * `ask()` call at the moment it fires, is `useSourceModel`'s own
 * `issued`/`seq` idiom -- only the call whose snapshot still matches the
 * CURRENT counter may write.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentWork } from '../../shared/agent-work.js';
import { useVisibilityInterval } from '../useVisibilityInterval.js';

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
  // Bumped by the reset effect's own cleanup, below -- see this file's
  // header for why a counter replaces the original per-effect `live` flag.
  const generation = useRef(0);

  const ask = useCallback(() => {
    if (agentId === null || read === undefined) return;
    const mine = generation.current;
    void read(sessionId, agentId)
      .then((work) => {
        if (mine === generation.current) setAnswer({ state: 'ready', work });
      })
      .catch((reason: unknown) => {
        // The port promises this never rejects. A hook that TRUSTED that
        // promise would white-screen the pane the day an adapter written
        // later breaks it, and `port.ts` cannot enforce it on one.
        if (mine !== generation.current) return;
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
  }, [sessionId, agentId, read]);

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
    // NEW AGENT, NEW QUESTION. Clearing to `loading` here is what stops the
    // previous agent's turns from sitting under the new agent's name while the
    // next read is in flight -- the pane would be captioned one thing and
    // drawn as another.
    setAnswer(LOADING);
    ask();
    return () => {
      // Invalidates whatever `ask()` just issued, so a slow answer that
      // outlives this agent (or this pane) never lands under a name -- or a
      // component -- it does not belong to.
      generation.current += 1;
    };
    // `sessionId` is not read directly here -- `ask` already carries it, and
    // its own identity is what re-runs this effect.
  }, [agentId, read, ask]);

  // The RECURRING cadence only -- see this file's header for why the
  // immediate ask on a NEW agent stays in the plain effect above instead.
  useVisibilityInterval(agentId !== null && read !== undefined, AGENT_WORK_POLL_MS, 'pause', ask);

  return answer;
}
