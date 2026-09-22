/**
 * The canvas, as data.
 *
 * This exists because vam's real feed waits on two capabilities its data
 * source has not shipped yet: pushed updates over SSE, and a heartbeat from
 * each running worker. Waiting for them to look at the layout would mean
 * designing the hardest part of the UI blind. So the shape is
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
 *    the data source's own task ids as rows, which put a subagent's work on
 *    the canvas as if it were something you had opened.
 *  - **`input` is what YOU said** — the prompt you typed, verbatim, never the
 *    agent's paraphrase. `output` is the session's final answer, never its
 *    working, and `null` means it is still writing one.
 *  - Nothing is invented that the sources cannot produce. The factory source
 *    cannot emit an activity line until it can report a per-worker heartbeat,
 *    so `vam-build-1` reads `null` rather than a plausible-looking string.
 *
 * Note where `waiting` sits and where it does not. `crosscheck-2` has an
 * unanswered turn and is `running`: it is working, and it wants nothing from
 * you. `factory-sse-1` answered and stopped — that is what puts the ball in your
 * court, and what the halo is for.
 *
 * The text runs long on purpose: `in`/`out` clamp at two lines, and a fixture of
 * short strings would let a one-line bug ship looking fine.
 *
 * AND A FOURTH RULE, LEARNED RATHER THAN DESIGNED: **a guard cannot see what
 * this file cannot produce.** Every state a component draws needs a row here
 * or it is outside the reach of every non-unit gate in the repo, however good
 * those gates are. Four times now the same shape has played out -- the
 * AskUserQuestion card, the tool-approval prompt above, `status: 'failed'`,
 * and a turn whose `errorCount` is a READ ZERO rather than absent
 * (`crosscheck-2` below, added when concise mode made the difference between
 * those two visible) -- and the third is the clearest: `e2e/tooltip-shots.mjs` was written
 * to catch a `Note` a keyboard cannot reach, and it ran green for a release
 * over a banner carrying exactly that defect, because no session here had
 * ever failed. The rule that would have caught it existed; the element was
 * never in front of it. So a state added to a component owes a row in this
 * file, and a row added here should say which gate was blind without it.
 *
 * Not shipped: `dev` renders it, the real app will not.
 */

import type { PromptView } from '../../shared/answer.js';
import type { SessionModel } from '../../shared/terminal.js';
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

/**
 * WHICH MODEL each demo session is "running" -- what `terminal.model` answers
 * on the desktop, faked per ROW.
 *
 * INVENTED, like every value in this file, but the SHAPES are the ones a real
 * CLI produces (`test/main/terminal/model-status-screens.ts` holds the
 * captures they were taken from):
 *
 *  - `notes-1` is on a model exactly one row of the picker is -- the plain
 *    case, one tick.
 *  - `notes-2` is on `Sonnet 5`, which is BOTH the Sonnet row and the Default
 *    row, because Default resolves to Sonnet 5 and the status line does not
 *    say which alias set it. Two ticks, and a state that would otherwise have
 *    no gate in front of it anywhere.
 *  - `notes-3` is the one row answered from the TRANSCRIPT rather than the
 *    pane (`last-turn`). On a machine whose operator has replaced the CLI's
 *    status line with a script of their own there is no footer to read at all,
 *    and this is the only arm those sessions ever take -- so an arm with no
 *    row here would be an arm no browser gate ever draws. It carries a
 *    different sentence in the note and the accessible name, which is the
 *    whole point of it being a separate kind (`shared/terminal.ts`).
 *  - every other row is `unknown`, including `factory-sse-1`, which is blocked
 *    on a permission prompt -- and a permission prompt REPLACES the status
 *    line, measured. So that row draws the fallback label, which is the
 *    commonest real state there is and has to stay visible to the guards.
 *
 * A function rather than a map so a caller passes a row id and gets a total
 * answer: a session this file says nothing about is one vam cannot tell about,
 * which is exactly what the desktop answers for a pane it could not read.
 */
