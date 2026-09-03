// @vitest-environment happy-dom

/**
 * Filtering has ONE home, and it is the sidebar.
 *
 * The status pills (All / Running / Needs you / Done) used to be an
 * `@xyflow/react` `<Panel position="top-left">` floating over the canvas.
 * They now live in a popover hung off a control beside the sidebar's search
 * box (operator request: "thêm icon filter cạnh ô search ở sidebar, khi
 * toggle sẽ có popover để filter các session trong sidebar").
 *
 * Two surfaces writing one piece of state is the bug this move removes, so
 * the first test below is a NEGATIVE one: nothing on the canvas may still set
 * `statusFilter`. The rest cover what the popover has to be — reachable by
 * mouse and by key, closable with Escape, and actually narrowing the list.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, status: Session['status']): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [
        session('a1', 'waiting'),
        session('a2', 'waiting'),
        session('a3', 'running'),
        session('a4', 'done'),
      ],
    },
  ],
};

const rows = () => [...document.querySelectorAll('[data-session-row]')];
const menu = () => document.querySelector('[data-filter-menu]');
const trigger = () => document.querySelector<HTMLButtonElement>('[data-filter-toggle]');
const pill = (key: string) =>
  document.querySelector<HTMLButtonElement>(`[data-status-pill="${key}"]`);

function openMenu() {
  const button = trigger();
  expect(button).toBeTruthy();
  if (button) fireEvent.click(button);
}

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
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

describe('the filter popover beside the sidebar search box', () => {
  it('leaves no second filter control floating on the canvas', () => {
    render(<Canvas model={MODEL} />);
    // The pills are not rendered at all until the popover is opened, and when
    // they are, they are in the sidebar — never inside ReactFlow's own panel.
    expect(pill('all')).toBeNull();
    openMenu();
    expect(pill('all')?.closest('.react-flow__panel')).toBeFalsy();
    expect(pill('all')?.closest('aside')).toBeTruthy();
  });

  it('is closed at first and opens on the control beside the search box', () => {
    render(<Canvas model={MODEL} />);
    const button = trigger();
    // Beside the search box means: same sidebar header block as it.
    expect(button?.closest('div')?.querySelector('[aria-label="search sessions"]')).toBeTruthy();
    expect(menu()).toBeNull();
    expect(button?.getAttribute('aria-expanded')).toBe('false');

    openMenu();
    expect(menu()).toBeTruthy();
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('narrows the sidebar when a pill is clicked — 4 rows, then 2 under "Needs you"', () => {
    render(<Canvas model={MODEL} />);
    expect(rows()).toHaveLength(4);
    openMenu();

    const waiting = pill('waiting');
    expect(waiting).toBeTruthy();
    if (waiting) fireEvent.click(waiting);

    expect(rows()).toHaveLength(2);
  });

  it('opens on `F` and closes on Escape, handing the keyboard back to the control', () => {
    render(<Canvas model={MODEL} />);
    fireEvent.keyDown(window, { key: 'F' });
    expect(menu()).toBeTruthy();
    // Keyboard-first: the popover takes focus so the next key lands in it.
    expect(menu()?.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
    expect(menu()).toBeNull();
    // Not stranded: focus is back on the control that opened it.
    expect(document.activeElement).toBe(trigger());
  });

  it('keeps the chosen filter after the popover is closed', () => {
    render(<Canvas model={MODEL} />);
    openMenu();
    const waiting = pill('waiting');
    if (waiting) fireEvent.click(waiting);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(rows()).toHaveLength(2);
  });
});

/**
 * Dismissing the popover by pressing outside it.
 *
 * `pointerdown`, not `click`: a click only lands on release, so a
 * press-drag-release starting outside and ending inside would never dismiss,
 * leaving the menu open under the very pointer trying to close it.
 */
describe('the filter popover closes on a press outside it', () => {
  function pressOn(target: Element | Document) {
    act(() => {
      target.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    });
  }

  it('closes when the press lands anywhere else on the page', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      trigger()?.click();
    });
    expect(menu()).not.toBeNull();

    pressOn(document.body);
    expect(menu()).toBeNull();
  });

  it('stays open when the press lands inside the popover', () => {
    // Otherwise the first click on any option would dismiss the thing being
    // clicked, and no option could ever be chosen with a mouse.
    render(<Canvas model={MODEL} />);
    act(() => {
      trigger()?.click();
    });
    const inside = menu()?.querySelector('button');
    expect(inside, 'popover has no button to press').not.toBeNull();

    pressOn(inside as Element);
    expect(menu()).not.toBeNull();
  });

  it('lets the toggle button close it, rather than closing and reopening', () => {
    // The toggle is excluded from the outside-press rule on purpose: without
    // that, pressing it while open runs BOTH the dismissal and the button's
    // own handler, which closes and reopens in a single press and reads as a
    // dead button.
    render(<Canvas model={MODEL} />);
    act(() => {
      trigger()?.click();
    });
    expect(menu()).not.toBeNull();

    const control = trigger() as HTMLElement;
    pressOn(control);
    act(() => {
      control.click();
    });
    expect(menu()).toBeNull();
  });
});
