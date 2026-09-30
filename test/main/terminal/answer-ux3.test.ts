/**
 * Does the main-process walk refuse a well-formed desktop answer (EC-3)? One
 * screen per case (`answer-ux3-screens.ts`), driven through `answerQuestion`
 * with the request the card builds -- the recorded question text and the
 * recorded option labels -- and a table of case -> kind printed at the end.
 * A case that stops is a proven cause; a case that sends refutes its cause.
 * The second half is the safety side: a screen that fails verification never
 * receives a key past the last verified one.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { answerQuestion } from '../../../src/main/terminal/answer.js';
import type { AnswerRequest, AnswerResult, AnswerStep } from '../../../src/shared/answer.js';
import { COLOUR_ON } from './answer-live-screens.js';
import {
  cursorOn,
  DESCRIBED,
  LABEL_Q,
  LABEL_WRAPPED,
  LONG_LABEL,
  MULTI_Q,
  multi,
  RESOLVED,
  review,
  SINGLE,
  SINGLE_Q,
  SIZE,
  SIZE_Q,
  STEP2_OF_3,
  STEP2_Q,
  WRAPPED,
  WRAPPED_KEPT,
  WRAPPED_Q,
} from './answer-ux3-screens.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const ID = 'claude-code:atlas-11111111';
const NAME = 'vam-atlas-a1b2c3';

/** A fake tmux that records EVERY argv it is given, in order. */
function recorder(captures: readonly string[]) {
  const queue = [...captures];
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    if (argv[0] === 'list-sessions') return ok(`${ID}\t\t${NAME}\n`);
    if (argv.includes('capture-pane')) return ok(queue.shift() ?? '');
    return ok('');
  };
  return { run, keys: () => argvs.filter((a) => a[0] === 'send-keys').map((a) => a.slice(3)) };
}

/** The screens a single-select walk reads: the cursor on row 1, 2, ... `target`. */
const visits = (screen: string, target: number): string[] =>
  Array.from({ length: target }, (_, at) => cursorOn(screen, at + 1));
const downs = (n: number): string[] => Array.from({ length: n }, () => 'Down');
const one = (question: string, labels: string[], multiSelect = false): AnswerRequest => ({
  steps: [{ question, labels, multiSelect }],
});

const table: Record<string, string> = {};
const drive = async (name: string, captures: string[], request: AnswerRequest) => {
  const t = recorder(captures);
  const result: AnswerResult = await answerQuestion(t.run, ID, request);
  table[name] = result.kind;
  return { result, keys: t.keys() };
};
afterAll(() => console.table(table));

describe('EC-3a: a well-formed answer is delivered, case by case', () => {
  it('single question', async () => {
    const { result, keys } = await drive(
      'single question',
      [...visits(SINGLE, 2), RESOLVED],
      one(SINGLE_Q, ['Cobalt']),
    );
    expect(result.kind).toBe('sent');
    expect(keys).toEqual([['Down'], ['Enter']]);
  });

  it('multi-question set showing step 2 of 3', async () => {
    const steps: AnswerStep[] = [
      { question: SINGLE_Q, labels: ['Cobalt'], multiSelect: false },
      { question: STEP2_Q, labels: ['Cherry'], multiSelect: false },
      { question: SIZE_Q, labels: ['M'], multiSelect: false },
    ];
    const { result, keys } = await drive(
      'step 2 of 3',
      [
        ...visits(SINGLE, 2),
        ...visits(STEP2_OF_3, 3),
        ...visits(SIZE, 2),
        review([
          [SINGLE_Q, 'Cobalt'],
          [STEP2_Q, 'Cherry'],
          [SIZE_Q, 'M'],
        ]),
        RESOLVED,
      ],
      { steps },
    );
    expect(result.kind).toBe('sent');
    expect(keys.flat()).toEqual([
      ...downs(1),
      'Enter',
      ...downs(2),
      'Enter',
      ...downs(1),
      'Enter',
      'Enter',
    ]);
  });

  it('question wrapped over two rows, the space lost at the wrap', async () => {
    const { result, keys } = await drive(
      'wrapped question',
      [...visits(WRAPPED, 2), RESOLVED],
      one(WRAPPED_Q, ['Cobalt']),
    );
    expect(result.kind).toBe('sent');
    expect(keys).toEqual([['Down'], ['Enter']]);
  });

  it('question wrapped over two rows, the space kept at the wrap', async () => {
    const { result } = await drive(
      'wrapped question (space kept)',
      [...visits(WRAPPED_KEPT, 2), RESOLVED],
      one(WRAPPED_Q, ['Cobalt']),
    );
    expect(result.kind).toBe('sent');
  });

  it('option with a description', async () => {
    const { result, keys } = await drive(
      'described option',
      [DESCRIBED, COLOUR_ON(2), COLOUR_ON(3), RESOLVED],
      one(SINGLE_Q, ['Emerald']),
    );
    expect(result.kind).toBe('sent');
    expect(keys).toEqual([['Down'], ['Down'], ['Enter']]);
  });

  it('option label that wraps', async () => {
    const { result, keys } = await drive(
      'wrapped label',
      [...visits(LABEL_WRAPPED, 2), RESOLVED],
      one(LABEL_Q, ['Leave it alone']),
    );
    expect(result.kind).toBe('sent');
    expect(keys).toEqual([['Down'], ['Enter']]);
  });

  it('wrapped label as the chosen one', async () => {
    const { result, keys } = await drive(
      'wrapped label chosen',
      [
        ...visits(LABEL_WRAPPED, 1),
        cursorOn(LABEL_WRAPPED, 2),
        cursorOn(LABEL_WRAPPED, 1),
        RESOLVED,
      ],
      one(LABEL_Q, [LONG_LABEL]),
    );
    expect(result.kind).toBe('sent');
    expect(keys).toEqual([['Down'], ['Down'], ['Enter']]);
  });

  it('multiSelect set', async () => {
    const { result, keys } = await drive(
      'multiSelect',
      [
        multi(1, []),
        multi(2, []),
        multi(2, [2]),
        multi(3, [2]),
        multi(3, [2, 3]),
        review([[MULTI_Q, 'Banana, Cherry']]),
        RESOLVED,
      ],
      one(MULTI_Q, ['Banana', 'Cherry'], true),
    );
    expect(result.kind).toBe('sent');
    expect(keys.flat()).toEqual(['Down', 'Enter', 'Down', 'Enter', 'Right', 'Enter']);
  });
});

