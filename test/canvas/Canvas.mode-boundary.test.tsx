// @vitest-environment happy-dom

/**
 * THE BOUNDARY BETWEEN SELECT AND INSERT IS DOM FOCUS, AND NOTHING ELSE.
 *
 * `Canvas.cursor-mode.test.tsx` is about what each mode's keys DO. This file
 * is about the seam between them: the audit's F4 and F5, which are one defect
 * seen from two sides — the mode was a React flag a handler set beside
 * whatever it did (or failed to do) to focus, so the two could disagree.
 *
 *   F4. `Mod-0` passed the typing guard, set the flag to Select and moved no
 *       focus. The bar read Select while a now read-only textarea still held
 *       the keyboard, and every bare `j`/`k` died in it. The leaving-Insert
 *       effect blurred only `[data-question-option]`, so the composer's own
 *       exit (`Escape`, which blurs explicitly) was the ONLY way out that
 *       worked — and `Mod-0` did not use it.
 *
 *   F5. `I` set the flag to Insert whether or not anything in the pane took
 *       the keyboard, so Insert could be entered with nothing to insert into.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `cancelable: true` IS LOAD-BEARING HERE TOO — the whole argument is in
 * `Canvas.cursor-mode.test.tsx`'s header and is not repeated. In short:
 * `preventDefault()` on an event built without it is a specified no-op, so
 * `Canvas.tsx`'s `if (event.defaultPrevented) return` goes inert and every
 * case runs with BOTH listeners handling the keystroke. `pressFocused` below
 * builds cancelable events. Do not drop it.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { AgentQuestion, CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { INSERT_SCOPE, INSERT_STOP } from '../../src/renderer/keyboard/focus-scope.js';

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: 'Colour',
  question: 'Which colour do you prefer?',
  multiSelect: false,
  options: [
    { label: 'Crimson', description: 'a deep red' },
    { label: 'Cobalt', description: 'a vivid blue' },
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

/** Two sessions, nothing being asked — Insert with only the prompt in it. */
const QUIET: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1'), session('a2')] },
  ],
};

/** The same, with the first session asking something. */
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

const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
const composer = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
const focusedSession = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.querySelector('[data-row-title]')?.textContent ?? '';
const statusText = () =>
  document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '';

/** A keydown on the window — a key with nothing focused. */
function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/** A keydown on whatever really holds focus, which is how a real press
 *  arrives — and the only way to reproduce a guard that reads `event.target`. */
function pressFocused(key: string, modifiers: KeyboardEventInit = {}) {
  const target = document.activeElement ?? window;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
    );
  });
}

/** `Mod-0`, spelled the way a real macOS keydown spells it: the CODE carries
 *  the position, which is why `chords.ts` reads it for the digit row. */
function pressModZero() {
  pressFocused('0', { metaKey: true, code: 'Digit0' });
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

/**
 * The invariant the whole change rests on, asserted directly and in both
 * directions: the cell CANNOT read Select while an insert scope holds the
 * keyboard, because it is not a second fact — it is that one.
 */
describe('the mode cell is a report about DOM focus', () => {
  it('turns to Insert the moment focus enters a scope, however it got there', () => {
    render(<Canvas model={QUIET} />);
    expect(mode()).toBe('Select');
    const box = composer() as HTMLTextAreaElement;
    expect(box.closest(`[${INSERT_SCOPE}]`)).not.toBeNull();
    act(() => {
      box.focus();
      fireEvent.focusIn(box);
    });
    expect(mode()).toBe('Insert');
  });

  it('turns back to Select the moment focus leaves it — no key pressed at all', () => {
    render(<Canvas model={QUIET} />);
    const box = composer() as HTMLTextAreaElement;
    act(() => {
      box.focus();
      fireEvent.focusIn(box);
    });
    expect(mode()).toBe('Insert');
    act(() => {
      box.blur();
      fireEvent.focusOut(box, { relatedTarget: null });
    });
    expect(mode()).toBe('Select');
  });
});

/**
 * F4. `Mod-0` — the finding, and the behaviour that proves the fix.
 *
 * The assertion that matters is not the cell. It is that a bare `j`, typed
 * where the operator's fingers really are, reaches the sidebar afterwards:
 * that is what the still-focused textarea was eating.
 */
describe('F4 — Mod-0 hands the keyboard back rather than only saying it did', () => {
  it('releases the composer’s DOM focus', () => {
    render(<Canvas model={QUIET} />);
    const box = composer() as HTMLTextAreaElement;
    act(() => {
      box.focus();
      fireEvent.focusIn(box);
    });
    expect(document.activeElement).toBe(box);
    pressModZero();
    expect(mode()).toBe('Select');
    expect(document.activeElement).not.toBe(box);
  });

  it('so the very next bare j walks the sidebar, from where the fingers are', () => {
    render(<Canvas model={QUIET} />);
    const box = composer() as HTMLTextAreaElement;
    act(() => {
      box.focus();
      fireEvent.focusIn(box);
    });
    expect(focusedSession()).toBe('a1');
    pressModZero();
    // Dispatched at whatever holds focus NOW — the reproduction depends on it.
    // While the read-only box still held focus this landed in the box and the
    // window listener returned at its own typing guard.
    pressFocused('j');
    expect(focusedSession()).toBe('a2');
  });

  it('does the same from inside an open question’s options', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    expect(mode()).toBe('Insert');
    expect(document.activeElement?.hasAttribute('data-question-option')).toBe(true);
    pressModZero();
    expect(mode()).toBe('Select');
    expect(document.activeElement?.hasAttribute('data-question-option')).not.toBe(true);
    pressFocused('j');
    expect(focusedSession()).toBe('a2');
  });

  it('and Mod-Shift-h, the other spelling of the same action, is no different', () => {
    render(<Canvas model={QUIET} />);
    const box = composer() as HTMLTextAreaElement;
    act(() => {
      box.focus();
      fireEvent.focusIn(box);
    });
    // IT USED TO BE A BARE `H`, and the comment here said that a bare letter
    // could not come from inside the box, so this arrived from the shell —
    // the state after clicking a tab strip: composing, focus elsewhere. The
    // operator moved it to `Cmd+Shift+H` (Cmd+H is macOS's Hide), which is a
    // chord and therefore CAN come from inside the box. The case being
    // driven is unchanged: whichever spelling reaches it, the mode has to
    // follow the keyboard rather than only report on it.
    press('H', { metaKey: true, shiftKey: true });
    expect(mode()).toBe('Select');
    expect(document.activeElement).not.toBe(box);
  });
});

