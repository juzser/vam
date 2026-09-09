/**
 * The demo's own backward pager — `?demo=1`'s answer to `source.history`.
 *
 * WHY THIS EXISTS AT ALL. vam is public and every real transcript on this
 * machine is somebody's work, so `?demo=1` is the only session a screenshot may
 * show and the only one a guard may drive (`e2e/transcript-column-shots.mjs`).
 * The demo canvas has no `SessionSource` behind it -- `App.tsx` hands the canvas
 * a `{ kind: 'demo' }` cell whose every write is refused -- so without this the
 * column's whole read-back path would be unreachable from the one session the
 * repo is allowed to look at, and the guard would be measuring the boundary
 * block's resting state and nothing else.
 *
 * EXTENDING THE DEMO, NOT FAKING A SOURCE. What this returns is a real
 * `TranscriptPage`, read by the same `walkOlder` that reads the Claude Code
 * source's, drawn by the same block. Nothing about the column knows which one
 * it is talking to, which is the only way driving one says anything about the
 * other.
 *
 * ALL FOUR ANSWERS, IN A FIXED ORDER, and the two easy to leave out are the two
 * that matter most:
 *
 *   1. a page of turns;
 *   2. a window with NO whole turn in it and a live cursor -- the ORDINARY
 *      answer on a large real session (~2.5 MB of transcript per turn on the
 *      operator's largest), and the one a fixture that only ever succeeds would
 *      never let a reader meet;
 *   3. a read that FAILED, once, transiently -- so a guard can check that "vam
 *      could not read" and "there is nothing older" do not look the same, AND
 *      that the retry offered beside it actually recovers;
 *   4. the proven start, `reachedStart: true` with a null cursor.
 *
 * STATE IN A CLOSURE, NOT A MODULE, and that is what the third answer costs.
 * The refusal happens once per pager, so `createDemoHistory()` is called once
 * per demo canvas (`App.tsx`, in a `useMemo`) and two canvases in one browser
 * cannot steal each other's step. A module-level counter would make the guard's
 * result depend on how many times the page had been visited.
 */

import type { HistoryCursor, TranscriptPage } from '../../shared/history.js';
import type { Decision } from '../domain/model.js';

/** The one demo session with a transcript behind it. */
const DEMO_SESSION = 'factory-sse-1';

/** How many turns of invented history there are, oldest numbered 1. */
export const DEMO_HISTORY_TURNS = 8;

/**
 * The turns, oldest first. Deliberately about the same subject as the fixture's
 * real ones, so a screenshot of the column read back looks like a session
 * rather than like lorem ipsum -- and deliberately about NOTHING that happened
 * on this machine.
 */
const OLDER: readonly Decision[] = [
  {
    id: 'demo-old-1',
    label: 'open',
    input: 'Start on ui-server-sse. What does the epic actually ask for?',
    output:
      'Four acceptance criteria, two of them about the wire. AC-1 and AC-2 are the server; AC-3 is the browser end; AC-4 is the drop-and-recover case. Starting with AC-1.',
    commands: [],
  },
  {
    id: 'demo-old-2',
    label: 'plan',
    input: 'Plan it as tasks before you write anything.',
    output: 'Five tasks, none of them touching more than three files. Plan v1 signed.',
    commands: [],
  },
  {
    id: 'demo-old-3',
    label: 'T-1',
    input: 'Take T-1: the endpoint that holds a connection open.',
    output:
      'Endpoint up, heartbeat every 15s, one test that kills the process and asserts the drop.',
    commands: [],
    errorCount: 1,
  },
  {
    id: 'demo-old-4',
    label: 'T-2',
    input: 'T-2 next: the change events themselves.',
    output: 'Events carry no payload — a tick means "ask again". Cheaper, and it cannot go stale.',
    commands: [],
  },
  {
    id: 'demo-old-5',
    label: 'review',
    input: 'Review T-1 and T-2 before either lands.',
    output:
      'One finding, S3: the heartbeat is not tested against a proxy that buffers. Waived with a note, since no proxy is in the path yet.',
    commands: [],
  },
  {
    id: 'demo-old-6',
    label: 'T-3',
    input: 'T-3: the browser end. Does EventSource reconnect on its own?',
    output:
      'It does, once, about 3s after the drop. If the server is still down at that retry the connection is CLOSED and no further attempt is made.',
    commands: [],
  },
  {
    id: 'demo-old-7',
    label: 'measure',
    input: 'Measure that rather than quoting the spec at me.',
    output: 'Measured: one retry at 3.0s, then readyState 2. The spec and this machine agree.',
    commands: [],
    errorCount: 2,
  },
  {
    id: 'demo-old-8',
    label: 'T-4',
    input: 'T-4: what happens to the canvas while the connection is gone?',
    output:
      'It keeps the last model and says the feed is down. It does not blank, and it does not invent rows.',
    commands: [],
  },
];

