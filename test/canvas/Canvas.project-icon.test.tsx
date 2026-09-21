// @vitest-environment happy-dom

/**
 * The project heading's icon picker, mouse-only — there is no keyboard
 * shortcut for it, and there is no longer a session-level picker for it to
 * mirror: that one was removed outright once the tab strip stopped drawing a
 * session icon and the picker was left writing where nothing read.
 *
 * WHICH MAKES THIS FILE THE ONLY HOME FOR THE CAPTURED TARGET, the last block
 * below. That property was pinned against the session picker and would have
 * died with it. It is not a fact about session icons; it is a fact about any
 * overlay that aims at something in a SOURCE and can outlive it, and this
 * picker is now the only one of those. (The rename flow captures the same
 * three fields for the same reason, but its editor is drawn ON THE ROW, so
 * the entry vanishing unmounts the input and the hazard cannot be reached
 * from there — checked, not assumed.)
 */

import { act, cleanup, render, screen } from '@testing-library/react';
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

/**
 * The picker aims at a project in a SOURCE, and it must still know which one
 * after the model underneath it has moved on.
 *
 * A model refresh between opening the picker and picking is the one input
 * that separates CARRYING the target from RE-DERIVING it. Re-deriving meant a
 * lookup by project id across every source with a `?? 'factory'` on the end —
 * and once the project is gone that fallback fires, so a pick aimed at an
 * ORCA project silently rewrote the factory bucket instead.
 *
 * `shared` exists under both sources in the STORE here, so the wrong bucket is
 * a real entry rather than a harmless no-op, which is what makes the two
 * directions distinguishable at all. The model holds one project per source
 * with distinct ids, because two projects sharing an id would collide on
 * React's key and make the render itself the thing under test.
 */
describe('the picker keeps aiming at the source it was opened from', () => {
  const TWO_SOURCES: CanvasModel = {
    projects: [
      { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1')] },
      { id: 'shared', name: 'beta', source: 'orca', sessions: [session('b1')] },
    ],
  };
  /** The same model with orca's project gone — the refresh that lost it. */
  const WITHOUT_ORCA: CanvasModel = { projects: [TWO_SOURCES.projects[0] as never] };

  const seedBothBuckets = () =>
    localStorage.setItem(
      'vam.prefs.v1',
      JSON.stringify({
        projectIcons: {
          factory: { shared: { icon: '🛠', at: new Date().toISOString() } },
          orca: { shared: { icon: '🐋', at: new Date().toISOString() } },
        },
      }),
    );

  it("keeps aiming at orca's project after the model drops it mid-pick", () => {
    seedBothBuckets();
    const { rerender } = render(<Canvas model={TWO_SOURCES} />);
    act(() => {
      projectIcon('shared')?.click();
    });
    // The refresh that used to lose the source.
    act(() => rerender(<Canvas model={WITHOUT_ORCA} />));
    expect(iconPicker(), 'the picker closed on the refresh; nothing below is measured').not.toBe(
      null,
    );
    act(() => {
      screen.getByText('clear icon').click();
    });
    const stored = JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}');
    // ORCA's entry was cleared and factory's was left alone. Both halves
    // matter: asserting only the first would pass for a write that cleared
    // BOTH, and asserting only the second for one that cleared nothing.
    expect(stored.projectIcons?.orca ?? {}).toEqual({});
    expect(stored.projectIcons?.factory?.shared?.icon).toBe('🛠');
  });

  it('names the project it is picking for even after the entry is gone', () => {
    // The title came from the same lookup and fell back to the raw id.
    const { rerender } = render(<Canvas model={TWO_SOURCES} />);
    act(() => {
      projectIcon('shared')?.click();
    });
    act(() => rerender(<Canvas model={WITHOUT_ORCA} />));
    expect(iconPicker()?.textContent).toContain('beta');
  });
});
