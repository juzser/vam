// @vitest-environment happy-dom

/**
 * Select and Insert — the two cursor modes, and the rule that they do not
 * interfere.
 *
 * The operator named the model: today's NORMAL is SELECT, and the resting
 * state of the right pane is INSERT. The point of naming it is the invariant
 * underneath: one key means one thing per mode, and neither set reaches into
 * the other.
 *
 *   |            | Select                | Insert                          |
 *   | `hjkl`     | choose a session      | choose an agent option, if any   |
 *
 * `Mod+digit` was the second row of that table until the fourth arrangement
 * of the digit row gave it ONE meaning — the session tab at that position, in
 * either mode — so `hjkl` is the only mode-dependent family left. What the
 * digit still proves here is the other half of the rule: it reaches the
 * grammar from inside a focused text box, where an unmodified key does not.
 *
 * "if any" is doing real work. In Insert with no question open, the composer
 * is drawn and owns its keys — stealing `j` from someone writing a prompt
 * would be indefensible. So option navigation is exactly the state where a
 * question is open and the composer has stood down, which is the state
 * `DetailPanel` already draws.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `cancelable: true` IS LOAD-BEARING IN THIS FILE. DO NOT DROP IT.
 *
 * The rule that keeps the two mode-dependent key sets out of each other's way
 * is one line in `Canvas.tsx`: `if (event.defaultPrevented) return`. The
 * options list answers `j` and calls `preventDefault`; the window listener,
 * which React's root container sits below in the bubble path, then stands
 * down on that same native event. Neither side enumerates the other's keys —
 * the whole arrangement rests on that one flag.
 *
 * `preventDefault()` on an event built WITHOUT `cancelable` is a no-op by
 * specification (happy-dom implements that faithfully), so while these helpers
 * dispatched `new KeyboardEvent('keydown', { bubbles: true })` the flag was
 * never set, the guard never fired, and every case below ran with the canvas
 * listener ALSO handling the keystroke the card had just handled.
 *
 * They passed anyway — and the reason is the thing worth remembering. Insert's
 * own `j`/`k` clamped an index into a one-entry list and Insert's `l` was a
 * bare `return`, so the canvas half of the double-handling did nothing
 * observable. The suite was green BECAUSE OF THE DEFECT it was later sent to
 * fix: the moment those branches learnt to say something, the quiet-case
 * assertion at the bottom of this file went red and exposed the dead guard.
 *
 * A real keydown is cancelable. If a future helper here builds one that is
 * not, this file goes back to proving nothing about which listener owns a key.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { AgentQuestion, CanvasModel, Session } from '../../src/renderer/domain/model.js';

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: 'Colour',
  question: 'Which colour do you prefer?',
  multiSelect: false,
  options: [
    { label: 'Crimson', description: 'a deep red' },
    { label: 'Cobalt', description: 'a vivid blue' },
    { label: 'Emerald', description: 'a bright green' },
  ],
  answer: null,
};

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [{ id: `${id}-d`, label: 'plan', input: 'in', output: 'out', commands: [] }],
    ...over,
  };
}

/** Two sessions, the first of which is being asked something. */
const ASKING: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'factory',
      sessions: [session('a1', { questions: [QUESTION] }), session('a2')],
    },
  ],
};

/** The same shape with nothing being asked — Insert with no options. */
const QUIET: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1'), session('a2')] },
  ],
};

const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
/**
 * The refusal channel, read in BOTH halves.
 *
 * `StatusCell` draws a message shortened to 72 characters and hangs the whole
 * of it on a tooltip, so a refusal longer than that loses the clause that
 * explains it to everyone who does not hover. Asserting the drawn text EQUALS
 * the full text is that limit stated as behaviour, against the real
 * `truncateStatus` rather than against a number copied out of it.
 */
const statusCell = () => document.querySelector('[data-status-bar] [data-status]');
const statusText = () => statusCell()?.textContent ?? '';
const statusFull = () => statusCell()?.getAttribute('data-note') ?? '';
const focusedSession = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.querySelector('[data-row-title]')?.textContent ?? '';
const options = () => [...document.querySelectorAll<HTMLElement>('[data-question-option]')];
const optionLabel = (el: Element | null) =>
  el?.querySelector('span > span:last-child')?.textContent ?? '';
