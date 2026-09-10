// @vitest-environment happy-dom

/**
 * A MODAL APP HAS TO SAY WHICH MODE IT IS IN, LOUDLY ENOUGH TO BE SEEN.
 *
 * The indicator was a 10px word in a 32px footer, in the same weight and the
 * same row as six other 10px cells, and it was the WHOLE of the signal: the
 * pane's focus border and its animated top line were both removed at the
 * operator's request, so nothing else on screen changes when the mode does. A
 * daily user of this app concluded the modes had been removed. They had not;
 * they were invisible.
 *
 * Two different requirements, and a fix for one is not a fix for the other:
 *
 *   AT REST, the mode has to be legible — which means a second channel beside
 *   the word, because a word you have to go looking for is a word you do not
 *   read. A chip with a ground of its own, and Insert drawn as the inverse of
 *   Select, so the two differ before you have read either.
 *
 *   AT THE MOMENT IT CHANGES, something has to move. The cell is keyed on the
 *   state it draws, so a change REMOUNTS it and the CSS animation on it runs
 *   again — a swap of textContent in place would replay nothing. That node
 *   identity is what the third case below measures, because it is the
 *   mechanism, and `getAnimations()` on a real element is what
 *   `e2e/mode-truth-shots.mjs` measures, because jsdom runs no animations.
 *
 * NO SECOND SOURCE OF TRUTH. PR 295 made the mode DERIVED from DOM focus
 * (`keyboard/focus-scope.ts`); the `useState` in `Canvas.tsx` is a mirror the
 * footer renders from. Everything here is drawn off that same mirror and off
 * `jumping`/`filtering` — nothing new is stored, which is why there is no case
 * below for "the chip and the word disagree": they cannot.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';

function decision(id: string, over: Partial<Decision> = {}): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [], ...over };
}

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
    decisions: [decision(`d-${id}`)],
    ...over,
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
  ],
};

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

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
    );
  });
}

const cell = () => document.querySelector<HTMLElement>('[data-mode]');
const mode = () => cell()?.textContent ?? '';
const skin = () => cell()?.className ?? '';

describe('the mode is legible at rest', () => {
  it('is a chip with a ground of its own, not one more word in a row of words', () => {
    render(<Canvas model={MODEL} />);
    expect(mode()).toBe('Select');
    // A background and a border are what make it a chip. Asserted as classes
    // because happy-dom resolves no Tailwind; what it PAINTS, and whether the
    // paint clears the contrast floor, is `e2e/mode-truth-shots.mjs`'s.
    expect(skin()).toMatch(/\bbg-/);
    expect(skin()).toMatch(/\bborder\b/);
  });

  it('Select and Insert differ in more than their spelling', () => {
    render(<Canvas model={MODEL} />);
    const resting = skin();
    press('I');
    expect(mode()).toBe('Insert');
    // The failure this rules out is the one that shipped: two states that are
    // one word apart at 10px, in a footer nobody is looking at.
    expect(skin()).not.toBe(resting);
  });

  it('JUMP is drawn as an armed state too, not only spelled as one', () => {
    render(<Canvas model={MODEL} />);
    const resting = skin();
    press('f');
    expect(mode()).toBe('JUMP');
    expect(skin()).not.toBe(resting);
  });
});

describe('a mode change is perceptible at the moment it happens', () => {
  it('remounts the cell so its animation replays, rather than swapping a word in place', () => {
    render(<Canvas model={MODEL} />);
    const before = cell();
    expect(before?.className).toContain('vam-mode-change');
    press('I');
    expect(mode()).toBe('Insert');
    const after = cell();
    expect(after).not.toBeNull();
    // A DIFFERENT ELEMENT. React only remounts on a changed key, and a CSS
    // animation only restarts on a mount — so this identity IS the signal.
    // Drop the key and the word still changes while nothing moves, which is
    // the state a daily user read as "the modes were removed".
    expect(after).not.toBe(before);
    expect(after?.className).toContain('vam-mode-change');
  });

  it('and a render that did not change the mode leaves the cell alone', () => {
    // Otherwise the "animation" would be a flash on every keystroke, which is
    // an alert rather than an indicator — and this is a persistent one.
    render(<Canvas model={MODEL} />);
    const before = cell();
    press('j');
    press('k');
    expect(mode()).toBe('Select');
    expect(cell()).toBe(before);
  });
});
