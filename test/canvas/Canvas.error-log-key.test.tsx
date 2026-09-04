// @vitest-environment happy-dom

/**
 * The error log gets a key.
 *
 * It shipped with a scrubbed event log and a report vam composes for the
 * operator to send, and exactly one way in: clicking the status bar. On a
 * keyboard-first tool that means an operator whose session just failed cannot
 * reach the thing that describes the failure — the surface most likely to be
 * wanted at the worst moment is the one that needs a mouse.
 *
 * Being in the chord table rather than on its own listener is what gives it the
 * two properties the reveal-project binding had to be moved here to get: it is
 * listed by the generated sheet, and it does not fire through an open overlay.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';

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
    decisions: [{ id: `${id}-d`, label: 'plan', input: 'in', output: 'out', commands: [] }],
  };
}

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1')] }],
};

const errorLog = () => document.querySelector('[data-error-log]');

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

/** Every keystroke the generated sheet lists, whatever group it landed in. */
function sheetKeys(): string[] {
  return buildKeySheet().flatMap(({ rows }) => rows.map((row) => row.keys));
}

/** The key the table binds it to, read off the sheet rather than assumed --
 *  the sheet is generated, so this follows a rebinding instead of going stale. */
function errorLogKeys(): string[] {
  return buildKeySheet()
    .flatMap(({ rows }) => rows)
    .filter((row) => /error log/i.test(row.label))
    .map((row) => row.keys);
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

describe('the error log is reachable from the keyboard', () => {
  it('is bound to exactly one key, and the sheet says which', () => {
    expect(errorLogKeys()).toHaveLength(1);
  });

  it('opens on that key', () => {
    render(<Canvas model={MODEL} />);
    expect(errorLog()).toBeNull();
    press(errorLogKeys()[0] as string);
    expect(errorLog()).not.toBeNull();
  });

  it('takes a key nothing else in the grammar holds', () => {
    const key = errorLogKeys()[0] as string;
    expect(sheetKeys().filter((k) => k === key)).toHaveLength(1);
  });
});

describe('an open overlay still owns the keyboard', () => {
  it('does not open behind the shortcut sheet', () => {
    render(<Canvas model={MODEL} />);
    press('?');
    expect(document.querySelector('[data-key-sheet]')).not.toBeNull();
    press(errorLogKeys()[0] as string);
    expect(errorLog()).toBeNull();
  });
});