/** The option the keyboard is on — DOM focus is the option cursor. */
const cursorOption = () => {
  const active = document.activeElement;
  return active !== null && active.hasAttribute('data-question-option') ? optionLabel(active) : '';
};
const marked = () => options().filter((el) => el.getAttribute('data-picked') === 'true');

/** A keydown on the window — how a key with nothing focused reaches the app. */
function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/**
 * A keydown on whatever holds DOM focus, which is how a real press arrives
 * once the keyboard is inside the options list. It must BUBBLE: React listens
 * at its root container, so an event dispatched straight at the window never
 * passes the component that would handle it.
 *
 * AND IT MUST BE CANCELABLE, which it was not. `preventDefault()` on an event
 * built without `cancelable` is a no-op by specification — happy-dom
 * implements that faithfully — so `defaultPrevented` stayed false however
 * loudly the options list answered a key, and the canvas listener's whole
 * "a key something else has already answered is not this grammar's" guard was
 * inert in every test in this file. A real `keydown` is cancelable; the
 * cases below only passed because Insert's own branches happened to do
 * nothing, which is the very defect this file is now also about.
 */
function pressFocused(key: string, modifiers: KeyboardEventInit = {}) {
  const target = document.activeElement ?? window;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
    );
  });
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(cleanup);

describe('the status bar names the mode the operator named', () => {
  it('rests in Select and says so', () => {
    render(<Canvas model={QUIET} />);
    expect(mode()).toBe('Select');
  });

  it('says Insert once the keyboard is handed to the right pane', () => {
    render(<Canvas model={QUIET} />);
    press('I');
    expect(mode()).toBe('Insert');
  });

  it('is back in Select when the keyboard is handed back', () => {
    render(<Canvas model={QUIET} />);
    press('I');
    press('H', { metaKey: true, shiftKey: true });
    expect(mode()).toBe('Select');
  });
});

describe('Select: hjkl chooses a session, exactly as before', () => {
  it('walks the sidebar with j and k', () => {
    render(<Canvas model={ASKING} />);
    expect(mode()).toBe('Select');
    expect(focusedSession()).toBe('a1');
    press('j');
    expect(focusedSession()).toBe('a2');
    press('k');
    expect(focusedSession()).toBe('a1');
  });

  it('does not touch the options while the keyboard is in the list', () => {
    render(<Canvas model={ASKING} />);
    // The card is drawn — the question is open — and yet nothing in it has the
    // keyboard, because the keyboard is in the other pane.
    expect(options()).toHaveLength(3);
    expect(cursorOption()).toBe('');
    press('j');
    expect(cursorOption()).toBe('');
  });
});

describe('Insert: hjkl chooses an option when one is being asked', () => {
  it('lands the keyboard on the first option as the mode is entered', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    expect(mode()).toBe('Insert');
    expect(cursorOption()).toBe('Crimson');
  });

  it('walks the options with j and k rather than the sidebar', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    pressFocused('j');
    expect(cursorOption()).toBe('Cobalt');
    pressFocused('j');
    expect(cursorOption()).toBe('Emerald');
    pressFocused('k');
    expect(cursorOption()).toBe('Cobalt');
    // The whole complaint, asserted directly: the sidebar did not move.
    expect(focusedSession()).toBe('a1');
  });

  it('swallows h and l inside the list rather than letting them walk the canvas', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    pressFocused('j');
    pressFocused('l');
    expect(cursorOption()).toBe('Cobalt');
    expect(focusedSession()).toBe('a1');
  });

  it('gives the keys back to the sidebar when the mode is left', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    expect(cursorOption()).toBe('Crimson');
    press('H', { metaKey: true, shiftKey: true });
    expect(mode()).toBe('Select');
    expect(cursorOption()).toBe('');
    press('j');
    expect(focusedSession()).toBe('a2');
  });
});

