// @vitest-environment happy-dom

/**
 * A Submit click never ends silently: a rejected answer and every stop kind
 * are drawn, in the waiting ink, inside a live region.
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

const mark = () => fireEvent.click(all('[data-question-option]')[0] as HTMLElement);

describe('a rejected answer is drawn, not swallowed', () => {
  it('shows a failure message, re-enables Submit, and a second click sends again', async () => {
    const answer = vi.fn((_p: string, _r: AnswerRequest, _row?: string) =>
      Promise.reject(new Error('ipc closed')),
    );
    draw(QUESTION, { answer });
    mark();
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-refusal]')).not.toBeNull());
    expect(q('[data-question-refusal]')?.textContent).toBe(
      'not sent — vam could not reach the session. Press Submit to try again.',
    );
    expect(q('[data-question-refusal]')?.getAttribute('role')).toBe('alert');
    expect(text()).not.toContain('ipc closed');
    await waitFor(() => expect(submit()?.disabled).toBe(false));
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
  });

  it('a rejected resend clears the previous stop outcome', async () => {
    const answer = vi
      .fn((_p: string, _r: AnswerRequest, _row?: string) =>
        Promise.resolve<AnswerResult>({ kind: 'unconfirmed', label: 'Crimson' }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve<AnswerResult>({ kind: 'unconfirmed', label: 'Crimson' }),
      )
      .mockImplementationOnce(() => Promise.reject(new Error('ipc closed')));
    draw(QUESTION, { answer });
    mark();
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
    expect(q('[data-question-outcome]')?.getAttribute('role')).toBe('alert');
    const stale = q('[data-question-outcome]')?.textContent ?? '';
    expect(stale).not.toBe('');
    await waitFor(() => expect(submit()?.disabled).toBe(false));
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-refusal]')).not.toBeNull());
    expect(q('[data-question-refusal]')?.textContent).toBe(
      'not sent — vam could not reach the session. Press Submit to try again.',
    );
    expect(q('[data-question-outcome]')).toBeNull();
    expect(text()).not.toContain(stale);
    expect(all('[role="alert"]')).toHaveLength(1);
    await waitFor(() => expect(submit()?.disabled).toBe(false));
  });
});

const STOPS: AnswerResult[] = [
  { kind: 'unaimed' },
  { kind: 'unavailable' },
  { kind: 'mispaired' },
  { kind: 'refused' },
  { kind: 'unreadable' },
  { kind: 'no-picker' },
  { kind: 'not-live' },
  { kind: 'unmatched', label: 'Crimson' },
  { kind: 'wrong-question', question: 'Which colour do you prefer?' },
  { kind: 'unconfirmed', label: 'Crimson' },
  { kind: 'refused', committed: ['Crimson'] },
];

// Exhaustive over `AnswerResult['kind']`: a new kind fails the compile here.
const KINDS: Record<AnswerResult['kind'], true> = {
  sent: true,
  unaimed: true,
  unavailable: true,
  mispaired: true,
  refused: true,
  unreadable: true,
  'no-picker': true,
  'not-live': true,
  unmatched: true,
  'wrong-question': true,
  unconfirmed: true,
};
const KIND_LIST: AnswerResult['kind'][] = Object.keys(KINDS) as AnswerResult['kind'][];

describe('a stop outcome is waiting ink in an alert', () => {
  it('covers every kind the type has', () => {
    const covered = new Set(STOPS.map((one) => one.kind));
    for (const kind of KIND_LIST) if (kind !== 'sent') expect(covered.has(kind), kind).toBe(true);
  });

  for (const [index, result] of STOPS.entries()) {
    it(`draws stop #${index} (${result.kind}) with text-waiting and role=alert`, async () => {
      draw(QUESTION, { answer: answering(result) });
      mark();
      fireEvent.click(submit() as HTMLElement);
      await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
      const outcome = q('[data-question-outcome]') as HTMLElement;
      expect(outcome.className).toContain('text-waiting');
      expect(outcome.className).not.toContain('text-ink-dim');
      expect(outcome.getAttribute('role')).toBe('alert');
    });
  }

  it('keeps a sent outcome in dim ink with a polite status role', async () => {
    draw(QUESTION, { answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    mark();
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
    const outcome = q('[data-question-outcome]') as HTMLElement;
    expect(outcome.className).toContain('text-ink-dim');
    expect(outcome.getAttribute('role')).toBe('status');
  });
});
