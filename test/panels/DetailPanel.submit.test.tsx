// @vitest-environment happy-dom

/**
 * The Submit at the bottom of the question card -- the control that answers
 * the agent, and the wording that has to stay true either side of it.
 *
 * A pick was only ever a MARK, and the card said so in words. That sentence is
 * still true of picking: Submit is the thing that sends, so the note now says
 * the mark stands until Submit rather than that nothing can ever go back.
 *
 * WHERE DELIVERY IS NOT REAL THERE IS NO BUTTON. A Submit drawn over a source
 * vam cannot write to is a control that lies about what it will do, and the
 * old sentence is exactly right for that case -- so it stays, unchanged.
 *
 * Nothing here talks to tmux: the bridge is a fake, and what the card claims
 * afterwards is asserted against what that fake answered.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
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

const SESSION: Session = {
  // vam started this one, which is what lets it press a key in the pane at
  // all -- and what Submit is drawn on.
  vamControlled: true,
  id: 's1',
  title: 'Colour study',
  icon: null,
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '3m',
  decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
};

function draw(
  question: AgentQuestion,
  over: Partial<DetailPanelProps> & { readonly entrySession?: Partial<Session> } = {},
) {
  const { entrySession, ...props } = over;
  const session: Session = { ...SESSION, questions: [question], ...entrySession };
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

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const text = () => document.body.textContent ?? '';
const submit = () => q('[data-question-submit]') as HTMLButtonElement | null;
/** A fake bridge, typed as the real member is so the calls can be read back. */
const answering = (result: AnswerResult) =>
  vi.fn((_projectId: string, _request: AnswerRequest, _rowId?: string) => Promise.resolve(result));

afterEach(cleanup);