describe('Insert: Enter selects the option under the cursor', () => {
  it('marks the focused option and nothing else', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    pressFocused('j');
    pressFocused('Enter');
    expect(marked().map((el) => optionLabel(el))).toEqual(['Cobalt']);
  });

  it('does not also mean what Enter means in this pane — the composer stays shut', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    pressFocused('Enter');
    expect(marked().map((el) => optionLabel(el))).toEqual(['Crimson']);
    // `open` on the action pane opens the composer. With a question open the
    // composer is stood down, and Enter must not have raised it.
    expect(document.querySelector('textarea[aria-label="prompt to session"]')).toBeNull();
  });
});

describe('the digits keep working alongside', () => {
  it('marks the option beside the number', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    pressFocused('3');
    expect(marked().map((el) => optionLabel(el))).toEqual(['Emerald']);
    expect(cursorOption()).toBe('Emerald');
  });

  it('leaves a MODIFIED digit to the grammar, which switches session tabs', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    pressFocused('2', { metaKey: true });
    // The option list did not answer it: a Cmd chord is the grammar's, and
    // the grammar moved a tab rather than marking option 2.
    expect(marked()).toHaveLength(0);
  });
});

describe('Insert with nothing being asked: the composer owns its keys', () => {
  it('draws no options and does not walk the sidebar with j', () => {
    render(<Canvas model={QUIET} />);
    press('I');
    expect(options()).toHaveLength(0);
    press('j');
    // Insert has never moved the sidebar, and still does not.
    expect(focusedSession()).toBe('a1');
  });
});

describe('the mouse reaches the composer by the same route the keyboard does', () => {
  const composer = () =>
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');

  it('is in Insert after CLICKING into the prompt box, not only after i', () => {
    render(<Canvas model={QUIET} />);
    const box = composer();
    expect(box).not.toBeNull();
    act(() => {
      fireEvent.focus(box as HTMLTextAreaElement);
    });
    // The bar said Select to an operator typing a prompt, and `Mod+<digit>` --
    // which reads the mode and is let through the typing guard on purpose --
    // moved a session instead of switching a tab.
    expect(mode()).toBe('Insert');
  });

  it('still reaches the grammar from inside the clicked box', () => {
    render(<Canvas model={QUIET} />);
    act(() => {
      fireEvent.focus(composer() as HTMLTextAreaElement);
    });
    press('2', { metaKey: true });
    // A Cmd chord produces a character on no layout, so the box has no claim
    // on it and the second tab came forward. This was the state the mode cell
    // used to lie about; the digit no longer reads the mode at all, and what
    // is left to hold is that the box did not swallow the keystroke.
    expect(focusedSession()).toBe('a2');
  });
});

/**
 * `l` in Insert, on both routes into the failure.
 *
 * The option cursor is DOM focus, so it only exists while an option button
 * holds focus. Walking to the next question unmounted the focused button and
 * focus fell to `document.body`; from there `l` was no longer the listbox's
 * and reached the canvas grammar, which moved the cursor to another node
 * under the pane the operator was reading.
 *
 * The labels here are DISTINCT PER QUESTION on purpose. React reconciles the
 * option buttons by label, so a label that recurs in the next question keeps
 * the DOM node alive and focus survives by accident -- `shared/answer.ts`
 * records that this really happens ("Cobalt was an option in BOTH questions"),
 * which is why the same gesture used to work or fail depending on the call.
 */
const FIRST: AgentQuestion = {
  id: 'toolu_2:0',
  header: 'Colour',
  question: 'Which colour?',
  multiSelect: false,
  options: [
    { label: 'Crimson', description: null },
    { label: 'Cobalt', description: null },
  ],
  answer: null,
};
const SECOND: AgentQuestion = {
  id: 'toolu_2:1',
  header: 'Fruit',
  question: 'Which fruit?',
  multiSelect: false,
  options: [
    { label: 'Apple', description: null },
    { label: 'Pear', description: null },
  ],
  answer: null,
};
const TWO_QUESTIONS: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'factory',
      sessions: [session('a1', { questions: [FIRST, SECOND] }), session('a2')],
    },
  ],
};

