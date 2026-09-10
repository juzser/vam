// @vitest-environment happy-dom

/**
 * TWO digit families that must never answer each other's keystroke, and `p`.
 *
 * `Mod-<digit>` picks a session TAB in the focused pane; `Alt-<digit>` picks
 * one of that pane's four VIEWS. Both are pressed here, in one mounted shell,
 * because the failure mode of two families on one row is that one of them
 * quietly answers the other — which this codebase has shipped twice, once by
 * indexing the drawn list and once by letting a hand-written window listener
 * live beside the table.
 *
 * It took four arrangements to get here. Sessions on the bare row with tabs
 * under Shift; then the reverse; then one context-dependent meaning per
 * cursor mode; and now one fixed meaning, at the operator's request, made
 * possible by the views having moved to the other modifier. The first two
 * carried a defect neither could survive: macOS captures `Cmd+Shift+3/4/5`
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
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1'), session('a2')] },
    { id: 'p2', name: 'beta', source: 'orca', sessions: [session('b1')] },
  ],
};

const focusedTitle = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.querySelector('[data-row-title]')?.textContent ?? '';
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const selectedTab = () =>
  document.querySelector('[data-view][aria-pressed="true"]')?.getAttribute('data-view') ?? null;
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

/** `Cmd+<n>`, spelled the way a real keyboard reports it — a SESSION TAB in
 *  the focused pane, in either cursor mode. */
function digitChord(n: number, target?: HTMLElement) {
  press(String(n), { metaKey: true, code: `Digit${n}` }, target);
}

/** `Alt+<n>` — the other family on the same row: one of the pane's VIEWS. */
function viewChord(n: number, target?: HTMLElement) {
  press(String(n), { altKey: true, code: `Digit${n}` }, target);
}

/** Which tab of the focused pane wears the active mark. */
const activeTab = () =>
  document.querySelector(
    '[data-split-pane][data-split-focused="true"] [data-session-tab][data-active="true"] [data-tab-select]',
  )?.textContent ?? null;

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

