// @vitest-environment happy-dom

/**
 * A SPLIT THAT CANNOT PRODUCE TWO USABLE PANES REFUSES, ALOUD.
 *
 * PR 289 measured `MIN_PANE_PX` — below 320px the floating view-icon pill
 * covers the first prompt bubble's text and a question card's option prints
 * over its own explanation — and applied it in `dividerShare`, which is every
 * DRAG and only drags. `splitPane` halves whatever it is handed, so `zv` on a
 * 254px pane made two 127px ones: into the broken zone, by the one gesture the
 * floor did not cover.
 *
 * The floor is an invariant of the layout now, and this file is about the
 * CLASS rather than about `zv`: every route that makes a pane is here — `zv`,
 * `zs`, and the drag onto a pane's edge — because a fix applied to the chord
 * alone would leave the drag doing exactly what was reported.
 *
 * TWO THINGS EVERY CASE TURNS ON, both learnt the hard way elsewhere in this
 * repo:
 *
 *  - happy-dom's `getBoundingClientRect` is always zeroed (`PaneResizer`'s own
 *    note), so a pane here has no size unless this file gives it one. That is
 *    also why the last case exists: an UNMEASURED pane must still split, which
 *    is the documented degenerate-case policy `dividerShare` already follows
 *    and the reason the other 3,400 tests in this repo — every one of them
 *    running against zeroed rects — are unaffected by the floor.
 *  - the refusal has to FIT. `StatusCell` truncates at 72 characters and hangs
 *    the rest on a tooltip, so a longer sentence loses the clause that says
 *    why; PR 289 hit exactly that on the divider's own refusal.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { MIN_PANE_PX } from '../../src/renderer/canvas/split.js';
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

afterEach(cleanup);

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function pressChord(prefix: string, key: string) {
  press(prefix);
  press(key);
}

const panes = () => [...document.querySelectorAll('[data-split-pane]')];
const statusText = () =>
  document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '';
/** The whole message, before `StatusCell` shortened it for the cell. */
const statusFull = () =>
  document.querySelector('[data-status-bar] [data-status]')?.getAttribute('data-note') ?? '';
const sidebarRow = (at: number) =>
  [...document.querySelectorAll('[data-session-row]')][at] as HTMLElement;
const tabSelect = (title: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-tab-select]')].find(
    (el) => el.textContent === title,
  );

/** Give every pane on screen a real extent — happy-dom's own is zeroed. */
function sizePanes(width: number, height: number) {
  for (const pane of panes()) {
    (pane as HTMLElement).getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width,
        height,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }
}

/** A genuine `MouseEvent` typed `drop`: happy-dom's `DragEvent` fallback
 *  carries no `clientX`/`clientY` (see `Canvas.split.test.tsx`'s header). */
function dragAt(el: Element, type: 'dragover' | 'drop', clientX: number, clientY: number) {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
}

describe('zv / zs refuse a split that would break the 320px floor', () => {
  it('a pane too narrow to halve is refused, and says what it needs and what it has', () => {
    render(<Canvas model={MODEL} />);
    sizePanes(500, 900);
    pressChord('z', 'v');
    expect(panes()).toHaveLength(1);
    expect(statusText()).toContain(String(MIN_PANE_PX));
    expect(statusText()).toContain('500');
    // The whole sentence, not a shortened one: the clause that says WHY has to
    // survive the cell. (PR 289's own lesson, on the divider's refusal.)
    expect(statusText()).toBe(statusFull());
  });

  it('a pane with room for two minimums splits', () => {
    render(<Canvas model={MODEL} />);
    sizePanes(MIN_PANE_PX * 2, 900);
    pressChord('z', 'v');
    expect(panes()).toHaveLength(2);
    expect(statusText()).toBe('');
  });

  it('zs reads the HEIGHT — a wide, short pane splits sideways and not down', () => {
    render(<Canvas model={MODEL} />);
    // 1000 wide is plenty for `zv`; 400 tall is not enough for `zs`. A floor
    // that measured one extent for both axes would pass one of these two.
    sizePanes(1000, 400);
    pressChord('z', 's');
    expect(panes()).toHaveLength(1);
    expect(statusText()).toContain('400');
    expect(statusText()).toContain('tall');
    pressChord('z', 'v');
    expect(panes()).toHaveLength(2);
  });

  it('the second split is refused when the first left no room for it', () => {
    render(<Canvas model={MODEL} />);
    sizePanes(900, 900);
    pressChord('z', 'v');
    expect(panes()).toHaveLength(2);
    // The two halves are 450 each now, which is what the floor is about: the
    // FIRST split was legal and the second is not.
    sizePanes(450, 900);
    pressChord('z', 'v');
    expect(panes()).toHaveLength(2);
    expect(statusText()).toContain('450');
  });
});

describe('the drag onto a pane edge is the same floor — the class, not the chord', () => {
  it('an edge drop that would halve a narrow pane is refused aloud', () => {
    render(<Canvas model={MODEL} />);
    // pane-1 holds a1; open a2 in it too so its own strip has a tab to drag.
    act(() => sidebarRow(1).click());
    act(() => sidebarRow(0).click());
    const pane = panes()[0] as HTMLElement;
    sizePanes(500, 900);
    const tab = tabSelect('a2') as HTMLButtonElement;
    fireEvent.dragStart(tab);
    dragAt(pane, 'dragover', 495, 450);
    dragAt(pane, 'drop', 495, 450);
    expect(panes()).toHaveLength(1);
    expect(statusText()).toContain(String(MIN_PANE_PX));
    expect(statusText()).toBe(statusFull());
  });

  it('and the same drop lands when the pane is wide enough', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click());
    act(() => sidebarRow(0).click());
    const pane = panes()[0] as HTMLElement;
    sizePanes(1000, 900);
    const tab = tabSelect('a2') as HTMLButtonElement;
    fireEvent.dragStart(tab);
    dragAt(pane, 'dragover', 990, 450);
    dragAt(pane, 'drop', 990, 450);
    expect(panes()).toHaveLength(2);
  });
});

describe('an unmeasured pane is not a pane that is too small', () => {
  it('splits with the rect happy-dom gives it — all zeroes', () => {
    // Deliberate, not incidental: a floor that bit where nothing had been
    // measured would refuse the first split of a layout that has not had a
    // frame yet, on the strength of a number nobody took. It is also what
    // keeps every other split test in this repo meaning what it says.
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    expect(panes()).toHaveLength(2);
    expect(statusText()).toBe('');
  });
});
