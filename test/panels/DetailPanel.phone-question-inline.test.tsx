// @vitest-environment happy-dom

/**
 * Spec step 3 (docs/design/phone-core-loop.md §3.2-3.3): the pending
 * question moves from `DetailPanel`'s fixed footer block into the
 * transcript's own scroller, as the newest item — on PHONE ONLY. Desktop
 * keeps the fixed block exactly as it always drew it.
 *
 * `QuestionCard`'s own internals (state, handlers, `AnswerRequest`
 * construction) are asserted UNCHANGED by AC-6: the same tap sequence on the
 * phone-inline card and the desktop fixed card must produce the identical
 * object `onAnswer` is called with.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { AnswerRequest, AnswerResult } from '../../src/shared/answer.js';

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: 'Colours',
  question: 'Which colour do you prefer?',
  multiSelect: false,
  options: [
    { label: 'Crimson', description: null },
    { label: 'Cobalt', description: null },
  ],
  answer: null,
};

const PRIOR_TURN: Decision = {
  id: 'd1',
  label: 'plan',
  input: 'read the ticket',
  output: 'the ticket asks for a colour pick',
  commands: [],
};

const SESSION: Session = {
  id: 's1',
  title: 'Colour study',
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '3m',
  decisions: [PRIOR_TURN],
  vamControlled: true,
};

const answering = (result: AnswerResult) =>
  vi.fn((_projectId: string, _request: AnswerRequest, _rowId?: string) => Promise.resolve(result));

function draw(
  over: Partial<DetailPanelProps> = {},
  questions: readonly AgentQuestion[] = [QUESTION],
) {
  const session: Session = { ...SESSION, questions };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  render(
    <DetailPanel
      entry={entry}
      decision={PRIOR_TURN}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={390}
      resizeHandle={null}
      delivers
      {...over}
    />,
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const scroller = () => q('[data-detail-column]');

afterEach(cleanup);

describe('the inline question (phone)', () => {
  it('draws no fixed question-bar block, and an inline one instead', () => {
    draw({ phone: true });
    expect(q('[data-question-bar]')).toBeNull();
    expect(q('[data-question-bar-inline]')).not.toBeNull();
    expect(q('[data-question]')).not.toBeNull();
  });

  it('AC-1: the inline question and a prior turn share the SAME scroll container', () => {
    draw({ phone: true });
    const column = scroller();
    expect(column).not.toBeNull();
    expect(column?.textContent).toContain(PRIOR_TURN.output);
    expect(column?.querySelector('[data-question-option]')).not.toBeNull();
  });

  it('AC-2: the inline wrapper is not a flex-none sibling of the composer', () => {
    draw({ phone: true });
    const inline = q('[data-question-bar-inline]');
    expect(inline?.className).not.toContain('flex-none');
    // The composer stands down while the question is open (existing rule);
    // asserted here so a reader sees both halves of AC-2 in one place.
    expect(q('[data-composer-bar]')).toBeNull();
  });

  it('still draws the question when the session has no turns at all yet', () => {
    const session: Session = { ...SESSION, decisions: [], questions: [QUESTION] };
    const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
    const entry: SessionEntry = { project, session };
    render(
      <DetailPanel
        entry={entry}
        decision={null}
        draft=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        composing={false}
        onCompose={() => {}}
        onStopComposing={() => {}}
        active={false}
        actionIndex={0}
        width={390}
        resizeHandle={null}
        delivers
        phone
      />,
    );
    expect(q('[data-question-option]')).not.toBeNull();
  });
});

describe('desktop keeps the fixed question-bar block, unchanged', () => {
  it('draws the fixed block and no inline one', () => {
    draw({ phone: false, width: 700 });
    expect(q('[data-question-bar]')).not.toBeNull();
    expect(q('[data-question-bar-inline]')).toBeNull();
  });
});

describe('AC-6: the same tap sequence produces the identical AnswerRequest either way', () => {
  async function tapOptionTwoThenSubmit(phone: boolean) {
    const answer = answering({ kind: 'sent', answer: 'Cobalt' });
    draw({ phone, answer, width: phone ? 390 : 700 });
    const options = all('[data-question-option]');
    fireEvent.click(options[1] as Element, { detail: 1 });
    const submit = q('[data-question-submit]') as HTMLButtonElement;
    fireEvent.click(submit);
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    return answer.mock.calls[0]?.[1];
  }

  it('produces {steps:[{question, labels, multiSelect}]}, byte-identical on phone and desktop', async () => {
    const phoneRequest = await tapOptionTwoThenSubmit(true);
    cleanup();
    const desktopRequest = await tapOptionTwoThenSubmit(false);
    const expected = {
      steps: [{ question: 'Which colour do you prefer?', labels: ['Cobalt'], multiSelect: false }],
    };
    expect(phoneRequest).toEqual(expected);
    expect(desktopRequest).toEqual(expected);
    expect(phoneRequest).toEqual(desktopRequest);
  });
});