describe('EC-3b: a screen that fails verification receives no key past the last verified one', () => {
  const FRUIT_STEP: AnswerStep = { question: STEP2_Q, labels: ['Cherry'], multiSelect: false };

  it('first read shows another question: no key of any kind', async () => {
    const t = recorder([SINGLE]);
    const result = await answerQuestion(t.run, ID, { steps: [FRUIT_STEP] });
    expect(result).toEqual({ kind: 'wrong-question', question: STEP2_Q });
    expect(t.keys()).toEqual([]);
  });

  it('first read shows a picker without the label: no key of any kind', async () => {
    const t = recorder([SINGLE]);
    const result = await answerQuestion(t.run, ID, one(SINGLE_Q, ['Magenta']));
    expect(result).toEqual({ kind: 'unmatched', label: 'Magenta' });
    expect(t.keys()).toEqual([]);
  });

  it('a question differing by more than whitespace is still another question', async () => {
    const t = recorder([WRAPPED]);
    const other = 'Which colour do you prefer for the footer?';
    const result = await answerQuestion(t.run, ID, one(other, ['Cobalt']));
    expect(result).toEqual({ kind: 'wrong-question', question: other });
    expect(t.keys()).toEqual([]);
  });

  it('a label that is only part of a folded label is not that row', async () => {
    const t = recorder([LABEL_WRAPPED]);
    const result = await answerQuestion(t.run, ID, one(LABEL_Q, ['Rewrite the whole module from']));
    expect(result).toEqual({ kind: 'unmatched', label: 'Rewrite the whole module from' });
    expect(t.keys()).toEqual([]);
  });

  it('the screen after the probe Down is another question: the log ends at that Down', async () => {
    const t = recorder([SINGLE, STEP2_OF_3]);
    const result = await answerQuestion(t.run, ID, one(SINGLE_Q, ['Emerald']));
    expect(result).toEqual({ kind: 'wrong-question', question: SINGLE_Q });
    expect(t.keys()).toEqual([['Down']]);
  });

  it('the screen after a stepping Down is another question: no Enter follows', async () => {
    const t = recorder([...visits(SINGLE, 2), STEP2_OF_3]);
    const result = await answerQuestion(t.run, ID, one(SINGLE_Q, ['Emerald']));
    expect(result).toEqual({ kind: 'wrong-question', question: SINGLE_Q });
    expect(t.keys()).toEqual([['Down'], ['Down']]);
  });

  it('a multi-question walk stops at a wrong screen after its own stepping Down', async () => {
    const t = recorder([...visits(SINGLE, 2), ...visits(STEP2_OF_3, 2), SINGLE]);
    const result = await answerQuestion(t.run, ID, {
      steps: [{ question: SINGLE_Q, labels: ['Cobalt'], multiSelect: false }, FRUIT_STEP],
    });
    expect(result).toEqual({
      kind: 'wrong-question',
      question: STEP2_Q,
      committed: ['Cobalt'],
    });
    expect(t.keys()).toEqual([['Down'], ['Enter'], ['Down'], ['Down']]);
  });
  it('a fold onto an unindented row is not part of the label', async () => {
    const screen = LABEL_WRAPPED.replace('     from scratch', 'from scratch');
    const t = recorder([screen]);
    const result = await answerQuestion(t.run, ID, one(LABEL_Q, [LONG_LABEL]));
    expect(result).toEqual({ kind: 'unmatched', label: LONG_LABEL });
    expect(t.keys()).toEqual([]);
  });

  it('a fold that reads to a different label is not the asked label', async () => {
    const t = recorder([LABEL_WRAPPED]);
    const other = 'Rewrite the whole module from nothing';
    const result = await answerQuestion(t.run, ID, one(LABEL_Q, [other]));
    expect(result).toEqual({ kind: 'unmatched', label: other });
    expect(t.keys()).toEqual([]);
  });
});

describe('a label folded over three rows', () => {
  const THREE = LABEL_WRAPPED.replace('     from scratch', '     from\n     scratch');
  it('is matched and delivered', async () => {
    const t = recorder([...visits(THREE, 1), cursorOn(THREE, 2), cursorOn(THREE, 1), RESOLVED]);
    const result = await answerQuestion(t.run, ID, one(LABEL_Q, [LONG_LABEL]));
    expect(result.kind).toBe('sent');
    expect(t.keys()).toEqual([['Down'], ['Down'], ['Enter']]);
  });
});
