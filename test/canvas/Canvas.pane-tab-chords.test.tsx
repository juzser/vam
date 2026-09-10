// @vitest-environment happy-dom

/**
 * THE TAB FAMILY AND THE PANE FAMILY, ONE MODIFIER APART.
 *
 *   `Mod-Shift-[` / `Mod-Shift-]`   previous / next TAB
 *   `Mod-Alt-[`   / `Mod-Alt-]`     previous / next PANE
 *   `Mod-1` … `Mod-9`               the tab at that position, ACROSS panes
 *
 * The brackets are the browser's own tab gesture on macOS, and they are safe
 * where `Mod-Shift-<digit>` is not: macOS matches `Cmd+Shift+3/4/5` through
 * `com.apple.symbolichotkeys` before Electron sees the keydown, and no test
 * can catch a binding put there because the OS never delivers the event a test
 * synthesises. The pane pair sits one modifier up so the two read as a family.
 *
 * `Mod-<digit>` COUNTING ACROSS PANES is the fifth arrangement of that row and
 * the operator's own call; `chords.ts` records it with its cost. What is
 * asserted here is the behaviour, in a split shell where the two rules differ:
 * with one tab in each of two panes, the old per-pane rule made `Mod-1` mean
 * "this pane's only tab" in either pane and `Mod-2` refuse in both.
 *
 * Every keystroke is spelled the way a real keyboard reports it — `code` for
 * the position, and the CHARACTER the modifiers actually produce (`}` under
 * Shift, `‘` under Alt on macOS). A test that sent `]` would be testing a
 * layout nobody has.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string): Session {
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
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'factory',
      sessions: [session('a1'), session('a2'), session('a3')],
    },
  ],
};

const focusedTitle = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.querySelector('[data-row-title]')?.textContent ?? '';
const focusedPane = () =>
  document
    .querySelector('[data-split-pane][data-split-focused="true"]')
    ?.getAttribute('data-split-pane') ?? null;
const panes = () =>
  [...document.querySelectorAll('[data-split-pane]')].map((el) =>
    el.getAttribute('data-split-pane'),
  );
const statusText = () =>
  document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '';

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/** `Cmd+Shift+]` as macOS delivers it: the character is a brace, the position
 *  is `BracketRight`, and only the second of those is a binding. */
const nextTab = () => press('}', { metaKey: true, shiftKey: true, code: 'BracketRight' });
const prevTab = () => press('{', { metaKey: true, shiftKey: true, code: 'BracketLeft' });
/** `Cmd+Alt+]`, which on a macOS US layout produces a typographic quote. */
const nextPane = () => press('‘', { metaKey: true, altKey: true, code: 'BracketRight' });
const prevPane = () => press('“', { metaKey: true, altKey: true, code: 'BracketLeft' });
const digitChord = (n: number) => press(String(n), { metaKey: true, code: `Digit${n}` });

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
 * Two panes, with the tabs INTERLEAVED across them — the smallest shell where
 * "the focused pane's strip" and "every strip on screen" are different lists,
 * and where the difference is more than an offset.
 *
 * Every session of the active project is a tab (A11.1), so pane-1 opens
 * holding all three. `j` brings a2 forward; `zv` MOVES the active tab into a
 * new pane (PR 268), so pane-1 keeps a1 and a3 and pane-2 receives a2 with the
 * keyboard. Drawn across panes, in the order the strips paint: a1, a3, a2.
 *
 * That order is asserted rather than assumed by the case below it, so a
 * fixture reordered by status can never turn a real regression green.
 */
const DRAWN = ['a1', 'a3', 'a2'];

function twoPanes() {
  render(<Canvas model={MODEL} />);
  press('j');
  expect(focusedTitle()).toBe('a2');
  press('z');
  press('v');
  expect(panes()).toHaveLength(2);
  expect(focusedPane()).toBe('pane-2');
}

const drawnTabs = () =>
  [...document.querySelectorAll('[data-split-pane] [data-tab-select]')].map((el) => el.textContent);

