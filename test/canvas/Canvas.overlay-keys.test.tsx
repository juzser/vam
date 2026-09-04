// @vitest-environment happy-dom

/**
 * An open overlay owns the keyboard.
 *
 * The window listener used to step aside for `INPUT`/`TEXTAREA` and nothing
 * else, so the command palette was safe only by accident — it contains an
 * input. The key sheet and the settings overlay contain none, so every chord
 * typed at them also drove the graph behind them: `j` moved the cursor you
 * could not see, `zc` closed the canvas under the sheet describing it.
 *
 * The rule asserted here is one rule, not three flags: while any overlay is
 * open the canvas listens for Escape and nothing else. Both halves matter —
 * the deafness while open, and the hearing restored the moment it closes.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const sheet = () => document.querySelector('[data-key-sheet]');
const settings = () => document.querySelector('[data-settings-overlay]');
const palette = () => document.querySelector('[cmdk-root]');
const canvasPane = () => document.querySelector('[data-canvas-pane]');
const focusedTitle = () => document.querySelector('[data-prompt-target]')?.textContent ?? '';

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/** A chord, typed. */
function chord(first: string, second: string) {
  press(first);
  press(second);
}

const openSheet = () => press('?', { shiftKey: true });
const openSettings = () => press(',');
const openPalette = () => press('k', { ctrlKey: true });

/** Each overlay, by the key that opens it and the node it renders. */
const OVERLAYS = [
  { name: 'the key sheet', open: openSheet, node: sheet },
  { name: 'the settings overlay', open: openSettings, node: settings },
  { name: 'the command palette', open: openPalette, node: palette },
] as const;

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

describe('an open overlay stops the canvas listening', () => {
  it('leaves the cursor where it was when `j` is typed at the key sheet', () => {
    render(<Canvas model={MODEL} />);
    press('g');
    press('g');
    const before = focusedTitle();
    expect(before).toBe('a1');

    openSheet();
    expect(sheet()).not.toBeNull();
    press('j');
    expect(focusedTitle()).toBe(before);
  });

  it('leaves the cursor where it was when `j` is typed at the settings overlay', () => {
    render(<Canvas model={MODEL} />);
    press('g');
    press('g');
    const before = focusedTitle();
    expect(before).toBe('a1');

    openSettings();
    expect(settings()).not.toBeNull();
    press('j');
    expect(focusedTitle()).toBe(before);
  });

  it('does not let `zc` close the canvas under either overlay', () => {
    for (const { name, open, node } of [OVERLAYS[0], OVERLAYS[1]]) {
      render(<Canvas model={MODEL} />);
      open();
      expect(node(), `${name} did not open`).not.toBeNull();
      chord('z', 'c');
      expect(canvasPane(), `\`zc\` reached the canvas under ${name}`).not.toBeNull();
      cleanup();
      localStorage.clear();
    }
  });

  it('does not let a chord open a second overlay over the first', () => {
    render(<Canvas model={MODEL} />);
    openSettings();
    expect(settings()).not.toBeNull();
    openSheet();
    expect(sheet(), 'a second overlay opened on top of the settings overlay').toBeNull();
    expect(settings()).not.toBeNull();
  });
});

describe('each overlay keeps its own way out', () => {
  for (const { name, open, node } of OVERLAYS) {
    it(`closes ${name} on Escape`, () => {
      render(<Canvas model={MODEL} />);
      open();
      expect(node(), `${name} did not open`).not.toBeNull();
      if (name === 'the command palette') {
        // The palette's input has focus, so its Escape is its own handler's.
        fireEvent.keyDown(screen.getByPlaceholderText('go to session…'), { key: 'Escape' });
      } else {
        press('Escape');
      }
      expect(node(), `${name} would not close`).toBeNull();
    });
  }

  it('leaves the palette typing and filtering as it was', () => {
    render(<Canvas model={MODEL} />);
    openPalette();
    const input = screen.getByPlaceholderText<HTMLInputElement>('go to session…');
    act(() => {
      fireEvent.change(input, { target: { value: 'beta' } });
    });
    expect(input.value).toBe('beta');
    // The one overlay that already behaved: typing filters, and the letters
    // typed are not chords.
    const shown = [...document.querySelectorAll('[cmdk-item]')].map((el) => el.textContent ?? '');
    expect(shown.join('|')).toContain('b1');
    expect(shown.some((row) => row.includes('a1'))).toBe(false);
  });
});

describe('the canvas hears again once the overlay closes', () => {
  it('moves the cursor on `j` after Escape', () => {
    render(<Canvas model={MODEL} />);
    press('g');
    press('g');
    openSheet();
    press('j');
    press('Escape');
    expect(sheet()).toBeNull();
    press('j');
    expect(focusedTitle()).toBe('a2');
  });

  it('lets `zc` through again after the settings overlay closes', () => {
    render(<Canvas model={MODEL} />);
    openSettings();
    chord('z', 'c');
    press('Escape');
    expect(settings()).toBeNull();
    chord('z', 'c');
    expect(canvasPane()).toBeNull();
  });
});
