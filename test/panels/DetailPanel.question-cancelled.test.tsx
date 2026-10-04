// @vitest-environment happy-dom

/** EC-9: a question closed by an is_error tool_result reads as cancelled. */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';

const ask = (over: Partial<AgentQuestion>): AgentQuestion => ({
  id: 'toolu_1:0',
  header: null,
  question: 'Which colour do you prefer?',
  multiSelect: false,
  options: [
    { label: 'Crimson', description: null },
    { label: 'Cobalt', description: null },
  ],
  answer: null,
  ...over,
});

function draw(questions: AgentQuestion[]) {
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
    questions,
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
    />,
  );
}

const text = () => document.querySelector('[data-question]')?.textContent ?? '';

afterEach(cleanup);

describe('a cancelled question', () => {
  it('reads cancelled in place of resolved, and offers no Submit', () => {
    draw([ask({ answer: 'tool use rejected', cancelled: true })]);
    expect(text()).toContain('cancelled');
    expect(text()).not.toContain('resolved');
    expect(text()).not.toContain('tool use rejected');
    expect(document.querySelector('[data-question-cancelled]')).not.toBeNull();
    expect(document.querySelector('button[data-question-submit]')).toBeNull();
  });

  it('leaves an answered question reading resolved', () => {
    draw([ask({ answer: 'Cobalt' })]);
    expect(text()).toContain('resolved — Cobalt');
    expect(text()).not.toContain('cancelled');
    expect(document.querySelector('button[data-question-submit]')).toBeNull();
  });
});
