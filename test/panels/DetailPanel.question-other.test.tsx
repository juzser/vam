// @vitest-environment happy-dom

/** The free-text row ("Type something."): Submit is off for the whole set while any step has it. */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { readPicker, readPrompt } from '../../src/main/terminal/answer.js';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { AnswerRequest, PromptView } from '../../src/shared/answer.js';
import {
  SINGLE,
  SINGLE_Q,
  SIZE,
  SIZE_Q,
  STEP2_OF_3,
  STEP2_Q,
} from '../main/terminal/answer-ux3-screens.js';

const ask = (index: number, text: string, labels: readonly string[]): AgentQuestion => ({
  id: `toolu_1:${index}`,
  header: null,
  question: text,
  multiSelect: false,
  options: labels.map((label) => ({ label, description: null })),
  answer: null,
});

function draw(questions: readonly AgentQuestion[], props: Partial<DetailPanelProps>) {
  const session: Session = {
    id: 's1',
    title: 'Study',
    epic: null,
    branch: null,
    status: 'waiting',
    runningAgents: 0,
    activity: null,
    age: '3m',
    waitingFor: 'question',
    vamControlled: true,
    questions,
    decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
  };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  render(
    <DetailPanel
      entry={entry}
      decision={session.decisions[0] ?? null}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      delivers
      {...props}
    />,
  );
}

/** The rows the CLI draws for a question, less the chat row the card draws apart. */
const rowsOf = (screen: string): string[] => {
  const picker = readPicker(screen);
  if (picker === null) throw new Error('fixture screen holds no picker');
  return picker.rows.map((row) => row.label).filter((label) => label !== 'Chat about this');
};
const FREE = 'Type something.';

/** A question whose listed options are the screen's rows before the free-text row. */
const askFrom = (index: number, text: string, screen: string): AgentQuestion => {
  const rows = rowsOf(screen);
  return ask(index, text, rows.slice(0, rows.indexOf(FREE)));
};

const click = async (element: Element | null | undefined) => {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click');
  await act(async () => {
    element.click();
  });
};
const tabs = () => [...document.querySelectorAll('[data-question-step]')];
const submit = () => document.querySelector<HTMLButtonElement>('button[data-question-submit]');
const note = () => document.querySelector('[data-question-terminal-note]');
const optionLabels = () =>
  [...document.querySelectorAll('[role="listbox"] [data-question-option]')].map(
    (option) => option.querySelector('[data-question-label]')?.textContent ?? '',
  );
/** Walk to step `at` and mark its option `row` (the free-text row when `free`). */
const mark = async (at: number, free: boolean) => {
  if (tabs().length > 1) await click(tabs()[at]);
  await click(
    document.querySelector(free ? '[data-question-free-text]' : '[data-question-option]'),
  );
};

const SET = [
  askFrom(0, SINGLE_Q, SINGLE),
  askFrom(1, STEP2_Q, STEP2_OF_3),
  askFrom(2, SIZE_Q, SIZE),
];

afterEach(cleanup);

describe('the free-text row', () => {
  it('is drawn after the listed options, as the terminal orders them', async () => {
    draw(SET, { prompt: async () => ({ kind: 'none' }) });
    await act(async () => {});
    const terminal = rowsOf(SINGLE);
    expect(terminal.at(-1)).toBe(FREE);
    expect(optionLabels().map((label) => label.trim())).toEqual(terminal);
  });
});

