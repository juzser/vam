// @vitest-environment happy-dom

/**
 * "After choosing an option, shouldn't the option panel hide?" — the operator,
 * as a question rather than a specification.
 *
 * It hides, and it must not thereby say the answer was sent. This card's own
 * rule is that A PICK IS ONLY A MARK: with no delivery route "vam cannot
 * answer this for you… nothing goes back to the session", and with one "a pick
 * is only a mark until you press Submit". A list that simply vanishes on a
 * click reads as "sent", and a UI implying something it did not do is this
 * project's dominant defect. So the collapse keeps three things on screen:
 * WHICH option is marked, the sentence saying a mark is not a delivery, and a
 * way back into the list.
 *
 * AND IT COLLAPSES ON A POINTER ONLY. The option list owns the picker's
 * keyboard — digits mark, `j`/`k` walk the options, `h`/`l` walk the steps,
 * `c` chats — through a listener on the listbox itself. Collapsing after a
 * keyboard pick would unmount the element holding that grammar and drop the
 * cursor to `document.body` mid-sequence, so a keyboard pick leaves the list
 * standing. The activation source is carried the same way the tab strip
 * carries it: `UIEvent.detail`, 0 for a keyboard activation and >= 1 for a
 * pointer press.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: 'Providers',
  question: 'Which provider should vam add next?',
  multiSelect: false,
  options: [
    { label: 'Codex CLI', description: 'a second CLI agent' },
    { label: 'Aider', description: 'a local editor agent' },
  ],
  answer: null,
};

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
      {...over}
    />,
  );
}

const options = () => [...document.querySelectorAll<HTMLElement>('[data-question-option]')];
const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const text = () => document.body.textContent ?? '';

/** A click from a mouse, which is what `detail: 1` means. */
function clickOption(label: string) {
  const option = options().find((el) => (el.textContent ?? '').includes(label)) as HTMLElement;
  expect(option, label).not.toBeUndefined();
  fireEvent.click(option, { detail: 1 });
}

afterEach(cleanup);

describe('the option list folds away once a pick is made', () => {
  it('takes the list off screen after a pointer pick', () => {
    draw([QUESTION]);
    expect(options()).toHaveLength(2);
    clickOption('Codex CLI');
    expect(options()).toHaveLength(0);
  });

  it('still says WHICH option is marked', () => {
    draw([QUESTION]);
    clickOption('Codex CLI');
    expect(q('[data-question-marked]')?.textContent ?? '').toContain('Codex CLI');
  });

  it('still says a mark is not a delivery', () => {
    // The card's own sentence, which the collapse must never take with it —
    // a list that vanishes on a click reads as "sent".
    draw([QUESTION]);
    clickOption('Codex CLI');
    expect(q('[data-question-note]')).not.toBeNull();
    expect(text()).toContain('only a mark');
  });

  it('offers the way back into the list, and it works', () => {
    draw([QUESTION]);
    clickOption('Codex CLI');
    const back = q('[data-question-expand]');
    expect(back).not.toBeNull();
    fireEvent.click(back as HTMLElement, { detail: 1 });
    expect(options()).toHaveLength(2);
    // And the mark survived the round trip.
    expect(q('[data-question-option][data-picked="true"]')?.textContent).toContain('Codex CLI');
  });
});

describe('what the collapse does not touch', () => {
  it('leaves the list standing after a KEYBOARD pick, which owns the picker keys', () => {
    draw([QUESTION]);
    const option = options()[0] as HTMLElement;
    fireEvent.click(option, { detail: 0 });
    expect(options()).toHaveLength(2);
    expect(option.getAttribute('data-picked')).toBe('true');
  });

  it('leaves a multi-select open, where one pick is not a choice made', () => {
    draw([{ ...QUESTION, multiSelect: true }]);
    clickOption('Codex CLI');
    expect(options()).toHaveLength(2);
  });

  it('keeps “Chat about this” reachable while collapsed', () => {
    // It is the one entry that does something rather than mark, and being
    // stuck behind a fold would be the collapse taking away the way out.
    draw([QUESTION]);
    clickOption('Codex CLI');
    expect(q('[data-question-chat]')).not.toBeNull();
  });
});
