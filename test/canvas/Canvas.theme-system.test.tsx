// @vitest-environment happy-dom

/**
 * `system` as a live theme, not a one-time sample.
 *
 * Two holes this file pins, both invisible to `tsc` because a two-way ternary
 * absorbs a third case in its `else` arm:
 *
 *  1. the sidebar's sun button read the STORED theme, so with `system` on a
 *     dark OS it announced "switch to dark theme" and one click resolved to
 *     `dark` — the class on `<html>` never moved and the operator clicked twice;
 *  2. `system` sampled `prefers-color-scheme` once, inside the `[prefs.theme]`
 *     effect, and then stopped following it — a dashboard left open past sunset
 *     kept the appearance the OS had at mount.
 *
 * Every other `applyTheme` test injects `prefersLight`, so nothing exercised
 * the real `globalThis.matchMedia` default. Nothing is injected here: the mock
 * below IS `window.matchMedia`, which is the argument the shipped code uses.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { PALETTE_TOKENS, type Prefs } from '../../src/renderer/prefs/prefs.js';

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
  projects: [{ id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1')] }],
};

const KEY = 'vam.prefs.v1';
const seed = (payload: Partial<Prefs>) => localStorage.setItem(KEY, JSON.stringify(payload));
const stored = (): Partial<Prefs> => JSON.parse(localStorage.getItem(KEY) ?? '{}');
const isLight = () => document.documentElement.classList.contains('light');

const TOKEN = PALETTE_TOKENS[0]?.token ?? '';
const BLUE = `#${'2f6feb'}`;
const AMBER = `#${'b45309'}`;
const inForce = () => document.documentElement.style.getPropertyValue(TOKEN);

/** The OS, as `matchMedia` reports it — mutable, and countable in listeners. */
const os = {
  light: false,
  listeners: new Set<(event: MediaQueryListEvent) => void>(),
  flip(light: boolean) {
    os.light = light;
    act(() => {
      for (const listener of [...os.listeners]) {
        listener({ matches: light } as MediaQueryListEvent);
      }
    });
  },
};

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

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      media: query,
      get matches() {
        // Only the two colour-scheme queries are this OS's business. The
        // renderer also asks a width query to choose a shell, and answering
        // that one would both flip these desktop assertions onto the phone
        // shell and count a width listener as an OS listener.
        if (query.includes('light')) return os.light;
        return query.includes('dark') ? !os.light : false;
      },
      addEventListener: (_type: string, fn: (event: MediaQueryListEvent) => void) =>
        void (query.includes('scheme') && os.listeners.add(fn)),
      removeEventListener: (_type: string, fn: (event: MediaQueryListEvent) => void) =>
        void os.listeners.delete(fn),
      addListener: (fn: (event: MediaQueryListEvent) => void) => void os.listeners.add(fn),
      removeListener: (fn: (event: MediaQueryListEvent) => void) => void os.listeners.delete(fn),
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  os.light = false;
  os.listeners.clear();
  document.documentElement.classList.remove('light');
  document.documentElement.style.removeProperty(TOKEN);
});

describe('the sun button reads the effective theme, not the stored one', () => {
  it('offers light when system resolves to dark', () => {
    os.light = false;
    seed({ theme: 'system' });
    render(<Canvas model={MODEL} />);
    expect(isLight(), 'a dark OS under system means no light class').toBe(false);
    expect(screen.getByLabelText('switch to light theme')).toBeTruthy();
  });

  it('offers dark when system resolves to light', () => {
    os.light = true;
    seed({ theme: 'system' });
    render(<Canvas model={MODEL} />);
    expect(isLight()).toBe(true);
    expect(screen.getByLabelText('switch to dark theme')).toBeTruthy();
  });

  it('one click from system on a dark OS visibly changes the document', () => {
    os.light = false;
    seed({ theme: 'system' });
    render(<Canvas model={MODEL} />);
    expect(isLight()).toBe(false);
    fireEvent.click(screen.getByLabelText('switch to light theme'));
    // The point of the finding: the OLD code stored `dark` here and the class
    // never moved, so the screen was identical and the operator clicked twice.
    expect(stored().theme).toBe('light');
    expect(isLight()).toBe(true);
  });
});