/**
 * F5. `I` cannot claim a cursor that does not exist.
 *
 * The mode is where focus is, so "Insert" and "something in this pane holds
 * the keyboard" are the same sentence. The old flag could say the first
 * without the second, and `hjkl` then fell through to the canvas grammar
 * under a pane being read.
 */
describe('F5 — entering Insert is a focus move that either lands or refuses', () => {
  it('lands on the question when one is open', () => {
    render(<Canvas model={ASKING} />);
    press('I');
    expect(mode()).toBe('Insert');
    expect(document.activeElement?.hasAttribute('data-question-option')).toBe(true);
  });

  it('lands on the prompt ROW when none is — never on the body', () => {
    render(<Canvas model={QUIET} />);
    press('I');
    expect(mode()).toBe('Insert');
    // WAS: nothing took the keyboard at all, and `document.activeElement`
    // stayed on the body while the bar read Insert.
    expect(document.activeElement).not.toBe(document.body);
    expect((document.activeElement as HTMLElement).hasAttribute(INSERT_STOP)).toBe(true);
  });

  it('lands on the ROW and not in the box — the caret is `i`, not `I`', () => {
    render(<Canvas model={QUIET} />);
    press('I');
    expect(document.activeElement).not.toBe(composer());
    // Which is what keeps Insert's own `j`/`k` alive: a focused TEXTAREA
    // would send every bare key to the window listener's typing guard, and
    // the refusal this pane owes for a cursor with one stop would vanish.
    press('j');
    expect(statusText()).toContain('prompt');
  });

  it('refuses with nothing focused, rather than recording a mode', () => {
    render(<Canvas model={{ projects: [] }} />);
    press('I');
    expect(mode()).toBe('Select');
    expect(statusText()).not.toBe('');
  });
});

/**
 * `i` is the other door into the same room, and it must leave the mode
 * agreeing with focus just as `I` does — this is where the flag used to be
 * set from two places with two different ideas of what had happened.
 */
describe('i puts the caret in the box, and the mode follows the caret', () => {
  it('opens the composer, focuses it, and reads Insert', () => {
    render(<Canvas model={QUIET} />);
    press('i');
    expect(document.activeElement).toBe(composer());
    expect(mode()).toBe('Insert');
  });

  it('and Mod-[ from there returns the keyboard AND the mode together', () => {
    // `Mod-[` is the way out since Escape in the composer became the agent's
    // interrupt. The property under test is unchanged: whatever the key, it
    // has to move DOM FOCUS, because the mode is derived from focus and a
    // mode that said Select over a focused textarea was this file's own bug.
    render(<Canvas model={QUIET} />);
    press('i');
    pressFocused('[', { code: 'BracketLeft', metaKey: true });
    expect(mode()).toBe('Select');
    expect(document.activeElement).not.toBe(composer());
    pressFocused('j');
    expect(focusedSession()).toBe('a2');
  });
});
