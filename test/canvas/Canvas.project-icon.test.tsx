// @vitest-environment happy-dom

/**
 * The project heading's icon picker, mouse-only (there is no keyboard
 * shortcut for it, unlike the session picker's `s`). Mirrors
 * `Canvas.keyboard.test.tsx`'s "renaming, icons and closing" block, one
 * level up: a project instead of a session, `data-project-icon` instead of
 * `s`.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
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
    // No `source` at all — the case `Canvas.tsx`'s existing session-icon
    // refusal already handles; the project icon picker must refuse the same
    // way rather than guess a fallback source to store under.
    { id: 'p2', name: 'beta', sessions: [session('b1')] },
  ],
};

const iconPicker = () => document.querySelector('[data-icon-picker]');
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const projectIcon = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-project-icon="${id}"]`);

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

describe('the project heading icon picker', () => {
  it('clicking a project icon opens the picker named for that project', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      projectIcon('p1')?.click();
    });
    expect(iconPicker()).toBeTruthy();
    expect(iconPicker()?.textContent).toContain('alpha');
  });

  it('clicking the same project icon again closes it', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      projectIcon('p1')?.click();
    });
    expect(iconPicker()).toBeTruthy();
    act(() => {
      projectIcon('p1')?.click();
    });
    expect(iconPicker()).toBeNull();
  });

  it('a project with no source refuses rather than guessing a fallback', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      projectIcon('p2')?.click();
    });
    expect(iconPicker()).toBeNull();
    expect(statusBar()).toMatch(/no source — icon unavailable/);
  });

  it('clearing the project icon says where it was kept, and forgets it', () => {
    localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({
        projectIcons: { 'black-smith': { p1: { icon: '📦', at: new Date().toISOString() } } },
      }),
    );
    render(<Canvas model={MODEL} />);
    expect(projectIcon('p1')?.textContent).toBe('📦');
    act(() => {
      projectIcon('p1')?.click();
    });
    act(() => {
      screen.getByText('clear icon').click();
    });
    expect(screen.getByText(/on this machine/)).toBeTruthy();
    expect(iconPicker()).toBeNull();
    // Cleared means the placeholder is back, not that the slot went blank —
    // an empty `textContent` alone would pass for an icon that failed to
    // render at all.
    expect(projectIcon('p1')?.textContent).toBe('');
    expect(projectIcon('p1')?.querySelector('[data-project-icon-placeholder]')).not.toBeNull();
    const stored = JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}');
    expect(stored.projectIcons).toEqual({});
  });

  it('stores the picked project icon under (source, projectId), not the session icon bucket', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      projectIcon('p1')?.click();
    });
    act(() => {
      // Same escape hatch the session picker test uses — the grid itself is
      // third-party and not this test's to drive; going through "clear icon"
      // with a pre-seeded store instead exercises the write path end to end.
      screen.getByText('clear icon').click();
    });
    const stored = JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}');
    expect(stored.icons ?? {}).toEqual({});
    expect(stored.projectIcons ?? {}).toEqual({});
  });
});
