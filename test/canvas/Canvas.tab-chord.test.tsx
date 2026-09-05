// @vitest-environment happy-dom

/**
 * `Mod-<digit>` is a position in whichever pane has the keyboard, and `p`
 * joins the grammar.
 *
 * There is one digit family now, and both of its meanings are pressed here on
 * purpose: the failure mode of a context-dependent key is that the context is
 * ignored. It took three arrangements to get here — sessions on the bare row
 * with tabs under Shift, then the reverse — and both were wrong in the same
 * way, plus a defect neither could survive: macOS captures `Cmd+Shift+3/4/5`
 * for screenshots before any Electron window sees them, so a quarter of each
 * arrangement was unreachable on the only platform vam ships to.
 *
 * `p` was real but ungoverned: hand-wired to its own window listener in
 * `SessionList.tsx`, it appeared in no key sheet and fired straight through an
 * open overlay. Both are asserted, the second as a direct negative rather than
 * through a status message, because the overlay guard is the subject.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';

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
    decisions: [],
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1'), session('a2')] },
    { id: 'p2', name: 'beta', source: 'orca', sessions: [session('b1')] },
  ],
};

const focusedTitle = () => document.querySelector('[data-prompt-target]')?.textContent ?? '';
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const selectedTab = () =>
  document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tab') ?? null;
const sheet = () => document.querySelector('[data-key-sheet]');
const revealed = (project: string) =>
  document
    .querySelector(`[data-project-heading][data-project-id="${project}"]`)
    ?.getAttribute('data-project-revealed') ?? null;

function press(key: string, modifiers: KeyboardEventInit = {}, target?: HTMLElement) {
  act(() => {
    if (target === undefined) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
    } else {
      fireEvent.keyDown(target, { key, bubbles: true, ...modifiers });
    }
  });
}

/** `Cmd+<n>`, spelled the way a real keyboard reports it. ONE chord now: what
 *  it counts depends on which pane has the keyboard, which is the subject of
 *  the tests below. */
function digitChord(n: number, target?: HTMLElement) {
  press(String(n), { metaKey: true, code: `Digit${n}` }, target);
}

/** Into the response pane and back, the way an operator gets there. */
const intoResponsePane = () => press('I');
const backToList = () => press('H');

/** A focused session, which is what makes the detail pane draw its tabs. */
function mountFocused() {
  const view = render(<Canvas model={MODEL} />);
  press('g');
  press('g');
  return view;
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, String(v)),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: (i: number) => [...map.keys()][i] ?? null,
        get length() {
          return map.size;
        },
      };
    })() as unknown as Storage,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Mod-<digit> is a position in whatever pane has the keyboard', () => {
  it('switches SESSION while the cursor is in the sidebar', () => {
    mountFocused();
    expect(focusedTitle()).toBe('a1');
    digitChord(2);
    expect(focusedTitle()).toBe('a2');
    // And the tab it shares a digit with did not move.
    expect(selectedTab()).toBe('response');
  });

  /**
   * THE DIGIT COUNTS WHAT THE BAR DRAWS. This model's source declares no
   * terminal, so the bar reads `Response · PRs · Agents` and Agents is
   * visibly third. It used to be `Mod-4`, because the handler indexed the
   * unfiltered constant: `Mod-3` resolved to the withdrawn Terminal tab and
   * silently landed back on Response.
   */
  it('switches TAB once the keyboard is in the response pane', () => {
    mountFocused();
    intoResponsePane();
    digitChord(3);
    expect(selectedTab()).toBe('agents');
    digitChord(2);
    expect(selectedTab()).toBe('prs');
    // The sidebar cursor stayed where it was: this press was not for it.
    expect(focusedTitle()).toBe('a1');
  });

  it('goes back to sessions when the keyboard goes back to the list', () => {
    mountFocused();
    intoResponsePane();
    digitChord(3);
    expect(selectedTab()).toBe('agents');
    backToList();
    digitChord(2);
    expect(focusedTitle()).toBe('a2');
    // Still on the tab the operator chose — moving in the list is not a
    // reason to reset the pane they were reading.
    expect(selectedTab()).toBe('agents');
  });

  /**
   * `Mod-5`..`Mod-9` are bound and no tab answers them. In the response pane
   * they refuse OUT LOUD rather than falling through to the sidebar: a digit
   * that quietly moved the cursor in a pane the operator is not looking at is
   * the exact defect this arrangement exists to fix, and silence would leave
   * them pressing it again.
   *
   * The COUNT it refuses with is the drawn one. "only 4 tabs" over a bar
   * showing three is the same handler-with-its-own-idea the position rule was
   * written against.
   */
  it('refuses a digit past the last tab, and does not fall through to sessions', () => {
    mountFocused();
    intoResponsePane();
    digitChord(7);
    expect(selectedTab()).toBe('response');
    expect(focusedTitle()).toBe('a1');
    expect(statusBar()).toContain('only 3 tabs');
  });

  it('refuses the digit of a tab that was WITHDRAWN, rather than landing nowhere', () => {
    mountFocused();
    intoResponsePane();
    // Position 4 exists in the constant (Agents was fourth of four) and does
    // not exist on this bar. Asking for it must be refused, not accepted and
    // silently reverted to Response.
    digitChord(2);
    expect(selectedTab()).toBe('prs');
    digitChord(4);
    expect(selectedTab()).toBe('prs');
    expect(statusBar()).toContain('only 3 tabs');
  });

  it('the ninth is the LAST session while the sidebar has the keyboard', () => {
    mountFocused();
    digitChord(9);
    expect(focusedTitle()).toBe('b1'); // three sessions, and 9 still lands
  });

  it('fires with the prompt box focused, where the operator actually is', () => {
    const { container } = mountFocused();
    intoResponsePane();
    const box = container.querySelector('[aria-label="prompt to session"]') as HTMLTextAreaElement;
    box.focus();
    digitChord(3, box);
    expect(selectedTab()).toBe('agents');
  });

  it('leaves an unmodified key typed in the prompt box alone', () => {
    const { container } = mountFocused();
    const box = container.querySelector('[aria-label="prompt to session"]') as HTMLTextAreaElement;
    box.focus();
    // `!` is what Shift+1 produces as text, and typing it must stay typing.
    press('!', { shiftKey: true, code: 'Digit1' }, box);
    expect(selectedTab()).toBe('response');
    expect(focusedTitle()).toBe('a1');
  });

  it('does not fire while an overlay is open', () => {
    mountFocused();
    press('?', { shiftKey: true });
    expect(sheet()).not.toBeNull();
    digitChord(2);
    expect(focusedTitle()).toBe('a1');
    expect(selectedTab()).toBe('response');
  });
});