export function demoSessionModel(rowId?: string): SessionModel {
  const running: Record<string, SessionModel> = {
    'notes-1': { kind: 'model', name: 'Opus 5' },
    'notes-2': { kind: 'model', name: 'Sonnet 5' },
    // THE LONGEST REAL NAME THERE IS, and the first reason it is in the
    // fixture: this is what the status line reads on a session started on a
    // full model id (`/model claude-sonnet-4-5-20250929` -> `Sonnet 4.5`,
    // measured), and ten characters is the width at which the tools row at
    // vam's narrowest legal pane used to push its own send button out of the
    // box. It is also a name NONE of the five aliases is, so it ticks nothing
    // -- a labelled button over an unmarked list, which no other row shows.
    //
    // AND IT IS THE TRANSCRIPT-SOURCED ROW, which fits the same session rather
    // than needing another: a full model id is what `claude-sonnet-4-5-
    // 20250929` is, and the id on an assistant line is exactly what
    // `displayModelName` turns back into `Sonnet 4.5`.
    'notes-3': { kind: 'last-turn', name: 'Sonnet 4.5' },
  };
  return (rowId === undefined ? undefined : running[rowId]) ?? { kind: 'unknown' };
}

export const DEMO_MODEL: CanvasModel = {
  projects: [
    {
      id: 'factory',
      name: 'factory',
      source: 'factory',
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
          epic: 'ui-server-sse',
          branch: null,
          status: 'waiting',
          runningAgents: 3,
          /**
           * THE ROSTER BEHIND THE `●3`, so the Agents tab has something to be.
           *
           * It carried the count and no roster, which meant the tab drew "this
           * source does not report which agents a session is running" -- the
           * sentence reserved for a source with NO agent surface -- on the one
           * fixture a screenshot may use. Three running, matching the badge,
           * and two finished so the idle toggle has something to reveal.
           *
           * Invented, like every other line of this file.
           */
          agents: [
            {
              id: 'agent-coder',
              type: 'coder',
              description: 'wire the stream route',
              running: true,
            },
            {
              id: 'agent-tester',
              type: 'tester',
              description: 'drive the reconnect path',
              running: true,
            },
            {
              id: 'agent-reviewer',
              type: 'reviewer',
              description: 'read the diff for the cookie decision',
              running: true,
            },
            { id: 'agent-planner', type: 'planner', description: 'split the epic', running: false },
            { id: 'agent-scribe', type: null, description: null, running: false },
          ],
          activity: 'coder · round 2 · sonnet',
          age: '4m',
          // Newest first — the model's order, not the reading order. The canvas
          // reverses it so the newest lands at the bottom of the detail column.
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
              // THE TURN'S OWN WORKING, drawn as rows under its progress line
              // whenever focus view is off -- which is the default, so this is
              // the list in every screenshot of this session. Without one here
              // the whole feature would be outside the reach of every gate but
              // the unit tests, which is the fourth rule in this file's header
              // and the reason `errorCount: 0` a few sessions down exists.
              //
              // SHAPED LIKE THE REAL RECORD: a bare tool name where the tool
              // writes no description of its own, `name: description` where it
              // does (Bash is the one that does, which is why it is the one
              // that reads as a sentence).
              steps: [
                { id: 'd-r5:s0', label: 'Read', failed: false },
                { id: 'd-r5:s1', label: 'Grep', failed: false },
                { id: 'd-r5:s2', label: 'Bash: serve the page on 127.0.0.1', failed: false },
                { id: 'd-r5:s3', label: 'Bash: measure the cross-origin cut-off', failed: false },
                { id: 'd-r5:s4', label: 'Read', failed: false },
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
              // THE ONE ANSWER THAT RENDERS MARKDOWN LISTS, and it is here
              // because its absence was load-bearing. `out` is drawn by
              // `OUT_MARKDOWN`, which styles a `ul`, an `ol` and their
              // `::marker`s -- and no fixture in this repo wrote a list, so
              // `?demo=1` never drew one marker. That is the only session a
              // screenshot may show or a guard may drive (`demo-history.ts`
              // says why), so the markers could not be measured, could not be
              // photographed, and shipped at 1.79:1 until the operator
              // reported them. A numbered list AND a bulleted one, because the
              // two now take different inks and one of them would leave the
              // other unrendered.
              output: [
                'Round 1 done: 340-line diff, 6 files, suite green. Reviewer came back with 2 findings (1×S2, 1×S3).',
                '',
                '1. S2 — the queue races when two tasks discharge in the same tick.',
                '2. S3 — the empty-queue branch has no test; the plan said do not waive it.',
                '',
                'Still open:',
                '',
                '- round 2 is picking up the S2 first',
                '- the S3 test lands with it',
              ].join('\n'),
              commands: [],
              // A TURN THAT FINISHED AND STILL WENT WRONG, which is the case
              // the progress line used to fold away entirely: it answered, so
              // its mark was `✓`, and three failed tool calls left no trace
              // anywhere on a collapsed row. The demo needs one because a
              // fixture where nothing ever fails would let the failure mark
              // and the `· N failed` count ship unseen -- the same reason the
              // elided turns below are here.
              errorCount: 3,
              // THE LIST BESIDE THE COUNT, and the pair is the point: `· 3
              // failed` says something blew up in this turn, and only these
              // rows say WHICH calls. Three of them are marked, so the count
              // and the list agree -- a fixture where they disagreed would
              // make either one look broken in a screenshot.
              steps: [
                { id: 'd-task4:s0', label: 'Read', failed: false },
                { id: 'd-task4:s1', label: 'Write', failed: false },
                { id: 'd-task4:s2', label: 'Bash: run the new test, expecting red', failed: true },
                { id: 'd-task4:s3', label: 'Edit', failed: false },
                { id: 'd-task4:s4', label: 'Bash: run the queue suite', failed: true },
                { id: 'd-task4:s5', label: 'Edit', failed: false },
                { id: 'd-task4:s6', label: 'Bash: run the queue suite', failed: false },
                { id: 'd-task4:s7', label: 'Bash: check the diff with biome', failed: true },
                { id: 'd-task4:s8', label: 'Edit', failed: false },
              ],
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
              // A QUIET, FINISHED, OLDER TURN THAT MADE CALLS, and it is here
              // because the one state the two turns above cannot produce is
              // the one the unfold exists for. Focus view keeps the newest
              // turn's line (it has a present to report) and the failing
              // turn's (alarm is never folded), so NEITHER of them ever draws
              // a `···` -- and without a turn like this, "press the way back
              // and the calls return" was unreachable from the only session a
              // guard may drive. `e2e/turn-steps-shots.mjs` found that by
              // failing on it.
              steps: [
                { id: 'd-plan:s0', label: 'Read', failed: false },
                { id: 'd-plan:s1', label: 'Grep', failed: false },
                { id: 'd-plan:s2', label: 'Write', failed: false },
              ],
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
              // ZERO, WHICH IS NOT ABSENT, and this session is the only place
              // in the fixture that says so. `errorCount` absent means "this
              // source cannot report tool failures"; zero means vam looked
              // across this turn and found none (model.ts). Every other demo
              // turn is one or the other -- absent, or a real count -- so the
              // READING of none was a state no guard in this repo could put on
              // a screen. Concise mode is what made that expensive: collapsed,
              // the column says "failures not reported by this source" over a
              // window where nothing can report, and must say nothing at all
              // over a window vam read and found clean. Without a session of
              // zeros here, half of that pair was unreachable.
              errorCount: 0,
            },
            {
              id: 'd-shadow',
              label: 'shadow',
              input: 'Both providers are in shadow mode, right? Check crosscheck.yml.',
              output:
                'Correct, both are mode: shadow. The file header still said promoted — I fixed that too.',
              commands: [],
              errorCount: 0,
            },
          ],
        },
        {
          id: 'dogfood-4',
          title: 'dogfood-4',
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
          epic: 'canvas-epic-1',
          branch: null,
          status: 'waiting',
          runningAgents: 1,
          activity: null,
          age: '8m',
          /**
           * THE `/` TYPEAHEAD'S LIST, and it is here for the fourth rule
           * above: until this line existed, `session.slashCommands` was
           * absent on every row in this file, so the `/` popover was outside
           * the reach of every non-unit gate in the repo -- it could not be
           * screenshotted, and a real-browser guard could not press a key at
           * it. `e2e/prompt-suggest-shots.mjs` drives it now.
           *
           * INVENTED, like everything here. The real list is three tiers deep
           * (`slash-commands.ts`, `builtin-commands.ts`) and the third of them
           * is whatever the operator's installed CLI answers with, which is
           * exactly the sort of thing that must never reach a public fixture.
           * Long enough (12) to overflow the popover's eight rows, because the
           * count of what is NOT drawn is the assertion that needs a row here.
           */
          slashCommands: [
            { id: 'builtin:burrow', name: 'burrow', description: 'dig in and summarise' },
            { id: 'builtin:clearing', name: 'clearing', description: 'start the context over' },
            { id: 'builtin:compass', name: 'compass', description: 'say where the session is' },
            { id: 'builtin:driftwood', name: 'driftwood', description: null },
            { id: 'builtin:ember', name: 'ember', description: 'keep the last answer warm' },
            { id: 'builtin:fathom', name: 'fathom', description: 'measure how deep this goes' },
            { id: 'builtin:gale', name: 'gale', description: 'blow the caches away' },
            { id: 'builtin:harbour', name: 'harbour', description: 'park the work safely' },
            { id: 'builtin:inlet', name: 'inlet', description: 'open a narrower channel' },
            { id: 'user:otter', name: 'otter', description: 'the operator’s own file' },
            { id: 'project:quarry', name: 'quarry', description: 'this project’s own file' },
            { id: 'builtin:rename', name: 'rename', description: 'give the session a name' },
          ],
          decisions: [
            {
              id: 'd-icons',
              label: 'icon',
              input: 'Rename sessions and pick an icon for them, like orca does.',
              output:
                'Orca uses emoji-picker-react (class .repo-icon-emoji-picker), not a fixed list. Switched the picker to one with search. Open a project heading’s icon to try it.',
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
    {
      // A PROJECT OF QUIET SESSIONS -- two at first -- and the only place the
      // two quiet statuses stand side by side. `idle` is what the CLI calls a live
      // session between turns -- the commonest thing an operator has open --
      // and vam painted it `waiting` for as long as the source read every
      // non-busy row as a demand. A fixture with no idle row would leave the
      // status untested in every browser guard and absent from every
      // screenshot, which is how a status drifts back into meaning nothing.
      // It is a project of its own rather than a fourth session in `factory`,
      // because the split-pane guards are written around that project holding
      // exactly three; a status fixture must not buy its visibility by
      // rewriting the assertions of a guard it has nothing to do with.
      id: 'notes',
      name: 'notes',
      source: 'claude-code',
      sessions: [
        {
          // IDLE: alive, attached, and simply between turns. Note what it is
          // NOT -- `dogfood-4` is `done`, a job that ENDED, and this one can
          // be typed into right now. That difference is the reason `idle` is
          // its own status and not a second name for `done`.
          vamControlled: true,
          /**
           * A SESSION WHOSE `/` LIST IS SHORT, AND SAYS SO. The tiers made of
           * files were read; the CLI that names the BUILT-INS could not be
           * asked (`builtin-commands.ts`). That is a different state from
           * "nothing matches" and the pane draws a different thing for it --
           * and, like every state in this file, it needed a row or no
           * screenshot and no browser guard could ever see it.
           */
          slashCommands: [
            { id: 'user:otter', name: 'otter', description: 'the operator’s own file' },
          ],
          slashCommandGap: {
            code: 'cli-missing',
            message: 'no `claude` on PATH, so vam cannot ask it for its own commands',
          },
          id: 'notes-1',
          title: 'notes-1',
          epic: 'd257-verdict',
          branch: 'smith/d257/verdict-notes',
          status: 'idle',
          runningAgents: 0,
          activity: null,
          age: '26m',
          decisions: [
            {
              id: 'd-notes',
              label: 'notes',
              input: 'Write up what the D-257 verdict actually turned on, then wait for me.',
              output:
                'Written. It turned on one unmerged branch, not on the finding count -- the draft is in the epic notes and nothing was pushed. Say the word and I will raise it.',
              commands: [],
            },
          ],
        },
        {
          // Its neighbour, and the whole point of the pairing: one tab strip
          // holding a session that wants something and one that does not, so
          // the amber has something to be told apart FROM.
          waitingFor: 'plan approval',
          vamControlled: true,
          id: 'notes-2',
          title: 'notes-2',
          epic: 'd257-verdict',
          branch: 'smith/d257/ledger-sweep',
          status: 'waiting',
          runningAgents: 0,
          activity: null,
          age: '3m',
          decisions: [
            {
              id: 'd-ledger',
              label: 'ledger',
              input: 'Sweep the findings ledger for the nine that never reached the projection.',
              output:
                'Found all nine, and a tenth nobody counted. Plan is to backfill the projection rather than re-raise them -- approve and I will start.',
              commands: [],
            },
          ],
        },
        {
          // FAILED, and it was the last status this fixture did not draw.
          //
          // The consequence was not cosmetic: `data-session-failed` -- the
          // banner the pane puts at the top of a failed session, with the
          // note that says WHY there is no reason to show -- appeared on no
          // screen any Playwright run could reach, so nothing outside a jsdom
          // test had ever seen it. That is how the note on it stayed a bare
          // `<span>`: a `Note` a keyboard cannot reach is exactly what
          // `e2e/tooltip-shots.mjs` was written to catch, and the element was
          // never on screen while it was looking.
          //
          // It joins `notes` for the reason `notes` exists at all (see the
          // project comment above): the split-pane guards are written around
          // `factory` holding exactly three sessions, and a status fixture
          // must not buy its visibility by rewriting a guard it has nothing
          // to do with.
          //
          // NO `waitingFor`: a failed session is not blocked on the operator,
          // and the whole point of the banner is that the source reports no
          // reason at all -- see the note the pane hangs on it.
          vamControlled: true,
          id: 'notes-3',
          title: 'notes-3',
          epic: 'd257-verdict',
          branch: 'smith/d257/projection-backfill',
          status: 'failed',
          runningAgents: 0,
          activity: null,
          age: '51m',
          decisions: [
            {
              id: 'd-backfill',
              label: 'backfill',
              input: 'Backfill the projection from the ledger, oldest finding first.',
              // The turn that was in flight when it stopped: no output, which
              // is what a session that failed mid-turn actually looks like.
              output: null,
              commands: [],
            },
          ],
        },
        {
          // RUNNING, beside the idle one -- and the fourth row of a project
          // that was named for holding two. It is here for the tab strip's
          // indicators (`prefs/tab-indicators.ts`): the operator's rule is
          // that a resting tab draws NO mark while a busy one draws the
          // sidebar's own glyph, and that rule is a picture of two tabs on
          // ONE strip. No strip in this fixture could show it: `factory` has
          // a running session and no idle one, `notes` had an idle session
          // and nothing running. So the screenshot the rule is about could
          // not be taken, and `e2e/tab-strip-shots.mjs` could not measure a
          // bare tab's width against a spinning one's on the same row.
          //
          // THE REASON THIS ROW HAD NO ICON IS GONE, and the row is not.
          // It read: with the icon switch on by default a tab with an icon
          // always draws SOMETHING before its title, so the guard needed one
          // tab whose only mark was its status, and "the spinner is the mark"
          // could be measured where nothing else could interfere. Sessions
          // have no icons now (pull request 433 took the tab's, and the
          // picker went after it) and every tab carries its provider glyph
          // regardless, so no tab is bare and no fixture row can make one.
          // What the guard measures instead is the DIFFERENCE between this
          // running tab and an idle one on the same strip, which is what the
          // operator's rule was always about; the row stays because that
          // comparison still needs two tabs.
          //
          // `factory` still holds exactly three; the split-pane guards are
          // written around that and this row does not touch it.
          vamControlled: true,
          id: 'notes-4',
          title: 'notes-4',
          epic: 'd257-verdict',
          branch: 'smith/d257/ledger-diff',
          status: 'running',
          runningAgents: 0,
          activity: 'diffing the ledger against the projection',
          age: '1m',
          decisions: [
            {
              id: 'd-diff',
              label: 'diff',
              input: 'Diff the ledger against the projection and list what is missing.',
              // Still writing. `running`, not `waiting`: it wants nothing yet.
              output: null,
              commands: [],
              errorCount: 0,
            },
          ],
        },
        {
          // UNSTARTED: a pane vam opened with nothing in it yet -- the sixth
          // status (`model.ts`), and the row the operator's own words are
          // about: "the Response view needs a provider picker and a Start
          // session button". Without this row the start screen
          // (`DetailPanel.tsx`, `StartSession`) and the hollow status dot
          // (`status-mark.tsx`) were outside the reach of every non-unit gate
          // in the repo, which is the fourth rule above playing out a fifth
          // time. `e2e/start-screen-shots.mjs` measures both, and
          // `docs/ui/start-screen-*.png` are its pictures.
          //
          // SHAPED EXACTLY AS `pane-row.ts` REPORTS ONE. The id is the tmux
          // name under the pane prefix, the title IS the tmux name (vam knows
          // nothing else about it yet), `pane` names the same session, there
          // are no turns, no branch and no age, and `vamControlled` is true
          // by the only proof there is -- it is in vam's own listing. Beside
          // `notes-1..4` on purpose, so the mark is measured in a column of
          // the other five.
          vamControlled: true,
          id: 'pane:vam-notes-k3f9zq',
          title: 'vam-notes-k3f9zq',
          pane: 'vam-notes-k3f9zq',
          epic: null,
          branch: null,
          status: 'unstarted',
          runningAgents: 0,
          activity: null,
          age: null,
          decisions: [],
          source: 'claude-code',
        },
        {
          // A SESSION DEDICATED TO THE PREVIEW PANEL -- not another question
          // tacked onto `vam-build-1` (`vam` project, above). Two guards
          // depend on the exact session count of the project a demo row
          // lives in -- `split-panes-shots.mjs` needs `vam` holding exactly
          // one tab to empty a pane with, `factory`'s own count is pinned in
          // its own comment. `notes` has grown from two sessions to six
          // already ("A PROJECT OF QUIET SESSIONS", above) without needing a
          // guard's assertion rewritten, which is the whole reason it is the
          // safe place to grow it again.
          //
          // ALSO WHY `e2e/prompt-suggest-shots.mjs` OPENS THIS ONE, PINNED.
          // A card showing this panel is taller than one that is not, which
          // moves the composer -- and the `/` popover anchored to its top --
          // further down a short window than that guard's plain `vam-build-1`
          // check ever measured. It found the regression this way once
          // (`popoverTop: -18` at 480px); `slashCommands` below is what gives
          // that pinned check something to open, the same twelve-deep list
          // `vam-build-1` carries, so the popover clamp (`SUGGEST_BOX`,
          // `DetailPanel.tsx`) is proven against the tallest card the panel
          // can actually produce, not the shortest.
          //
          // THE MIX A REAL CALL HAS: `AskUserQuestion`'s `preview` is
          // free-form, and the operator's own transcripts hold ASCII diagrams
          // several rows deep (31 of the operator's own session files carry
          // one, `grep -l '"preview"' ~/.claude/projects/*/*.jsonl`). This is
          // a NEUTRAL mockup of that shape -- box-drawing, ~8 rows, no real
          // project text, path or session id -- beside a short one-line
          // preview and an option with none, because a panel that only ever
          // had one shape to draw would not be much of a guard.
          id: 'vam-preview-1',
          title: 'vam-preview-1',
          epic: null,
          branch: null,
          status: 'waiting',
          runningAgents: 0,
          activity: null,
          age: '5m',
          vamControlled: true,
          slashCommands: [
            { id: 'builtin:burrow', name: 'burrow', description: 'dig in and summarise' },
            { id: 'builtin:clearing', name: 'clearing', description: 'start the context over' },
            { id: 'builtin:compass', name: 'compass', description: 'say where the session is' },
            { id: 'builtin:driftwood', name: 'driftwood', description: null },
            { id: 'builtin:ember', name: 'ember', description: 'keep the last answer warm' },
            { id: 'builtin:fathom', name: 'fathom', description: 'measure how deep this goes' },
            { id: 'builtin:gale', name: 'gale', description: 'blow the caches away' },
            { id: 'builtin:harbour', name: 'harbour', description: 'park the work safely' },
            { id: 'builtin:inlet', name: 'inlet', description: 'open a narrower channel' },
            { id: 'user:otter', name: 'otter', description: 'the operator’s own file' },
            { id: 'project:quarry', name: 'quarry', description: 'this project’s own file' },
            { id: 'builtin:rename', name: 'rename', description: 'give the session a name' },
          ],
          questions: [
            {
              id: 'toolu_demo_preview:0',
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
                  preview:
                    '┌─ browser ─────────────┐                 ┌─ server ────────────────────────┐\n' +
                    '│ GET /changes?since=41  │──held up to 30s─▶│ holds the request open           │\n' +
                    '│  fetch() awaits it     │◀──────────────── │  replies the moment something    │\n' +
                    '└────────────────────────┘                  │  changes, or after 30s with none │\n' +
                    '                                             └───────────────────────────────────┘\n' +
                    '\n' +
                    'Every reply -- empty or not -- starts the NEXT request straight away, so the\n' +
                    'client is blocked on a GET almost the whole time, one request at a time.',
                },
                {
                  label: 'Web socket',
                  description: 'two-way, and vam needs one way',
                  // NO PREVIEW, on purpose: the panel's own fallback line
                  // ("no preview for this option") needs a real option here
                  // to be driven against, the same way the phone fixture
                  // (`e2e/phone-core-loop.pw.ts`) already carries one.
                  preview: null,
                },
              ],
              answer: null,
            },
          ],
          decisions: [],
        },
      ],
    },
  ],
};

