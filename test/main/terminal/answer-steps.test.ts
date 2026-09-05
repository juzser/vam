/**
 * Answering a SET: one `AskUserQuestion` call carrying several questions, which
 * the CLI walks one at a time and commits once at the end.
 *
 * THE FIXTURES ARE THE REAL SCREENS (`answer-live-screens.ts`), captured from a
 * throwaway Claude Code session asked for exactly this: two questions in one
 * call, with `Cobalt` an option in BOTH. That shared label is the whole point
 * of the file. A loop that answers question one and then matches a label
 * against whatever is on screen next will find `Cobalt` on question one's own
 * picker and answer it twice, confidently, while reporting the operator's two
 * choices -- the Crimson failure with a second question to hide in.
 *
 * So every read inside a step first asks WHICH QUESTION IS ON SCREEN, and the
 * tests below are mostly about that check rather than about the keys.
 */

import { describe, expect, it } from 'vitest';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { answerQuestion } from '../../../src/main/terminal/answer.js';
import type { AnswerStep } from '../../../src/shared/answer.js';
import {
  COLOUR_ASKED,
  COLOUR_ON,
  FRUIT_ASKED,
  FRUIT_ON,
  RESOLVED,
  REVIEW,
} from './answer-live-screens.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const ATLAS = 'claude-code:atlas-11111111';
const NAME = 'vam-atlas-a1b2c3';
const TARGET = `=${NAME}:`;

function runner(captures: readonly string[]) {
  const argvs: (readonly string[])[] = [];
  const queue = [...captures];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    if (argv[0] === 'list-sessions') return ok(`${ATLAS}\t${NAME}\n`);
    if (argv[0] === 'capture-pane') return ok(queue.shift() ?? '');
    return ok('');
  };
  return {
    run,
    argvs,
    keys: () => argvs.filter((argv) => argv[0] === 'send-keys').map((argv) => argv[3]),
  };
}

const COLOUR: AnswerStep = {
  question: 'Which colour do you prefer?',
  labels: ['Emerald'],
  multiSelect: false,
};
const FRUIT: AnswerStep = {
  question: 'Which fruit do you prefer?',
  labels: ['Cherry'],
  multiSelect: false,
};
/** The shared label, asked of the second question. */
const FRUIT_COBALT: AnswerStep = { ...FRUIT, labels: ['Cobalt'] };
const SET = { steps: [COLOUR, FRUIT] };

/** The exact screens the real session showed, in the order it showed them. */
const REAL = [
  COLOUR_ASKED, // the set opens on question one
  COLOUR_ON(2), // after the probe arrow
  COLOUR_ON(3), // after the second: Emerald
  FRUIT_ASKED, // Return answered colour AND advanced -- this is the CLI's doing
  FRUIT_ON(2), // the probe arrow again, on question two
  FRUIT_ON(3), // Cherry
  REVIEW, // Return on the last question reaches the CLI's own review
  RESOLVED, // and Return there commits the set
];

describe('the real two-question call, walked end to end', () => {
  it('answers both questions and commits once, with the argv by value', async () => {
    const { run, argvs, keys } = runner(REAL);
    expect(await answerQuestion(run, ATLAS, SET)).toEqual({
      kind: 'sent',
      answer: 'Emerald, Cherry',
    });
    expect(keys()).toEqual(['Down', 'Down', 'Enter', 'Down', 'Down', 'Enter', 'Enter']);
    expect(argvs.filter((argv) => argv[0] === 'send-keys')).toEqual([
      ['send-keys', '-t', TARGET, 'Down'],
      ['send-keys', '-t', TARGET, 'Down'],
      ['send-keys', '-t', TARGET, 'Enter'],
      ['send-keys', '-t', TARGET, 'Down'],
      ['send-keys', '-t', TARGET, 'Down'],
      ['send-keys', '-t', TARGET, 'Enter'],
      ['send-keys', '-t', TARGET, 'Enter'],
    ]);
    // Read before every key and after every one of them: nine captures for
    // seven keys, and never two keys in a row on one reading.
    expect(argvs.filter((argv) => argv[0] === 'capture-pane')).toHaveLength(8);
  });

  it('reads the answer back off the CLI own review rather than off its own intent', async () => {
    // The review names both questions and both answers. A review that does not
    // name one of them is not committed, however well the walk went.
    const short = REVIEW.replace('→ Cherry', '→ Apple');
    const { run, keys } = runner([...REAL.slice(0, 6), short]);
    expect(await answerQuestion(run, ATLAS, SET)).toEqual({
      kind: 'unconfirmed',
      label: 'Cherry',
      // Question one is not in doubt: the CLI advanced past it, which is the
      // proof `committed` is built on. Only the last step is unconfirmed.
      committed: ['Emerald'],
    });
    // Two answers went in, and the commit did not.
    expect(keys().filter((key) => key === 'Enter')).toHaveLength(2);
  });
});

