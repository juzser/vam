// @vitest-environment happy-dom

/**
 * The `,` settings overlay, wired to a real keydown.
 *
 * This file owns the wiring only: that `,` reaches the grammar, that the
 * overlay traps focus and gives it back on Escape. The round-tripping of
 * each stored setting lives in `test/prefs/prefs.settings.test.ts`.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

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

const overlay = () => document.querySelector('[data-settings]');

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

describe(', opens the settings overlay', () => {
  it('is closed until , is pressed, and Escape closes it again', () => {
    render(<Canvas model={MODEL} />);
    expect(overlay()).toBeNull();
    press(',');
    expect(overlay()).not.toBeNull();
    press('Escape');
    expect(overlay()).toBeNull();
  });

  it('hands the keyboard back to where the operator was', () => {
    render(<Canvas model={MODEL} />);
    const row =
      document.querySelector<HTMLElement>('[data-session-row] button') ??
      document.querySelector<HTMLElement>('[data-session-row]') ??
      undefined;
    expect(row, 'no focusable session control to return to').toBeTruthy();
    act(() => row?.focus());

    press(',');
    expect(overlay()?.contains(document.activeElement)).toBe(true);
    press('Escape');
    expect(document.activeElement).toBe(row);
  });
});
