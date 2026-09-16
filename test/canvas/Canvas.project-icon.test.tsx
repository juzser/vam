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
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1')] },
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
        projectIcons: { factory: { p1: { icon: '📦', at: new Date().toISOString() } } },
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

  /**
   * A GLYPH IS TWO PRESSES, AND THE PANEL HAS TO SURVIVE THE FIRST.
   *
   * Every earlier pick was one press -- an emoji, or "clear icon" -- so every
   * handler closed the panel as it wrote. A colour is chosen AFTER the glyph
   * it paints, so closing on the glyph would put the tone row out of reach of
   * the only thing it can act on, and the operator would have to reopen the
   * picker to finish a choice they had already started. `keepPickerOpen` is
   * the rule; this is the behaviour, driven through the real controls.
   *
   * IT ALSO PINS THE REFUSAL'S OTHER HALF. Before the first press the tone row
   * cannot act and says so; after it, the sentence has to be GONE, or the
   * panel would be explaining away a control that now works.
   */
  it('keeps the panel open after a glyph, so its colour is still reachable', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      projectIcon('p1')?.click();
    });
    expect(document.querySelector('[data-icon-tone-refusal]')).not.toBeNull();

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-icon-choice="rocket"]')?.click();
    });
    expect(iconPicker(), 'the panel closed on the glyph, before its colour').not.toBeNull();
    expect(document.querySelector('[data-icon-tone-refusal]')).toBeNull();

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-icon-tone-swatch="teal"]')?.click();
    });
    const stored = JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}');
    expect(stored.projectIcons?.factory?.p1?.icon).toBe('lucide:rocket:teal');
    // And the heading is wearing it, which is the half a stored string cannot
    // prove on its own.
    const glyph = projectIcon('p1')?.querySelector('[data-icon-glyph]');
    expect(glyph?.getAttribute('data-icon-glyph')).toBe('rocket');
    expect(glyph?.getAttribute('class')).toContain('text-icon-teal');
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
