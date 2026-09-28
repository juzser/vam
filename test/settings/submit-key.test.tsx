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

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import { chordSymbols } from '../../src/renderer/keyboard/chords.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import {
  DEFAULT_PROMPT_SUBMIT_KEY,
  SUBMIT_KEY_LABELS,
  setActivePromptSubmitKey,
} from '../../src/renderer/prefs/submit-key.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { onBothPlatforms } from '../support/platform.js';

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
      initialSection="agents"
    />,
  );
  return { onChange, onClose };
}

const option = (key: string) =>
  document.querySelector<HTMLButtonElement>(`[data-submit-key-option="${key}"]`);
const note = () => document.querySelector<HTMLElement>('[data-submit-key-note]')?.textContent ?? '';

/**
 * `,` OPENS ON `interface` FROM `Canvas.tsx` (its own `'settings'` case),
 * not `agents` -- the single-section-view restructure (item C) means the
 * send-key row is not in the document until the nav is clicked there, so
 * every end-to-end open in this file (through `Canvas`, not `open()`
 * above) drives that click rather than trusting the row was already
 * mounted.
 */
async function openSettingsAtAgents(): Promise<void> {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
  });
  await waitFor(() => {
    if (!document.querySelector('[data-settings-nav-item="agents"]')) {
      throw new Error('nav still pending');
    }
  });
  fireEvent.click(document.querySelector('[data-settings-nav-item="agents"]') as HTMLElement);
  await waitFor(() => {
    if (!option('enter')) throw new Error('still pending');
  });
}

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('the agents section offers the two keys', () => {
  it('draws both, with the one in force pressed', () => {
    open();
    expect(option('enter')?.getAttribute('aria-pressed')).toBe('true');
    expect(option('shift-enter')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('names each key the way the composer names it', () => {
    // One table (`SUBMIT_KEY_LABELS`), two surfaces. A picker that said
    // "shift-enter" over a box that said "Shift-Enter" would be two spellings
    // of one key, which is how a setting comes to look like a different one.
    //
    // AND THE TABLE'S SPELLING IS A CHORD, so it reaches this button through
    // `chordSymbols` like every other key in settings: ⇧⏎ on a Mac, and
    // `Shift+Enter` off one. Both, from one run — see `chords.ts`.
    onBothPlatforms((mac) => {
      open();
      expect(option('enter')?.textContent).toBe(chordSymbols(SUBMIT_KEY_LABELS.enter, mac));
      expect(option('shift-enter')?.textContent).toBe(
        chordSymbols(SUBMIT_KEY_LABELS['shift-enter'], mac),
      );
      expect(option('enter')?.textContent).toBe(mac ? '⏎' : 'Enter');
      expect(option('shift-enter')?.textContent).toBe(mac ? '⇧ ⏎' : 'Shift+Enter');
      cleanup();
    });
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
  it('moves the send key end to end, and moves it back', async () => {
    // THROUGH THE WHOLE SEAM: overlay → prefs → `writePrefs` → `activatePrefs`
    // → the module store → the box's subscription. A test that stopped at
    // `onChange` would pass over every one of those.
    //
    // ASSERTED ON THE KEYSTROKE, NOT ON A CAPTION, since the composer draws no
    // caption for its send key any more -- the row under the prompt input is
    // gone, at the operator's ask, and this test used to read it. A claimed
    // keystroke is `defaultPrevented` on a cancelable event, which `fireEvent`
    // builds and reports as its return value; that is the one signal the two
    // modes really differ in.
    //
    // BOTH DIRECTIONS, which is what this test keeps that the one below does
    // not: a pref that could be set once and not unset would strand an
    // operator on a key they were trying out.
    render(<Canvas model={MODEL} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    });
    const box = document.querySelector(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;
    // A composer to press keys IN, or every claim below is free.
    expect(box, 'the composer is not open, so none of this is about a send key').not.toBeNull();
    fireEvent.change(box, { target: { value: 'ship it' } });
    // The shipped key: a bare Enter is claimed, Shift+Enter is the newline.
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true);

    // `SettingsOverlay` is its own lazy chunk now (`Canvas.tsx`'s own
    // `React.lazy` + `Suspense`), and the send-key row is Agents' own now
    // too (the single-section-view restructure, item C): `,` lands on
    // `interface` from `Canvas.tsx`'s own `'settings'` case, so
    // `openSettingsAtAgents` drives the nav click that puts it in the
    // document at all. The chunk is cached after this first open, and the
    // nav click itself is what persists `agents` as the last section
    // viewed (`last-section.ts`), so the second open below needs neither
    // wait: it reopens there on its own.
    await openSettingsAtAgents();
    fireEvent.click(option('shift-enter') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    fireEvent.change(box, { target: { value: 'ship it' } });
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(false);

    // And it is reversible from the same row. `last-section.ts` reopens
    // Settings on `agents` directly now (the first open's own nav click
    // persisted it), but the section view still mounts on a later tick than
    // the keystroke -- `waitFor` rather than trusting it landed
    // synchronously.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    });
    await waitFor(() => {
      if (!option('enter')) throw new Error('still pending');
    });
    fireEvent.click(option('enter') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    fireEvent.change(box, { target: { value: 'ship it' } });
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true);
  });

  it('makes the swapped key the one that actually submits', async () => {
    // The caption above is a report; this is the behaviour it reports on. A
    // cancelable event is the only kind `preventDefault` is observable
    // through, and `fireEvent` builds one.
    render(<Canvas model={MODEL} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    });
    // See the sibling test above: `SettingsOverlay`'s own lazy chunk and
    // Agents' own nav click, driven independently here rather than trusted
    // from a previous test's own last-viewed section.
    await openSettingsAtAgents();
    fireEvent.click(option('shift-enter') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));

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
