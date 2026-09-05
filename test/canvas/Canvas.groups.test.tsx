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

describe('the group lifecycle, stored', () => {
  const newGroup = () => document.querySelector<HTMLButtonElement>('[data-new-group]');
  const draft = () => document.querySelector<HTMLInputElement>('[data-group-draft]');
  const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
  const storedGroups = () =>
    (storedPrefs().groups ?? {}) as Record<string, { id: string; name: string }[]>;

  function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('creates a named group under the source it will hold projects from', () => {
    render(<Canvas model={MODEL} />);
    act(() => newGroup()?.click());
    const input = draft() as HTMLInputElement;
    act(() => type(input, 'the-monorepo'));
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const stored = storedGroups()['black-smith'] ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('the-monorepo');
    expect(stored[0]?.id).toMatch(/^group:/);
    expect(heading(stored[0]?.id ?? '')?.textContent).toContain('the-monorepo');
  });

  it('ungroups with no dialog, returning the members to the top level', () => {
    seed({
      groups: { 'black-smith': [{ id: 'group:1', name: 'work', projects: ['p1', 'p2'] }] },
    });
    render(<Canvas model={MODEL} />);
    act(() => document.querySelector<HTMLButtonElement>('[data-group-menu="group:1"]')?.click());
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-group-menu-item="ungroup"]')?.click(),
    );
    expect(document.querySelector('[data-confirm-remove]')).toBeNull();
    expect(document.querySelectorAll('[data-group-heading]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-project-heading]')).toHaveLength(2);
    expect(rows()).toBe(2);
    expect(storedGroups()['black-smith']).toBeUndefined();
    // The status line names what happened, since nothing else does.
    expect(statusBar()).toContain('work');
    expect(statusBar()).toContain('2');
  });

  it('renames a group in the store', () => {
    seed({ groups: { 'black-smith': [{ id: 'group:1', name: 'work', projects: ['p1'] }] } });
    render(<Canvas model={MODEL} />);
    act(() => document.querySelector<HTMLButtonElement>('[data-group-menu="group:1"]')?.click());
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-group-menu-item="rename"]')?.click(),
    );
    const input = draft() as HTMLInputElement;
    act(() => type(input, 'renamed'));
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(storedGroups()['black-smith']?.[0]?.name).toBe('renamed');
  });

  it('opens the icon picker for a group and stores what was picked', () => {
    seed({ groups: { 'black-smith': [{ id: 'group:1', name: 'work', projects: ['p1'] }] } });
    render(<Canvas model={MODEL} />);
    act(() => document.querySelector<HTMLButtonElement>('[data-group-menu="group:1"]')?.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-group-menu-item="icon"]')?.click());
    expect(document.querySelector('[data-icon-picker]')?.textContent).toContain('work');
  });
});

describe('group membership, stored', () => {
  const openList = (groupId: string) =>
    act(() =>
      document.querySelector<HTMLButtonElement>(`[data-add-to-group="${groupId}"]`)?.click(),
    );
  const choice = (id: string) =>
    document.querySelector<HTMLButtonElement>(`[data-project-choice="${id}"]`);
  const storedGroups = () =>
    (storedPrefs().groups ?? {}) as Record<string, { id: string; projects: string[] }[]>;

  it('offers the projects vam already knows, and no directory dialog', () => {
    seed({ groups: { 'black-smith': [{ id: 'group:1', name: 'work', projects: ['p1'] }] } });
    render(<Canvas model={MODEL} />);
    openList('group:1');
    expect(document.querySelector('[data-project-picker]')).toBeTruthy();
    // Every project in the model, and nothing invented: p1 in, p2 offered.
    expect(choice('p1')?.getAttribute('aria-pressed')).toBe('true');
    expect(choice('p2')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('adds a project to the group and draws it there', () => {
    seed({ groups: { 'black-smith': [{ id: 'group:1', name: 'work', projects: [] }] } });
    render(<Canvas model={MODEL} />);
    openList('group:1');
    act(() => choice('p2')?.click());
    expect(storedGroups()['black-smith']?.[0]?.projects).toEqual(['p2']);
    expect(
      document
        .querySelector('[data-project-id="p2"]')
        ?.closest('li')
        ?.getAttribute('data-in-group'),
    ).toBe('group:1');
  });

  it('MOVES a project that is already in another group', () => {
    seed({
      groups: {
        'black-smith': [
          { id: 'group:1', name: 'work', projects: ['p1'] },
          { id: 'group:2', name: 'other', projects: ['p2'] },
        ],
      },
    });
    render(<Canvas model={MODEL} />);
    openList('group:1');
    expect(choice('p2')?.textContent).toContain('other');
    act(() => choice('p2')?.click());
    const stored = storedGroups()['black-smith'] ?? [];
    expect(stored.find((g) => g.id === 'group:1')?.projects).toEqual(['p1', 'p2']);
    expect(stored.find((g) => g.id === 'group:2')?.projects).toEqual([]);
  });

  it('takes one back out, leaving it at the top level', () => {
    seed({ groups: { 'black-smith': [{ id: 'group:1', name: 'work', projects: ['p1'] }] } });
    render(<Canvas model={MODEL} />);
    openList('group:1');
    act(() => choice('p1')?.click());
    expect(storedGroups()['black-smith']?.[0]?.projects).toEqual([]);
    expect(
      document
        .querySelector('[data-project-id="p1"]')
        ?.closest('li')
        ?.getAttribute('data-in-group'),
    ).toBe(null);
  });
});
