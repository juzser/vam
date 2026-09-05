// @vitest-environment happy-dom

/**
 * The prompt vam READ OFF THE PANE, drawn as a question and answered as one.
 *
 * WHY IT REUSES THE CARD. The operator asked for every shape to be displayed
 * "with consistent keyboard shortcuts". A permission prompt drawn by a second
 * component with keys of its own would be the exact defect they named, so it
 * is turned into a question set and handed to `QuestionCard` -- one grammar,
 * one resolver, one Submit.
 *
 * WHAT MUST STAY TRUE IS THE HONESTY: vam may only read and answer a pane of a
 * session it STARTED, so no read is attempted at all for anything else, and a
 * row vam cannot drive keeps the waiting note and gets no control that would
 * refuse when pressed.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { AnswerRequest, PromptView } from '../../src/shared/answer.js';

const SESSION: Session = {
  id: 's1',
  title: 'Provider survey',
  icon: null,
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '3m',
  decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
};

const PROMPT: PromptView = {
  kind: 'prompt',
  prompt: {
    title: 'Do you want to proceed?',
    options: ['Yes', 'Yes, and do not ask again', 'No, and tell the agent what to do differently'],
  },
};

function draw(over: Partial<Session>, props: Partial<DetailPanelProps> = {}) {
  const session: Session = { ...SESSION, ...over };
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

const waiting = { waitingFor: 'permission prompt', questions: [] } as const;
const options = () => [...document.querySelectorAll('[data-question-option]')];
const labels = () => options().map((option) => option.textContent ?? '');

afterEach(cleanup);

describe('a prompt read off the pane', () => {
  it('draws the pane question in the same card the tool questions use', async () => {
    draw({ ...waiting, vamControlled: true }, { prompt: async () => PROMPT });
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(document.body.textContent).toContain('Do you want to proceed?');
    expect(labels()[0]).toContain('Yes');
    expect(labels()[2]).toContain('No, and tell the agent what to do differently');
  });

  it('sends the pane title back as the step question, which is the identity check', async () => {
    // `answerQuestion` re-reads the screen and matches this string on it
    // before it presses anything. Sending the label without the title would
    // hand the walk no way to tell it is still on the same screen.
    const asked: AnswerRequest[] = [];
    draw(
      { ...waiting, vamControlled: true },
      {
        prompt: async () => PROMPT,
        answer: async (_project, request) => {
          asked.push(request);
          return { kind: 'sent', answer: 'Yes' };
        },
      },
    );
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    const first = options()[0];
    if (!(first instanceof HTMLElement)) throw new Error('no option to pick');
    await act(async () => {
      first.click();
    });
    const submit = document.querySelector('[data-question-submit]');
    if (!(submit instanceof HTMLElement)) throw new Error('no submit to press');
    await act(async () => {
      submit.click();
    });
    expect(asked).toEqual([
      { steps: [{ question: 'Do you want to proceed?', labels: ['Yes'], multiSelect: false }] },
    ]);
  });

  it('never reads the pane of a session vam did not start', async () => {
    // THE OWNERSHIP GUARD, and it is `=== true` rather than truthy: absent
    // means vam could not establish control, which is not permission.
    const reads = vi.fn(async () => PROMPT);
    draw({ ...waiting, vamControlled: false }, { prompt: reads });
    await act(async () => {});
    expect(reads).not.toHaveBeenCalled();
    expect(options()).toEqual([]);
  });

  it('never reads the pane of a session vam could not ask tmux about', async () => {
    const reads = vi.fn(async () => PROMPT);
    draw({ ...waiting }, { prompt: reads });
    await act(async () => {});
    expect(reads).not.toHaveBeenCalled();
  });

  it('keeps the waiting note and draws no card when the pane holds no prompt', async () => {
    draw({ ...waiting, vamControlled: true }, { prompt: async () => ({ kind: 'none' }) });
    await act(async () => {});
    expect(options()).toEqual([]);
    expect(document.querySelector('[data-session-waiting]')).not.toBeNull();
  });

  it('lets a real tool question win over anything on the pane', async () => {
    // The transcript record is the better evidence: it carries the tool's own
    // multiSelect, its descriptions and its previews, none of which a screen
    // has. The pane read is the fallback for the shapes that have no record.
    const reads = vi.fn(async () => PROMPT);
    draw(
      {
        ...waiting,
        vamControlled: true,
        questions: [
          {
            id: 'tool-1:0',
            header: null,
            question: 'Which colour do you prefer?',
            multiSelect: false,
            options: [{ label: 'Crimson', description: null }],
            answer: null,
          },
        ],
      },
      { prompt: reads },
    );
    await act(async () => {});
    expect(document.body.textContent).toContain('Which colour do you prefer?');
    expect(document.body.textContent).not.toContain('Do you want to proceed?');
    expect(reads).not.toHaveBeenCalled();
  });
});