describe('`p` is a binding like every other', () => {
  it('reveals the focused session’s project', () => {
    mountFocused();
    expect(revealed('p1')).toBeNull();
    press('p');
    expect(revealed('p1')).toBe('true');
  });

  it('does not fire while an overlay is open', () => {
    mountFocused();
    press('?', { shiftKey: true });
    expect(sheet()).not.toBeNull();
    press('p');
    expect(revealed('p1')).toBeNull();
  });
});

describe('the generated key sheet tells the truth about the digits', () => {
  const rows = () => buildKeySheet().flatMap((group) => group.rows);
  const keys = () => rows().map((row) => row.keys);

  it('lists every bound digit, and only those', () => {
    for (let digit = 1; digit <= 9; digit += 1) {
      expect(keys(), `Mod-${digit}`).toContain(`Mod-${digit}`);
    }
    expect(keys()).not.toContain('Mod-0');
  });

  /**
   * The sheet may not name a tab that cannot exist. `Mod-5`..`Mod-9` are bound
   * and the pane holds four tabs at most, so the Insert caption for those five
   * used to print "tab 5 in the response pane" through "tab 9" -- a binding
   * that is real under a caption that is not, which is the one thing a
   * generated sheet exists to make impossible.
   */
  it('names no tab past the last one the pane can hold', () => {
    const insertLabels = rows()
      .filter((row) => row.mode === 'insert' && row.keys.startsWith('Mod-'))
      .map((row) => row.label);
    expect(insertLabels.some((label) => label.includes('tab 4'))).toBe(true);
    for (const digit of [5, 6, 7, 8, 9]) {
      expect(
        insertLabels.some((label) => label.includes(`tab ${digit}`)),
        `tab ${digit}`,
      ).toBe(false);
    }
  });

  it('names NO Mod-Shift digit — macOS owns three of them', () => {
    for (let digit = 1; digit <= 9; digit += 1) {
      expect(keys(), `Mod-Shift-${digit}`).not.toContain(`Mod-Shift-${digit}`);
    }
  });

  /**
   * The row cannot say "session 1", because that is wrong every time the
   * operator is in the response pane. It names BOTH, which is what the key
   * actually does.
   */
  it('says a digit means a session or a tab, one row per cursor mode', () => {
    // Two rows now, not one caption naming both: the operator's point is that
    // the two meanings belong to two named modes and do not interfere, and a
    // single undifferentiated row is what hid that.
    const digit = rows().filter((candidate) => candidate.keys === 'Mod-2');
    expect(digit.map((row) => row.mode)).toEqual(['select', 'insert']);
    const select = digit.find((row) => row.mode === 'select');
    const insert = digit.find((row) => row.mode === 'insert');
    expect(select?.label).toContain('Select');
    expect(select?.label).toContain('session 2');
    expect(select?.label).not.toContain('tab 2');
    expect(insert?.label).toContain('Insert');
    expect(insert?.label).toContain('tab 2');
    expect(insert?.label).not.toContain('session 2');
  });

  it('splits hjkl the same way — a session in Select, an option in Insert', () => {
    const walk = rows().filter((candidate) => candidate.keys === 'j');
    expect(walk.map((row) => row.mode)).toEqual(['select', 'insert']);
    expect(walk.find((row) => row.mode === 'select')?.label).toContain('session list');
    expect(walk.find((row) => row.mode === 'insert')?.label).toContain('options');
  });

  it('says the ninth is the last session rather than a ninth one', () => {
    const row = rows().find((candidate) => candidate.keys === 'Mod-9');
    expect(row?.label).toContain('LAST');
  });

  it('lists `p`, which was bound and invisible', () => {
    const row = rows().find((candidate) => candidate.keys === 'p');
    expect(row).toBeDefined();
    expect(row?.label).not.toBe('');
  });
});