describe('walking to the next question keeps the option cursor', () => {
  it('lands on the new step first option rather than on the body', () => {
    render(<Canvas model={TWO_QUESTIONS} />);
    press('I');
    expect(cursorOption()).toBe('Crimson');
    pressFocused('l');
    expect(document.querySelector('[data-question-text]')?.textContent).toBe('Which fruit?');
    expect(cursorOption()).toBe('Apple');
  });

  it('leaves the next h and l inside the card, not on the canvas', () => {
    render(<Canvas model={TWO_QUESTIONS} />);
    press('I');
    pressFocused('l');
    pressFocused('j');
    expect(cursorOption()).toBe('Pear');
    pressFocused('l');
    // The canvas cursor did not move under the pane being read.
    expect(focusedSession()).toBe('a1');
  });
});

/**
 * The root cause, reachable without walking a step at all: press `I` with no
 * question open. Nothing takes the option cursor, focus stays on the body, and
 * `l` used to fall past both Insert guards to the canvas spatial walk -- which
 * moved the cursor onto another session's card under a pane being read. 0.2
 * migration, step 2: that walk is now the open-tab cycle (`h`/`l` re-homed in
 * the same commit as its deletion — `Canvas.tab-cycle.test.tsx`), so the Select
 * case below opens a2's tab with `j` first: with only a1's tab open, `l`
 * degenerately wraps to itself, which would prove nothing about Insert owning
 * the key. Two tabs open, one `l` press wraps the ring — the smallest fixture
 * that still shows Select's `l` moving the cursor at all.
 */
describe('Insert owns the horizontal keys even with no question open', () => {
  it('walks the canvas with l in Select, as it always has', () => {
    render(<Canvas model={QUIET} />);
    press('j'); // opens a2's tab too, landing focus on it
    expect(focusedSession()).toBe('a2');
    press('l');
    expect(focusedSession()).toBe('a1');
  });

  it('does not walk the canvas with l when nothing holds the option cursor', () => {
    render(<Canvas model={QUIET} />);
    press('I');
    expect(mode()).toBe('Insert');
    press('l');
    press('l');
    expect(focusedSession()).toBe('a1');
    expect(mode()).toBe('Insert');
  });
});

/**
 * ABSENT, NOT DIMMED — and where a key cannot be withdrawn, it refuses aloud.
 *
 * `hjkl` cannot be withdrawn in Insert: the same four keys move an open
 * question's options, so they are live in the mode and merely have nothing to
 * act on in the state the operator is actually in. All three did the one thing
 * this repo will not have a control do — nothing, silently. `j`/`k` clamped an
 * index into a list `buildActions` has returned ONE entry from since the
 * command strip left the pane, so the clamp could not move; `l` was an
 * unconditional `return` with a comment explaining why it must not fall
 * through, which is an argument for not acting rather than for not saying so.
 *
 * The noise case is asserted beside them: with a question open the card
 * answers `j` itself and calls `preventDefault`, the canvas listener stands
 * down at `event.defaultPrevented`, and nothing is said. A refusal on an
 * ordinary walk down three options would be exactly the noise that teaches an
 * operator to stop reading the bar.
 */
describe('Insert says why a key cannot act instead of eating it', () => {
  it('answers j and k when the pane cursor has one stop', () => {
    render(<Canvas model={QUIET} />);
    press('I');
    press('j');
    expect(statusText()).toContain('prompt');
    expect(statusText()).toBe(statusFull());
    const afterDown = statusText();
    press('k');
    expect(statusText()).toContain('prompt');
    expect(statusText()).toBe(statusFull());
    // Two directions, two sentences: a refusal that reads the same either way
    // cannot tell the operator which key it answered.
    expect(statusText()).not.toBe(afterDown);
  });

  it('answers l when there is no question to step through', () => {
    render(<Canvas model={QUIET} />);
    press('I');
    press('l');
    expect(statusText()).not.toBe('');
    expect(statusText()).toBe(statusFull());
    // Still no cursor movement — the refusal replaces the silence, not the
    // guard that stopped `l` reaching the tab ring.
    expect(focusedSession()).toBe('a1');
    expect(mode()).toBe('Insert');
  });

  it('stays quiet while the options list is answering the same keys', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    pressFocused('j');
    expect(cursorOption()).toBe('Cobalt');
    expect(statusText()).toBe('');
    pressFocused('l');
    expect(statusText()).toBe('');
  });
});
