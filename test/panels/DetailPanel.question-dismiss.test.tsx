// @vitest-environment happy-dom

/**
 * THE CARD STANDS DOWN WHEN IT HAS BEEN ANSWERED.
 *
 * Operator instruction: once an option choice has been picked and submitted,
 * the card has to go away. It did not. `open` was computed from the
 * TRANSCRIPT -- a step counts as open until the source reports an answer for
 * it -- so after a successful Submit the picker sat there, amber, with its
 * options live and its Submit enabled, until a poll came back and the
 * transcript had caught up. On the screen where this matters most it was also
 * eating half the viewport (`e2e/phone-shell.pw.ts`).
 *
 * WHY OPTIMISTIC IS THE RIGHT SHAPE HERE, and not a guess. `AnswerResult`
 * already distinguishes a delivery from a stop: `kind: 'sent'` is the source
 * saying it typed the answer into the session. Standing down on that is the
 * same bargain the composer makes for a prompt (`Canvas.tsx`'s optimistic
 * turn) -- the pane reacts to the act rather than to the round trip. Every
 * other outcome KEEPS the card, because every other outcome means the operator
 * still has something to do.
 *
 * AND IT SAYS WHAT HAPPENED. The card does not vanish whole: what stands down
 * is the PICKER -- the options, Submit, the note -- while the outcome line
 * stays. A control that disappears the instant it is pressed, saying nothing,
 * is indistinguishable from one that crashed.
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
const submit = () => q('[data-question-submit]') as HTMLButtonElement | null;
const answering = (result: AnswerResult) =>
  vi.fn((_projectId: string, _request: AnswerRequest, _rowId?: string) => Promise.resolve(result));

/** Pick the first option and press Submit. */
async function pickAndSend() {
  fireEvent.click(all('[data-question-option]')[0] as HTMLElement);
  fireEvent.click(submit() as HTMLElement);
}

afterEach(cleanup);

describe('the picker stands down once the answer is delivered', () => {
  it('takes the options and Submit off the screen', async () => {
    draw(QUESTION, { answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    expect(all('[data-question-option]').length).toBeGreaterThan(0);
    await pickAndSend();

    await waitFor(() => expect(submit()).toBeNull());
    expect(all('[data-question-option]')).toHaveLength(0);
    // The note is part of the picker: it explains how to answer, and there is
    // nothing left to answer.
    expect(q('[data-question-note]')).toBeNull();
  });

  it('still says what happened, so it is not a control that vanished', async () => {
    draw(QUESTION, { answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    await pickAndSend();

    const outcome = await waitFor(() => {
      const found = q('[data-question-outcome]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(outcome.textContent ?? '').not.toBe('');
  });

  /**
   * THE SESSION IS NO LONGER BLOCKED ON THE OPERATOR. `waiting` is `open` and
   * nothing narrower, on purpose -- amber means "blocked on you". Leaving it
   * amber after the answer went in would make a session that is working look
   * like one that is stuck, which is the most expensive thing this palette can
   * get wrong.
   */
  it('stops claiming the session is waiting on an answer', async () => {
    draw(QUESTION, { answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    await pickAndSend();
    await waitFor(() => expect(submit()).toBeNull());
    expect(q('[data-question]')?.getAttribute('data-question-waiting') ?? null).not.toBe('true');
  });
});

describe('every outcome that is NOT a delivery keeps the card', () => {
  /**
   * These are the cases where the operator still has something to do, so
   * taking the picker away would take away the only route to doing it. Each is
   * a real `AnswerStop` the bridge can answer with.
   */
  for (const result of [
    { kind: 'unaimed' },
    { kind: 'unconfirmed', label: 'Crimson' },
    { kind: 'wrong-question' },
  ] as const) {
    it(`keeps Submit on ${result.kind}`, async () => {
      draw(QUESTION, { answer: answering(result as AnswerResult) });
      await pickAndSend();
      await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
      expect(submit(), `${result.kind} took the picker away`).not.toBeNull();
      expect(all('[data-question-option]').length).toBeGreaterThan(0);
    });
  }
});

describe('a question the operator has not answered is untouched', () => {
  it('draws the picker as it always did before anything is sent', () => {
    draw(QUESTION, { answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    expect(submit()).not.toBeNull();
    expect(all('[data-question-option]').length).toBeGreaterThan(0);
    expect(q('[data-question-note]')).not.toBeNull();
  });
});
