// @vitest-environment happy-dom

/**
 * `Mod-Shift-<digit>` picks the detail pane's tab, and `p` joins the grammar.
 *
 * Both families are pressed here on purpose: the digit row now means a
 * POSITION twice over — `Mod-1` a session, `Mod-Shift-1` a tab — and the
 * failure mode of that pair is one answering the other.
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

/** `Cmd+Shift+<n>`, spelled the way a real keyboard reports it. */
function tabChord(n: number, target?: HTMLElement) {
  press(String(n), { metaKey: true, shiftKey: true, code: `Digit${n}` }, target);
}

/** `Cmd+<n>` — the session jump that shares the digit row. */
function sessionChord(n: number) {
  press(String(n), { metaKey: true, code: `Digit${n}` });
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

describe('Mod-Shift-<digit> switches the detail pane tab', () => {
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

  it('leaves Mod-<digit> jumping to a session', () => {
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

  it('lists every Mod-Shift digit the tab bar offers', () => {
    const keys = rows().map((row) => row.keys);
    expect(keys).toContain('Mod-Shift-1');
    expect(keys).toContain('Mod-Shift-2');
    expect(keys).toContain('Mod-Shift-3');
    expect(keys).toContain('Mod-Shift-4');
  });

  it('names each tab rather than its number', () => {
    const row = rows().find((candidate) => candidate.keys === 'Mod-Shift-4');
    expect(row?.label).toBe('the agents tab');
  });

  it('lists `p`, which was bound and invisible', () => {
    const row = rows().find((candidate) => candidate.keys === 'p');
    expect(row).toBeDefined();
    expect(row?.label).not.toBe('');
  });
});
