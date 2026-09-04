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

/**
 * Picking by number — the fast path.
 *
 * `i` already lands on the first option and the arrows walk from there, which
 * makes the third option three keystrokes. Numbering them is the idiom every
 * terminal picker uses and the one this app already uses twice (`Mod-<digit>`
 * for a session, `Mod-Shift-<digit>` for a tab), so the third option is `i`
 * then `3`.
 *
 * A BARE digit, and the safety argument is scope rather than luck: this
 * listener is on the listbox, so it can only fire while the keyboard is
 * already inside the options list. `j`, `k` and the other bare letters that
 * mean something on the canvas are untouched — they are letters — and a digit
 * pressed anywhere else in the app reaches the canvas grammar, which binds no
 * bare digit at all. With no question open there is no listbox to hold focus,
 * so there is nothing to fire.
 *
 * And it changes nothing about what a pick IS: a mark. The honesty assertions
 * below are the click test's, repeated for the keyboard, because a second way
 * in is a second way to imply an answer was sent.
 */
describe('a digit picks the option beside it', () => {
  const THREE: AgentQuestion = {
    ...QUESTION,
    multiSelect: false,
    options: [
      { label: 'first', description: null },
      { label: 'second', description: null },
      { label: 'third', description: null },
    ],
  };

  const pressDigit = (digit: string) =>
    fireEvent.keyDown(q('[role="listbox"]') as HTMLElement, { key: digit, bubbles: true });

  it('shows the number beside every option, in order', () => {
    draw([THREE]);
    expect(
      all('[data-question-option]').map((o) => o.getAttribute('data-question-number')),
    ).toEqual(['1', '2', '3']);
  });

  it('marks the third option on `3`, without three arrow presses', () => {
    draw([THREE]);
    pressDigit('3');
    const picked = all('[data-question-option][data-picked="true"]');
    expect(picked).toHaveLength(1);
    expect(picked[0]?.textContent).toContain('third');
    // And the keyboard follows the mark, so the arrows walk on from there.
    expect(document.activeElement).toBe(picked[0]);
  });

  it('does nothing for a digit with no option under it', () => {
    draw([THREE]);
    pressDigit('7');
    pressDigit('0');
    expect(all('[data-question-option][data-picked="true"]')).toHaveLength(0);
  });

  it('numbers only the first nine, because there is no tenth digit', () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      label: `option ${index + 1}`,
      description: null,
    }));
    draw([{ ...THREE, options: many }]);
    const numbers = all('[data-question-option]').map((o) =>
      o.getAttribute('data-question-number'),
    );
    expect(numbers.slice(0, 9)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(numbers.slice(9)).toEqual([null, null]);
  });

  it('obeys multiSelect, exactly as a click does', () => {
    draw([THREE]);
    pressDigit('1');
    pressDigit('2');
    // Single-select: the second mark replaces the first rather than joining it.
    expect(all('[data-question-option][data-picked="true"]')).toHaveLength(1);
    cleanup();
    draw([{ ...THREE, multiSelect: true }]);
    pressDigit('1');
    pressDigit('2');
    expect(all('[data-question-option][data-picked="true"]')).toHaveLength(2);
  });

  it('claims nothing was sent, on the keyboard path too', () => {
    draw([THREE]);
    pressDigit('2');
    const pane = text();
    for (const claim of ['sent', 'submitted', 'answered', 'delivered', 'replied']) {
      expect(pane.toLowerCase(), claim).not.toContain(claim);
    }
    expect(pane).toContain('cannot answer');
  });

  it('has nothing to fire on when no question is open', () => {
    draw([]);
    expect(q('[role="listbox"]')).toBeNull();
    fireEvent.keyDown(document.body, { key: '1', bubbles: true });
    expect(all('[data-question-option]')).toHaveLength(0);
    cleanup();
    // A resolved question draws its card but no list: same absence, on purpose.
    draw([{ ...THREE, answer: 'first' }]);
    expect(q('[role="listbox"]')).toBeNull();
    fireEvent.keyDown(document.body, { key: '1', bubbles: true });
    expect(all('[data-question-option][data-picked="true"]')).toHaveLength(0);
  });
});

/**
 * While a question is open, the options ARE the interaction.
 *
 * Claude Code's own picker owns the screen and offers a free-text entry as the
 * last choice; vam drew both at once, so the operator was reading a list of
 * options above a box that could not answer them. So the composer stands down
 * while an open question is drawn, and "Chat about this" is what brings it
 * back — the one entry whose behaviour differs from a mark.
 *
 * The entry is SYNTHESIZED. `AskUserQuestion`'s `tool_use` records only the
 * model's own `options[]`; the free-text row is the CLI's own UI. So it is
 * drawn outside the listbox, marked as vam's, and is not a `role="option"`:
 * it is not something the agent offered and not something a pick can mark.
 *
 * The scope line is unchanged and deliberate: nothing here delivers an answer.
 * Vam cannot see a TUI picker's cursor, so answering one blind would risk
 * submitting the wrong choice to a running agent. "Chat about this" opens the
 * composer, which is the path that already delivers where it can.
 */
