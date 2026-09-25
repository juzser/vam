// @vitest-environment happy-dom

/**
 * THE VIEW BELONGS TO THE SESSION, not to the pane and not to the app.
 *
 * Operator instruction: "when session 1 switches to the PRs view, the rest of
 * the sessions do not switch". What shipped did the opposite, twice over --
 * `DetailPanel` held ONE `tab` in local state and a pane reuses one instance
 * for every session it shows, so switching the session tab kept whatever view
 * the previous session left; and `prefs.detailTab` is a single global string,
 * so even a remount would have handed the next session the choice made for the
 * last one.
 *
 * `Canvas.tsx`'s own comment on `renderLeaf` already claimed this isolation --
 * "a leaf that stays mounted while its OWN `sessionId` changes must still be a
 * fresh component instance, or `DetailPanel`'s internal state for the session
 * it used to show would bleed into the one it shows now". `key={leaf.id}` does
 * not change when `leaf.sessionId` does, so nothing remounted and the bleed was
 * exactly the shipped behaviour. A documented invariant names the bug to grep
 * for.
 *
 * The third test is the one that keeps the fix honest rather than merely
 * green: `prefs.detailTab` is still what vam OPENS on after a restart, so a
 * fix that simply defaulted every session to Response would pass the first two
 * and silently delete a preference.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string): Session {
  return {
    id,
    title: id,
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
  ],
};

/** Which view the focused pane is showing. */
const selectedView = () =>
  document.querySelector('[data-view][aria-pressed="true"]')?.getAttribute('data-view') ?? null;

/** Which session tab the focused pane is showing. */
const activeTab = () =>
  document.querySelector(
    '[data-split-pane][data-split-focused="true"] [data-session-tab][data-active="true"] [data-tab-select]',
  )?.textContent ?? null;

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/** `Cmd+<n>` — the SESSION tab in the focused pane. */
const sessionChord = (n: number) => press(String(n), { metaKey: true, code: `Digit${n}` });
/** `Alt+<n>` — the VIEW in the focused pane. */
const viewChord = (n: number) =>
  press(String(n), { ctrlKey: true, altKey: true, code: `Digit${n}` });

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

describe('a view is a per-session choice', () => {
  it('switching one session to Agents leaves the next session on Response', () => {
    mountFocused();
    expect(activeTab()).toBe('a1');
    viewChord(4);
    expect(selectedView()).toBe('agents');

    sessionChord(2);
    expect(activeTab()).toBe('a2');
    // The operator's sentence, as an assertion: a2 never asked for Agents.
    expect(selectedView()).toBe('response');
  });

  it('returning to the first session restores the view it was left on', () => {
    mountFocused();
    viewChord(4);
    sessionChord(2);
    expect(selectedView()).toBe('response');

    sessionChord(1);
    expect(activeTab()).toBe('a1');
    expect(selectedView()).toBe('agents');
  });

  it('a second session keeps its own view once it has chosen one', () => {
    mountFocused();
    viewChord(4);
    sessionChord(2);
    viewChord(2);
    expect(selectedView()).toBe('prs');

    sessionChord(1);
    expect(selectedView()).toBe('agents');
    sessionChord(2);
    expect(selectedView()).toBe('prs');
  });

  it('still OPENS on the view a previous run was left on', () => {
    // The half a "default everything to Response" fix would quietly delete.
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ detailTab: 'Agents' }));
    mountFocused();
    expect(selectedView()).toBe('agents');
  });

  it('a view chosen during this run does not become the next session’s opener', () => {
    // `prefs.detailTab` is what the NEXT RUN opens on. Re-reading it live
    // would put the choice made for a1 onto every session shown after it --
    // the same bleed by a slower route.
    mountFocused();
    viewChord(2);
    expect(selectedView()).toBe('prs');
    sessionChord(2);
    expect(selectedView()).toBe('response');
    // And it was still remembered for next time.
    const stored = JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}') as {
      detailTab?: unknown;
    };
    expect(stored.detailTab).toBe('PRs');
  });
});

/** Kept out of the describe above: this one is about the strip, not the view. */
describe('the session tab strip still works while views are per-session', () => {
  it('clicking a session tab moves the pane and its view together', () => {
    mountFocused();
    viewChord(4);
    const tabs = [...document.querySelectorAll('[data-session-tab] [data-tab-select]')];
    const second = tabs.find((node) => node.textContent === 'a2') as HTMLElement | undefined;
    expect(second).toBeDefined();
    act(() => {
      fireEvent.mouseDown(second as HTMLElement);
      fireEvent.click(second as HTMLElement);
    });
    expect(activeTab()).toBe('a2');
    expect(selectedView()).toBe('response');
  });
});
