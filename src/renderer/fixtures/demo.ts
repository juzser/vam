/**
 * The canvas from docs/design/canvas-layout.md §3, as data.
 *
 * This exists because §5 says vam's real feed waits on two black-smith epics
 * (SSE, worker heartbeat) that have not landed. Waiting for them to look at the
 * layout would mean designing the hardest part of the UI blind. So the shape is
 * fixed here and the adapters fill it later — and because the canvas only ever
 * sees `CanvasModel`, swapping this for a live adapter changes no component.
 *
 * Three rules keep it honest, and all three are load-bearing for a fixture whose
 * job is to be looked at:
 *
 *  - **A session is one you started.** `factory-sse-1`, `vam-build-1` — the
 *    things you opened and can type into. The agents those sessions run inside
 *    themselves (reviewer, coder, verifier) are NOT rows: they are the `●N` and
 *    the activity line on the session that owns them. An earlier draft used
 *    black-smith task ids like `D-257` as rows, which put a subagent's work on
 *    the canvas as if it were something you had opened.
 *  - **`input` is what YOU said** — the prompt you typed, verbatim, never the
 *    agent's paraphrase. `output` is the session's final answer, never its
 *    working, and `null` means it is still writing one.
 *  - Nothing is invented that the sources cannot produce. black-smith cannot
 *    emit an activity line until §5 epic B lands, so `vam-build-1` reads `null`
 *    rather than a plausible-looking string.
 *
 * Note where `waiting` sits and where it does not. `crosscheck-2` has an
 * unanswered turn and is `running`: it is working, and it wants nothing from
 * you. `factory-sse-1` answered and stopped — that is what puts the ball in your
 * court, and what the halo is for.
 *
 * The text runs long on purpose: `in`/`out` clamp at two lines, and a fixture of
 * short strings would let a one-line bug ship looking fine.
 *
 * Not shipped: `dev` renders it, the real app will not.
 */

import type { PromptView } from '../../shared/answer.js';
import type { CanvasModel } from '../domain/model.js';

/**
 * The prompt `factory-sse-1` is blocked on, as vam would read it off the pane.
 *
 * INVENTED, like every value in this file -- the command and the path are
 * stand-ins. It exists because a tool-approval prompt writes no transcript
 * record, so there is no `questions` entry that could put it on a screenshot:
 * without this, the commonest asking shape there is stays invisible to every
 * non-unit gate in the repo, which is exactly what the questions PR found for the
 * AskUserQuestion card.
 */
export const DEMO_PROMPT: PromptView = {
  kind: 'prompt',
  prompt: {
    title: 'Do you want to run this command?',
    options: [
      'Yes',
      'Yes, and do not ask again for scripts/rebuild-index.sh',
      'No, and tell the agent what to do differently',
    ],
  },
};