describe('the check that makes a loop no more dangerous than one question', () => {
  /**
   * THE FALSIFICATION FIXTURE. The CLI does not advance -- a stalled redraw, a
   * screen vam caught mid-flight -- and question one is still up. Its second
   * option is `Cobalt`, and so is question two's.
   *
   * A loop that trusted the advance would match `Cobalt` against the screen in
   * front of it, walk two rows and press Return on QUESTION ONE, then report
   * that the operator's fruit had been sent.
   */
  it('refuses when the CLI has not advanced, even though the label is on that screen', async () => {
    const stalled = [
      COLOUR_ASKED,
      COLOUR_ON(2),
      COLOUR_ON(3),
      // Return pressed, and the screen is still question one.
      COLOUR_ASKED,
      // Everything a loop that trusted the advance would need to go on: the
      // probe arrow lands on Cobalt, which is question one's second option and
      // the operator's answer to question TWO.
      COLOUR_ON(2),
      REVIEW,
      RESOLVED,
    ];
    const { run, keys } = runner(stalled);
    expect(await answerQuestion(run, ATLAS, { steps: [COLOUR, FRUIT_COBALT] })).toEqual({
      kind: 'wrong-question',
      question: 'Which fruit do you prefer?',
      // AND NOTHING IS CLAIMED AS DELIVERED. The screen is still question one,
      // so the Return vam pressed is not proven to have gone in -- `committed`
      // counts what the CLI advanced past, never what vam pressed.
    });
    /**
     * ONE Return, and the second one is what the check exists to prevent.
     *
     * MEASURED, by disabling the check and re-running this test: it came back
     * `{ kind: 'unconfirmed', label: 'Cobalt' }`. That outcome is only
     * reachable from the tail, which a single-select step only reaches by
     * pressing Return -- so the loop walked QUESTION ONE's picker onto Cobalt
     * and answered it, with a label belonging to question two, in a question
     * the operator had already answered. The single thing that stopped it
     * reporting success was the review screen not naming Cobalt; on a set
     * where it did, that answer would have been delivered and called sent.
     *
     * The fixture carries the screens that let a trusting loop get that far on
     * purpose. Without them the walk merely runs out of pane, and the test
     * would redden for a reason that proves nothing.
     */
    expect(keys().filter((key) => key === 'Enter')).toHaveLength(1);
  });

  it('will not answer a screen that is merely TALKING about the question', async () => {
    // The committed screen echoes every question of the set and its answer, so
    // "is this question on the screen" is true of it. It is not being asked
    // there: it is named under the rows, or with no rows at all, and either way
    // vam has nothing to answer. This is why the check is positional.
    const { run, keys } = runner([...REAL.slice(0, 3), RESOLVED]);
    expect(await answerQuestion(run, ATLAS, SET)).toEqual({ kind: 'no-picker' });
    expect(keys().filter((key) => key === 'Enter')).toHaveLength(1);
  });

  it('will not answer the review screen, which names every question of the set', async () => {
    // Without the positional rule this is the dangerous one: the review names
    // question two, so vam would look for the operator's fruit among `Submit
    // answers` and `Cancel` -- a real picker, on a real screen, that this step
    // has no business touching.
    const { run, keys } = runner([...REAL.slice(0, 3), REVIEW]);
    expect(await answerQuestion(run, ATLAS, SET)).toEqual({
      kind: 'wrong-question',
      question: 'Which fruit do you prefer?',
    });
    expect(keys().filter((key) => key === 'Enter')).toHaveLength(1);
  });

  it('re-checks the question after every arrow, not once per step', async () => {
    // The screen becomes question two in the middle of walking question one.
    // The cursor moved, so the probe is satisfied; the question did not stay.
    const { run, keys } = runner([COLOUR_ASKED, COLOUR_ON(2), FRUIT_ON(3)]);
    expect(await answerQuestion(run, ATLAS, SET)).toEqual({
      kind: 'wrong-question',
      question: 'Which colour do you prefer?',
    });
    expect(keys()).toEqual(['Down', 'Down']);
  });

  it('refuses a label that is not on the screen for the step it belongs to', async () => {
    const missing: AnswerStep = { ...FRUIT, labels: ['Emerald'] };
    const { run, keys } = runner([...REAL.slice(0, 4)]);
    expect(await answerQuestion(run, ATLAS, { steps: [COLOUR, missing] })).toEqual({
      kind: 'unmatched',
      label: 'Emerald',
      // The screen is question two's, so question one went in.
      committed: ['Emerald'],
    });
    // Emerald IS on question one's screen. It is not on question two's, and
    // that is the screen this step is answered against.
    expect(keys().filter((key) => key === 'Enter')).toHaveLength(1);
  });
});

