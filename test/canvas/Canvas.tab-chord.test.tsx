// @vitest-environment happy-dom

/**
 * `Mod-<digit>` picks the detail pane's tab, and `p` joins the grammar.
 *
 * Both families are pressed here on purpose: the digit row means a POSITION
 * twice over — `Mod-1` a tab, `Mod-Shift-1` a session — and the failure mode
 * of that pair is one answering the other. They shipped the other way round
 * and the operator reported the collision: Cmd+number is the tab gesture
 * everywhere else, so the tabs took the bare row.
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

/** `Cmd+<n>` — the tab, spelled the way a real keyboard reports it. */
function tabChord(n: number, target?: HTMLElement) {
  press(String(n), { metaKey: true, code: `Digit${n}` }, target);
}

/** `Cmd+Shift+<n>` — the session jump that shares the digit row. On a US
 *  layout the browser hands us `!` for Shift+1, so the shifted characters are
 *  what a real keydown carries; the POSITION is in `code`. */
const SHIFTED = ['!', '@', '#', '$', '%', '^', '&', '*', '('] as const;
function sessionChord(n: number) {
  press(SHIFTED[n - 1] as string, { metaKey: true, shiftKey: true, code: `Digit${n}` });
}

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

describe('Mod-<digit> switches the detail pane tab', () => {
  it('selects the tab at that position', () => {
    mountFocused();
    expect(selectedTab()).toBe('response');
    tabChord(4);
    expect(selectedTab()).toBe('agents');
    tabChord(2);
    expect(selectedTab()).toBe('prs');
    tabChord(1);
    expect(selectedTab()).toBe('response');
  });

  it('leaves Mod-Shift-<digit> jumping to a session', () => {
    mountFocused();
    expect(focusedTitle()).toBe('a1');
    sessionChord(2);
    expect(focusedTitle()).toBe('a2');
    // And the tab it shares a digit with did not move.
    expect(selectedTab()).toBe('response');
  });

  it('fires with the prompt box focused, where the operator actually is', () => {
    const { container } = mountFocused();
    const box = container.querySelector('[aria-label="prompt to session"]') as HTMLTextAreaElement;
    box.focus();
    tabChord(4, box);
    expect(selectedTab()).toBe('agents');
  });

  it('leaves an unmodified key typed in the prompt box alone', () => {
    const { container } = mountFocused();
    const box = container.querySelector('[aria-label="prompt to session"]') as HTMLTextAreaElement;
    box.focus();
    // `!` is what Shift+1 produces as text, and typing it must stay typing.
    press('!', { shiftKey: true, code: 'Digit1' }, box);
    expect(selectedTab()).toBe('response');
  });

  it('does not fire while an overlay is open', () => {
    mountFocused();
    press('?', { shiftKey: true });
    expect(sheet()).not.toBeNull();
    tabChord(4);
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

describe('the generated key sheet lists both', () => {
  const rows = () => buildKeySheet().flatMap((group) => group.rows);
  const keyFor = (label: string) =>
    rows()
      .filter((row) => row.label === label)
      .map((row) => row.keys);

  it('lists the tabs on the bare digits, by value', () => {
    expect(keyFor('the response tab')).toEqual(['Mod-1']);
    expect(keyFor('the prs tab')).toEqual(['Mod-2']);
    expect(keyFor('the terminal tab')).toEqual(['Mod-3']);
    expect(keyFor('the agents tab')).toEqual(['Mod-4']);
  });

  it('lists the sessions on the shifted digits, by value', () => {
    for (let position = 1; position <= 8; position += 1) {
      expect(keyFor(`session ${position} in the sidebar`)).toEqual([`Mod-Shift-${position}`]);
    }
    // `last` holds two keys, and the ninth shifted digit is the second.
    expect(keyFor('last session')).toEqual(['G', 'Mod-Shift-9']);
  });

  it('names no digit nothing is bound to', () => {
    const keys = rows().map((row) => row.keys);
    for (const digit of ['Mod-5', 'Mod-6', 'Mod-7', 'Mod-8', 'Mod-9', 'Mod-0']) {
      expect(keys, digit).not.toContain(digit);
    }
  });

  it('lists `p`, which was bound and invisible', () => {
    const row = rows().find((candidate) => candidate.keys === 'p');
    expect(row).toBeDefined();
    expect(row?.label).not.toBe('');
  });
});
