/**
 * THE OPERATOR'S OWN REPORT, reproduced: Submit refused a real `AskUserQuestion`
 * with `wrong-question`, naming the very question the screen WAS showing.
 *
 * ROOT CAUSE, MEASURED (`lesson-screens.ts` has the full account): `see`
 * matched `step.question` against ONE LINE at a time
 * (`lines.findIndex((line) => line.includes(step.question))`), and a pane
 * narrower than the question wraps it across two -- no single line then
 * contains it, whole. vam resizes a session's pane to the Terminal tab's own
 * measured width only once that tab is opened; a question answered purely
 * from the Response view can be sitting at whatever width the pane was last
 * left, which a narrow window or the phone view reaches easily. The picker
 * itself is untouched by the wrap: the same rows, the same cursor, the same
 * options `readPicker` already reads correctly -- only the per-line question
 * check was fooled by it.
 */

import { describe, expect, it } from 'vitest';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { answerQuestion } from '../../../src/main/terminal/answer.js';
import type { AnswerStep } from '../../../src/shared/answer.js';
import { LESSON_ASKED, LESSON_ON_2, LESSON_RESOLVED } from './lesson-screens.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });

const CODEX = 'claude-code:coordinator-b07ef4b1';
const NAME = 'vam-coordinator-b07ef4';
const TARGET = `=${NAME}:`;

function runner(captures: readonly string[]) {
  const queue = [...captures];
  const run: TmuxRun = async (argv) => {
    if (argv[0] === 'list-sessions') return ok(`${CODEX}\t\t${NAME}\n`);
    if (argv.includes('capture-pane')) return ok(queue.shift() ?? '');
    return ok('');
  };
  return run;
}

const LESSON: AnswerStep = {
  question: 'Xử lý lesson-raised-b07ef4b15fc4 thế nào?',
  labels: ['Sửa rồi approve'],
  multiSelect: false,
};

describe('a question wrapped by a narrow pane', () => {
  it('is still recognised, not refused as the wrong question', async () => {
    const run = runner([LESSON_ASKED, LESSON_ON_2, LESSON_RESOLVED]);
    const result = await answerQuestion(run, CODEX, { steps: [LESSON] });
    expect(result).toEqual({ kind: 'sent', answer: 'Sửa rồi approve' });
  });

  it('still refuses a question that really is not on screen', async () => {
    const otherStep: AnswerStep = {
      question: 'This text never appears on the lesson screen at all.',
      labels: ['Sửa rồi approve'],
      multiSelect: false,
    };
    const run = runner([LESSON_ASKED]);
    const result = await answerQuestion(run, CODEX, { steps: [otherStep] });
    expect(result).toEqual({
      kind: 'wrong-question',
      question: 'This text never appears on the lesson screen at all.',
    });
  });
});
