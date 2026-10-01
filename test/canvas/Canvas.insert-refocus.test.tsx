// @vitest-environment happy-dom

/**
 * AFTER AN APP SWITCH, Esc THEN `i` PUTS THE CURSOR BACK IN THE PROMPT, AND AN
 * IME COMPOSITION IS NEVER READ AS A KEY (operator event #70).
 *
 * The report: switching to another app and back lost the insert focus; Esc
 * then `i` did not focus the prompt ("stuck in select mode"); and the first
 * word of the next prompt lost a character under a Vietnamese IME.
 *
 * Two halves, both in `Canvas.tsx`'s window key listener and its mode effect:
 *   - the listener ignores a keydown that is part of a composition
 *     (`isComposing`, or the legacy `keyCode` 229);
 *   - a window `focus` after a `blur` that left insert mode puts the keyboard
 *     back on the stop that held it, when that stop is still connected.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [{ id: `${id}-d`, label: 'plan', input: 'in', output: 'out', commands: [] }],
    ...over,
  };
}

const QUIET: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1'), session('a2')] },
  ],
};

const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
const composer = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
const statusText = () =>
  document.querySelector('[data-status-bar] [data-status]')?.textContent ?? '';

/** A cancelable keydown on the window; returns the event so a test can read `defaultPrevented`. */
function press(key: string, init: KeyboardEventInit & { keyCode?: number } = {}) {
  const { keyCode, ...rest } = init;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...rest });
  if (keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: keyCode });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** The app switch: the window loses focus, and the focused element reports a `focusout` to nowhere. */
function appSwitchAway({ activeToBody }: { activeToBody: boolean }) {
  act(() => {
    window.dispatchEvent(new FocusEvent('blur'));
    document.activeElement?.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
    );
    if (activeToBody && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
}
function appSwitchBack() {
  act(() => {
    window.dispatchEvent(new FocusEvent('focus'));
  });
}

function typeInto(el: HTMLTextAreaElement, value: string) {
  act(() => {
    fireEvent.change(el, { target: { value } });
  });
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(cleanup);

describe('EC-63 -- Esc then i after an app switch refocuses the prompt', () => {
  for (const activeToBody of [false, true]) {
    it(`activeElement ${activeToBody ? 'moved to body' : 'left on the textarea'} during the blur`, () => {
      render(<Canvas model={QUIET} />);
      press('i');
      expect(document.activeElement).toBe(composer());
      appSwitchAway({ activeToBody });
      appSwitchBack();
      press('Escape');
      press('i');
      expect(document.activeElement).toBe(composer());
      expect(mode()).toBe('Insert');
      typeInto(composer() as HTMLTextAreaElement, 'abc');
      expect(composer()?.value).toBe('abc');
    });
  }

  it('window focus alone puts the keyboard back when the mode was insert before the blur', () => {
    render(<Canvas model={QUIET} />);
    press('i');
    appSwitchAway({ activeToBody: true });
    expect(document.activeElement).not.toBe(composer());
    appSwitchBack();
    expect(document.activeElement).toBe(composer());
    expect(mode()).toBe('Insert');
  });

  it('window focus alone focuses nothing when the mode was select before the blur', () => {
    render(<Canvas model={QUIET} />);
    expect(mode()).toBe('Select');
    appSwitchAway({ activeToBody: false });
    appSwitchBack();
    expect(document.activeElement).toBe(document.body);
    expect(mode()).toBe('Select');
  });

  it('window focus does not refocus a stop that has left the document', () => {
    const view = render(<Canvas model={QUIET} />);
    press('i');
    appSwitchAway({ activeToBody: true });
    view.unmount();
    expect(() => appSwitchBack()).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('EC-64 -- an IME composition is not a key', () => {
  it('i leaves the draft exactly as it was, with no added or zero-width character', () => {
    render(<Canvas model={QUIET} />);
    press('i');
    expect(composer()?.value).toBe('');
    composer()?.blur();
    press('i');
    expect(composer()?.value).toBe('');
    typeInto(composer() as HTMLTextAreaElement, 'xin');
    composer()?.blur();
    press('i');
    expect(composer()?.value).toBe('xin');
    expect(composer()?.value).not.toMatch(/[​-‍﻿]/);
  });

  for (const [label, init] of [
    ['isComposing', { isComposing: true }],
    ['keyCode 229', { keyCode: 229 }],
  ] as const) {
    it(`select mode: i with ${label} moves no focus, says nothing and is not prevented`, () => {
      render(<Canvas model={QUIET} />);
      const event = press('i', init);
      expect(document.activeElement).not.toBe(composer());
      expect(statusText()).toBe('');
      expect(event.defaultPrevented).toBe(false);
      expect(mode()).toBe('Select');
    });

    it(`insert mode: Escape with ${label} leaves the keyboard in the prompt`, () => {
      render(<Canvas model={QUIET} />);
      press('i');
      const event = press('Escape', init);
      expect(document.activeElement).toBe(composer());
      expect(event.defaultPrevented).toBe(false);
      expect(mode()).toBe('Insert');
    });
  }

  it('a composition on the first word leaves the composed text as the value', () => {
    render(<Canvas model={QUIET} />);
    press('i');
    const box = composer() as HTMLTextAreaElement;
    act(() => {
      box.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      box.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'v',
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      );
    });
    typeInto(box, 'việt');
    act(() => {
      box.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'việt' }));
    });
    expect(box.value).toBe('việt');
    expect(document.activeElement).toBe(box);
  });

  it('the focus move for i happens after the keydown returns', () => {
    render(<Canvas model={QUIET} />);
    let during: Element | null = null;
    const event = new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
      during = document.activeElement;
    });
    expect(during).not.toBe(composer());
    expect(document.activeElement).toBe(composer());
  });
});