/**
 * The same fixture with `factory-sse-1` padded out to `count` turns.
 *
 * WHY IT EXISTS: the detail pane now draws every turn `entry.session.decisions`
 * carries, and that list is capped at `MAX_DECISIONS = 3276`
 * (`main/sources/claude-code/transcript.ts`). A seven-turn fixture cannot say
 * whether the column still answers a scroll at that size, and "it will
 * probably be fine" is not a measurement. So the worst case is buildable:
 * `?demo=1&turns=3276` renders it, and `e2e/transcript-column-shots.mjs`
 * times it in a real browser, so CI holds the number rather than a memory of
 * one.
 *
 * SYNTHETIC AND OLDER, NEVER A SUBSTITUTE. The real turns stay at the front of
 * the list -- `decisions` is newest first -- so the newest turns, the ones
 * every screenshot is taken of, are byte-identical to the plain demo. The
 * padding is only ever what scrolls off the top, which is exactly the part
 * this fixture is about.
 *
 * `count` at or below what the fixture already carries returns it untouched:
 * this pads, it never truncates, because a fixture that quietly dropped turns
 * would make the very count it exists to prove a lie.
 */
export function demoModelWithTurns(count: number): CanvasModel {
  const project = DEMO_MODEL.projects[0];
  const session = project?.sessions[0];
  if (project === undefined || session === undefined) return DEMO_MODEL;
  const real = session.decisions;
  if (count <= real.length) return DEMO_MODEL;
  const padding = Array.from({ length: count - real.length }, (_, index) => {
    // Numbered from the oldest end, so a turn's label does not depend on how
    // many were asked for: turn 1 is turn 1 at any size, which is what makes a
    // screenshot of one comparable with a screenshot of another.
    const ordinal = count - real.length - index;
    return {
      id: `demo-pad-${ordinal}`,
      label: `T-${ordinal}`,
      input: `Turn ${ordinal} of a long session — what did the previous step leave open?`,
      output: `Answer ${ordinal}. Nothing was left open; the step closed clean, so the next one can start.`,
      commands: [],
      // Every seventh padded turn carries a failure, so the per-turn
      // `· N failed` count has something to draw at volume rather than only in
      // the three hand-written turns above.
      ...(ordinal % 7 === 0 ? { errorCount: 2 } : {}),
    };
  });
  return {
    ...DEMO_MODEL,
    projects: [
      {
        ...project,
        sessions: [{ ...session, decisions: [...real, ...padding] }, ...project.sessions.slice(1)],
      },
      ...DEMO_MODEL.projects.slice(1),
    ],
  };
}