describe('free text chosen on any step turns Submit off for the whole set', () => {
  const answered = (asked: AnswerRequest[]) => ({
    prompt: async () => ({ kind: 'none' as const }),
    answer: async (_project: string, request: AnswerRequest) => {
      asked.push(request);
      return { kind: 'sent' as const, answer: 'ok' };
    },
  });

  for (const [name, free] of [
    ['the middle step', 1],
    ['the first step of a one-question set', 0],
    ['the last step', 2],
  ] as const) {
    it(`holds Submit and sends nothing when ${name} is on free text`, async () => {
      const asked: AnswerRequest[] = [];
      const set = name.includes('one-question') ? SET.slice(0, 1) : SET;
      draw(set, answered(asked));
      for (let at = 0; at < set.length; at += 1) await mark(at, at === free);
      expect(submit()?.disabled).toBe(true);
      expect(note()?.textContent).toContain('terminal');
      await click(submit());
      expect(asked).toHaveLength(0);
    });
  }

  it('turns Submit back on once every step is on a listed option, one AnswerStep per question', async () => {
    const asked: AnswerRequest[] = [];
    draw(SET, answered(asked));
    for (let at = 0; at < SET.length; at += 1) await mark(at, at === 1);
    expect(submit()?.disabled).toBe(true);
    await mark(1, false);
    expect(submit()?.disabled).toBe(false);
    expect(note()).toBeNull();
    await click(submit());
    expect(asked).toHaveLength(1);
    expect(asked[0]?.steps.map((step) => step.question)).toEqual([SINGLE_Q, STEP2_Q, SIZE_Q]);
  });
});

const listbox = () => document.querySelector('[role="listbox"]') as HTMLElement;
const freeRow = () => document.querySelector<HTMLElement>('[data-question-free-text]');
const asFree = () => freeRow()?.getAttribute('aria-selected');
describe('keyboard routes into the free-text row', () => {
  it('chooses it by its digit', async () => {
    draw(SET.slice(0, 1), { prompt: async () => ({ kind: 'none' }) });
    fireEvent.keyDown(listbox(), { key: String(optionLabels().length) });
    expect(asFree()).toBe('true');
  });

  it('chooses it with Enter and with Space when the cursor is on it', async () => {
    draw(SET.slice(0, 1), { prompt: async () => ({ kind: 'none' }) });
    freeRow()?.focus();
    fireEvent.keyDown(listbox(), { key: 'Enter' });
    expect(asFree()).toBe('true');
    fireEvent.keyDown(listbox(), { key: ' ' });
    expect(asFree()).toBe('false');
  });
});

describe('an Enter pick never auto-sends while another step is on free text', () => {
  it('holds the answer when a multi-select step keeps a mark and is on free text', async () => {
    const asked: AnswerRequest[] = [];
    const multi = { ...ask(1, 'Pick many', ['A', 'B']), multiSelect: true };
    const set = [ask(0, 'First', ['X', 'Y']), multi, ask(2, 'Third', ['P', 'Q'])];
    draw(set, {
      prompt: async () => ({ kind: 'none' }),
      answer: async (_project, request) => {
        asked.push(request);
        return { kind: 'sent', answer: 'ok' };
      },
    });
    await mark(0, false);
    await click(tabs()[1]);
    await click(document.querySelector('[data-question-option]'));
    await click(freeRow());
    await click(tabs()[2]);
    document.querySelectorAll<HTMLElement>('[data-question-option]')[0]?.focus();
    fireEvent.keyDown(listbox(), { key: 'Enter' });
    expect(asked).toHaveLength(0);
  });
});

describe('a free-text choice on a step the terminal has passed', () => {
  it('does not hold Submit once the pane has moved on to the later steps', async () => {
    const asked: AnswerRequest[] = [];
    const prompt = readPrompt(STEP2_OF_3);
    if (prompt === null) throw new Error('fixture screen holds no prompt');
    let view: PromptView = { kind: 'none' };
    draw(SET, {
      prompt: async () => view,
      answer: async (_project, request) => {
        asked.push(request);
        return { kind: 'sent', answer: 'ok' };
      },
    });
    await mark(0, true);
    view = { kind: 'prompt', prompt };
    await waitFor(
      () => expect(document.querySelector('[data-question-text]')?.textContent).toBe(STEP2_Q),
      { timeout: 5000 },
    );
    await mark(1, false);
    await mark(2, false);
    expect(submit()?.disabled).toBe(false);
    expect(note()).toBeNull();
    await click(submit());
    expect(asked[0]?.steps.map((step) => step.question)).toEqual([STEP2_Q, SIZE_Q]);
  }, 10000);
});