describe('the two digit families on one row, told apart by the modifier', () => {
  it('Cmd switches the SESSION TAB, and leaves the view alone', () => {
    mountFocused();
    expect(focusedTitle()).toBe('a1');
    digitChord(2);
    expect(activeTab()).toBe('a2');
    expect(focusedTitle()).toBe('a2');
    // Alt's family did not move with it: the two share a row, not a meaning.
    expect(selectedTab()).toBe('response');
  });

  it('Alt switches the VIEW, and leaves the tab alone', () => {
    mountFocused();
    digitChord(2);
    expect(activeTab()).toBe('a2');
    viewChord(4);
    expect(selectedTab()).toBe('agents');
    // Still on a2. If either family were reading the other's keystroke this
    // is the assertion that would catch it.
    expect(activeTab()).toBe('a2');
  });

  /**
   * THE DIGIT NAMES A VIEW, and the same view every time — `tabForDigit`'s
   * rule (A15.6). `Alt-3` is Terminal because Terminal is `TABS[2]`, whether
   * or not this source offers one; counting the DRAWN list positionally is
   * the defect `tabForDigit` was added to abolish, and it has been shipped
   * twice.
   */
  it('agrees with the icon tooltips: the Alt digit is a NAME, not a position', () => {
    mountFocused();
    intoResponsePane();
    const agents = document.querySelector('[data-view="agents"]') as HTMLElement;
    fireEvent.focus(agents);
    const caption = document.querySelector('[role="tooltip"]')?.textContent ?? '';
    expect(caption).toContain('Agents');
    expect(caption).toContain('4');
    fireEvent.blur(agents);
    viewChord(3);
    // Terminal is TABS[2] and this source has none: refused, aloud, and NOT
    // silently landed on whatever is drawn third. The refusal is the PANE's
    // own note rather than the status bar -- `pickView` writes `viewNote`,
    // which is drawn in the pane the digit was aimed at.
    expect(selectedTab()).toBe('response');
    expect(document.body.textContent).toContain('Terminal');
    viewChord(4);
    expect(selectedTab()).toBe('agents');
  });

  it('means the same thing with the keyboard in either place', () => {
    mountFocused();
    intoResponsePane();
    digitChord(2);
    expect(activeTab()).toBe('a2');
    backToList();
    digitChord(1);
    expect(activeTab()).toBe('a1');
    // And the view the operator chose is not reset by moving between tabs.
    viewChord(4);
    expect(selectedTab()).toBe('agents');
    digitChord(2);
    expect(activeTab()).toBe('a2');
    expect(selectedTab()).toBe('agents');
  });

  /**
   * Both families refuse OUT LOUD past their last member, and they refuse in
   * DIFFERENT words, because they are different facts. A digit that quietly
   * did nothing is the defect family this repo tracks; a digit that quietly
   * did the other family's job is the one this file is named for.
   */
  it('refuses past the last tab, and past the last view, in its own words', () => {
    mountFocused();
    digitChord(7);
    expect(activeTab()).toBe('a1');
    expect(statusBar()).toContain('only 2 tabs');
    viewChord(7);
    expect(selectedTab()).toBe('response');
    expect(document.body.textContent).toContain('no view 7');
  });

  /**
   * The Cmd family only. A Cmd/Ctrl chord produces a character on no layout,
   * so a text box has no claim on it; ALT DOES produce one on macOS (`Alt+4`
   * is `¢`), so the typing guard in `Canvas.tsx` deliberately keeps Alt out of
   * a focused box and `Alt+<digit>` is not reachable from inside the composer.
   * Asserted in both directions here so the asymmetry is a decision on record
   * rather than something a later reader discovers by pressing it.
   */
  it('fires with the prompt box focused, where the operator actually is', () => {
    const { container } = mountFocused();
    intoResponsePane();
    const box = container.querySelector('[aria-label="prompt to session"]') as HTMLTextAreaElement;
    box.focus();
    digitChord(2, box);
    expect(activeTab()).toBe('a2');
    viewChord(4, box);
    expect(selectedTab()).toBe('response');
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

  it('lists every bound digit, zero included', () => {
    for (let digit = 1; digit <= 9; digit += 1) {
      expect(keys(), `Mod-${digit}`).toContain(`Mod-${digit}`);
      expect(keys(), `Alt-${digit}`).toContain(`Alt-${digit}`);
    }
    // `Mod-0` is bound now (the sidebar), and a sheet that omitted it would be
    // hiding a key the operator can press -- the one thing a generated sheet
    // exists to make impossible.
    expect(keys()).toContain('Mod-0');
  });

  /**
   * The sheet may not name a VIEW that cannot exist. `Alt-5`..`Alt-9` are
   * bound so the pane can refuse them aloud rather than let them reach the
   * browser, and a sheet that captioned them as views would be naming five
   * that do not exist. (The Cmd row has no such ceiling — a pane's strip holds
   * as many tabs as the project has sessions — which is why its caption names
   * no count at all.)
   */
  it('names no view past the last one the pane can hold', () => {
    const viewLabels = rows()
      .filter((row) => row.keys.startsWith('Alt-'))
      .map((row) => row.label);
    expect(viewLabels.length).toBe(9);
    expect(viewLabels.some((label) => label.includes('Agents'))).toBe(true);
    for (const digit of [5, 6, 7, 8, 9]) {
      const row = rows().find((each) => each.keys === `Alt-${digit}`);
      expect(row?.label, `Alt-${digit}`).toContain(`no view ${digit}`);
    }
  });

  it('names NO Mod-Shift digit — macOS owns three of them', () => {
    for (let digit = 1; digit <= 9; digit += 1) {
      expect(keys(), `Mod-Shift-${digit}`).not.toContain(`Mod-Shift-${digit}`);
    }
  });

  /**
   * ONE row, with no mode on it. The digit had two captions because it had two
   * meanings; it has one now, and a row printed once per mode saying the same
   * sentence would be the sheet padding itself.
   *
   * The caption must not say "session", either: the sidebar's positions are
   * what the fourth arrangement gave up, and a row still naming them would be
   * the generated sheet promising a key that no longer does that.
   */
  it('gives the Cmd digit one row, captioned as a tab, with no mode on it', () => {
    const digit = rows().filter((candidate) => candidate.keys === 'Mod-2');
    expect(digit).toHaveLength(1);
    expect(digit[0]?.mode).toBeNull();
    expect(digit[0]?.label).toContain('tab 2');
    expect(digit[0]?.label).not.toContain('session 2');
    expect(digit[0]?.label).not.toContain('Select');
  });

  it('splits hjkl the same way — a session in Select, an option in Insert', () => {
    const walk = rows().filter((candidate) => candidate.keys === 'j');
    expect(walk.map((row) => row.mode)).toEqual(['select', 'insert']);
    // The captions are per DIRECTION now as well as per mode (audit F1: all
    // four Select motions read "the session list" while `h`/`l` walk a
    // project's tabs), so this reads `j`'s own two rather than the family's
    // one sentence.
    expect(walk.find((row) => row.mode === 'select')?.label).toContain('session');
    expect(walk.find((row) => row.mode === 'insert')?.label).toContain('option');
  });

  it('says the ninth is the last tab rather than a ninth one', () => {
    const row = rows().find((candidate) => candidate.keys === 'Mod-9');
    expect(row?.label).toContain('LAST');
  });

  it('lists `p`, which was bound and invisible', () => {
    const row = rows().find((candidate) => candidate.keys === 'p');
    expect(row).toBeDefined();
    expect(row?.label).not.toBe('');
  });
});
