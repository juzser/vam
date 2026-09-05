/**
 * Answering the picker a session is actually showing -- the third thing in vam
 * that changes a tmux session, and the first that commits an answer to a
 * running agent.
 *
 * WHY THE OBVIOUS ROUTE IS NOT TESTED HERE: BECAUSE IT IS WRONG. A probe
 * against a live picker delivered the literal text `Emerald` and then Return.
 * The pane was byte-for-byte unchanged -- the picker has no text buffer, and
 * the "type something" row is a MODE you select, not a field text falls into
 * -- and Return took whatever row the cursor happened to sit on. The
 * transcript recorded `"Which colour do you prefer?"="Crimson"`. Text in,
 * different answer out, looking like success on both ends.
 *
 * So every test below is about the VERIFICATION, not about the keys: read the
 * screen, step one arrow and prove the cursor moved, match the cursor's LABEL
 * against what the operator chose -- never a position count -- and only then
 * press Return. Every refusal is a refusal that SENT NOTHING.
 *
 * Nothing spawns: the runner is a fake, and the argv is asserted BY VALUE.
 */

import { describe, expect, it } from 'vitest';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { answerQuestion, readPicker } from '../../../src/main/terminal/answer.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

const ATLAS = 'claude-code:atlas-11111111';
const BEACON = 'claude-code:beacon-22222222';
const NAME = 'vam-atlas-a1b2c3';
const TARGET = `=${NAME}:`;

/**
 * The colour picker from the probe, with the cursor on `row`.
 *
 * It carries the QUESTION TEXT above the rows because a real one does: the CLI
 * prints it there, and every read vam makes inside a step checks for it before
 * matching anything (`see` in `answer.ts`).
 */
const COLOUR_Q = 'Which colour do you prefer?';
const colours = (row: number, labels = ['Crimson', 'Cobalt', 'Emerald']) =>
  [
    COLOUR_Q,
    '',
    ...labels.map((label, at) => `${at === row ? '❯' : ' '} ${at + 1}. ${label}`),
    'Enter to select · ↑/↓ to navigate · Esc to cancel',
  ].join('\n');

/** The fruits picker, with the cursor on `row` and `ticked` checked. */
const FRUIT_Q = 'Which fruits do you like?';
const fruits = (row: number, ticked: readonly number[]) =>
  [FRUIT_Q, '']
    .concat(
      ['Apple', 'Banana', 'Cherry'].map(
        (label, at) =>
          `${at === row ? '❯' : ' '} ${at + 1}. [${ticked.includes(at) ? '✔' : ' '}] ${label}`,
      ),
    )
    .join('\n');

const REVIEW = [
  'Review your answers',
  ' ● Which fruits do you like?',
  '   → Apple, Cherry',
  'Ready to submit your answers?',
  '❯ 1. Submit answers',
  '  2. Cancel',
].join('\n');

const RESOLVED = 'Your questions have been answered.\n> ';

/**
 * A fake tmux. `captures` is a QUEUE: each `capture-pane` takes the next
 * screen, which is what lets a test say "and after that arrow the pane looked
 * like this" instead of assuming the module re-read at all.
 */
function runner(captures: readonly string[], listed = `${ATLAS}\t${NAME}\n`) {
  const argvs: (readonly string[])[] = [];
  const queue = [...captures];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    if (argv[0] === 'list-sessions') return ok(listed);
    if (argv[0] === 'capture-pane') return ok(queue.shift() ?? '');
    if (argv[0] === 'send-keys') return ok('');
    return failed(`no stub for ${argv[0] ?? ''}`);
  };
  return {
    run,
    argvs,
    sends: () => argvs.filter((argv) => argv[0] === 'send-keys'),
    keys: () => argvs.filter((argv) => argv[0] === 'send-keys').map((argv) => argv[3]),
  };
}

/** A one-question set -- what every call was before a set could have two. */
const single = (labels: readonly string[]) => ({
  steps: [{ question: COLOUR_Q, labels, multiSelect: false }],
});

