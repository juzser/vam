// @vitest-environment happy-dom

/**
 * The group layer end to end: what `Prefs.groups` holds, drawn.
 *
 * `SessionList.groups.test.tsx` is about the heading given a group; this is
 * about the wiring that produces one -- the store, `composeGroups`, the
 * ordering, and the fold that has to survive a reload.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, over: Partial<Session> = {}): Session {
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
    ...over,
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1')] },
    { id: 'p2', name: 'beta', source: 'black-smith', sessions: [session('b1')] },
  ],
};

function seed(prefs: Record<string, unknown>) {
  localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
}

const heading = (id: string) => document.querySelector(`[data-group-id="${id}"]`);
const rows = () => document.querySelectorAll('[data-session-row]').length;
const storedPrefs = () =>
  JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}') as Record<string, unknown>;

beforeAll(() => {
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

describe('groups, from the store to the sidebar', () => {
  it('draws nothing new for a store that has no groups', () => {
    render(<Canvas model={MODEL} />);
    expect(document.querySelectorAll('[data-group-heading]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-project-heading]')).toHaveLength(2);
    expect(rows()).toBe(2);
  });

  it('draws a stored group over the members it resolves', () => {
    seed({
      groups: { 'black-smith': [{ id: 'group:1', name: 'the-monorepo', projects: ['p1'] }] },
    });
    render(<Canvas model={MODEL} />);
    expect(heading('group:1')?.textContent).toContain('the-monorepo');
    expect(document.querySelector('[data-group-count="group:1"]')?.textContent).toBe('1');
    // p1 moved under the group; p2 stayed at the top level.
    expect(
      document
        .querySelector('[data-project-id="p1"]')
        ?.closest('li')
        ?.getAttribute('data-in-group'),
    ).toBe('group:1');
    expect(
      document
        .querySelector('[data-project-id="p2"]')
        ?.closest('li')
        ?.getAttribute('data-in-group'),
    ).toBe(null);
  });

  it('folds a group and writes the fold where a reload will find it', () => {
    seed({ groups: { 'black-smith': [{ id: 'group:1', name: 'work', projects: ['p1'] }] } });
    render(<Canvas model={MODEL} />);
    expect(rows()).toBe(2);
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-group-collapse="group:1"]')?.click();
    });
    expect(rows()).toBe(1);
    expect(storedPrefs().collapsedGroups).toEqual({ 'black-smith': ['group:1'] });
  });
});
