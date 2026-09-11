// @vitest-environment happy-dom

/**
 * THE CONTROL FOR THE SEND KEY, at the surface the operator touches.
 *
 * Two halves, and the second is the one that matters. A settings row that
 * writes a value into `prefs` and a settings row that changes the screen are
 * different things, and only the second is a setting -- so the last block here
 * drives `Canvas`, opens the overlay with the key an operator opens it with,
 * clicks the choice, closes it, and then presses a key in the real composer.
 * Every hop between those two is a place the choice can be dropped in silence.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import {
  DEFAULT_PROMPT_SUBMIT_KEY,
  setActivePromptSubmitKey,
} from '../../src/renderer/prefs/submit-key.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

const TURN: Decision = {
  id: 'd1',
  label: 'plan',
  input: 'ask me',
  output: 'asked',
  commands: [],
};

const SESSION: Session = {
  id: 'a1',
  title: 'a1',
  icon: null,
  epic: null,
  branch: null,
  status: 'running',
  runningAgents: 0,
  activity: null,
  age: '3m',
  decisions: [TURN],
};

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'factory', sessions: [SESSION] }],
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
  setActivePromptSubmitKey(DEFAULT_PROMPT_SUBMIT_KEY);
});

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <SettingsOverlay
      prefs={prefs}
      theme="dark"
      onChange={onChange}
      onClose={onClose}
      initialSection="sessions"
    />,
  );
  return { onChange, onClose };
}

const option = (key: string) =>
  document.querySelector<HTMLButtonElement>(`[data-submit-key-option="${key}"]`);
const note = () => document.querySelector<HTMLElement>('[data-submit-key-note]')?.textContent ?? '';
const hint = () => document.querySelector<HTMLElement>('[data-prompt-send-key]');

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('the sessions section offers the two keys', () => {
  it('draws both, with the one in force pressed', () => {
    open();
    expect(option('enter')?.getAttribute('aria-pressed')).toBe('true');
    expect(option('shift-enter')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('names each key the way the composer names it', () => {
    // One table (`SUBMIT_KEY_LABELS`), two surfaces. A picker that said
    // "shift-enter" over a box that said "Shift-Enter" would be two spellings
    // of one key, which is how a setting comes to look like a different one.
    open();
    expect(option('enter')?.textContent).toBe('Enter');
    expect(option('shift-enter')?.textContent).toBe('Shift-Enter');
  });

  it('follows a stored choice rather than the default', () => {
    open({ ...EMPTY_PREFS, promptSubmitKey: 'shift-enter' });
    expect(option('shift-enter')?.getAttribute('aria-pressed')).toBe('true');
    expect(option('enter')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('writes the picked key, disturbing no neighbour', () => {
    const { onChange } = open({ ...EMPTY_PREFS, outFontSize: 15, theme: 'light' });
    fireEvent.click(option('shift-enter') as HTMLElement);
    const next = changed(onChange, 0);
    expect(next.promptSubmitKey).toBe('shift-enter');
    expect(next.outFontSize).toBe(15);
    expect(next.theme).toBe('light');
  });

  it('writes it back', () => {
    const { onChange } = open({ ...EMPTY_PREFS, promptSubmitKey: 'shift-enter' });
    fireEvent.click(option('enter') as HTMLElement);
    expect(changed(onChange, 0).promptSubmitKey).toBe('enter');
  });

  it('says what the OTHER key does, since the row moves two things at once', () => {
    // The row's whole point is that the two keys trade places. A caption that
    // named only the send would leave the operator to discover the newline by
    // losing a draft to it.
    open();
    expect(note().toLowerCase()).toContain('newline');
  });
});

describe('picking a key changes the composer, not only the store', () => {
  it('moves the send key, and the caption that names it, end to end', () => {
    // THROUGH THE WHOLE SEAM: overlay → prefs → `writePrefs` → `activatePrefs`
    // → the module store → the box's subscription. A test that stopped at
    // `onChange` would pass over every one of those.
    render(<Canvas model={MODEL} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    });
    expect(hint(), 'the composer draws no send-key caption at all').not.toBeNull();
    expect(hint()?.textContent, 'the box starts on the shipped key').toContain('Enter → ');
    expect(hint()?.textContent).not.toContain('Shift');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    });
    fireEvent.click(option('shift-enter') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close settings' }));
    expect(hint()?.textContent).toContain('Shift-Enter → ');

    // And it is reversible from the same row.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    });
    fireEvent.click(option('enter') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close settings' }));
    expect(hint()?.textContent).not.toContain('Shift');
  });

  it('makes the swapped key the one that actually submits', () => {
    // The caption above is a report; this is the behaviour it reports on. A
    // cancelable event is the only kind `preventDefault` is observable
    // through, and `fireEvent` builds one.
    render(<Canvas model={MODEL} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    });
    fireEvent.click(option('shift-enter') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close settings' }));

    const box = document.querySelector(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'ship it' } });
    // A bare Enter is the newline now: the box does not claim the keystroke.
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true);
    expect(box.value, 'nothing was cleared, so nothing was sent').toBe('ship it');
    // And the operator's chosen key is the one that is claimed.
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(false);
  });
});
