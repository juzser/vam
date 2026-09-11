// @vitest-environment happy-dom

/**
 * `Ctrl-D` / `Ctrl-U` THROUGH THE REAL MOUNT: which element moves, and who
 * the keystroke belongs to.
 *
 * The arithmetic is `test/panels/half-page.test.ts` and the grammar is
 * `test/keyboard/chords.half-page.test.ts`. What is left — and what those two
 * cannot see — is the wiring: that a real keydown finds the FOCUSED pane's
 * transcript column and no other, that it moves that column's own
 * `scrollTop`, that it refuses aloud at both ends, and that it stands down
 * wherever the keyboard is inside something being typed into.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TWO THINGS THIS ENVIRONMENT CANNOT DO, AND WHAT COVERS THEM INSTEAD.
 *
 * 1. LAYOUT. happy-dom reports `scrollHeight` and `clientHeight` as 0 on every
 *    element, so the column's geometry is DEFINED here, per case, and read
 *    back through the real `halfPageTarget`. That makes these cases honest
 *    about which element and how far, and silent about what a real browser
 *    makes of a real column. `e2e/half-page-shots.mjs` measures that, against
 *    a column Chromium actually laid out.
 *
 * 2. THE SCROLL EVENT. Assigning `scrollTop` here fires NO `scroll` event
 *    (measured, in this environment, before this file was written), so the
 *    column's own `onScroll` — which is what reads earlier turns in near the
 *    top — never runs. That join is the browser guard's section 3, and it is
 *    the whole reason this key asks for no page of its own.
 *
 * `cancelable: true` IS LOAD-BEARING HERE, for the reason
 * `Canvas.cursor-mode.test.tsx` spells out at length: `preventDefault()` on an
 * event built without it is a no-op BY SPECIFICATION, so every
 * `defaultPrevented` assertion below would go inert and this file's central
 * claim — that an insert scope keeps these two keys — would pass over a
 * handler that swallowed them.
 * ─────────────────────────────────────────────────────────────────────────
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
    decisions: [decision(`${id}-d`)],
    ...over,
  };
}

/** Two sessions in one project — so the pane opens with two tabs, and `zv`
 *  has something to move into a second pane. */
const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1'), session('a2')] },
  ],
};

/** Nothing at all: the state where there is no column to scroll. */
const EMPTY: CanvasModel = { projects: [] };

const columns = () => [...document.querySelectorAll<HTMLElement>('[data-detail-column]')];
const column = () => columns()[0];
const paneOf = (el: Element | null | undefined) => el?.closest('[data-split-pane]') ?? null;
const focusedPane = () => document.querySelector('[data-split-pane][data-split-focused="true"]');
const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
const statusText = () =>
  document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '';
const statusFull = () =>
  document.querySelector('[data-status-bar] [data-status]')?.getAttribute('data-note') ?? '';
const focusedRowTitle = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.querySelector('[data-row-title]')?.textContent ?? '';

/**
 * A LAYOUT THIS ENVIRONMENT DOES NOT HAVE. `clientHeight` and `scrollHeight`
 * are given here so the rule under test has real numbers to work on;
 * `scrollTop` is left as the ordinary settable property happy-dom already
 * implements, because that one IS what the handler writes and faking it would
 * make the central assertion of this file a tautology.
 */
function layOut(el: HTMLElement, clientHeight: number, scrollHeight: number, scrollTop: number) {
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  el.scrollTop = scrollTop;
}

/**
 * A real keydown on the window — a chord with nothing focused — RETURNED, so
 * the case can ask whether this grammar took it.
 */
