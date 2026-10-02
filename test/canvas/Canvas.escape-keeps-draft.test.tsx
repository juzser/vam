// @vitest-environment happy-dom

/** EC-52 (event #47): Esc and `Mod-[` leave Insert and keep the draft; only a send clears it. */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';

function session(id: string): Session {
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
  };
}

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1')] }],
};

const mode = () => document.querySelector('[data-mode]')?.textContent ?? '';
const composer = () =>
  document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="prompt to session"]',
  ) as HTMLTextAreaElement;

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

function typeDraft(text: string) {
  const box = composer();
  act(() => {
    box.focus();
    fireEvent.focusIn(box);
  });
  fireEvent.change(box, { target: { value: text } });
  expect(composer().value).toBe(text);
}

function leaveWith(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    composer().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
    );
  });
}

describe('EC-52: leaving Insert keeps what was typed', () => {
  it('Escape leaves Insert and the draft is still in the box', () => {
    render(<Canvas model={MODEL} />);
    typeDraft('half a reply');
    expect(mode()).toBe('Insert');
    leaveWith('Escape');
    expect(mode()).toBe('Select');
    expect(composer().value).toBe('half a reply');
    expect(document.activeElement).not.toBe(composer());
  });

  it('Mod-[ does the same', () => {
    render(<Canvas model={MODEL} />);
    typeDraft('another draft');
    leaveWith('[', { metaKey: true, code: 'BracketLeft' });
    expect(mode()).toBe('Select');
    expect(composer().value).toBe('another draft');
  });

  it('coming back to Insert finds the draft there', () => {
    render(<Canvas model={MODEL} />);
    typeDraft('keep me');
    leaveWith('Escape');
    act(() => {
      composer().focus();
      fireEvent.focusIn(composer());
    });
    expect(mode()).toBe('Insert');
    expect(composer().value).toBe('keep me');
  });

  it('(a) the first Escape with a popover open closes only the popover', () => {
    render(<Canvas model={MODEL} />);
    typeDraft('mid-thought');
    const toggle = document.querySelector('[data-provider-picker-toggle]') as HTMLElement;
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    leaveWith('Escape');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(mode()).toBe('Insert');
    expect(composer().value).toBe('mid-thought');
  });

  it('(c) a shell-level cancel leaves every draft', () => {
    render(<Canvas model={MODEL} />);
    typeDraft('still here');
    leaveWith('Escape');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(composer().value).toBe('still here');
  });
});

describe('EC-52: only a send empties the draft', () => {
  it('(b) Submit still clears it', async () => {
    const source = {
      id: 'claude-code',
      label: 'Claude Code',
      capabilities: { recordPrompt: true, deliverPrompt: false, terminal: false },
      declines: {},
      viewerScope: { kind: 'connection', note: 'one local process' },
      load: async () => [],
      write: { recordPrompt: async () => {} },
    } as unknown as SessionSource;
    render(<Canvas model={MODEL} source={{ kind: 'session', source, onWrote: () => {} }} />);
    typeDraft('send me');
    await act(async () => {
      composer().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(composer().value).toBe('');
  });
});
