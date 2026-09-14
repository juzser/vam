/**
 * The demo's own answer for "what is this agent doing" — `?demo=1`'s
 * counterpart to `src/main/sources/claude-code/agent-work.ts`.
 *
 * WHY THIS EXISTS. `factory-sse-1` in `fixtures/demo.ts` carries a roster —
 * `agent-coder`, `agent-tester`, `agent-reviewer`, `agent-planner`,
 * `agent-scribe` — so the Agents tab has rows to draw. Until this file
 * existed nothing answered `agentWork` for the demo canvas at all
 * (`App.tsx`'s `DemoCanvas` mounted no `AgentWorkReaderProvider`), so
 * `useAgentWork` read `read === undefined` and drew the sentence reserved for
 * a source with NO agent surface — "this source cannot report what a
 * session's agents are doing". That is a real answer for the factory's
 * `readAgentWork` before it shipped, but it was never true of the demo: the
 * demo can answer anything, because nothing here is read off a disk. Picking
 * an agent in the one build every screenshot in `docs/images/` shows was
 * therefore demonstrating a refusal the shipped desktop app does not make.
 *
 * THE SAME SHAPE THE REAL SOURCE RETURNS, `AgentWork` (`shared/agent-work.ts`)
 * — `work` with `turns`/`brief`/`whole`, or `unavailable` with a
 * `SourceError` — never a parallel shape invented for the demo. A pane that
 * draws one type must be exercised through that type, or the demo tests
 * nothing about what the real pane does with it.
 *
 * CONSISTENT WITH THE ROSTER'S OWN SUBTITLES, and with the rest of the
 * fixture: `agent-coder`'s "wire the stream route" and `agent-reviewer`'s
 * "read the diff for the cookie decision" are the same epic `d-r5` in
 * `demo.ts` argues about (the cross-origin `EventSource` cut-off, the
 * `SameSite` cookie decision), and `agent-planner`'s turn below is the same
 * plan `d-plan` already reports the RESULT of — this is what the work behind
 * that decision would have looked like from the agent's own transcript.
 * `agent-tester`'s reconnect measurement echoes `demo-history.ts`'s own
 * `demo-old-6`/`demo-old-7`. Nothing here names a real file, a real host or a
 * real session — every string is invented for this fixture, like every other
 * value in `demo.ts`.
 *
 * ONE AGENT STAYS UNAVAILABLE ON PURPOSE: `agent-scribe`. `demo.ts` already
 * gives it `type: null, description: null` — an agent whose roster row
 * survived an unreadable `*.meta.json` beside its transcript
 * (`agent-roster.ts`'s own rule: "a row survives an unreadable meta file").
 * A transcript that thin is exactly the kind that also has nothing written to
 * it yet, so its `agentWork` answer is the real source's own `agent:empty`
 * arm, word for word. Without a row like this the `unavailable` arm — the
 * one this whole feature is about not confusing with "no work yet" — would be
 * reachable from unit tests only, never from the one session a screenshot may
 * show.
 *
 * NO ARTIFICIAL DELAY, unlike `demo-history.ts`'s pager: that file simulates
 * latency to give a guard a frame in which "Reading further back…" is on
 * screen, which matters because the column's in-flight state is the thing
 * under test. Nothing here tests `useAgentWork`'s `loading` state — that is
 * `test/sources/useAgentWork.test.tsx`'s job, against a controllable promise
 * — so resolving immediately keeps the demo responsive and this fixture
 * simple, which is the correct amount of fidelity for what it is standing in
 * for.
 */

import type { AgentWork } from '../../shared/agent-work.js';

/** The one demo session whose roster this file has work for. */
const DEMO_SESSION = 'factory-sse-1';

const refused = (code: string, message: string): AgentWork => ({
  kind: 'unavailable',
  error: { kind: 'refused', code, message },
});

/**
 * `agent-coder` — "wire the stream route". A short transcript that fits in
 * one window (`whole: true`, `brief: null`), one turn finished and one still
 * open, matching `running: true` on its roster row.
 */
const CODER: AgentWork = {
  kind: 'work',
  whole: true,
  brief: null,
  turns: [
    {
      id: 'agent-coder:t1',
      label: 'brief',
      input:
        'Wire the stream route the epic asks for: one long-lived GET, text/event-stream, heartbeat every 15s.',
      output:
        'Endpoint answers with the right content-type and a heartbeat comment every 15s. Wiring it to the session poll next, so a change fires an event and not only the clock.',
      commands: [],
      errorCount: 0,
      steps: [
        { id: 'agent-coder:t1:s0', label: 'Read', failed: false },
        { id: 'agent-coder:t1:s1', label: 'Edit', failed: false },
        { id: 'agent-coder:t1:s2', label: 'Bash: run the endpoint suite', failed: false },
      ],
    },
    {
      id: 'agent-coder:t2',
      label: 'poll',
      input:
        'Now hook the session poll into it, so a card change fires an event and not only the heartbeat.',
      // Still writing — the demo's own case for the "no answer yet" render,
      // matching `running: true` on this agent's row.
      output: null,
      commands: [],
      steps: [
        { id: 'agent-coder:t2:s0', label: 'Read', failed: false },
        { id: 'agent-coder:t2:s1', label: 'Edit', failed: false },
      ],
    },
  ],
};