function press(key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** The same, from whatever holds DOM focus — how a chord arrives once the
 *  keyboard is inside the prompt box or on a question's options. */
function pressFocused(key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  const target = document.activeElement ?? window;
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** `Ctrl+D` and `Ctrl+U` as the browser really delivers them. `code` is what
 *  a US layout puts on those keys; `normalizeKey` reads the character for a
 *  letter, so both spellings agree. */
const CTRL_D = { ctrlKey: true, code: 'KeyD' };
const CTRL_U = { ctrlKey: true, code: 'KeyU' };

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Ctrl-D and Ctrl-U move the transcript column itself', () => {
  it('scrolls down by half the column’s own height', () => {
    render(<Canvas model={MODEL} />);
    const box = column();
    expect(box, 'the pane draws no transcript column').toBeDefined();
    layOut(box as HTMLElement, 600, 1800, 0);
    press('d', CTRL_D);
    expect((box as HTMLElement).scrollTop).toBe(300);
  });

  it('and up by the same half', () => {
    render(<Canvas model={MODEL} />);
    const box = column() as HTMLElement;
    layOut(box, 600, 1800, 900);
    press('u', CTRL_U);
    expect(box.scrollTop).toBe(600);
  });

  it('halves the column it is given, not a fixed number of pixels', () => {
    // The same press against a pane twice as tall moves twice as far — which
    // is what "half a viewport" means and what a constant would not do.
    render(<Canvas model={MODEL} />);
    const box = column() as HTMLElement;
    layOut(box, 1200, 4000, 0);
    press('d', CTRL_D);
    expect(box.scrollTop).toBe(600);
  });

  it('takes the keystroke, so the browser’s own Cmd+D never happens', () => {
    render(<Canvas model={MODEL} />);
    layOut(column() as HTMLElement, 600, 1800, 0);
    expect(press('d', CTRL_D).defaultPrevented).toBe(true);
  });

  it('moves no cursor while it scrolls — it is not a second `j`', () => {
    render(<Canvas model={MODEL} />);
    layOut(column() as HTMLElement, 600, 1800, 0);
    expect(focusedRowTitle()).toBe('a1');
    press('d', CTRL_D);
    expect(focusedRowTitle()).toBe('a1');
  });
});

describe('at the ends it refuses aloud, because a key cannot be withdrawn', () => {
  it('says so at the bottom, and says which end that is', () => {
    render(<Canvas model={MODEL} />);
    const box = column() as HTMLElement;
    layOut(box, 600, 1800, 1200);
    press('d', CTRL_D);
    expect(box.scrollTop).toBe(1200);
    expect(statusText()).toMatch(/bottom/i);
    // The 72-character limit as behaviour: a refusal the cell had to shorten
    // is one whose explanation only a hover can reach.
    expect(statusText()).toBe(statusFull());
  });

  it('says so at the top — and does not claim the session begins there', () => {
    render(<Canvas model={MODEL} />);
    const box = column() as HTMLElement;
    layOut(box, 600, 1800, 0);
    press('u', CTRL_U);
    expect(box.scrollTop).toBe(0);
    expect(statusText()).toMatch(/top/i);
    // "there is nothing above" and "this is where the session starts" are two
    // different claims, and only the column's own head may make the second.
    expect(statusText()).not.toMatch(/begin|start of the session|nothing older/i);
    expect(statusText()).toBe(statusFull());
  });

  it('still moves the other way from an end', () => {
    render(<Canvas model={MODEL} />);
    const box = column() as HTMLElement;
    layOut(box, 600, 1800, 1200);
    press('u', CTRL_U);
    expect(box.scrollTop).toBe(900);
  });

  it('refuses when the pane is showing nothing with a transcript in it', () => {
    render(<Canvas model={EMPTY} />);
    expect(columns()).toHaveLength(0);
    press('d', CTRL_D);
    expect(statusText()).not.toBe('');
    expect(statusText()).toBe(statusFull());
  });
});

describe('the pane that holds the keyboard is the pane that scrolls', () => {
  it('leaves the other split exactly where it was', () => {
    render(<Canvas model={MODEL} />);
    // `zv` moves the front tab into a new pane and focuses it, so each pane
    // draws a column of its own.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
    });
    const both = columns();
    expect(both).toHaveLength(2);
    for (const box of both) layOut(box, 600, 1800, 0);

    const focusedId = focusedPane()?.getAttribute('data-split-pane');
    expect(focusedId).not.toBeUndefined();
    press('d', CTRL_D);

    const moved = both.filter((box) => box.scrollTop !== 0);
    expect(moved).toHaveLength(1);
    expect(paneOf(moved[0])?.getAttribute('data-split-pane')).toBe(focusedId);
    expect(moved[0]?.scrollTop).toBe(300);
  });
});