describe('the composer stands down while a question is open', () => {
  const composer = () => q('[data-prompt-box]');
  const chat = () => q('[data-question-chat]');

  it('draws no composer while an open question is on screen', () => {
    draw([QUESTION]);
    expect(q('[data-question-open="true"]')).not.toBeNull();
    expect(composer()).toBeNull();
  });

  it('draws the composer exactly as before when nothing is being asked', () => {
    draw([]);
    expect(composer()).not.toBeNull();
    expect(chat()).toBeNull();
  });

  it('draws the composer again once the question is resolved', () => {
    draw([{ ...QUESTION, answer: 'Codex CLI' }]);
    expect(composer()).not.toBeNull();
    // A resolved question is not a picker: no options, and no synthetic entry.
    expect(chat()).toBeNull();
  });

  it('reveals the composer when "Chat about this" is picked, and focuses it', () => {
    draw([QUESTION]);
    expect(chat()?.textContent).toContain('Chat about this');
    fireEvent.click(chat() as HTMLElement);
    const box = composer()?.querySelector('textarea') ?? null;
    expect(box).not.toBeNull();
    expect(document.activeElement).toBe(box);
  });

  it('reveals it from the keyboard too, on `c`', () => {
    draw([QUESTION]);
    fireEvent.keyDown(q('[role="listbox"]') as HTMLElement, { key: 'c', bubbles: true });
    expect(composer()).not.toBeNull();
  });

  it('is the LAST entry, and is not one of the recorded options', () => {
    draw([QUESTION]);
    const marked = all('[data-question-option]');
    expect(marked).toHaveLength(2); // the two the transcript recorded
    expect(chat()?.getAttribute('data-question-synthetic')).toBe('true');
    expect(chat()?.getAttribute('role')).not.toBe('option');
    // Last in the card, after every option the agent actually offered.
    const card = q('[data-question]') as HTMLElement;
    const entries = [...card.querySelectorAll('[data-question-option],[data-question-chat]')];
    expect(entries.at(-1)).toBe(chat());
  });

  it('says the entry is vam’s, not the agent’s', () => {
    draw([QUESTION]);
    expect(text()).toContain('vam adds this one');
  });

  it('still claims nothing was sent, once the composer is open', () => {
    draw([QUESTION]);
    fireEvent.click(all('[data-question-option]')[0] as HTMLElement);
    fireEvent.click(chat() as HTMLElement);
    const pane = text();
    for (const claim of ['sent', 'submitted', 'answered', 'delivered', 'replied']) {
      expect(pane.toLowerCase(), claim).not.toContain(claim);
    }
    expect(all('[data-question-option][data-picked="true"]')).toHaveLength(1);
  });
});

/**
 * The digits are bare, and "bare" has to mean it.
 *
 * The listener read `event.key` and nothing else, so it answered chords it
 * has no business seeing: `Cmd+C` matched the `c` branch — killing the copy
 * with `preventDefault` and opening the composer — and `Cmd+2` marked the
 * second option AND, since the target is a BUTTON and the window listener
 * steps aside only for INPUT and TEXTAREA, resolved as a chord as well. One
 * keystroke, two effects.
 *
 * Scope was the argument for bare keys ("it can only fire while the keyboard
 * is in the options list") and scope is still true — it is just not an
 * argument about MODIFIERS. A chord is never text and never a pick: under
 * Cmd, Ctrl or Alt this listener stands aside entirely and leaves the
 * keystroke to the grammar, which is the same rule the prompt box follows.
 *
 * It matters more after the digit rework, not less: `Cmd+<digit>` is now the
 * focus-sensitive family, so this is a live collision rather than a
 * theoretical one.
 */
describe('a modifier means the keystroke is not ours', () => {
  const list = () => q('[role="listbox"]') as HTMLElement;
  const picked = () => all('[data-question-option][data-picked="true"]');

  it('leaves Cmd+C alone — the copy lives, and no composer appears', () => {
    draw([QUESTION]);
    // `fireEvent` returns false when the handler called preventDefault.
    const notCancelled = fireEvent.keyDown(list(), { key: 'c', metaKey: true, bubbles: true });
    expect(notCancelled).toBe(true);
    expect(q('[data-prompt-box]')).toBeNull();
  });

  it('leaves Ctrl+C alone as well, which is the same gesture off macOS', () => {
    draw([QUESTION]);
    expect(fireEvent.keyDown(list(), { key: 'c', ctrlKey: true, bubbles: true })).toBe(true);
    expect(q('[data-prompt-box]')).toBeNull();
  });

  it('marks nothing for a modified digit, whichever modifier it is', () => {
    draw([QUESTION]);
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      const notCancelled = fireEvent.keyDown(list(), {
        key: '2',
        code: 'Digit2',
        bubbles: true,
        ...modifier,
      });
      expect(notCancelled, JSON.stringify(modifier)).toBe(true);
      expect(picked(), JSON.stringify(modifier)).toHaveLength(0);
    }
  });

  it('leaves a modified arrow to whatever else wants it', () => {
    draw([QUESTION]);
    const first = all('[data-question-option]')[0] as HTMLButtonElement;
    first.focus();
    expect(fireEvent.keyDown(list(), { key: 'ArrowDown', metaKey: true, bubbles: true })).toBe(
      true,
    );
    expect(document.activeElement).toBe(first);
  });

  it('still answers the unmodified keys, which are the ones it is for', () => {
    draw([QUESTION]);
    expect(fireEvent.keyDown(list(), { key: '2', code: 'Digit2', bubbles: true })).toBe(false);
    expect(picked()).toHaveLength(1);
    expect(fireEvent.keyDown(list(), { key: 'c', bubbles: true })).toBe(false);
    expect(q('[data-prompt-box]')).not.toBeNull();
  });
});