describe('Submit is offered only where delivery is real', () => {
  it('draws no Submit at all when the source does not deliver prompts', () => {
    draw(QUESTION, { delivers: false });
    expect(submit()).toBeNull();
    // And the old sentence is still the true one here.
    expect(text()).toContain('vam cannot answer this for you');
  });

  it('draws no Submit when the source says nothing about delivering', () => {
    draw(QUESTION, { delivers: undefined });
    expect(submit()).toBeNull();
  });

  it('draws no Submit for a session vam did not start', () => {
    // `vamControlled` is the necessary fact: vam can press a key only in a
    // pane it started, because no process may take over another's controlling
    // TTY. The mode row over this same pane already tests it and disappears;
    // Submit was drawn, enabled, and could only ever refuse.
    draw(QUESTION, {
      answer: answering({ kind: 'unaimed' }),
      entrySession: { vamControlled: false },
    });
    expect(submit()).toBeNull();
  });

  it('draws no Submit when nothing said whether vam started the session', () => {
    // Absent is "nobody established this", not a fact to draw a write control
    // on -- the same reading the mode row takes.
    draw(QUESTION, {
      answer: answering({ kind: 'unaimed' }),
      entrySession: { vamControlled: undefined },
    });
    expect(submit()).toBeNull();
  });

  it('draws no Submit when there is no answer bridge, rather than one that cannot send', () => {
    draw(QUESTION, { delivers: true, answer: undefined });
    expect(submit()).toBeNull();
  });

  it('draws Submit at the bottom of the card when delivery is real', () => {
    draw(QUESTION, { answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    expect(submit()).not.toBeNull();
    // The mark-only sentence is kept true rather than dropped: picking still
    // sends nothing, and Submit is what does.
    expect(text()).toContain('a pick is only a mark until you press Submit');
    expect(text()).not.toContain('vam cannot answer this for you');
  });

  it('draws no Submit on a question that has already been answered', () => {
    draw({ ...QUESTION, answer: 'Crimson' }, { answer: answering({ kind: 'unaimed' }) });
    expect(submit()).toBeNull();
  });
});

describe('what Submit sends, and what it says afterwards', () => {
  it('will not send with nothing picked', () => {
    const answer = answering({ kind: 'sent', answer: 'Crimson' });
    draw(QUESTION, { answer });
    expect(submit()?.disabled).toBe(true);
    fireEvent.click(submit() as HTMLElement);
    expect(answer).not.toHaveBeenCalled();
  });

  it('sends the picked LABELS, the tool multiSelect flag, and the row it is about', async () => {
    const answer = answering({ kind: 'sent', answer: 'Cobalt' });
    draw(QUESTION, { answer });
    fireEvent.click(all('[data-question-option]')[1] as HTMLElement);
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    // By value: the project, the labels the operator marked, and the session
    // id -- which is what makes the pairing per session rather than per
    // project on the other side.
    expect(answer.mock.calls[0]).toEqual([
      'p1',
      {
        steps: [
          { question: 'Which colour do you prefer?', labels: ['Cobalt'], multiSelect: false },
        ],
      },
      's1',
    ]);
  });

  it('carries every mark of a multi-select question, in the order they are drawn', async () => {
    const answer = answering({ kind: 'sent', answer: 'Crimson, Cobalt' });
    draw({ ...QUESTION, multiSelect: true }, { answer });
    fireEvent.click(all('[data-question-option]')[1] as HTMLElement);
    fireEvent.click(all('[data-question-option]')[0] as HTMLElement);
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(answer.mock.calls[0]?.[1]).toEqual({
      steps: [
        {
          question: 'Which colour do you prefer?',
          labels: ['Crimson', 'Cobalt'],
          multiSelect: true,
        },
      ],
    });
  });

  it('says sent only for a confirmed read-back, and names what the picker read', async () => {
    draw(QUESTION, { answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    fireEvent.click(all('[data-question-option]')[0] as HTMLElement);
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
    expect(q('[data-question-outcome]')?.getAttribute('data-outcome')).toBe('sent');
    expect(text()).toContain('the picker now reads Crimson');
  });

  it('reports the read-back that disagreed rather than calling it sent', async () => {
    draw(QUESTION, { answer: answering({ kind: 'unconfirmed', label: 'Crimson' }) });
    fireEvent.click(all('[data-question-option]')[0] as HTMLElement);
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
    expect(q('[data-question-outcome]')?.getAttribute('data-outcome')).toBe('unconfirmed');
    expect(text()).toContain('does not agree');
    expect(text()).not.toContain('the picker now reads');
  });

  it('gives each refusal its own sentence, because they send a person elsewhere', async () => {
    const said = async (result: AnswerResult) => {
      cleanup();
      draw(QUESTION, { answer: answering(result) });
      fireEvent.click(all('[data-question-option]')[0] as HTMLElement);
      fireEvent.click(submit() as HTMLElement);
      await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
      return text();
    };
    expect(await said({ kind: 'unaimed' })).toContain('could not name one session of its own');
    expect(await said({ kind: 'refused' })).toContain('tmux would not deliver');
    expect(await said({ kind: 'unreadable' })).toContain('could not read the screen');
    expect(await said({ kind: 'no-picker' })).toContain('not on the screen');
    expect(await said({ kind: 'not-live' })).toContain('did not answer the probe arrow');
    expect(await said({ kind: 'unmatched', label: 'Viridian' })).toContain('Viridian');
  });

  it('does not name a pairing failure for a tmux vam could not reach', async () => {
    draw(QUESTION, { answer: answering({ kind: 'unavailable' }) });
    fireEvent.click(all('[data-question-option]')[0] as HTMLElement);
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
    expect(text()).toContain('could not ask tmux');
    // The sentence it used to draw. vam never looked, so it cannot report
    // what it would have found.
    expect(text()).not.toContain('could not name one session of its own');
  });

  it('does not say vam could not NAME a session for a pane it named and refused', async () => {
    draw(QUESTION, { answer: answering({ kind: 'mispaired' }) });
    fireEvent.click(all('[data-question-option]')[0] as HTMLElement);
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
    expect(text()).toContain('pane vam cannot use for this project');
    expect(text()).not.toContain('could not name one session of its own');
  });

  it('says nothing about the outcome before Submit is pressed', () => {
    draw(QUESTION, { answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    fireEvent.click(all('[data-question-option]')[0] as HTMLElement);
    expect(q('[data-question-outcome]')).toBeNull();
  });
});