export const DEMO_MODEL: CanvasModel = {
  projects: [
    {
      id: 'black-smith',
      name: 'black-smith',
      source: 'black-smith',
      sessions: [
        {
          // A SESSION BLOCKED WITH NOTHING TO DRAW A CARD FROM, which is the
          // commonest case there is: a tool-approval prompt writes no
          // transcript record while it is open, so `questions` is empty and
          // only the session's own per-process file says it is stuck. vam
          // started this one, so the note can offer the terminal.
          waitingFor: 'permission prompt',
          vamControlled: true,
          id: 'factory-sse-1',
          title: 'factory-sse-1',
          icon: '🔨',
          epic: 'ui-server-sse',
          branch: null,
          status: 'waiting',
          runningAgents: 3,
          activity: 'coder · round 2 · sonnet',
          age: '4m',
          // Newest first — the model's order, not the reading order. The canvas
          // reverses it so the newest lands at the bottom of the node.
          decisions: [
            {
              id: 'd-r5',
              label: 'R-5',
              input:
                "Does cross-origin EventSource actually reach the 127.0.0.1 server? Measure it, don't guess.",
              output:
                "It reaches — Origin header present, handler runs, subscribe + heartbeat start. But Chrome cuts it at ~5.0s (5004/5008/5010ms), while same-origin has no limit. Fix R-5's wording, or add CORS?",
              commands: [
                {
                  id: 'c-raise',
                  label: 'raise finding to fix R-5 wording',
                  command:
                    'smith findings raise --evidence state/results/f-ui-server-sse.json --found-by reviewer --session factory-sse-1',
                },
              ],
            },
            {
              id: 'd-signoff',
              label: 'sign-off',
              input: "Have we signed off plan-v2 yet? Don't sign if any finding is still open.",
              output:
                'Not yet. One S2 still open on task-4 (race in queue) — verifier confirmed it, coder is fixing round 2.',
              commands: [],
            },
            {
              id: 'd-task4',
              label: 'task-4',
              input: "Run task-4 per plan-v2, TDD first, don't waive the empty-queue branch.",
              output:
                'Round 1 done: 340-line diff, 6 files, suite green. Reviewer came back with 2 findings (1×S2, 1×S3).',
              commands: [],
            },
            // Everything below here is older than the three the canvas draws. It
            // is in the fixture precisely so the elided link has something to
            // count: a demo where nothing is ever skipped would let `+N` ship
            // untested and unseen.
            {
              id: 'd-plan',
              label: 'plan',
              input: 'Draft a plan for epic ui-server-sse, split waves by claim graph.',
              output:
                "plan-v2: 5 tasks, 41 ACs, 3 waves. task-2 holds task-1's claims via claim-order.",
              commands: [],
            },
            {
              id: 'd-scope',
              label: 'scope',
              input:
                'This epic is read-only for now, no writes yet. Put that explicitly in the spec.',
              output: 'Written into §6: epic 1 is read-only, the write path is epic 2.',
              commands: [],
            },
            {
              id: 'd-start',
              label: 'start',
              input: 'Open a session for epic ui-server-sse.',
              output: 'session-start factory-sse-1, plan_version 1.',
              commands: [],
            },
            {
              id: 'd-hello',
              label: 'hello',
              input: "What's the factory's status right now?",
              output: '2 epics open, 1 merge queue empty, no gate pending.',
              commands: [],
            },
          ],
        },
        {
          id: 'crosscheck-2',
          title: 'crosscheck-2',
          icon: '🧪',
          epic: 'cross-provider',
          branch: null,
          status: 'running',
          runningAgents: 2,
          activity: 'quorum · codex + deepseek · round 3',
          age: '26m',
          decisions: [
            {
              id: 'd-active',
              label: 'active mode',
              input: 'Fix deepseek, and active mode for both deepseek and codex.',
              // Still writing. `running`, not `waiting`: it wants nothing yet.
              output: null,
              commands: [],
            },
            {
              id: 'd-shadow',
              label: 'shadow',
              input: 'Both providers are in shadow mode, right? Check crosscheck.yml.',
              output:
                'Correct, both are mode: shadow. The file header still said promoted — I fixed that too.',
              commands: [],
            },
          ],
        },
        {
          id: 'dogfood-4',
          title: 'dogfood-4',
          icon: '📦',
          epic: 'd257-verdict',
          branch: null,
          status: 'done',
          runningAgents: 0,
          activity: 'merged',
          age: '2h',
          decisions: [
            {
              id: 'd-merge',
              label: 'merge',
              input: "Rebase then merge, don't squash — I want to keep every commit from task-4.",
              output: 'Clean rebase, no conflicts. Merged into main, all 7 commits kept.',
              commands: [],
            },
          ],
        },
      ],
    },
    {
      id: 'vam',
      name: 'vam',
      source: 'orca',
      sessions: [
        {
          // THE ASKING SHAPES, so that a screenshot and a Playwright run can
          // see them at all. Until this landed, `questions` appeared nowhere in
          // this fixture and nothing under `e2e/` mentioned one, so the entire
          // question surface -- single-select, multi-select and the 42% of real
          // calls that carry more than one question -- was invisible to every
          // non-unit gate in the repo. One call, two questions, and the two
          // shapes side by side.
          questions: [
            {
              id: 'toolu_demo:0',
              header: 'Transport',
              question: 'How should the canvas receive updates while a run is live?',
              multiSelect: false,
              options: [
                {
                  label: 'Server-sent events',
                  description: 'one long-lived GET, the server pushes',
                  preview: 'GET /events  →  text/event-stream',
                },
                {
                  label: 'Long poll',
                  description: 'a request per change, simplest to serve',
                  preview: 'GET /changes?since=41  →  200 after 0-30s',
                },
                {
                  label: 'Web socket',
                  description: 'two-way, and vam needs one way',
                  preview: 'Upgrade: websocket',
                },
              ],
              answer: null,
            },
            {
              id: 'toolu_demo:1',
              header: 'Retries',
              question: 'Which drops should the client retry by itself?',
              multiSelect: true,
              options: [
                { label: 'The server restarted', description: 'connection closed cleanly' },
                { label: 'The browser cut it off', description: 'the five-second ceiling' },
                { label: 'A proxy timed out', description: 'no bytes for a minute' },
              ],
              answer: null,
            },
          ],
          // THE UNANSWERABLE HALF, drawn on purpose. vam did not start this
          // session, so no Submit is offered over the card at all -- a control
          // that could only ever come back refused is worse than none.
          vamControlled: false,
          id: 'vam-build-1',
          title: 'vam-build-1',
          icon: '📐',
          epic: 'canvas-epic-1',
          branch: null,
          status: 'waiting',
          runningAgents: 1,
          activity: null,
          age: '8m',
          decisions: [
            {
              id: 'd-icons',
              label: 'icon',
              input: 'Rename sessions and pick an icon for them, like orca does.',
              output:
                'Orca uses emoji-picker-react (class .repo-icon-emoji-picker), not a fixed list. Switched the picker to one with search. Press s on a row to try it.',
              commands: [],
            },
            {
              id: 'd-group',
              label: 'group',
              input:
                "The left sidebar can group sessions by project. On the canvas, wrap a dashed-line border around each project's sessions, labeled with the project name.",
              output:
                'Done. The heading is a plain <div> so j never stops there; the border can only wrap contiguous rows, so a project sorts by its most urgent session.',
              commands: [],
            },
            {
              id: 'd-stack',
              label: 'stack',
              input: 'Use React and ReactFlow, but not HDS — reference orca itself.',
              output:
                'Written into §1.1 as a stack deviation: Vue→React, vue-flow→ReactFlow, HDS→Tailwind. Loses 57 .vue files and the HDS tokens; vam is the first repo off the standard.',
              commands: [
                {
                  id: 'c-check',
                  label: 'rerun the UI gate',
                  command: 'pnpm -s lint && pnpm -s typecheck && pnpm -s test && pnpm -s build',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
