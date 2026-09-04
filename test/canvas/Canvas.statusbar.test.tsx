// @vitest-environment happy-dom

/**
 * What the status bar is allowed to say.
 *
 * The operator asked for two removals: the session tallies ("statusbar khong
 * can list so session va session status") and everything on the right except
 * the `?` hint ("Phan ben phai status bar, chi de `?` keyboard shortcut
 * thoi"). This file pins BOTH as absences, so a re-add fails a test rather
 * than quietly landing.
 *
 * It also pins what must survive: the mode indicator, which a modal app
 * cannot do without, and the usage cell and bars beside it -- neither was
 * part of the request, and a removal that took them too would be a
 * different, unasked-for change.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, status: Session['status']): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

/** One session of every status, so every tally cell that could render would. */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [session('a1', 'running'), session('a2', 'waiting')],
    },
    { id: 'p2', name: 'beta', source: 'orca', sessions: [session('b1', 'done')] },
    { id: 'p3', name: 'gamma', sessions: [session('c1', 'failed')] },
  ],
};

const statusBar = () => document.querySelector('[data-status-bar]');
const statusText = () => statusBar()?.textContent ?? '';

beforeAll(() => {
  // ReactFlow measures with APIs happy-dom does not implement.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  globalThis.localStorage ??= (() => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    };
  })() as unknown as Storage;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the status bar after the trim', () => {
  it('counts nothing: no session tally, no per-status tally, no project count', () => {
    render(<Canvas model={MODEL} />);
    const text = statusText();
    expect(text).not.toMatch(/sessions/);
    expect(text).not.toMatch(/\d+ running/);
    expect(text).not.toMatch(/need you/);
    expect(text).not.toMatch(/\d+ done/);
    expect(text).not.toMatch(/\d+ failed/);
    expect(text).not.toMatch(/projects/);
  });

  it('drops the budget cell with the rest of the right-hand end', () => {
    render(<Canvas model={MODEL} />);
    expect(statusBar()?.querySelector('[data-budget]')).toBeNull();
    expect(statusText()).not.toMatch(/cap/);
  });

  it('leaves `?` as the only thing right of the spacer', () => {
    render(<Canvas model={MODEL} />);
    const bar = statusBar();
    expect(bar).not.toBeNull();
    const children = [...(bar?.children ?? [])];
    const spacer = children.findIndex((el) => el.className.split(/\s+/).includes('flex-1'));
    expect(spacer).toBeGreaterThanOrEqual(0);
    const right = children.slice(spacer + 1);
    expect(right.map((el) => el.textContent)).toEqual(['?Keyboard shortcut']);
  });

  it('draws `?` as a tag and names what it opens', () => {
    render(<Canvas model={MODEL} />);
    const hint = statusBar()?.querySelector('[data-keysheet-hint]');
    // The key is a tag, not loose text: it has to read as a key you press,
    // which is what a bordered cap does and a bare glyph does not.
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe('?');
    expect(hint?.className).toMatch(/border/);
    // And the label beside it says what pressing it does -- a lone `?` in a
    // corner is discoverable only to someone who already knows.
    expect(statusText()).toContain('Keyboard shortcut');
  });

  it('still prints the key the keysheet is actually bound to', () => {
    render(<Canvas model={MODEL} />);
    // `?` is the `help` chord in the binding tables; the hint must not name
    // a key the grammar does not answer to.
    expect(statusText()).toMatch(/\?/);
    expect(statusText()).not.toMatch(/hjkl/);
  });

  it('keeps the mode indicator and the usage cell, which nobody asked to lose', () => {
    render(<Canvas model={MODEL} />);
    expect(statusBar()?.querySelector('[data-mode]')?.textContent).toBe('NORMAL');
    expect(statusBar()?.querySelector('[data-usage]')).not.toBeNull();
  });
});