describe('the tail, and what the word sent is allowed to mean', () => {
  it('will not call a set sent on a screen that never showed the review', async () => {
    // A set of several questions ends on the review -- measured. A screen with
    // no picker at all in its place is not a confirmation.
    const { run } = runner([...REAL.slice(0, 6), RESOLVED]);
    expect(await answerQuestion(run, ATLAS, SET)).toEqual({
      kind: 'unconfirmed',
      label: 'Cherry',
      // Question one is not in doubt: the CLI advanced past it, which is the
      // proof `committed` is built on. Only the last step is unconfirmed.
      committed: ['Emerald'],
    });
  });

  it('will not press Return on a review whose cursor is not on Submit', async () => {
    const cancel = REVIEW.replace(
      '❯ 1. Submit answers\n  2. Cancel',
      '  1. Submit answers\n❯ 2. Cancel',
    );
    const { run, keys } = runner([...REAL.slice(0, 6), cancel]);
    expect(await answerQuestion(run, ATLAS, SET)).toEqual({
      kind: 'unconfirmed',
      label: 'Cherry',
      // Question one is not in doubt: the CLI advanced past it, which is the
      // proof `committed` is built on. Only the last step is unconfirmed.
      committed: ['Emerald'],
    });
    expect(keys().filter((key) => key === 'Enter')).toHaveLength(2);
  });

  it('reports the review still standing after the commit rather than calling it sent', async () => {
    const { run } = runner([...REAL.slice(0, 7), REVIEW]);
    expect(await answerQuestion(run, ATLAS, SET)).toEqual({
      kind: 'unconfirmed',
      label: 'Cherry',
      // BOTH, here: the review named both answers back before vam pressed
      // Return on it, so the picker has taken the whole set in and a retry
      // must re-send none of it. What is unconfirmed is the commit.
      committed: ['Emerald', 'Cherry'],
    });
  });
});

/**
 * HOW FAR THE SET GOT, carried on the refusal itself.
 *
 * Every `return` in the loop was a whole-request failure, and the renderer
 * drew all of them as "not sent". For a set of one that is true. For a set of
 * two it denies an answer that is already inside the running agent -- and
 * `shared/answer.ts` said so in words: "every one but `sent` means the picker
 * was left as it was found".
 */
describe('a refusal after part of the set has been committed', () => {
  /** A runner whose send-keys start failing from the `nth` one on. */
  function failing(captures: readonly string[], nth: number) {
    const argvs: (readonly string[])[] = [];
    const queue = [...captures];
    let sends = 0;
    const run: TmuxRun = async (argv) => {
      argvs.push(argv);
      if (argv[0] === 'list-sessions') return ok(`${ATLAS}\t${NAME}\n`);
      if (argv[0] === 'capture-pane') return ok(queue.shift() ?? '');
      sends += 1;
      return sends >= nth
        ? { failure: { message: 'tmux failed' }, stdout: '', stderr: "can't find pane" }
        : ok('');
    };
    return { run, argvs };
  }

  it('names the answer question one already committed, and does not deny it', async () => {
    // Three keys go in for question one -- probe, walk, Return -- and the
    // Return ANSWERS it. The probe arrow for question two is the fourth, and
    // tmux refuses it: the session ended in between.
    const { run } = failing(REAL, 4);
    expect(await answerQuestion(run, ATLAS, SET)).toEqual({
      kind: 'refused',
      committed: ['Emerald'],
    });
  });

  it('carries nothing for a set that failed before anything was committed', async () => {
    // The very first probe arrow fails. Nothing was pressed on a row, so
    // there is no partial answer to report -- and the field is absent rather
    // than an empty list, so "nothing was sent" stays the honest wording.
    const { run } = failing(REAL, 1);
    expect(await answerQuestion(run, ATLAS, SET)).toEqual({ kind: 'refused' });
  });
});
