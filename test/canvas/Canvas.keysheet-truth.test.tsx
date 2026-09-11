// @vitest-environment happy-dom

/**
 * AUDIT F1 — THE SHEET DESCRIBED MODAL BEHAVIOUR THE CODE DOES NOT HAVE.
 *
 * The finding is about the CAPTIONS, not the keys. Every behaviour named below
 * is what the operator asked for and is staying; what was wrong is what the
 * sheet and the settings editor said about it.
 *
 *   - All four Select motions were captioned "the session list". `j`/`k` do
 *     walk the session list; `h`/`l` cycle the ACTIVE PROJECT's tabs, which is
 *     a different list with a different shape (a ring, not a run).
 *   - All four Insert motions were captioned "the options of an open
 *     question". `j`/`k` do walk options; `h` is the way BACK to Select and
 *     `l`, outside that widget, has nothing to step.
 *   - `Enter` was captioned "open the focused step" in both modes. Select
 *     refuses it aloud; Insert marks an option or raises the composer.
 *   - `<`/`>` invert their direction by mode, with no caption saying so.
 *
 * EVERY CASE HERE MEASURES THE BEHAVIOUR FIRST and only then holds the sheet
 * to it. A caption's prose cannot be checked by machine, but two things can:
 * that the sheet prints a row PER MODE for exactly the bindings that behave
 * differently per mode, and that those rows differ from each other. Asserting
 * a label equals a string typed into the test on the same day it was typed
 * into the source is the tautology this file is built to avoid.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import {
  ACTION_LABELS,
  buildKeySheet,
  type CursorMode,
} from '../../src/renderer/keyboard/keysheet.js';

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

/**
 * ONE session in the first project and TWO in the second — the fixture that
 * tells the vertical pair from the horizontal one.
 *
 * From a1, `j` steps to the NEXT ROW of the whole session list, which is in
 * another project. `l` walks the ACTIVE PROJECT's tab ring, which from a
 * one-session project wraps back to itself. A fixture where both moved would
 * prove nothing about either caption.
 */
const TWO_PROJECTS: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1')] },
    { id: 'p2', name: 'beta', source: 'factory', sessions: [session('b1'), session('b2')] },
  ],
};

const focusedTitle = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.querySelector('[data-row-title]')?.textContent ?? '';
const focusedProject = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-project-rows]')
    ?.getAttribute('data-project-rows') ?? null;
const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
const statusText = () =>
  document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '';
const composer = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
const sidebarWidth = () => {
  const px = document.querySelector<HTMLElement>('[data-sidebar-pane]')?.style.width ?? '';
  return Number.parseFloat(px);
};

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

function pressFocused(key: string, modifiers: KeyboardEventInit = {}) {
  const target = document.activeElement ?? window;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
    );
  });
}

/** Every caption the sheet prints for one chord, keyed by the mode it is
 *  tagged with — `null` for a binding that means one thing in both. */
function captionsFor(chord: string): Partial<Record<CursorMode | 'both', string>> {
  const out: Partial<Record<CursorMode | 'both', string>> = {};
  for (const group of buildKeySheet({})) {
    for (const row of group.rows) {
      if (row.keys === chord) {
        out[row.mode ?? 'both'] = row.label;
      }
    }
  }
  return out;
}

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

/**
 * WHICH BINDINGS ARE MODE-DEPENDENT AT ALL — the sheet's own claim, held
 * against the behaviour asserted in the rest of this file.
 *
 * Of the whole grammar, exactly nine chords branch on the cursor mode:
 * `h j k l Enter < > Mod-d Mod-u`, which is four ACTION KINDS. A `byMode` on
 * anything else prints one row twice saying the same sentence, and a missing
 * `byMode` on one of these prints one row for two behaviours — which is F1.
 *
 * `scrollHalf` IS THE FOURTH, AND IT BRANCHES THE OTHER WAY. The first three
 * do something different in each mode; this one does something in Select and
 * NOTHING in Insert — `isSelectOnly` in `chords.ts`, because `Ctrl-D` and
 * `Ctrl-U` are already the composer's and the terminal's. An absence is still
 * a second behaviour to caption: a single row reading "half a screen down"
 * would promise a scroll to an operator whose caret is in the prompt box,
 * which is F1's failure exactly.
 */
describe('the sheet splits by mode exactly where the code branches on it', () => {
  it('names move, open, resizePane and scrollHalf, and nothing else', () => {
    const split = Object.entries(ACTION_LABELS)
      .filter(([, meta]) => (meta as { byMode?: unknown }).byMode !== undefined)
      .map(([kind]) => kind)
      .sort();
    expect(split).toEqual(['move', 'open', 'resizePane', 'scrollHalf']);
  });

  it('gives each of them two rows that actually differ', () => {
    for (const chord of ['h', 'j', 'k', 'l', 'Enter', '<', '>', 'Mod-d', 'Mod-u']) {
      const captions = captionsFor(chord);
      expect(captions.select, `${chord} in Select`).toBeDefined();
      expect(captions.insert, `${chord} in Insert`).toBeDefined();
      expect(captions.select, `${chord} says the same in both modes`).not.toBe(captions.insert);
    }
  });

  it('leaves a mode-independent binding one row, as it always did', () => {
    // `yy` copies in either mode, and a row printed twice is noise.
    const captions = captionsFor('yy');
    expect(captions.both).toBeDefined();
    expect(captions.select).toBeUndefined();
  });
});

