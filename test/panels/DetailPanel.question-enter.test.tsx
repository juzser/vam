// @vitest-environment happy-dom

/**
 * Operator request: pressing Submit for every option is the friction — "there
 * needs to be a keyboard shortcut for submitting, for example: Enter to
 * submit, Space to select." Taken literally that risks the CLI picker's own
 * trap (an Enter that lands on the wrong row), so what ships is a CLI
 * picker's Enter rather than a form's: it marks the option under the cursor
 * — same as Space — and in the same keystroke either advances to the next
 * unmarked step or sends the call, so a mark can never be "missed". `Space`
 * stays the bare toggle. `Mod-Enter` sends from wherever the cursor is,
 * without first walking back to an option.
 *
 * `test/keyboard/question-keys.test.ts` holds the resolver; this drives the
 * real widget, the same split `DetailPanel.question-keys.test.tsx` uses for
 * the rest of the card's grammar.
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
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '3m',
  decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
};

const answering = (result: AnswerResult) =>
  vi.fn((_projectId: string, _request: AnswerRequest, _rowId?: string) => Promise.resolve(result));

function draw(question: AgentQuestion, over: Partial<DetailPanelProps> = {}) {
  const session: Session = { ...SESSION, questions: [question] };
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
      {...over}
    />,
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const options = () => all('[data-question-option]');
const listbox = () => q('[role="listbox"]') as HTMLElement;
const card = () => q('[data-question]') as HTMLElement;
const submit = () => q('[data-question-submit]') as HTMLButtonElement | null;

afterEach(cleanup);

describe('Enter marks the option under the cursor and advances the call', () => {
  it('marks the focused option and sends, on a single question', async () => {
    const answer = answering({ kind: 'sent', answer: 'Cobalt' });
    draw(QUESTION, { answer });
    options()[1]?.focus();
    fireEvent.keyDown(listbox(), { key: 'Enter' });
    expect(options()[1]?.getAttribute('data-picked')).toBe('true');
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(answer.mock.calls[0]?.[1]).toEqual({
      steps: [{ question: 'Which colour do you prefer?', labels: ['Cobalt'], multiSelect: false }],
    });
  });

  it('sends on Enter over an option already marked, without unmarking it', async () => {
    // "Enter with the set already complete — submit." Enter is not Space: it
    // must never UNMARK the option under the cursor the way a bare toggle
    // would on a second press of the same key.
    const answer = answering({ kind: 'sent', answer: 'Cobalt' });
    draw(QUESTION, { answer });
    fireEvent.click(options()[1] as HTMLElement);
    options()[1]?.focus();
    fireEvent.keyDown(listbox(), { key: 'Enter' });
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(options()[1]?.getAttribute('data-picked')).toBe('true');
    expect(answer.mock.calls[0]?.[1]).toEqual({
      steps: [{ question: 'Which colour do you prefer?', labels: ['Cobalt'], multiSelect: false }],
    });
  });
});

describe('Space marks without ever sending', () => {
  it('never calls onAnswer, however many times it is pressed', () => {
    const answer = answering({ kind: 'sent', answer: 'Crimson' });
    draw(QUESTION, { answer });
    options()[0]?.focus();
    fireEvent.keyDown(listbox(), { key: ' ' });
    expect(options()[0]?.getAttribute('data-picked')).toBe('true');
    fireEvent.keyDown(listbox(), { key: ' ' });
    expect(options()[0]?.getAttribute('data-picked')).toBeNull();
    expect(answer).not.toHaveBeenCalled();
  });
});

describe('Mod-Enter submits from anywhere on the card', () => {
  it('refuses aloud rather than sending when a step is unmarked, and does not call onAnswer', () => {
    const answer = answering({ kind: 'sent', answer: 'Crimson' });
    draw(QUESTION, { answer });
    fireEvent.keyDown(card(), { key: 'Enter', metaKey: true });
    expect(answer).not.toHaveBeenCalled();
    const refusal = q('[data-question-refusal]');
    expect(refusal).not.toBeNull();
    expect(refusal?.textContent).toContain('Which colour do you prefer?');
  });

  it('sends once every step is marked, from wherever the cursor is', async () => {
    const answer = answering({ kind: 'sent', answer: 'Crimson' });
    draw(QUESTION, { answer });
    fireEvent.click(options()[0] as HTMLElement);
    // Dispatched at the card root, not the listbox — "regardless of focus".
    fireEvent.keyDown(card(), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(answer.mock.calls[0]?.[1]).toEqual({
      steps: [{ question: 'Which colour do you prefer?', labels: ['Crimson'], multiSelect: false }],
    });
  });

  it('does nothing when there is no Submit to reach — no onAnswer, no crash', () => {
    draw(QUESTION, { delivers: false });
    expect(() => fireEvent.keyDown(card(), { key: 'Enter', metaKey: true })).not.toThrow();
    expect(q('[data-question-refusal]')).toBeNull();
  });
});

describe('the progress line hints Enter once the set is complete', () => {
  it('is silent about a hint while a mark is still missing, and gains one once nothing is', () => {
    draw(QUESTION, { answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    expect(q('[data-question-progress]')?.textContent).not.toContain('Enter submits');
    fireEvent.click(options()[0] as HTMLElement);
    expect(q('[data-question-progress]')?.textContent).toContain('Enter submits');
  });
});

describe('the Submit button is still reachable and still native', () => {
  it('sits right after the options in DOM order, so Tab reaches it from the last option', () => {
    draw(QUESTION, { answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    const focusable = [
      ...document.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]'),
    ].filter((el) => el.tabIndex >= 0);
    const lastOption = options()[options().length - 1] ?? null;
    const at = (el: HTMLElement | null | undefined) =>
      el === null || el === undefined ? -1 : focusable.indexOf(el);
    expect(at(lastOption)).toBeGreaterThanOrEqual(0);
    expect(at(submit())).toBeGreaterThan(at(lastOption));
    // Nothing focusable sits between the last option and Submit but the
    // synthetic "Chat about this" row — never a negative tabIndex hiding it.
    expect(submit()?.tabIndex).not.toBe(-1);
  });
});
