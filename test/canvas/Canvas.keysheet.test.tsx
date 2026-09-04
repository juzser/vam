// @vitest-environment happy-dom

/**
 * The `?` sheet, wired to a real keydown.
 *
 * The unit test in `test/keyboard/keysheet.test.ts` owns the property that
 * makes this feature worth having — the sheet cannot name an unbound key.
 * This one owns the wiring: that `?` reaches the grammar at all, that Escape
 * gives the keyboard back to where it was, and that opening a full-screen
 * overlay did not quietly break the chord layer underneath it.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { BINDING_TABLES } from '../../src/renderer/keyboard/chords.js';

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

const sheet = () => document.querySelector('[data-key-sheet]');
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const focusedTitle = () => document.querySelector('[data-prompt-target]')?.textContent ?? '';

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
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

describe('? opens the shortcut sheet', () => {
  it('is closed until ? is pressed, and Escape closes it again', () => {
    render(<Canvas model={MODEL} />);
    expect(sheet()).toBeNull();
    press('?', { shiftKey: true });
    expect(sheet()).not.toBeNull();
    press('Escape');
    expect(sheet()).toBeNull();
  });

  it('hands the keyboard back to where the operator was', () => {
    render(<Canvas model={MODEL} />);
    const row =
      document.querySelector<HTMLElement>('[data-session-row] button') ??
      document.querySelector<HTMLElement>('[data-session-row]') ??
      undefined;
    expect(row, 'no focusable session control to return to').toBeTruthy();
    act(() => row?.focus());
    expect(document.activeElement).toBe(row);

    press('?', { shiftKey: true });
    // Focus moves into the overlay, so Escape is not swallowed by the page.
    expect(sheet()?.contains(document.activeElement)).toBe(true);
    press('Escape');
    expect(document.activeElement).toBe(row);
  });

  it('renders every bound key, spelling a chord as its sequence', () => {
    render(<Canvas model={MODEL} />);
    press('?', { shiftKey: true });
    const printed = [...(sheet()?.querySelectorAll('[data-key-sheet-keys]') ?? [])].map(
      (el) => el.textContent ?? '',
    );
    const bound = BINDING_TABLES.flatMap(({ prefix, table }) =>
      Object.keys(table).map((key) => `${prefix}${key}`),
    );
    expect(bound.length).toBeGreaterThan(25);
    for (const keys of bound) {
      expect(printed, `"${keys}" is bound but not on the sheet`).toContain(keys);
    }
    expect(printed).toContain('gt');
    expect(printed).not.toContain('t');
    // No row may be blank: a missing label must break, not render empty space.
    for (const label of [...(sheet()?.querySelectorAll('[data-key-sheet-label]') ?? [])]) {
      expect((label.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('leaves the chords working while the sheet is closed', () => {
    render(<Canvas model={MODEL} />);
    press('?', { shiftKey: true });
    press('Escape');
    expect(sheet()).toBeNull();
    press('G'); // last session
    expect(focusedTitle()).toBe('b1');
    press('g');
    press('g'); // first
    expect(focusedTitle()).toBe('a1');
  });

  it('announces itself in the status bar hint', () => {
    render(<Canvas model={MODEL} />);
    expect(statusBar()).toContain('?');
  });
});