/**
 * THE CONSTRAINT THAT MATTERS MOST, and the reason this pair is the only
 * `isSelectOnly` binding in the table.
 *
 * Inside a macOS text field `Ctrl-D` is delete-forward and `Ctrl-U` deletes to
 * the start of the line; in a shell `Ctrl-D` is EOF. The window listener lets
 * `Mod-` chords past its typing guard on purpose — a chord is never a
 * character — so without a rule of their own these two would fire while
 * somebody was writing a prompt, and would `preventDefault` the edit as well.
 */
describe('in Insert the keystroke is not this grammar’s', () => {
  it('leaves it to the composer, unprevented, and scrolls nothing', () => {
    render(<Canvas model={MODEL} />);
    const box = column() as HTMLElement;
    layOut(box, 600, 1800, 600);
    press('i');
    expect(mode()).toBe('Insert');
    const event = pressFocused('d', CTRL_D);
    expect(box.scrollTop).toBe(600);
    // Unprevented is the whole of it: whatever the platform does with
    // `Ctrl-D` in a text box, vam has not taken it away.
    expect(event.defaultPrevented).toBe(false);
  });

  it('and the same for Ctrl-U', () => {
    render(<Canvas model={MODEL} />);
    const box = column() as HTMLElement;
    layOut(box, 600, 1800, 600);
    press('i');
    const event = pressFocused('u', CTRL_U);
    expect(box.scrollTop).toBe(600);
    expect(event.defaultPrevented).toBe(false);
  });

  it('says nothing either — a key that is not ours has no refusal to make', () => {
    render(<Canvas model={MODEL} />);
    layOut(column() as HTMLElement, 600, 1800, 600);
    press('i');
    pressFocused('d', CTRL_D);
    expect(statusText()).toBe('');
  });

  /**
   * THE TAG NAME IS NOT THE RULE, THE SCOPE IS — and this is the case that
   * proves it. An `INPUT|TEXTAREA` test would cover the composer and miss the
   * terminal pane, which is a `section` carrying `data-insert-scope` and is
   * the surface where `Ctrl-D` means most (EOF). The question card is the
   * same shape of element — an insert scope that is not a text box — so it
   * stands in for the terminal here, and the browser guard drives the
   * terminal itself.
   */
  it('stands down on a question card too, which is no text box at all', () => {
    const asking: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'factory',
          sessions: [
            session('a1', {
              questions: [
                {
                  id: 'toolu_1:0',
                  header: 'Colour',
                  question: 'Which colour?',
                  multiSelect: false,
                  options: [{ label: 'Crimson', description: 'a deep red' }],
                  answer: null,
                },
              ],
            }),
          ],
        },
      ],
    };
    render(<Canvas model={asking} />);
    const box = column() as HTMLElement;
    layOut(box, 600, 1800, 600);
    press('I');
    expect(mode()).toBe('Insert');
    expect(document.activeElement?.hasAttribute('data-question-option')).toBe(true);
    const event = pressFocused('d', CTRL_D);
    expect(box.scrollTop).toBe(600);
    expect(event.defaultPrevented).toBe(false);
  });

  it('and works again the moment the keyboard comes back to Select', () => {
    render(<Canvas model={MODEL} />);
    const box = column() as HTMLElement;
    layOut(box, 600, 1800, 600);
    press('i');
    pressFocused('d', CTRL_D);
    expect(box.scrollTop).toBe(600);
    press('Escape');
    expect(mode()).toBe('Select');
    press('d', CTRL_D);
    expect(box.scrollTop).toBe(900);
  });
});

/**
 * THE OTHER HALF OF THE TYPING GUARD, pinned beside the rule that narrows it.
 * The reason `Mod-` chords are let past a focused textarea at all is the
 * operator's own — "look at another tab from inside the box I am typing in" —
 * and a widening of `isSelectOnly` would take that away with nothing else in
 * this repo to catch it.
 */
describe('the tab chords still fire from inside the prompt box', () => {
  it('Mod-1 selects a tab with the caret in the composer', () => {
    render(<Canvas model={MODEL} />);
    press('i');
    expect(mode()).toBe('Insert');
    const event = pressFocused('2', { ctrlKey: true, code: 'Digit2' });
    expect(event.defaultPrevented).toBe(true);
  });
});
