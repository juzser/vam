// @vitest-environment happy-dom

/**
 * Operator request, translated: "when Claude offers options and describes
 * them with a diagram, the options must be shown on one side and the
 * diagram on the other — today, when the diagram goes with the option, the
 * display breaks."
 *
 * `AskUserQuestion`'s `options[].preview` is multi-line, monospace content —
 * an ASCII mockup, a diagram, a diff, a config snippet — and it used to be
 * drawn `truncate`d to one line INSIDE the option row (`DetailPanel.
 * questions.test.tsx`'s old "an option that carries a preview" case pinned
 * exactly that). A diagram collapsed to one truncated line is the break.
 *
 * What ships instead: the row never prints the preview text at all, only a
 * quiet "preview" marker; a separate panel shows the FULL preview of
 * whichever option currently has the operator's attention — focused, else
 * marked, else the first option that carries one, so the panel is never
 * blank while a preview exists. `happy-dom` lays nothing out, so the actual
 * side-by-side-vs-stacked rectangle is a real-browser guard's claim
 * (`e2e/key-truth-shots.mjs`); this file pins the DOM and the state machine
 * both rest on.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const DIAGRAM = 'GET /events\nkeeps ONE socket open\nfor the life of the run';

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: 'Transport',
  question: 'How should the canvas receive updates?',
  multiSelect: false,
  options: [
    { label: 'Server-sent events', description: 'one long-lived GET', preview: DIAGRAM },
    { label: 'Long poll', description: 'a request per change', preview: 'GET /changes?since=41' },
    { label: 'Web socket', description: 'two-way, and vam needs one way', preview: null },
  ],
  answer: null,
};

/** No option here carries a preview at all — the panel's off switch. */
const NO_PREVIEW_QUESTION: AgentQuestion = {
  id: 'toolu_2:0',
  header: 'Retries',
  question: 'Which drops should the client retry by itself?',
  multiSelect: true,
  options: [
    { label: 'The server restarted', description: null },
    { label: 'The browser cut it off', description: null },
  ],
  answer: null,
};

const SESSION: Session = {
  id: 's1',
  title: 'Transport study',
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '3m',
  decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
};

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
      {...over}
    />,
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const options = () => [...document.querySelectorAll<HTMLElement>('[data-question-option]')];
const panel = () => q('[data-question-preview-panel]');

afterEach(cleanup);

describe('the panel exists only when a preview exists', () => {
  it('draws nothing when no option in the step carries one', () => {
    draw(NO_PREVIEW_QUESTION);
    expect(panel()).toBeNull();
  });

  it('draws it when at least one option does, defaulting to the first that has one', () => {
    draw(QUESTION);
    expect(panel()).not.toBeNull();
    expect(panel()?.textContent).toContain('GET /events');
  });
});

describe('the panel text is the focused option’s preview', () => {
  it('follows keyboard/pointer focus onto another option', () => {
    draw(QUESTION);
    fireEvent.focus(options()[1] as HTMLElement);
    expect(panel()?.textContent).toContain('GET /changes?since=41');
    expect(panel()?.textContent).not.toContain('GET /events');
  });

  it('walking (focus moving option to option) keeps changing it', () => {
    draw(QUESTION);
    fireEvent.focus(options()[1] as HTMLElement);
    expect(panel()?.getAttribute('data-for')).toBe('1');
    fireEvent.focus(options()[0] as HTMLElement);
    expect(panel()?.getAttribute('data-for')).toBe('0');
    expect(panel()?.textContent).toContain('GET /events');
  });
});

describe('nothing focused falls back to the marked option, then to the first with one', () => {
  it('shows the marked option’s preview when nothing has focus', () => {
    draw(QUESTION);
    // A bare click marks without moving focus and without folding the list
    // (`DetailPanel.question-collapse.test.tsx`'s own `detail: 1` is what
    // folds; this is a plain click, `detail: 0`).
    fireEvent.click(options()[1] as HTMLElement);
    expect(document.activeElement).not.toBe(options()[1]);
    expect(panel()?.textContent).toContain('GET /changes?since=41');
  });

  it('falls back to the first option that carries a preview when nothing is focused or marked', () => {
    draw(QUESTION);
    expect(panel()?.getAttribute('data-for')).toBe('0');
    expect(panel()?.textContent).toContain('GET /events');
  });
});

describe('an option without a preview', () => {
  it('shows the quiet fallback line, never the neighbouring option’s text', () => {
    draw(QUESTION);
    fireEvent.focus(options()[2] as HTMLElement);
    expect(panel()?.textContent).toContain('no preview for this option');
    expect(panel()?.textContent).not.toContain('GET /events');
    expect(panel()?.textContent).not.toContain('GET /changes?since=41');
  });
});

describe('the option row itself never prints the preview', () => {
  it('carries a quiet marker instead of the diagram text', () => {
    draw(QUESTION);
    const row = options()[0];
    expect(row?.textContent ?? '').not.toContain('GET /events');
    expect(row?.textContent ?? '').not.toContain('keeps ONE socket open');
    expect(row?.textContent ?? '').toContain('preview');
  });

  it('prints no marker at all on an option carrying none', () => {
    draw(QUESTION);
    const row = options()[2];
    expect(row?.querySelector('[data-question-preview-hint]')).toBeNull();
  });
});
