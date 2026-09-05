// @vitest-environment happy-dom

/**
 * A set of questions asked in ONE call, drawn as steps with one Submit.
 *
 * What this replaces was not a compromise, it was a hole: the pane drew the
 * newest open question and nothing else, so a two-question call put question
 * TWO on screen and question one nowhere. Measured before any of this was
 * written -- one card, `Q1?` drawn, `Q0?` absent.
 *
 * The rules the steps have to keep:
 *
 *  - every question of the call is reachable, in the order it was asked,
 *  - the marks survive walking between steps,
 *  - ONE Submit, for the set: the agent is waiting on the call, not on its
 *    first question, and a step must not look separately submittable,
 *  - a step whose question is already answered shows the answer and stands
 *    aside rather than blocking the rest.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { AnswerRequest, AnswerResult } from '../../src/shared/answer.js';

const COLOUR: AgentQuestion = {
  id: 'toolu_1:0',
  header: 'Colour',
  question: 'Which colour do you prefer?',
  multiSelect: false,
  options: [
    { label: 'Crimson', description: null },
    { label: 'Cobalt', description: null },
  ],
  answer: null,
};
const FRUIT: AgentQuestion = {
  id: 'toolu_1:1',
  header: 'Fruit',
  question: 'Which fruit do you prefer?',
  multiSelect: false,
  options: [
    { label: 'Apple', description: null },
    { label: 'Cobalt', description: null },
  ],
  answer: null,
};

const SESSION: Session = {
  // vam started this one: Submit is drawn only over a pane vam can press a
  // key in, which is the same test the mode row makes.
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

const answering = (result: AnswerResult) =>
  vi.fn((_projectId: string, _request: AnswerRequest, _rowId?: string) => Promise.resolve(result));

function draw(questions: readonly AgentQuestion[], over: Partial<DetailPanelProps> = {}) {
  const session: Session = { ...SESSION, questions };
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
      answer={answering({ kind: 'sent', answer: 'x' })}
      {...over}
    />,
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const text = () => document.body.textContent ?? '';
const steps = () => all('[data-question-step]');
const options = () => all('[data-question-option]');
const listbox = () => q('[role="listbox"]') as HTMLElement;
const submit = () => q('[data-question-submit]') as HTMLButtonElement | null;

afterEach(cleanup);

describe('a call carrying two questions is drawn as two steps', () => {
  it('offers a step for each, and starts on the first -- which used to be invisible', () => {
    draw([COLOUR, FRUIT]);
    expect(steps()).toHaveLength(2);
    expect(text()).toContain('Which colour do you prefer?');
    expect(text()).not.toContain('Which fruit do you prefer?');
    expect(steps()[0]?.getAttribute('data-current')).toBe('true');
  });

  it('says which step it is on and how many there are', () => {
    draw([COLOUR, FRUIT]);
    expect(q('[data-question-position]')?.textContent).toContain('1 of 2');
  });

  it('draws no strip at all for a call that asked one question', () => {
    // A step counter over a single question is furniture that says nothing.
    draw([COLOUR]);
    expect(q('[data-question-steps]')).toBeNull();
    expect(submit()).not.toBeNull();
  });

  it('keeps a set together and leaves another call out of it', () => {
    draw([{ ...COLOUR, id: 'toolu_0:0' }, COLOUR, FRUIT]);
    expect(steps()).toHaveLength(2);
  });
});

describe('walking between steps', () => {
  it('moves on with l and back with h -- the horizontal half of the operator table', () => {
    draw([COLOUR, FRUIT]);
    fireEvent.keyDown(listbox(), { key: 'l' });
    expect(text()).toContain('Which fruit do you prefer?');
    expect(steps()[1]?.getAttribute('data-current')).toBe('true');
    fireEvent.keyDown(listbox(), { key: 'h' });
    expect(text()).toContain('Which colour do you prefer?');
  });

  it('moves with the horizontal arrows too', () => {
    draw([COLOUR, FRUIT]);
    fireEvent.keyDown(listbox(), { key: 'ArrowRight' });
    expect(text()).toContain('Which fruit do you prefer?');
    fireEvent.keyDown(listbox(), { key: 'ArrowLeft' });
    expect(text()).toContain('Which colour do you prefer?');
  });

  it('stops at the ends rather than wrapping, so the last step is not the first', () => {
    // Options wrap because a list is a ring. Steps are a sequence with a
    // Submit at the end of it, and wrapping past the last one reads as
    // progress that did not happen.
    draw([COLOUR, FRUIT]);
    fireEvent.keyDown(listbox(), { key: 'h' });
    expect(text()).toContain('Which colour do you prefer?');
    fireEvent.keyDown(listbox(), { key: 'l' });
    fireEvent.keyDown(listbox(), { key: 'l' });
    expect(text()).toContain('Which fruit do you prefer?');
  });

  it('walks to a step by clicking its tab', () => {
    draw([COLOUR, FRUIT]);
    fireEvent.click(steps()[1] as HTMLElement);
    expect(text()).toContain('Which fruit do you prefer?');
  });

  it('does not let a horizontal key reach the canvas behind the pane', () => {
    draw([COLOUR, FRUIT]);
    const event = new KeyboardEvent('keydown', { key: 'l', bubbles: true, cancelable: true });
    listbox().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps each step marks when the operator walks away and back', () => {
    draw([COLOUR, FRUIT]);
    fireEvent.click(options()[1] as HTMLElement);
    fireEvent.keyDown(listbox(), { key: 'l' });
    fireEvent.click(options()[0] as HTMLElement);
    fireEvent.keyDown(listbox(), { key: 'h' });
    expect(options()[1]?.getAttribute('data-picked')).toBe('true');
    expect(options()[0]?.getAttribute('data-picked')).toBeNull();
  });
});

describe('one Submit, for the set', () => {
  it('draws exactly one Submit however many steps there are', () => {
    draw([COLOUR, FRUIT]);
    expect(all('[data-question-submit]')).toHaveLength(1);
  });

  it('will not send until every open step has a mark, and says which are missing', () => {
    draw([COLOUR, FRUIT]);
    expect(submit()?.disabled).toBe(true);
    fireEvent.click(options()[0] as HTMLElement);
    // One of two marked: the set is not answerable yet.
    expect(submit()?.disabled).toBe(true);
    expect(text()).toContain('1 of 2');
    fireEvent.keyDown(listbox(), { key: 'l' });
    fireEvent.click(options()[0] as HTMLElement);
    expect(submit()?.disabled).toBe(false);
  });

  it('sends every step, in asking order, each with its own question text', async () => {
    const answer = answering({ kind: 'sent', answer: 'Crimson, Cobalt' });
    draw([COLOUR, FRUIT], { answer });
    fireEvent.click(options()[0] as HTMLElement);
    fireEvent.keyDown(listbox(), { key: 'l' });
    // Cobalt -- the label BOTH questions offer, marked on the second.
    fireEvent.click(options()[1] as HTMLElement);
    fireEvent.click(submit() as HTMLElement);
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(answer.mock.calls[0]?.[1]).toEqual({
      steps: [
        {
          question: 'Which colour do you prefer?',
          labels: ['Crimson'],
          multiSelect: false,
        },
        {
          question: 'Which fruit do you prefer?',
          labels: ['Cobalt'],
          multiSelect: false,
        },
      ],
    });
  });
});

describe('a step whose question is already answered', () => {
  const settled: AgentQuestion[] = [{ ...COLOUR, answer: 'Crimson' }, FRUIT];

  it('shows the answer in place of its options, and offers nothing to mark', () => {
    draw(settled);
    expect(text()).toContain('resolved — Crimson');
    expect(options()).toHaveLength(0);
    expect(steps()[0]?.getAttribute('data-answered')).toBe('true');
  });

  it('does not hold the set back: the open steps are what Submit waits for', async () => {
    const answer = answering({ kind: 'sent', answer: 'Apple' });
    draw(settled, { answer });
    fireEvent.click(steps()[1] as HTMLElement);
    fireEvent.click(options()[0] as HTMLElement);
    expect(submit()?.disabled).toBe(false);
    fireEvent.click(submit() as HTMLElement);
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    // The settled question is not re-answered.
    expect(answer.mock.calls[0]?.[1]).toEqual({
      steps: [{ question: 'Which fruit do you prefer?', labels: ['Apple'], multiSelect: false }],
    });
  });

  it('lets the keyboard leave a settled step, which has no options list to hold it', () => {
    // The horizontal keys live on the options list, and a settled step has
    // none. Without the strip taking them too, the keyboard arrives here and
    // stays.
    draw(settled);
    fireEvent.keyDown(q('[data-question-steps]') as HTMLElement, { key: 'l' });
    expect(text()).toContain('Which fruit do you prefer?');
  });

  it('draws no Submit at all once every step is answered', () => {
    draw([
      { ...COLOUR, answer: 'Crimson' },
      { ...FRUIT, answer: 'Apple' },
    ]);
    expect(submit()).toBeNull();
  });
});

/**
 * A SET THAT WAS PART-DELIVERED, which is the one outcome the card used to
 * deny outright.
 *
 * The CLI commits each single-select question as it is answered -- the Return
 * that picks the option also advances the set -- so a failure on step two of
 * two is not "nothing was sent". It said so anyway, and the operator's obvious
 * response, pressing Submit again, re-sent question one into a screen that had
 * moved on: `wrong-question`, forever, with no way to finish the set from the
 * UI at all.
 */
