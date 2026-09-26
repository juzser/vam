// @vitest-environment happy-dom

/**
 * THE OPERATOR'S THREE UI ASKS FOR THE QUESTION CARD, translated:
 *
 *  - a picked option should show a Check and a selected tint, distinct from
 *    a merely focused one;
 *  - the focus ring should be subtler than the app's own bold one, and never
 *    cover a picked row's own border;
 *  - Enter on an option that is ALREADY picked should still submit, the same
 *    as Enter on Submit itself.
 *
 * `e2e/question-card-shots.mjs` is where the PAINT is measured (contrast,
 * the ring as drawn, the two states side by side); this is the DOM this file
 * shares with every other question-card test — classes, attributes, and the
 * one call a real submit makes.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { applePlatform, chordSymbols } from '../../src/renderer/keyboard/chords.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import {
  DEFAULT_PROMPT_SUBMIT_KEY,
  setActivePromptSubmitKey,
} from '../../src/renderer/prefs/submit-key.js';
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

function draw(over: Partial<DetailPanelProps> = {}) {
  const session: Session = { ...SESSION, questions: [QUESTION] };
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

const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const options = () => all('[data-question-option]');
const submit = () => document.querySelector<HTMLButtonElement>('[data-question-submit]');

afterEach(() => {
  cleanup();
  setActivePromptSubmitKey(DEFAULT_PROMPT_SUBMIT_KEY);
});

describe('a picked option', () => {
  it('carries a Check mark and the picked border/fill, before any focus at all', () => {
    draw({ answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    fireEvent.click(options()[0] as HTMLElement);
    const picked = options()[0] as HTMLElement;
    expect(picked.getAttribute('data-picked')).toBe('true');
    expect(picked.querySelector('[data-question-picked-mark]')).not.toBeNull();
    expect(picked.className).toContain('border-running');
    // The OTHER option carries neither.
    const other = options()[1] as HTMLElement;
    expect(other.getAttribute('data-picked')).toBeNull();
    expect(other.querySelector('[data-question-picked-mark]')).toBeNull();
  });

  it('keeps its own focus-visible ring, separate from the picked treatment', () => {
    draw({ answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    // Every option button carries the same focus-ring utility class,
    // independent of whether it happens to be picked -- the two are
    // different visual channels (an outline vs. a border/fill), never one
    // standing in for the other.
    for (const option of options()) {
      expect(option.className).toContain('focus-visible:outline-ink-dim');
    }
  });
});

describe('Enter on an already-picked option', () => {
  it('submits, the same as Enter on Submit itself', async () => {
    const answer = answering({ kind: 'sent', answer: 'Crimson' });
    draw({ answer });
    const first = options()[0] as HTMLElement;
    // Mark it (a keyboard mark, `detail: 0`, so nothing folds the list away
    // under the keystroke this test drives next).
    fireEvent.click(first, { detail: 0 });
    expect(first.getAttribute('data-picked')).toBe('true');
    expect(answer).not.toHaveBeenCalled();
    // Enter again, on the SAME already-picked row.
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(answer).toHaveBeenCalledTimes(1);
  });
});

describe("Submit's own chord chip", () => {
  // `chordSymbols` is the same canonical rendering `ChordGlyphs` promises its
  // `.textContent` never drifts from (that component's own doc comment) --
  // computed here, at whatever platform this run actually is, rather than a
  // literal glyph that would only be right on a Mac.
  const mac = applePlatform();

  it('shows Enter by default', () => {
    draw({ answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    fireEvent.click(options()[0] as HTMLElement);
    const chip = submit()?.querySelector('[data-question-submit-key]');
    expect(chip?.textContent).toBe(chordSymbols('Enter', mac));
  });

  it('draws the key before the word, as the operator asked', () => {
    draw({ answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    fireEvent.click(options()[0] as HTMLElement);
    const button = submit() as HTMLElement;
    expect(button.firstElementChild?.hasAttribute('data-question-submit-key')).toBe(true);
    expect(button.textContent).toBe(`${chordSymbols('Enter', mac)}Submit`);
  });

  it('follows the Shift-Enter preference', () => {
    setActivePromptSubmitKey('shift-enter');
    draw({ answer: answering({ kind: 'sent', answer: 'Crimson' }) });
    fireEvent.click(options()[0] as HTMLElement);
    const chip = submit()?.querySelector('[data-question-submit-key]');
    expect(chip?.textContent).toBe(chordSymbols('Shift-Enter', mac));
  });
});
