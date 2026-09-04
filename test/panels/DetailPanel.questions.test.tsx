// @vitest-environment happy-dom

/**
 * The open question the pane draws, and the four things it refuses to do with
 * it.
 *
 * A placeholder picker once stood above the composer with three invented cards,
 * and it was removed because nothing vam read recorded what a session was
 * asking. `AskUserQuestion` does record it, so a real card can stand there --
 * under the rules the placeholder broke:
 *
 *  - an ANSWERED question is not drawn as if it were still waiting,
 *  - a session with no question gets no box, not an empty one,
 *  - `multiSelect` decides the shape of the list; the pane never assumes,
 *  - and picking an option ANSWERS NOTHING. Vam has no channel that could
 *    deliver it, so the card marks the operator's choice and says, in words,
 *    that nothing was sent.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: 'Providers',
  question: 'Which providers should vam support beyond Claude Code?',
  multiSelect: true,
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

function draw(questions?: readonly AgentQuestion[], over: Partial<DetailPanelProps> = {}) {
  const session: Session = questions === undefined ? SESSION : { ...SESSION, questions };
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
const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const text = () => document.body.textContent ?? '';

afterEach(cleanup);

describe('an open question is drawn, with everything the record carries', () => {
  it('shows the question, its header, and every option label AND description', () => {
    draw([QUESTION]);
    expect(q('[data-question]')).not.toBeNull();
    expect(text()).toContain('Which providers should vam support beyond Claude Code?');
    expect(text()).toContain('Providers');
    expect(all('[data-question-option]')).toHaveLength(2);
    expect(text()).toContain('Codex CLI');
    // The description is the half that says why you would pick it.
    expect(text()).toContain('a second CLI agent, read the same way');
    expect(text()).toContain('a local editor agent');
  });

  it('draws a multi-select as multi-select and a single-select as single', () => {
    draw([QUESTION]);
    expect(q('[data-question]')?.getAttribute('data-question-select')).toBe('multi');
    expect(q('[role="listbox"]')?.getAttribute('aria-multiselectable')).toBe('true');
    cleanup();
    draw([{ ...QUESTION, multiSelect: false }]);
    expect(q('[data-question]')?.getAttribute('data-question-select')).toBe('single');
    expect(q('[role="listbox"]')?.getAttribute('aria-multiselectable')).toBe('false');
  });

  it('lets several options be marked at once only when the record says multiSelect', () => {
    draw([QUESTION]);
    const marked = () => all('[data-question-option][data-picked="true"]').length;
    const options = all('[data-question-option]');
    fireEvent.click(options[0] as HTMLElement);
    fireEvent.click(options[1] as HTMLElement);
    expect(marked()).toBe(2);
    cleanup();
    draw([{ ...QUESTION, multiSelect: false }]);
    const single = all('[data-question-option]');
    fireEvent.click(single[0] as HTMLElement);
    fireEvent.click(single[1] as HTMLElement);
    expect(marked()).toBe(1);
  });
});

describe('what the pane refuses to claim', () => {
  it('draws nothing at all for a session that asked no question', () => {
    draw([]);
    expect(q('[data-question]')).toBeNull();
    expect(all('[data-question-option]')).toHaveLength(0);
    cleanup();
    // Absent, not empty: a source with no such surface says nothing either.
    draw(undefined);
    expect(q('[data-question]')).toBeNull();
  });

  it('does not draw an ANSWERED question as one still waiting', () => {
    draw([{ ...QUESTION, answer: 'Codex CLI' }]);
    expect(q('[data-question][data-question-open="true"]')).toBeNull();
    expect(all('[data-question-option]')).toHaveLength(0);
  });

  it('never claims an answer was submitted when an option is picked', () => {
    draw([QUESTION]);
    fireEvent.click(all('[data-question-option]')[0] as HTMLElement);
    const pane = text();
    for (const claim of ['sent', 'submitted', 'answered', 'delivered', 'replied']) {
      expect(pane.toLowerCase(), claim).not.toContain(claim);
    }
    // And it says so out loud, rather than by omission.
    expect(pane).toContain('cannot answer');
    // The mark is the whole effect: no option becomes the session's answer.
    expect(all('[data-question-option][data-picked="true"]')).toHaveLength(1);
  });

  it('says the window it read, so an empty pane is not read as "no question"', () => {
    draw([]);
    // The absence is documented where a reader of the component will find it,
    // not asserted as UI: the pane draws nothing, and `source.ts` records that
    // a question older than TAIL_BYTES never reaches it.
    expect(q('[data-question]')).toBeNull();
  });
});

describe('keyboard-first: `i` reaches the options when a question is open', () => {
  it('focuses the first option instead of the prompt box while one is waiting', () => {
    draw([QUESTION], { composing: true });
    expect(document.activeElement).toBe(all('[data-question-option]')[0]);
  });

  it('still focuses the prompt box when nothing is being asked', () => {
    draw([], { composing: true });
    expect((document.activeElement as HTMLElement | null)?.tagName).toBe('TEXTAREA');
  });
});

/**
 * The running caption's motion.
 *
 * `✳ Improvising…` replaced a blinking caret, and the operator's report is
 * that the result reads as text rather than as work: the only thing moving
 * was three dots easing at 20% opacity, which at 11.5px is nearly nothing.
 *
 * So the WORD carries motion too -- a sheen travelling across it -- and the
 * star turns. Both are CSS from existing tokens, on properties that do not
 * repaint the pane, and both are inside the app's register: a status line, not
 * a spinner. The rule #133 set stands: with `prefers-reduced-motion`, nothing
 * moves and the state is still legible, which means colour and a parked
 * ellipsis rather than a frozen frame of an animation.
 */
describe('the running caption is unmistakably running', () => {
  const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
  const reduced = () => CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));

  it('moves the word itself, not only the dots', () => {
    expect(CSS).toContain('@keyframes vam-running-sheen');
    expect(CSS).toMatch(/\.vam-running-word[^}]*\{[^}]*animation:\s*vam-running-sheen/s);
    // The star turns as well -- one more channel of the same motion.
    expect(CSS).toMatch(/\.vam-running-star[^}]*\{[^}]*animation:\s*vam-spin/s);
  });

  it('takes every colour from a token, so the sheen cannot drift from the theme', () => {
    const rule = CSS.slice(CSS.indexOf('.vam-running-word'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('var(--color-running)');
  });

  it('conveys the running state without movement under reduced motion', () => {
    expect(reduced()).toMatch(/\.vam-running-word[^}]*\{[^}]*animation:\s*none/s);
    expect(reduced()).toMatch(/\.vam-running-star[^}]*\{[^}]*animation:\s*none/s);
    // Stopped, the word must not be left transparent -- the sheen paints it by
    // clipping a gradient to the glyphs, so switching that off has to restore
    // a real colour or the caption vanishes.
    expect(reduced()).toMatch(/\.vam-running-word[^}]*\{[^}]*color:\s*var\(--color-running\)/s);
  });

  it('puts the classes on the caption the pane actually draws', () => {
    const live: Session = { ...SESSION, status: 'running', activity: 'Bash: run the gates' };
    const project: Project = { id: 'p1', name: 'atlas', sessions: [live] };
    render(
      <DetailPanel
        entry={{ project, session: live }}
        decision={{ id: 'd1', label: 'plan', input: 'go', output: null, commands: [] }}
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
      />,
    );
    expect(q('[data-out-running-word]')?.className).toContain('vam-running-word');
    expect(q('[data-out-running-star]')?.className).toContain('vam-running-star');
  });
});