describe('a Submit that got part of the way', () => {
  const partly = (results: readonly AnswerResult[]) => {
    const queue = [...results];
    return vi.fn((_projectId: string, _request: AnswerRequest, _rowId?: string) =>
      Promise.resolve(queue.shift() ?? { kind: 'refused' as const }),
    );
  };

  const markBoth = () => {
    fireEvent.click(options()[0] as HTMLElement);
    fireEvent.keyDown(listbox(), { key: 'l' });
    fireEvent.click(options()[0] as HTMLElement);
  };

  it('does not say nothing was sent when question one went in', async () => {
    const answer = partly([{ kind: 'refused', committed: ['Crimson'] }]);
    draw([COLOUR, FRUIT], { answer });
    markBoth();
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
    // The denial, in the words it used to be drawn in.
    expect(text()).not.toContain('not sent —');
    // What actually happened, both halves of it.
    expect(text()).toContain('Crimson');
    expect(text()).toContain('tmux would not deliver');
  });

  it('resumes at the step that did NOT go in, rather than re-sending the set', async () => {
    const answer = partly([
      { kind: 'refused', committed: ['Crimson'] },
      { kind: 'sent', answer: 'Apple' },
    ]);
    draw([COLOUR, FRUIT], { answer });
    markBoth();
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(answer.mock.calls).toHaveLength(2));
    // The first attempt carried the whole set; the second carries only what
    // the agent is still waiting on. Re-sending question one would be matched
    // against a screen that has already moved to question two.
    expect(answer.mock.calls[0]?.[1].steps.map((step) => step.question)).toEqual([
      'Which colour do you prefer?',
      'Which fruit do you prefer?',
    ]);
    expect(answer.mock.calls[1]?.[1].steps.map((step) => step.question)).toEqual([
      'Which fruit do you prefer?',
    ]);
    // And the step itself says so, rather than the outcome line being the only
    // record of it -- the next Submit replaces that line.
    expect(steps()[0]?.getAttribute('data-sent')).toBe('true');
    expect(steps()[1]?.getAttribute('data-sent')).toBeNull();
    await waitFor(() => expect(q('[data-question-outcome]')?.textContent).toContain('Apple'));
  });

  it('offers no Submit once every step has gone in', async () => {
    // Both questions committed and the CLI own review is what failed. There is
    // nothing left to send, and a button that would send an empty set is a
    // button that refuses.
    const answer = partly([
      { kind: 'unconfirmed', label: 'Apple', committed: ['Crimson', 'Apple'] },
    ]);
    draw([COLOUR, FRUIT], { answer });
    markBoth();
    fireEvent.click(submit() as HTMLElement);
    await waitFor(() => expect(q('[data-question-outcome]')).not.toBeNull());
    expect(submit()).toBeNull();
  });
});