describe('system keeps following the OS after mount', () => {
  it('moves the document when prefers-color-scheme changes', () => {
    seed({ theme: 'system' });
    render(<Canvas model={MODEL} />);
    expect(isLight()).toBe(false);
    os.flip(true);
    expect(isLight()).toBe(true);
    os.flip(false);
    expect(isLight()).toBe(false);
  });

  it('relabels the sun button when the OS flips underneath it', () => {
    // Light OS first, so the label starts on the arm the stored `system` would
    // NOT produce: this fails on a button that reads `prefs.theme`.
    os.light = true;
    seed({ theme: 'system' });
    render(<Canvas model={MODEL} />);
    expect(screen.getByLabelText('switch to dark theme')).toBeTruthy();
    os.flip(false);
    expect(screen.getByLabelText('switch to light theme')).toBeTruthy();
  });

  it('ignores the OS while an explicit theme is stored', () => {
    seed({ theme: 'dark' });
    render(<Canvas model={MODEL} />);
    os.flip(true);
    expect(isLight(), 'an explicit dark must not follow the OS').toBe(false);
  });

  it('subscribes once per mount, not once per render', () => {
    seed({ theme: 'system' });
    render(<Canvas model={MODEL} />);
    const after = os.listeners.size;
    expect(after).toBe(1);
    os.flip(true);
    os.flip(false);
    expect(os.listeners.size).toBe(after);
  });

  it('unsubscribes on unmount', () => {
    seed({ theme: 'system' });
    const view = render(<Canvas model={MODEL} />);
    expect(os.listeners.size).toBe(1);
    view.unmount();
    expect(os.listeners.size).toBe(0);
  });

  it('unsubscribes when the theme leaves system', () => {
    seed({ theme: 'system' });
    render(<Canvas model={MODEL} />);
    expect(os.listeners.size).toBe(1);
    fireEvent.click(screen.getByLabelText('switch to light theme'));
    expect(stored().theme).toBe('light');
    expect(os.listeners.size, 'an explicit theme keeps no OS listener').toBe(0);
  });
});

/**
 * The overrides are stored per theme, so "which theme is in force" decides
 * which ones are on the document — and under `system` that answer changes
 * without anything in `prefs` changing. The class and the colours have to move
 * together or the operator sees a light theme wearing dark's canvas.
 */
describe('the palette in force follows the theme in force', () => {
  it('applies the stored theme’s bucket at mount, not the other one', () => {
    seed({ theme: 'light', palette: { dark: { [TOKEN]: BLUE }, light: { [TOKEN]: AMBER } } });
    render(<Canvas model={MODEL} />);
    expect(inForce()).toBe(AMBER);
  });

  it('swaps the overrides when the OS flips under system', () => {
    seed({ theme: 'system', palette: { dark: { [TOKEN]: BLUE }, light: { [TOKEN]: AMBER } } });
    render(<Canvas model={MODEL} />);
    expect(inForce()).toBe(BLUE);
    os.flip(true);
    expect(isLight()).toBe(true);
    expect(inForce(), 'the class moved; the colours must move with it').toBe(AMBER);
  });

  it('takes the override off the document for a theme that has none', () => {
    // Half a payload on purpose: storage holds whatever the last version
    // wrote, and `Prefs` is what comes OUT of the reader, not what goes in.
    seed({ theme: 'system', palette: { dark: { [TOKEN]: BLUE } } as Prefs['palette'] });
    render(<Canvas model={MODEL} />);
    expect(inForce()).toBe(BLUE);
    os.flip(true);
    expect(inForce(), 'an unset token falls through to the stylesheet').toBe('');
  });
});
