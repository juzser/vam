// @vitest-environment happy-dom

/**
 * EC-52 (operator event #47): Esc and `Mod-[` leave Insert for Select and keep
 * the composer draft exactly as typed. Only a send clears it.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

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

/** Type a draft into the focused box, the way a person would. */
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
});