/**
 * Walking a step carries the cursor with it.
 *
 * The option cursor is DOM focus, so the button holding it unmounts when the
 * step changes; without this the cursor was simply gone, and the next key
 * belonged to the window rather than to the card. The labels below are
 * DISTINCT per question deliberately: React reconciles options by label, so a
 * shared label keeps the node alive and hides the bug.
 */
describe('the cursor follows the step it walked to', () => {
  const APPLES: AgentQuestion = {
    ...FRUIT,
    options: [
      { label: 'Apple', description: null },
      { label: 'Pear', description: null },
    ],
  };

  it('lands on the new step first option', () => {
    draw([COLOUR, APPLES], { active: true });
    expect(document.activeElement).toBe(options()[0]);
    fireEvent.keyDown(listbox(), { key: 'l' });
    expect(text()).toContain('Which fruit do you prefer?');
    expect(document.activeElement).toBe(options()[0]);
    expect(document.activeElement?.textContent).toContain('Apple');
  });

  it('lands on the TAB of a step that is already answered, which has no list', () => {
    draw([COLOUR, { ...APPLES, answer: 'Apple' }], { active: true });
    fireEvent.keyDown(listbox(), { key: 'l' });
    // Nothing to walk into: the settled step shows its answer instead. The
    // strip takes the horizontal keys, so the cursor must be on the strip.
    expect(options()).toHaveLength(0);
    expect(document.activeElement).toBe(steps()[1]);
  });
});