/** Newest first, which is the order a page must be in. */
const NEWEST_FIRST = [...OLDER].reverse();

const unavailable = (code: string, message: string): TranscriptPage => ({
  kind: 'unavailable',
  error: { kind: 'unreachable', code, message },
});

/**
 * The order the four answers come in, one entry per ask.
 *
 * WRITTEN OUT RATHER THAN COMPUTED, because the whole value of this fixture is
 * that a guard can say "the third answer is the refusal" and be right every
 * run. `blank` sits immediately before `refuse` on purpose: those two are the
 * pair most easily confused for one another, and a reader who meets them back
 * to back can see that the column does not confuse them.
 *
 * Past the end of the script the pager has handed over everything it has and
 * answers the start, however often it is asked.
 */
const SCRIPT = ['page', 'blank', 'refuse', 'page', 'page'] as const;

/** Turns per page. Three of eight, so the walk takes more than one step. */
const PAGE_TURNS = 3;

/**
 * A pager for one demo canvas.
 *
 * DRIVEN BY ITS OWN STEP COUNT, not by the cursor's contents, and that is the
 * honest way round: `HistoryCursor` is opaque to callers (`shared/history.ts`),
 * so a fixture that decoded one would be teaching a guard a shape no consumer
 * is allowed to know. Each answer hands back a cursor that this pager alone
 * understands, exactly as a real source does.
 */
export function createDemoHistory(): (
  sessionId: string,
  cursor: HistoryCursor | null,
) => Promise<TranscriptPage> {
  // Where the script has got to, and how many turns have been handed over.
  let at = 0;
  let given = 0;

  return async (sessionId: string, _cursor: HistoryCursor | null): Promise<TranscriptPage> => {
    if (sessionId !== DEMO_SESSION) {
      // The other demo sessions are hand-written rows with no transcript behind
      // them at all. Saying so is the point: an empty page here would claim
      // those sessions began where the fixture stops.
      return unavailable(
        'no-demo-transcript',
        'the demo only carries a transcript for one session — the others are rows, not recordings',
      );
    }
    const instruction = SCRIPT[at];
    at += 1;
    if (instruction === 'blank') {
      // A window vam read that held no complete turn. NOT an ending: it carries
      // a cursor, and the ask after it returns turns.
      return { kind: 'page', turns: [], cursor: `demo-window-${at}`, reachedStart: false };
    }
    if (instruction === 'refuse') {
      // TRANSIENT, and that is what makes the retry beside it worth drawing:
      // the cursor did not move, so asking the same thing again is exactly what
      // the control does.
      return unavailable(
        'demo-read-refused',
        'the demo refuses one read on purpose, so you can see what a failed one says — ask again',
      );
    }
    const turns = NEWEST_FIRST.slice(given, given + PAGE_TURNS);
    given += turns.length;
    const done = given >= NEWEST_FIRST.length;
    return {
      kind: 'page',
      turns,
      cursor: done ? null : `demo-window-${at}`,
      reachedStart: done,
    };
  };
}
