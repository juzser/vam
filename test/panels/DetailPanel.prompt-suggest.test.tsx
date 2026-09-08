// @vitest-environment happy-dom

/**
 * The prompt box wears the open question's suggestion, and `Tab` accepts it.
 *
 * Operator request: "the prompt input should change its content according to
 * the suggestion, and you should be able to press Tab to quick-reply." The
 * shell/inline-completion idiom, so answering a routine question costs one
 * key.
 *
 * TWO PROPERTIES THIS FILE EXISTS TO PIN, because both are ways the feature
 * could turn into a defect:
 *
 *  - `Tab` IS THE WAY OUT OF A TEXTAREA. It may only be taken while a
 *    suggestion is actually on offer; with none, it must stay the exit, or
 *    the composer becomes a keyboard trap. So every "no offer" case here
 *    asserts the event was NOT `defaultPrevented`.
 *  - ACCEPTING DELIVERS NOTHING. It writes the draft, and the existing
 *    record-or-submit path is untouched: `onSubmit` is never called, and the
 *    card's own note about a pick being "only a mark" stays true.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: 'Providers',
  question: 'Which providers should vam support beyond Claude Code?',
  multiSelect: false,
  options: [
    { label: 'Codex CLI', description: 'a second CLI agent, read the same way' },
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

/**
 * The draft is a PROP, owned by the canvas, so a test that wants to see the
 * box after an accept has to hold it the way the canvas does. `composing`
 * rides along the same way -- opening the composer is what `onCompose` means.
 */
function Harness({
  questions,
  over,
  onSubmit,
}: {
  readonly questions: readonly AgentQuestion[];
  readonly over?: Partial<DetailPanelProps>;
  readonly onSubmit?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  const session: Session = { ...SESSION, questions };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  return (
    <DetailPanel
      entry={entry}
      decision={session.decisions[0] ?? null}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={onSubmit ?? (() => {})}
      composing={composing}
      onCompose={() => setComposing(true)}
      onStopComposing={() => setComposing(false)}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      {...over}
    />
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const box = () => q('textarea[aria-label="prompt to session"]') as HTMLTextAreaElement;
/** The composer stands down while a question is open; this is the way back. */
const openComposer = () => fireEvent.click(q('[data-question-chat]') as HTMLElement);

afterEach(cleanup);

describe('the prompt box offers the open question suggestion', () => {
  it('names the suggestion and the key that takes it, without touching the draft', () => {
    render(<Harness questions={[QUESTION]} />);
    openComposer();
    expect(box().value).toBe('');
    expect(box().getAttribute('data-prompt-suggestion')).toBe('Codex CLI');
    expect(box().placeholder).toContain('Codex CLI');
    expect(box().placeholder).toContain('Tab');
  });

  it('follows the mark: picking the second option moves the offer to it', () => {
    render(<Harness questions={[QUESTION]} />);
    openComposer();
    fireEvent.click(all('[data-question-option]')[1] as HTMLElement);
    expect(box().getAttribute('data-prompt-suggestion')).toBe('Aider');
  });

  it('Tab writes the suggestion into the draft and sends nothing', () => {
    const onSubmit = vi.fn();
    render(<Harness questions={[QUESTION]} onSubmit={onSubmit} />);
    openComposer();
    expect(fireEvent.keyDown(box(), { key: 'Tab' })).toBe(false);
    expect(box().value).toBe('Codex CLI');
    expect(onSubmit).not.toHaveBeenCalled();
    // Still only a mark: the card goes on saying so.
    expect(q('[data-question-note]')?.textContent).toContain('only a mark');
  });

  it('withdraws the offer once the draft carries text, so Tab is the exit again', () => {
    render(<Harness questions={[QUESTION]} />);
    openComposer();
    fireEvent.keyDown(box(), { key: 'Tab' });
    expect(box().value).toBe('Codex CLI');
    expect(box().getAttribute('data-prompt-suggestion')).toBeNull();
    expect(box().placeholder).not.toContain('Codex CLI');
    // Not prevented: nothing left to accept, so Tab leaves the box.
    expect(fireEvent.keyDown(box(), { key: 'Tab' })).toBe(true);
  });
});

describe('Tab stays the way out when nothing is on offer', () => {
  it('a session asking nothing lets a plain Tab through untouched', () => {
    render(<Harness questions={[]} />);
    expect(q('[data-question]')).toBeNull();
    expect(box().getAttribute('data-prompt-suggestion')).toBeNull();
    expect(fireEvent.keyDown(box(), { key: 'Tab' })).toBe(true);
    expect(box().value).toBe('');
  });

  it('an ANSWERED question offers nothing, and Tab still leaves', () => {
    render(<Harness questions={[{ ...QUESTION, answer: 'Codex CLI' }]} />);
    expect(box().getAttribute('data-prompt-suggestion')).toBeNull();
    expect(fireEvent.keyDown(box(), { key: 'Tab' })).toBe(true);
  });

  it('Shift+Tab is the mode cycle and never accepts a suggestion', () => {
    render(<Harness questions={[QUESTION]} />);
    openComposer();
    fireEvent.keyDown(box(), { key: 'Tab', shiftKey: true });
    expect(box().value).toBe('');
  });
});