/**
 * F1a. The four Select motions were captioned as one list. They are two.
 */
describe('Select: the vertical pair and the horizontal pair walk different lists', () => {
  it('j leaves the project — it walks the whole session list', () => {
    render(<Canvas model={TWO_PROJECTS} />);
    expect(focusedTitle()).toBe('a1');
    const from = focusedProject();
    press('j');
    expect(focusedTitle()).toBe('b1');
    expect(focusedProject()).not.toBe(from);
  });

  it('l does NOT — it walks the active project’s tab ring', () => {
    render(<Canvas model={TWO_PROJECTS} />);
    const from = focusedProject();
    press('l');
    // p1 holds one session, so its ring wraps to the tab already in front.
    // The session list has a next row and `l` did not take it.
    expect(focusedTitle()).toBe('a1');
    expect(focusedProject()).toBe(from);
  });

  it('so the two captions cannot be the same sentence about the same list', () => {
    const down = captionsFor('j').select ?? '';
    const right = captionsFor('l').select ?? '';
    expect(down).not.toBe(right);
    // WAS: both said "move ⟨direction⟩ — the session list".
    expect(down.toLowerCase()).toContain('session');
    expect(right.toLowerCase()).toContain('tab');
    expect(right.toLowerCase()).not.toContain('session list');
  });
});

/**
 * F1b. The four Insert motions were captioned as the options of a question.
 * Two of them are; `h` is the way out and `l` has nothing to step outside a
 * multi-question call.
 */
describe('Insert: h leaves the mode, l steps a question that may not exist', () => {
  it('h hands the keyboard back rather than choosing an option', () => {
    render(<Canvas model={TWO_PROJECTS} />);
    press('I');
    expect(mode()).toBe('Insert');
    pressFocused('h');
    expect(mode()).toBe('Select');
  });

  it('l says there is nothing to step when no question is open', () => {
    render(<Canvas model={TWO_PROJECTS} />);
    press('I');
    press('l');
    expect(statusText()).not.toBe('');
    expect(mode()).toBe('Insert');
  });

  it('so h and l are captioned apart from j and k, and from each other', () => {
    const left = captionsFor('h').insert ?? '';
    const right = captionsFor('l').insert ?? '';
    const down = captionsFor('j').insert ?? '';
    expect(left).not.toBe(down);
    expect(right).not.toBe(down);
    expect(left).not.toBe(right);
    // The one that leaves the mode has to say so — it was captioned as an
    // option walk, which is the only thing it never does.
    expect(left.toLowerCase()).toContain('select');
    // And the one that walks options still says options.
    expect(down.toLowerCase()).toContain('option');
  });
});

/**
 * F1c. `Enter` was "open the focused step" in both modes. It opens nothing in
 * Select and it is not a step in Insert.
 */
describe('Enter means two different things, and the sheet now says two', () => {
  it('refuses in Select, out loud, and raises no composer', () => {
    render(<Canvas model={TWO_PROJECTS} />);
    expect(mode()).toBe('Select');
    press('Enter');
    expect(statusText()).not.toBe('');
    expect(document.activeElement).not.toBe(composer());
  });

  it('raises the composer in Insert', () => {
    render(<Canvas model={TWO_PROJECTS} />);
    press('I');
    press('Enter');
    expect(document.activeElement).toBe(composer());
  });

  it('so its two captions differ, and the Select one promises nothing', () => {
    const captions = captionsFor('Enter');
    expect(captions.select).not.toBe(captions.insert);
    // WAS: "open the focused step", in a mode where pressing it says the
    // detail is already on screen.
    expect((captions.select ?? '').toLowerCase()).not.toContain('open the focused step');
  });
});

/**
 * F1d. `<` and `>` invert by mode, and nothing said so.
 */
describe('the resize pair reverses with the mode, and the sheet admits it', () => {
  it('narrows the sidebar in Select and widens it in Insert', () => {
    render(<Canvas model={TWO_PROJECTS} />);
    const start = sidebarWidth();
    expect(Number.isFinite(start)).toBe(true);
    press('<');
    const inSelect = sidebarWidth();
    expect(inSelect).toBeLessThan(start);

    press('I');
    expect(mode()).toBe('Insert');
    press('<');
    // The SAME key, the other way: in Insert `<` narrows the pane the keyboard
    // is in, which is the response pane, so the sidebar grows.
    expect(sidebarWidth()).toBeGreaterThan(inSelect);
  });

  it('so its two captions differ, and neither is the other’s direction', () => {
    const narrow = captionsFor('<');
    const widen = captionsFor('>');
    expect(narrow.select).not.toBe(narrow.insert);
    expect(widen.select).not.toBe(widen.insert);
    // And the pair is not simply the same two sentences swapped: each names
    // WHICH pane it is about, which is the fact the old caption omitted and
    // the only thing that explains why one key moves the boundary two ways.
    expect((narrow.insert ?? '').toLowerCase()).toContain('response');
    expect((narrow.select ?? '').toLowerCase()).not.toContain('response');
  });
});