describe('reading the picker off the screen', () => {
  it('finds the rows and the cursor tmux actually rendered', () => {
    const picker = readPicker(colours(1));
    expect(picker?.cursor).toBe(1);
    expect(picker?.rows.map((row) => row.label)).toEqual(['Crimson', 'Cobalt', 'Emerald']);
  });

  it('reads the checkbox state, so a toggle can be verified rather than assumed', () => {
    expect(readPicker(fruits(2, [0, 2]))?.rows.map((row) => row.checked)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('is null for a screen with no picker on it at all', () => {
    expect(readPicker(RESOLVED)).toBeNull();
    expect(readPicker('')).toBeNull();
  });

  it('is null when nothing on screen carries the cursor', () => {
    expect(readPicker('  1. Crimson\n  2. Cobalt')).toBeNull();
  });

  it('ignores numbered prose that is not the block the cursor is in', () => {
    const picker = readPicker(`I considered 3 options:\n\n${colours(0)}`);
    expect(picker?.rows).toHaveLength(3);
  });
});

describe('the pairing guard stands in front of every answer', () => {
  it('refuses, and captures nothing, when no session of vam~s answers for the project', async () => {
    const { run, argvs } = runner([colours(0)], `${BEACON}\tvam-beacon-d4e5f6\n`);
    expect(await answerQuestion(run, ATLAS, single(['Crimson']))).toEqual({ kind: 'unaimed' });
    expect(argvs.map((argv) => argv[0])).toEqual(['list-sessions']);
  });

  it('refuses on a published pane that disagrees, and never falls back to the tag', async () => {
    const { run, argvs } = runner([colours(0)]);
    const panes = new Map([['s1', 'vam-somebody-else']]);
    // NOT `unaimed`: vam named a session -- the one this row published -- and
    // rejected it. The read path has said `mispaired` for this since
    // `PaneView` gained the arm, and a Submit that says "vam could not name
    // one session of its own" over a name it just refused sends the operator
    // looking for the wrong thing.
    expect(await answerQuestion(run, ATLAS, single(['Crimson']), 's1', panes)).toEqual({
      kind: 'mispaired',
    });
    expect(argvs.map((argv) => argv[0])).toEqual(['list-sessions']);
  });

  it('says vam could not LOOK when tmux itself could not be reached', async () => {
    // `listVamSessions` failed outright. vam has no listing, so it has no
    // opinion about pairings at all -- and claiming one is a cause the
    // operator will go and look for.
    // A failure that did not classify: "no server running" is an ANSWER (no
    // server, no sessions) and resolves to an empty listing instead.
    const run: TmuxRun = async (argv) =>
      argv[0] === 'list-sessions' ? failed('tmux: connection lost') : ok('');
    expect(await answerQuestion(run, ATLAS, single(['Crimson']))).toEqual({
      kind: 'unavailable',
    });
  });
});

describe('refusing rather than guessing', () => {
  it('sends nothing when the screen is not the one this question is asked on', async () => {
    // The resolved screen does not carry the question text, so vam does not get
    // as far as asking whether there are rows on it. Both answers refuse; this
    // one is the more precise, and it is the check the loop leans on.
    const { run, sends } = runner([RESOLVED]);
    expect(await answerQuestion(run, ATLAS, single(['Crimson']))).toEqual({
      kind: 'wrong-question',
      question: COLOUR_Q,
    });
    expect(sends()).toEqual([]);
  });

  it('sends nothing when the question is on screen but its picker is not', async () => {
    const { run, sends } = runner([`${COLOUR_Q}\n\nthinking...`]);
    expect(await answerQuestion(run, ATLAS, single(['Crimson']))).toEqual({ kind: 'no-picker' });
    expect(sends()).toEqual([]);
  });

  it('sends no Return when the chosen label is nowhere on the screen', async () => {
    const { run, keys } = runner([colours(0), colours(1)]);
    expect(await answerQuestion(run, ATLAS, single(['Viridian']))).toEqual({
      kind: 'unmatched',
      label: 'Viridian',
    });
    expect(keys()).not.toContain('Enter');
  });

  it('checks the label BEFORE it touches the pane at all', async () => {
    const { run, sends } = runner([colours(0)]);
    await answerQuestion(run, ATLAS, single(['Viridian']));
    expect(sends()).toEqual([]);
  });

  it('refuses when the probe arrow does not move the cursor', async () => {
    // The picker is on screen but is not taking keys -- a stale capture, a
    // pane that has moved on. Pressing Return here is the Crimson failure.
    const { run, keys } = runner([colours(0), colours(0)]);
    expect(await answerQuestion(run, ATLAS, single(['Cobalt']))).toEqual({ kind: 'not-live' });
    expect(keys()).toEqual(['Down']);
  });

  it('reports a keystroke tmux would not deliver, rather than carrying on', async () => {
    const argvs: (readonly string[])[] = [];
    const run: TmuxRun = async (argv) => {
      argvs.push(argv);
      if (argv[0] === 'list-sessions') return ok(`${ATLAS}\t${NAME}\n`);
      if (argv[0] === 'capture-pane') return ok(colours(0));
      return failed('cant find pane');
    };
    expect(await answerQuestion(run, ATLAS, single(['Cobalt']))).toEqual({ kind: 'refused' });
  });
});

describe('the verified route, step by step', () => {
  it('steps by arrow until the cursor LABEL matches, then presses Return exactly once', async () => {
    const { run, argvs, keys } = runner([
      colours(0), // the first read: cursor on Crimson
      colours(1), // after the probe arrow: it moved, so the picker is live
      colours(2), // after the second arrow: Emerald, the chosen label
      RESOLVED, // the read-back: the picker is gone
    ]);
    expect(await answerQuestion(run, ATLAS, single(['Emerald']))).toEqual({
      kind: 'sent',
      answer: 'Emerald',
    });
    expect(keys()).toEqual(['Down', 'Down', 'Enter']);
    // By value, every one of them, and aimed at the exact session.
    expect(argvs.filter((argv) => argv[0] === 'send-keys')).toEqual([
      ['send-keys', '-t', TARGET, 'Down'],
      ['send-keys', '-t', TARGET, 'Down'],
      ['send-keys', '-t', TARGET, 'Enter'],
    ]);
    // Read, step, read, step, read, Return, read -- never a blind burst.
    expect(argvs.map((argv) => argv[0])).toEqual([
      'list-sessions',
      'capture-pane',
      'send-keys',
      'capture-pane',
      'send-keys',
      'capture-pane',
      'send-keys',
      'capture-pane',
    ]);
  });

  it('answers the row the probe arrow landed on without stepping past it', async () => {
    const { run, keys } = runner([colours(0), colours(1), RESOLVED]);
    expect(await answerQuestion(run, ATLAS, single(['Cobalt']))).toEqual({
      kind: 'sent',
      answer: 'Cobalt',
    });
    expect(keys()).toEqual(['Down', 'Enter']);
  });

  it('walks the whole list, wrapping, to reach a label above the cursor', async () => {
    const { run, keys } = runner([colours(2), colours(0), RESOLVED]);
    expect(await answerQuestion(run, ATLAS, single(['Crimson']))).toEqual({
      kind: 'sent',
      answer: 'Crimson',
    });
    expect(keys()).toEqual(['Down', 'Enter']);
  });

  /**
   * THE POSITION COUNT IS THE BUG, AND THIS IS THE TEST THAT CATCHES IT.
   *
   * Written after replacing the label match with `cursor === labels.indexOf`
   * and finding every other test in this file still green: a fixture whose
   * rows never move cannot tell the two apart, and a suite that cannot tell
   * them apart is not testing the thing the module exists for.
   *
   * So the list REFLOWS between the first read and the walk -- the CLI redraws,
   * and the row an option sits on is not a name for it. Counting positions
   * from the first screen commits row three, which is now Cobalt, and reports
   * Emerald: the Crimson failure with extra steps. Matching the cursor's label
   * walks one row further and answers what was chosen.
   */
  it('matches the LABEL, not the position, when the list reflows under the walk', async () => {
    const before = colours(0, ['Crimson', 'Cobalt', 'Emerald']);
    const reflowed = (row: number) => colours(row, ['Emerald', 'Crimson', 'Cobalt']);
    const { run, keys } = runner([before, reflowed(1), reflowed(2), reflowed(0), RESOLVED]);
    expect(await answerQuestion(run, ATLAS, single(['Emerald']))).toEqual({
      kind: 'sent',
      answer: 'Emerald',
    });
    expect(keys()).toEqual(['Down', 'Down', 'Down', 'Enter']);
  });

  it('reports the read-back rather than swallowing it when the picker is still there', async () => {
    const { run } = runner([colours(0), colours(1), colours(1)]);
    expect(await answerQuestion(run, ATLAS, single(['Cobalt']))).toEqual({
      kind: 'unconfirmed',
      label: 'Cobalt',
    });
  });
});

describe('multi-select toggles exactly what was chosen, and reviews it before committing', () => {
  const both = { steps: [{ question: FRUIT_Q, labels: ['Apple', 'Cherry'], multiSelect: true }] };

  it('ticks each chosen row, uses the CLI own review, and answers what it read there', async () => {
    const { run, keys } = runner([
      fruits(0, []), // first read
      fruits(1, []), // the probe arrow moved the cursor: the picker is live
      fruits(2, []), // stepping towards Apple
      fruits(0, []), // and onto it
      fruits(0, [0]), // Return ticked Apple, and the pane says so
      fruits(1, [0]), // stepping towards Cherry
      fruits(2, [0]), // and onto it
      fruits(2, [0, 2]), // Return ticked Cherry too
      REVIEW, // Right reached the CLI own review screen
      RESOLVED, // Return committed it
    ]);
    expect(await answerQuestion(run, ATLAS, both)).toEqual({
      kind: 'sent',
      answer: 'Apple, Cherry',
    });
    expect(keys()).toEqual([
      'Down',
      'Down',
      'Down',
      'Enter',
      'Down',
      'Down',
      'Enter',
      'Right',
      'Enter',
    ]);
    // Two ticks and one commit. Banana was never on the cursor when a Return
    // was pressed, and nothing but the two chosen rows was toggled.
    expect(keys().filter((key) => key === 'Enter')).toHaveLength(3);
  });

  it('stops when a toggle did not land on the row it was aimed at', async () => {
    const { run } = runner([
      fruits(0, []),
      fruits(1, []),
      fruits(2, []),
      fruits(0, []),
      fruits(0, []), // Return changed nothing: the tick is not there
    ]);
    expect(await answerQuestion(run, ATLAS, both)).toEqual({
      kind: 'unconfirmed',
      label: 'Apple',
    });
  });

  it('refuses to commit a review screen that does not name every chosen option', async () => {
    const short = REVIEW.replace('Apple, Cherry', 'Cherry');
    const { run, keys } = runner([
      fruits(0, []),
      fruits(1, []),
      fruits(2, []),
      fruits(0, []),
      fruits(0, [0]),
      fruits(1, [0]),
      fruits(2, [0]),
      fruits(2, [0, 2]),
      short,
    ]);
    expect(await answerQuestion(run, ATLAS, both)).toEqual({ kind: 'unconfirmed', label: 'Apple' });
    // Two Returns for the two ticks, and nothing after the Right.
    expect(keys().filter((key) => key === 'Enter')).toHaveLength(2);
  });
});

/**
 * The same flow against REAL `capture-pane` output, byte for byte.
 *
 * Every fixture above is written by hand, and a parser tested only against
 * screens its author invented is a parser tested against its own assumptions.
 * So these three screens were captured from a live tmux -- a throwaway session
 * on a private socket, running a three-row picker, killed and verified gone in
 * the same task -- and pasted in unaltered. `capture-pane -p` strips trailing
 * spaces and pads the screen with empty lines, which is the detail a hand
 * fixture would not have thought to include.
 *
 * What the capture proves about tmux itself, and it is why the route is this
 * one: `send-keys Down` moved the rendered cursor, Return committed the row
 * the cursor was ON at that moment, and the screen afterwards no longer holds
 * the picker.
 */
/**
 * The refusals that only a tmux failing MID-FLIGHT can reach. Every one of them
 * leaves the answer uncommitted or says so, and none of them claims `sent`.
 */
describe('when the pane stops cooperating part way through', () => {
  const oneFruit = { steps: [{ question: FRUIT_Q, labels: ['Apple'], multiSelect: true }] };

  /** A runner whose Nth `send-keys` fails, everything before it succeeding. */
  function flaky(captures: readonly string[], failAt: number) {
    const queue = [...captures];
    let sends = 0;
    const keys: (string | undefined)[] = [];
    const run: TmuxRun = async (argv) => {
      if (argv[0] === 'list-sessions') return ok(`${ATLAS}\t${NAME}\n`);
      if (argv[0] === 'capture-pane') {
        const next = queue.shift();
        return next === undefined ? failed('cant find pane') : ok(next);
      }
      keys.push(argv[3]);
      sends += 1;
      return sends === failAt ? failed('cant find pane') : ok('');
    };
    return { run, keys: () => keys };
  }

  it('gives up on a cursor that never reaches a label the first read showed', async () => {
    // The label WAS on the screen vam checked, and the cursor cycles without
    // ever landing on it. One pass of the list and then a refusal, rather than
    // arrows into a pane forever.
    const stuck = [colours(0), colours(1), colours(0), colours(1), colours(0), colours(1)];
    const { run, keys } = runner(stuck);
    expect(await answerQuestion(run, ATLAS, single(['Emerald']))).toEqual({
      kind: 'unmatched',
      label: 'Emerald',
    });
    expect(keys()).not.toContain('Enter');
  });

  it('reports the commit tmux would not deliver, on the multi-select tail', async () => {
    const screens = [
      fruits(0, []),
      fruits(1, []),
      fruits(2, []),
      fruits(0, []),
      fruits(0, [0]),
      REVIEW,
    ];
    // The sixth send-keys is the Return that commits the review.
    const { run, keys } = flaky(screens, 6);
    expect(await answerQuestion(run, ATLAS, oneFruit)).toEqual({
      kind: 'refused',
    });
    expect(keys().at(-1)).toBe('Enter');
  });

  it('will not call an unreadable screen a confirmation, either side of the commit', async () => {
    // Before the Right: vam cannot see the review, so it does not commit.
    const blind = [fruits(0, []), fruits(1, []), fruits(2, []), fruits(0, []), fruits(0, [0])];
    const { run } = flaky(blind, 0);
    expect(await answerQuestion(run, ATLAS, oneFruit)).toEqual({
      kind: 'unreadable',
    });
    // And after it: the keys went in and vam cannot say what happened, which is
    // `unconfirmed` -- never `sent`.
    const short = flaky([...blind, REVIEW], 0);
    expect(await answerQuestion(short.run, ATLAS, oneFruit)).toEqual({
      kind: 'unconfirmed',
      label: 'Apple',
    });
  });

  it('will not call an unreadable screen a confirmation for a single answer either', async () => {
    const { run } = flaky([colours(0), colours(1)], 0);
    expect(await answerQuestion(run, ATLAS, single(['Cobalt']))).toEqual({
      kind: 'unconfirmed',
      label: 'Cobalt',
    });
  });
});

describe('against real capture-pane bytes', () => {
  const LIVE = [
    '❯ 1. Crimson\n  2. Cobalt\n  3. Emerald\nEnter to select · Up/Down to navigate\n' +
      '\n'.repeat(20),
    '  1. Crimson\n❯ 2. Cobalt\n  3. Emerald\nEnter to select · Up/Down to navigate\n' +
      '\n'.repeat(20),
    '  1. Crimson\n  2. Cobalt\n❯ 3. Emerald\nEnter to select · Up/Down to navigate\n' +
      '\n'.repeat(20),
    'Your questions have been answered: "colour"="Emerald".\n>\n' + '\n'.repeat(28),
  ];

  it('reads the cursor and the rows off a screen tmux actually rendered', () => {
    expect(readPicker(LIVE[0] ?? '')?.cursor).toBe(0);
    expect(readPicker(LIVE[2] ?? '')?.cursor).toBe(2);
    expect(readPicker(LIVE[2] ?? '')?.rows.map((row) => row.label)).toEqual([
      'Crimson',
      'Cobalt',
      'Emerald',
    ]);
    // The screen after the commit holds no picker, which is what the read-back
    // reads as confirmation.
    expect(readPicker(LIVE[3] ?? '')).toBeNull();
  });

  // The end-to-end walk across these screens moved to `answer-steps.test.ts`,
  // where the fixtures are a real TWO-question call captured from Claude Code
  // itself -- strictly better bytes for the same claim.
});
