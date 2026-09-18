// @vitest-environment happy-dom

/**
 * THE CONTROL FOR FOCUS VIEW, at the surface the operator touches.
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
import { DEFAULT_FOCUS_VIEW, setActiveFocusView } from '../../src/renderer/prefs/progress.js';
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
  setActiveFocusView(DEFAULT_FOCUS_VIEW);
});

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
}

const toggle = () => document.querySelector<HTMLButtonElement>('[data-switch="focus-view"]');
/** The two parts that make a switch LOOK like one rather than read like one. */
const track = () => toggle()?.querySelector('[data-switch-track]') ?? null;
const knob = () => toggle()?.querySelector('[data-switch-knob]') ?? null;
const promise = () =>
  document.querySelector<HTMLElement>('[data-focus-view-note]')?.textContent ?? '';
const lines = () => document.querySelectorAll('[data-progress-line]');
const unfolds = () => document.querySelectorAll('[data-turn-unfold]');

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('the appearance section offers focus view', () => {
  it('is a switch, and says which way it is thrown', () => {
    // A SWITCH RATHER THAN TWO BUTTONS, because there is one thing being
    // turned on now instead of two words to choose between -- and `role` plus
    // `aria-checked` is how that reaches a screen reader as a state rather
    // than as a pressed button whose label happens to read "on".
    open();
    expect(toggle()?.getAttribute('role')).toBe('switch');
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(toggle()?.textContent).toBe('off');
  });

  it('looks like a switch, not only like a button that says "off"', () => {
    // OPERATOR: "turn some of the settings buttons into a toggle UI." The
    // control already WAS a switch to a screen reader and a bordered word to
    // everybody else, which is the half that was missing: a state is read off
    // a track and a knob at a glance, where a word has to be read.
    //
    // STRUCTURE HERE, TRAVEL IN THE BROWSER. Whether the knob actually moves
    // and whether the two states are distinguishable are questions about
    // paint, and `e2e/settings-chrome-shots.mjs` measures them. What this can
    // hold is that the parts exist at all, on both states.
    open();
    expect(track(), 'the track is drawn').not.toBeNull();
    expect(knob(), 'the knob is drawn').not.toBeNull();
    expect(knob()?.getAttribute('aria-hidden'), 'the paint is decorative').toBe('true');
    cleanup();
    open({ ...EMPTY_PREFS, focusView: true });
    expect(track()).not.toBeNull();
    expect(knob()).not.toBeNull();
  });

  it('is named for what it controls, never for the state it is in', () => {
    // An accessible name that flips with the value ("turn focus view on")
    // makes the control a different control on every press, and a screen
    // reader then reads the state twice and the purpose never.
    open();
    const off = toggle()?.getAttribute('aria-label') ?? '';
    cleanup();
    open({ ...EMPTY_PREFS, focusView: true });
    expect(toggle()?.getAttribute('aria-label')).toBe(off);
    expect(off.toLowerCase()).toContain('focus view');
  });

  it('follows a stored choice rather than the default', () => {
    open({ ...EMPTY_PREFS, focusView: true });
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
    expect(toggle()?.textContent).toBe('on');
  });

  it('writes the choice, disturbing no neighbour', () => {
    const { onChange } = open({ ...EMPTY_PREFS, outFontSize: 15, theme: 'light' });
    fireEvent.click(toggle() as HTMLElement);
    const next = changed(onChange, 0);
    expect(next.focusView).toBe(true);
    expect(next.outFontSize).toBe(15);
    expect(next.theme).toBe('light');
  });

  it('writes it back', () => {
    const { onChange } = open({ ...EMPTY_PREFS, focusView: true });
    fireEvent.click(toggle() as HTMLElement);
    expect(changed(onChange, 0).focusView).toBe(false);
  });

  it('says on screen what folding keeps, and that it comes back', () => {
    // The row is asking the operator to give up detail, and it is the only
    // place they learn what happens. Two promises, not one: what folding may
    // never cost them (the alarm), and that the folded thing is one press
    // away. A guarantee kept only in the source is one the person making the
    // choice cannot read.
    open();
    expect(promise()).toContain('failed');
    expect(promise()).toContain('waiting');
    expect(promise().toLowerCase()).toContain('working');
    // The way back, named where the choice is made.
    expect(promise()).toContain('···');
    expect(promise().toLowerCase()).toContain('comes back');
  });

  it('says what it folds in its own label, not only in the note under it', () => {
    // "turn progress / shown / collapsed" named a QUANTITY and two words that
    // could be read as deleted and kept. The label and hint are what an
    // operator skims; they have to carry the two facts on their own.
    open();
    const block = toggle()?.closest('section, div')?.parentElement?.textContent ?? '';
    expect(block.toLowerCase()).toContain('focus view');
    expect(block.toLowerCase()).toContain('fold');
  });
});

describe('throwing the switch changes the screen, not only the store', () => {
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
    fireEvent.click(toggle() as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close settings' }));
    expect(lines().length, 'every turn here is quiet and finished').toBe(0);
    // AND THE FOLD LEFT A WAY BACK ON EVERY ONE OF THEM, through the same
    // seam. A column with no lines and no ways back is what the retired
    // setting produced, and it is indistinguishable from a deletion.
    expect(unfolds().length, 'folded, not deleted').toBe(3);

    settings();
    fireEvent.click(toggle() as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close settings' }));
    expect(lines().length, 'and the choice is reversible').toBe(3);
    expect(unfolds().length, 'with nothing folded, nothing offers to unfold').toBe(0);
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
    fireEvent.click(toggle() as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close settings' }));
    expect(lines().length).toBe(1);
    expect(document.querySelector('[data-progress-failed]')?.textContent).toBe('· 2 failed');
  });
});
