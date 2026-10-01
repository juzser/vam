// @vitest-environment happy-dom

/** The card heads itself with the step the terminal is on (read through `prompt`). */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readPrompt } from '../../src/main/terminal/answer.js';
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

const COLOUR_Q = SINGLE_Q;

const ask = (index: number, text: string, labels: readonly string[]): AgentQuestion => ({
  id: `toolu_1:${index}`,
  header: null,
  question: text,
  multiSelect: false,
  options: labels.map((label) => ({ label, description: null })),
  answer: null,
});

const SET = [
  ask(0, COLOUR_Q, ['Crimson', 'Cobalt', 'Emerald']),
  ask(1, STEP2_Q, ['Apple', 'Cobalt', 'Cherry']),
  ask(2, SIZE_Q, ['S', 'M', 'L']),
];

const viewOf = (screen: string): PromptView => {
  const prompt = readPrompt(screen);
  if (prompt === null) throw new Error('fixture screen holds no prompt');
  return { kind: 'prompt', prompt };
};

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

const heading = () => document.querySelector('[data-question-text]')?.textContent;
const click = async (element: Element | null | undefined) => {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click');
  await act(async () => {
    element.click();
  });
};

afterEach(cleanup);

describe('the card follows the terminal step', () => {
  it('heads the card with Q2 when the pane picker asks Q2 of the same set', async () => {
    draw(SET, { prompt: async () => viewOf(STEP2_OF_3) });
    await waitFor(() => expect(heading()).toBe(STEP2_Q));
    expect(document.querySelector('[data-question-position]')?.textContent).toContain(
      'step 2 of 3',
    );
  });

  it('sends a first step whose question is Q2 after the card followed the pane', async () => {
    const asked: AnswerRequest[] = [];
    draw(SET, {
      prompt: async () => viewOf(STEP2_OF_3),
      answer: async (_project, request) => {
        asked.push(request);
        return { kind: 'sent', answer: 'ok' };
      },
    });
    await waitFor(() => expect(heading()).toBe(STEP2_Q));
    const tabs = [...document.querySelectorAll('[data-question-step]')];
    for (const tab of tabs) {
      await click(tab);
      await click(document.querySelector('[data-question-option]'));
    }
    await click(document.querySelector('[data-question-submit]'));
    expect(asked[0]?.steps[0]?.question).toBe(STEP2_Q);
    expect(asked[0]?.steps.map((step) => step.question)).toEqual([STEP2_Q, SIZE_Q]);
  });

  it('keeps the local step while the pane shows no picker of this set', async () => {
    draw(SET, { prompt: async () => ({ kind: 'none' }) });
    await act(async () => {});
    expect(heading()).toBe(COLOUR_Q);
    await click(document.querySelectorAll('[data-question-step]')[2]);
    expect(heading()).toBe(SIZE_Q);
  });

  it('keeps the local step when the pane picker is a different set', async () => {
    const other: PromptView = {
      kind: 'prompt',
      prompt: { title: 'Do you want to proceed?', options: ['Yes', 'No'] },
    };
    draw(SET, { prompt: async () => other });
    await act(async () => {});
    expect(heading()).toBe(COLOUR_Q);
  });

  it('lets the operator walk away from the pane step until the pane moves', async () => {
    let view = viewOf(STEP2_OF_3);
    const prompt = vi.fn(async () => view);
    draw(SET, { prompt });
    await waitFor(() => expect(heading()).toBe(STEP2_Q));
    await click(document.querySelectorAll('[data-question-step]')[0]);
    expect(heading()).toBe(COLOUR_Q);
    fireEvent.focus(window);
    await act(async () => {});
    expect(heading()).toBe(COLOUR_Q);
    view = viewOf(SIZE);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
    expect(heading()).toBe(SIZE_Q);
  }, 10000);

  it('draws a single recorded question byte for byte', async () => {
    draw([ask(0, COLOUR_Q, ['Crimson', 'Cobalt', 'Emerald'])], {
      prompt: async () => viewOf(SINGLE),
    });
    await act(async () => {});
    expect(heading()).toBe(COLOUR_Q);
  });
});