describe('Mod-<digit> counts tabs across panes, in visual order', () => {
  it('counts the strips as PAINTED, not the order the panes were filled', () => {
    // `orderedPaneTabs` is what each strip draws — session status, not the
    // order tabs were opened — and #294 landed a joined tab at that same
    // position for the same reason. Every case below indexes THIS list.
    twoPanes();
    expect(drawnTabs()).toEqual(DRAWN);
  });

  it('reaches a tab that lives in ANOTHER pane, and takes the keyboard with it', () => {
    twoPanes();
    // WAS: `Mod-1` meant "the first tab of the pane I am in", so from pane-2
    // it named a2 — the tab already in front — and a1 was unreachable by
    // number without first stepping panes.
    digitChord(1);
    expect(focusedTitle()).toBe(DRAWN[0]);
    expect(focusedPane()).toBe('pane-1');
  });

  it('numbers straight through the pane boundary rather than restarting at it', () => {
    twoPanes();
    digitChord(2);
    // Position 2 is pane-1's SECOND tab, because position 1 was its first —
    // the count does not begin again in each strip.
    expect(focusedTitle()).toBe(DRAWN[1]);
    expect(focusedPane()).toBe('pane-1');
    digitChord(3);
    // WAS: "only 2 tabs in this pane" — pane-1 holds two, and the third tab
    // on screen was not something a digit could address at all.
    expect(focusedTitle()).toBe(DRAWN[2]);
    expect(focusedPane()).toBe('pane-2');
    expect(statusText()).toBe('');
  });

  it('takes 9 as THE LAST tab on screen, whatever the count', () => {
    twoPanes();
    digitChord(1);
    digitChord(9);
    expect(focusedTitle()).toBe(DRAWN[DRAWN.length - 1]);
  });

  it('refuses a digit past the last tab, and counts every pane when it says so', () => {
    twoPanes();
    digitChord(4);
    // Three tabs are open across two panes; the sentence has to be about that
    // list, not about whichever pane happens to hold the keyboard.
    expect(statusText()).toContain('3');
    expect(focusedTitle()).toBe('a2');
  });
});

describe('Mod-Shift-[ and Mod-Shift-] step the tab', () => {
  it('goes forward and wraps at the end', () => {
    twoPanes();
    // a2 is the LAST of the three as drawn, so the next one wraps.
    expect(focusedTitle()).toBe(DRAWN[2]);
    nextTab();
    expect(focusedTitle()).toBe(DRAWN[0]);
    nextTab();
    expect(focusedTitle()).toBe(DRAWN[1]);
  });

  it('goes back, and wraps at the start', () => {
    twoPanes();
    prevTab();
    expect(focusedTitle()).toBe(DRAWN[1]);
    prevTab();
    expect(focusedTitle()).toBe(DRAWN[0]);
    prevTab();
    expect(focusedTitle()).toBe(DRAWN[2]);
  });

  it('carries the keyboard into the pane the tab lives in', () => {
    twoPanes();
    expect(focusedPane()).toBe('pane-2');
    nextTab();
    expect(focusedPane()).toBe('pane-1');
  });

  it('works with the caret in the prompt box, where the reason to switch comes from', () => {
    twoPanes();
    const box = document.querySelector<HTMLTextAreaElement>(
      '[data-split-focused="true"] textarea[aria-label="prompt to session"]',
    );
    expect(box).not.toBeNull();
    act(() => {
      (box as HTMLTextAreaElement).focus();
    });
    nextTab();
    expect(focusedTitle()).toBe(DRAWN[0]);
  });
});

describe('Mod-Alt-[ and Mod-Alt-] step the pane', () => {
  it('moves the keyboard to the next pane and wraps', () => {
    twoPanes();
    expect(focusedPane()).toBe('pane-2');
    nextPane();
    expect(focusedPane()).toBe('pane-1');
    nextPane();
    expect(focusedPane()).toBe('pane-2');
  });

  it('moves it back the other way', () => {
    twoPanes();
    prevPane();
    expect(focusedPane()).toBe('pane-1');
  });

  it('leaves zw and zW doing exactly what they did — nothing loses a route', () => {
    twoPanes();
    press('z');
    press('w');
    expect(focusedPane()).toBe('pane-1');
    press('z');
    press('W');
    expect(focusedPane()).toBe('pane-2');
  });

  it('refuses aloud with only one pane, as its chord spelling always has', () => {
    render(<Canvas model={MODEL} />);
    expect(panes()).toHaveLength(1);
    nextPane();
    expect(statusText()).not.toBe('');
  });
});

/**
 * The two families must not answer each other. They differ by one modifier and
 * sit on one physical key, which is the exact shape that has twice let one
 * digit family answer the other's keystroke in this codebase.
 */
describe('the bracket pair keeps its two families apart', () => {
  it('a PANE step shows whatever that pane already had in front', () => {
    twoPanes();
    nextPane();
    expect(focusedPane()).toBe('pane-1');
    // pane-1 holds a1 and a3 and was left showing a3 when `zv` took a2 out.
    // A pane step lands on THAT, not on a position in the tab ring.
    expect(focusedTitle()).toBe('a3');
  });

  it('a TAB step from the same place lands somewhere else entirely', () => {
    twoPanes();
    nextTab();
    // The next tab in the drawn order, wrapping past the end — a different
    // answer from the pane step above, out of the same starting state, which
    // is what proves one modifier apart is really two families.
    expect(focusedTitle()).toBe(DRAWN[0]);
  });

  it('an UNMODIFIED bracket is a character, not a chord', () => {
    twoPanes();
    press(']', { code: 'BracketRight' });
    press('[', { code: 'BracketLeft' });
    expect(focusedTitle()).toBe('a2');
    expect(focusedPane()).toBe('pane-2');
  });
});
