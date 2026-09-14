/**
 * What one subagent has been asked and what it has done: the Agents pane's
 * detail side.
 *
 * In `src/shared/` for the reason `history.ts` is: main produces this, the
 * preload and the remote server forward it, and the renderer draws it, so it
 * cannot live in any one of the three.
 *
 * THE SPLIT IS THE SAME ONE `history.ts` ARGUES FOR, which is this repo's
 * oldest lesson said again: "no work" and "vam could not look" must never draw
 * the same. A request here has three outcomes:
 *
 *  1. `work` with turns -- here is what the agent is doing.
 *  2. `work` with no turns -- vam read the agent and found no whole turn in
 *     the window. That is ordinary: one tool result can exceed the window on
 *     its own, and an agent still writing its first answer has nothing closed.
 *     It is NOT an error and must not draw as one.
 *  3. `unavailable` -- vam could not read the agent at all, carrying the
 *     source's own words for why.
 */

import type { Decision } from '../renderer/domain/model.js';
import type { SourceError } from '../renderer/sources/port.js';

export type AgentWork =
  | {
      readonly kind: 'work';
      /**
       * OLDEST FIRST, unlike a session row's `decisions` and like
       * `TranscriptPage`: an agent's pane is read top to bottom, from what it
       * was asked towards what it is doing now.
       */
      readonly turns: readonly Decision[];
      /**
       * The turn the PARENT opened this agent with, when `turns` does not
       * reach back far enough to include it.
       *
       * Null when it is already `turns[0]` -- there is one representation of
       * the brief and never two. It exists at all because of a measurement:
       * only 52 of the 872 subagent transcripts on this machine, SIX PER CENT,
       * fit inside one window, so for 94 of every 100 agents the brief is at
       * the far end of a file from the work.
       */
      readonly brief: Decision | null;
      /**
       * True only when the window vam read actually began at byte 0.
       *
       * A POSITIVE FACT, never inferred from a short list -- the rule
       * `history.ts` keeps for `reachedStart`. False means there is a middle
       * vam did not read, and the pane has to say so rather than draw the two
       * ends joined: that would claim the agent went straight from its brief to
       * its newest turn, which is the one thing the operator cannot check.
       */
      readonly whole: boolean;
    }
  | { readonly kind: 'unavailable'; readonly error: SourceError };
