// @vitest-environment happy-dom

/**
 * The `,` settings overlay, wired to a real keydown.
 *
 * This file owns the wiring only: that `,` reaches the grammar, that the
 * overlay takes focus on open and gives it back on Escape. It does NOT trap
 * focus — Tab leaves it, exactly as it does in `KeySheet` — so do not read an
 * assertion here as covering containment. The round-tripping of each stored
 * setting lives in `test/prefs/prefs.settings.test.ts`.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';
import { LAYOUTS } from '../../src/renderer/prefs/panes.js';
import type { Prefs } from '../../src/renderer/prefs/prefs.js';

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

const KEY = 'vam.prefs.v1';
const overlay = () => document.querySelector('[data-settings-overlay]');
const stored = (): Partial<Prefs> => JSON.parse(localStorage.getItem(KEY) ?? '{}');
const seed = (payload: Record<string, unknown>) =>
  localStorage.setItem(KEY, JSON.stringify(payload));
const option = (name: string) => screen.getByRole('button', { name });
/** A layout tile is a radio in a panel the overlay does not open on, and its
 *  accessible name now carries the drawn column order after the label — so:
 *  navigate first, then match the label rather than the whole name. */
const layoutTile = (label: string) => {
  fireEvent.click(screen.getByRole('tab', { name: 'Layout' }));
  return screen.getByRole('radio', { name: new RegExp(label) });
};

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

describe('the settings overlay is reachable and drawable', () => {
  it('opens from the sidebar gear too, not only from the chord', () => {
    render(<Canvas model={MODEL} />);
    fireEvent.click(screen.getByLabelText('settings'));
    expect(overlay()).not.toBeNull();
  });

  it('does not collide with the gear button on the name "settings"', () => {
    // Two elements sharing one accessible name is a getByLabelText that throws
    // "found multiple" — and the gear is exactly what a test reaches for to
    // open the thing it then wants to inspect.
    render(<Canvas model={MODEL} />);
    press(',');
    expect(overlay()).not.toBeNull();
    expect(() => screen.getByLabelText('settings')).not.toThrow();
    expect(screen.getByLabelText('settings').closest('[data-settings-overlay]')).toBeNull();
  });

  it('closes on Escape typed inside one of its own inputs', () => {
    // The trap CommandPalette's comment names: the window key listener ignores
    // keys typed in an input, so an overlay that only listens on the window has
    // no keyboard way out the moment focus lands in a field.
    render(<Canvas model={MODEL} />);
    press(',');
    const input = overlay()?.querySelector('input');
    expect(input, 'the overlay has no input to be trapped in').toBeTruthy();
    act(() => (input as HTMLInputElement).focus());
    fireEvent.keyDown(input as HTMLInputElement, { key: 'Escape' });
    expect(overlay()).toBeNull();
  });

  it('draws in a layout that hides the canvas', () => {
    // #114 moved the palette and the sheet out of the canvas column for this
    // exact reason: inside it, an overlay in `noCanvas` renders into nothing.
    seed({ paneVisibility: LAYOUTS.noCanvas });
    render(<Canvas model={MODEL} />);
    press(',');
    expect(overlay()).not.toBeNull();
    // The canvas really is unmounted in this layout — without this the
    // assertion above would pass in the layout it was meant to exclude.
    expect(document.querySelector('[data-canvas-pane]')).toBeNull();
  });
});

describe('the theme section is the same state as the sidebar toggle', () => {
  it('writes the pick to prefs and moves the document', () => {
    render(<Canvas model={MODEL} />);
    press(',');
    fireEvent.click(option('light'));
    expect(stored().theme).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('offers system beside light and dark, and stores it as its own choice', () => {
    render(<Canvas model={MODEL} />);
    press(',');
    fireEvent.click(option('system'));
    // Stored as `system`, not resolved to a colour: the store has to be able to
    // tell "follow the OS" from "I picked dark and the OS happens to agree".
    expect(stored().theme).toBe('system');
  });
});

describe('the layout section picks from the layouts that exist', () => {
  it('lists every exported layout and no invented one', () => {
    const names = Object.keys(LAYOUTS);
    expect(names.length).toBeGreaterThanOrEqual(2);
    render(<Canvas model={MODEL} />);
    press(',');
    const listed = [...(overlay()?.querySelectorAll('[data-layout-option]') ?? [])].map(
      (el) => el.getAttribute('data-layout-option') ?? '',
    );
    for (const name of names) {
      expect(listed, `${name} is a layout but the picker does not offer it`).toContain(name);
    }
    // Plus the shipped one, which is what `z0` restores and is not in LAYOUTS.
    expect(listed).toContain('full');
    expect(listed.length).toBe(names.length + 1);
  });

  it('marks the current layout, and the mark follows the pick', () => {
    render(<Canvas model={MODEL} />);
    press(',');
    const current = () =>
      overlay()
        ?.querySelector('[data-layout-option][aria-checked="true"]')
        ?.getAttribute('data-layout-option');
    expect(current()).toBe('full');
    fireEvent.click(layoutTile('hide the canvas'));
    expect(current()).toBe('noCanvas');
  });

  it('writes the same pref the chord writes, byte for byte', () => {
    render(<Canvas model={MODEL} />);
    press('z');
    press('c');
    const fromChord = localStorage.getItem(KEY);
    cleanup();
    localStorage.clear();

    render(<Canvas model={MODEL} />);
    press(',');
    fireEvent.click(layoutTile('hide the canvas'));
    expect(localStorage.getItem(KEY)).toBe(fromChord);
  });
});

describe('the keyboard reference is the generated sheet', () => {
  it('lists exactly what buildKeySheet lists', () => {
    render(<Canvas model={MODEL} />);
    press(',');
    const rows = buildKeySheet().flatMap((group) => group.rows);
    expect(rows.length).toBeGreaterThan(25);
    const printed = [...(overlay()?.querySelectorAll('[data-settings-keys]') ?? [])].map(
      (el) => el.textContent ?? '',
    );
    for (const row of rows) {
      expect(printed, `"${row.keys}" is bound but the reference omits it`).toContain(row.keys);
    }
    // The DISTINCT keys, not the row count: the sheet lists a mode-dependent
    // binding once per cursor mode while this reference still prints one row
    // per binding. Grouping it by mode is a following task; what this asserts
    // is the property it always did — the reference shows every bound key and
    // no unbound one.
    expect(new Set(printed)).toEqual(new Set(rows.map((row) => row.keys)));
  });
});
