// @vitest-environment happy-dom

/**
 * THE CONTROL FOR CONCISE MODE, at the surface the operator touches.
 *
 * Two halves, and the second is the one that matters. A settings row that
 * writes a value into `prefs` and a settings row that changes the screen are
 * different things, and only the second is a setting -- so the last block here
 * drives `Canvas`, opens the overlay with the key an operator opens it with,
 * clicks the choice, and reads the column.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { DEFAULT_TURN_PROGRESS, setActiveTurnProgress } from '../../src/renderer/prefs/progress.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

function turn(id: string, over: Partial<Decision> = {}): Decision {
  return {
    id,
    label: `turn-${id}`,
    input: `ask ${id}`,
    output: `done ${id}`,
    commands: [],
    ...over,
  };
}

function session(id: string, decisions: readonly Decision[]): Session {
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
    decisions,
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'factory',
      sessions: [session('a1', [turn('a'), turn('b'), turn('c')])],
    },
  ],
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
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.style.cssText = '';
  setActiveTurnProgress(DEFAULT_TURN_PROGRESS);
});

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
}

const option = (mode: string) =>
  document.querySelector<HTMLButtonElement>(`[data-turn-progress-option="${mode}"]`);
const promise = () =>
  document.querySelector<HTMLElement>('[data-turn-progress-note]')?.textContent ?? '';
const lines = () => document.querySelectorAll('[data-progress-line]');

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('the appearance section offers the two modes', () => {
  it('draws both, with the one in force pressed', () => {
    open();
    expect(option('shown')?.getAttribute('aria-pressed')).toBe('true');
    expect(option('collapsed')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('follows a stored choice rather than the default', () => {
    open({ ...EMPTY_PREFS, turnProgress: 'collapsed' });
    expect(option('collapsed')?.getAttribute('aria-pressed')).toBe('true');
    expect(option('shown')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('writes the picked mode, disturbing no neighbour', () => {
    const { onChange } = open({ ...EMPTY_PREFS, outFontSize: 15, theme: 'light' });
    fireEvent.click(option('collapsed') as HTMLElement);
    const next = changed(onChange, 0);
    expect(next.turnProgress).toBe('collapsed');
    expect(next.outFontSize).toBe(15);
    expect(next.theme).toBe('light');
  });

  it('writes it back', () => {
    const { onChange } = open({ ...EMPTY_PREFS, turnProgress: 'collapsed' });
    fireEvent.click(option('shown') as HTMLElement);
    expect(changed(onChange, 0).turnProgress).toBe('shown');
  });

  it('says on screen what collapsing keeps, not only in a comment', () => {
    // The row is asking the operator to give up detail. What it must never
    // cost them is the alarm, and a promise kept only in the source is a
    // promise the person making the choice cannot read. The three things
    // `drawsProgressLine` holds back are named here, in the operator's words.
    open();
    expect(promise()).toContain('failed');
    expect(promise()).toContain('waiting');
    expect(promise().toLowerCase()).toContain('working');
  });
});

describe('picking a mode changes the screen, not only the store', () => {
  it('takes the quiet turns’ lines off the column, and puts them back', () => {
    // END TO END through the seam the mode really travels: overlay → prefs →
    // `writePrefs` → `activatePrefs` → the module store → the column's
    // subscription. Every one of those is a place the choice can be dropped
    // silently, and a test that stopped at `onChange` would pass over all of
    // them.
    render(<Canvas model={MODEL} />);
    expect(lines().length, 'the column starts with a line per turn').toBe(3);

    const settings = () =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
      });
    settings();
    fireEvent.click(option('collapsed') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close settings' }));
    expect(lines().length, 'every turn here is quiet and finished').toBe(0);

    settings();
    fireEvent.click(option('shown') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close settings' }));
    expect(lines().length, 'and the choice is reversible').toBe(3);
  });

  it('does not fold away the turn that failed', () => {
    // The same drive, over a session with a failing turn: the whole point of
    // the setting is that this line survives it.
    const model: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'factory',
          sessions: [session('a1', [turn('a'), turn('b', { errorCount: 2 }), turn('c')])],
        },
      ],
    };
    render(<Canvas model={model} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    });
    fireEvent.click(option('collapsed') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close settings' }));
    expect(lines().length).toBe(1);
    expect(document.querySelector('[data-progress-failed]')?.textContent).toBe('· 2 failed');
  });
});