/**
 * `agent-tester` — "drive the reconnect path". Long enough that only the two
 * ends were read (`whole: false`, a real `brief`), the case that is ORDINARY
 * for a real transcript (`agent-work.ts`'s own measurement: 94 of every 100).
 */
const TESTER: AgentWork = {
  kind: 'work',
  whole: false,
  brief: {
    id: 'agent-tester:brief',
    label: 'brief',
    input:
      'Drive the reconnect path: prove EventSource actually retries after a drop, on a real client, not from the spec.',
    output:
      'It does retry, once, about 3s after the drop. If the server is still down at that retry the connection closes and nothing else happens.',
    commands: [],
  },
  turns: [
    {
      id: 'agent-tester:t7',
      label: 'storm',
      input: 'Drop the connection ten times in a row and watch what each retry does.',
      output:
        'Nine of ten behaved identically to one drop; the tenth retried at 3.1s instead of 3.0s — inside jitter, not a bug.',
      commands: [],
      errorCount: 0,
      steps: [
        { id: 'agent-tester:t7:s0', label: 'Bash: script ten drops in a row', failed: false },
        { id: 'agent-tester:t7:s1', label: 'Read', failed: false },
      ],
    },
    {
      id: 'agent-tester:t8',
      label: 'proxy',
      input:
        'One more: what happens if a proxy buffers the stream instead of dropping it outright?',
      output: null,
      commands: [],
      steps: [
        {
          id: 'agent-tester:t8:s0',
          label: 'Bash: put a buffering proxy in front of it',
          failed: false,
        },
      ],
    },
  ],
};

/**
 * `agent-reviewer` — "read the diff for the cookie decision". Fits in one
 * window like the coder's, and its finished turn answers the exact question
 * `d-r5` in `demo.ts` raises.
 */
const REVIEWER: AgentWork = {
  kind: 'work',
  whole: true,
  brief: null,
  turns: [
    {
      id: 'agent-reviewer:t1',
      label: 'diff',
      input:
        'Read the diff for the cookie decision — does the SameSite change actually match what R-5 asked for?',
      output:
        'Matches: SameSite=Lax on the pairing cookie, the session cookie untouched. One nit — the comment above it still names the old default.',
      commands: [],
      errorCount: 0,
      steps: [
        { id: 'agent-reviewer:t1:s0', label: 'Read', failed: false },
        { id: 'agent-reviewer:t1:s1', label: 'Grep', failed: false },
      ],
    },
    {
      id: 'agent-reviewer:t2',
      label: 'nit',
      input: 'Fix the comment yourself, or hand it back to the coder?',
      output: null,
      commands: [],
    },
  ],
};

/**
 * `agent-planner` — "split the epic", `running: false`: a finished agent, so
 * an idle row on the roster can carry real work rather than nothing at all
 * once the "show idle" toggle reveals it. Its one turn is the work behind
 * `d-plan`'s answer in `demo.ts`, told from the agent's own side.
 */
const PLANNER: AgentWork = {
  kind: 'work',
  whole: true,
  brief: null,
  turns: [
    {
      id: 'agent-planner:t1',
      label: 'split',
      input: 'Split the epic into tasks by claim graph — how many waves does it actually need?',
      output:
        'plan-v2: 5 tasks, 41 ACs, 3 waves. task-2 holds task-1’s claims via claim-order, so wave 2 cannot start early.',
      commands: [],
      errorCount: 0,
      steps: [
        { id: 'agent-planner:t1:s0', label: 'Read', failed: false },
        { id: 'agent-planner:t1:s1', label: 'Write', failed: false },
      ],
    },
  ],
};

/**
 * `agent-scribe` — `type: null`, `description: null`, `running: false` in
 * `demo.ts`. Its own meta file could not be read, so its transcript answer is
 * the real source's `agent:empty` arm — the same words `agent-work.ts` gives
 * a subagent that exists but has written nothing. This is the one row that
 * keeps the `unavailable` arm reachable from the demo, on purpose (see the
 * header above).
 */
const SCRIBE: AgentWork = {
  kind: 'unavailable',
  error: {
    kind: 'unreachable',
    code: 'agent:empty',
    message: 'this agent’s transcript is empty',
  },
};

const AGENT_WORK: Readonly<Record<string, AgentWork>> = {
  'agent-coder': CODER,
  'agent-tester': TESTER,
  'agent-reviewer': REVIEWER,
  'agent-planner': PLANNER,
  'agent-scribe': SCRIBE,
};

/**
 * The demo's `agentWork` reader — the exact signature
 * `SessionSource['agentWork']` carries, so `App.tsx` can hand it to
 * `AgentWorkReaderProvider` with nothing in between.
 *
 * NEVER REJECTS, on the same promise every source's `agentWork` makes
 * (`sources/port.ts`): every branch below returns, none throws.
 */
export async function demoAgentWork(sessionId: string, agentId: string): Promise<AgentWork> {
  if (sessionId !== DEMO_SESSION) {
    // The other demo sessions carry no `agents` roster at all (`demo.ts`), so
    // the Agents tab never asks about them — this is the honest answer if
    // something ever does.
    return refused(
      'demo:no-agent-roster',
      'the demo only carries agent work for one session — the others have no roster at all',
    );
  }
  const work = AGENT_WORK[agentId];
  if (work === undefined) {
    return refused('demo:unknown-agent', 'the demo has no work fabricated for this agent id');
  }
  return work;
}
