// @vitest-environment happy-dom

/**
 * EC-8: a question set older than the newest one is never submittable, in the
 * live card, the phone inline card or the transcript.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';
import type { AnswerRequest, AnswerResult } from '../../src/shared/answer.js';

const SET_A: AgentQuestion = {
  id: 'toolu_a:0',
  header: null,
  question: 'Old orphan question?',
  multiSelect: false,
  options: [
    { label: 'Crimson', description: null },
    { label: 'Cobalt', description: null },
  ],
  answer: null,
};
const SET_B: AgentQuestion = {
  id: 'toolu_b:0',
  header: null,
  question: 'Newer answered question?',
  multiSelect: false,
  options: [{ label: 'Yes', description: null }],
  answer: 'Yes',
};

function draw(phone: boolean) {
  const answer = vi.fn((_p: string, _r: AnswerRequest, _row?: string) =>
    Promise.resolve<AnswerResult>({ kind: 'sent', answer: 'Cobalt' }),
  );
  const session: Session = {
    vamControlled: true,
    id: 's1',
    title: 'Colour study',
    epic: null,
    branch: null,
    status: 'waiting',
    runningAgents: 0,
    activity: null,
    age: '3m',
    decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
    questions: [SET_A, SET_B],
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
      phone={phone}
      answer={answer}
    />,
  );
  return answer;
}

afterEach(cleanup);

describe.each([false, true])('orphan set, phone=%s', (phone) => {
  it('draws the newer set closed and never the older one as a card', () => {
    draw(phone);
    const text = document.body.textContent ?? '';
    expect(text).toContain('resolved — Yes');
    expect(text).not.toContain('Old orphan question?');
    expect(document.querySelector('button[data-question-submit]')).toBeNull();
    expect(document.querySelectorAll('[data-question-option]').length).toBe(0);
  });

  it('calls answer zero times on Enter', () => {
    const answer = draw(phone);
    const target =
      document.querySelector('[data-question]') ?? (document.body as HTMLElement | null);
    fireEvent.keyDown(target as Element, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(answer).not.toHaveBeenCalled();
  });
});
