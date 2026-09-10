// @vitest-environment happy-dom

/**
 * THE PROJECT FOLD, AND WHETHER IT SURVIVES A RELOAD.
 *
 * `Prefs.collapsedProjects` shipped with a field, a reader (`isProjectCollapsed`),
 * a writer (`setProjectCollapsed`), a source-key migration and a TTL exemption
 * — and `SessionList`'s own prop doc says exactly what to do with them: "Pass
 * them — from `prefs.collapsedProjects` via `isProjectCollapsed`/
 * `setProjectCollapsed` — and the fold survives a reload instead of a
 * re-render." Nobody passed them. `Canvas.tsx` did not contain the string
 * `collapsedProjects` at all, so the component took its documented fallback and
 * kept the fold in component state, where it dies on reload.
 *
 * THE SAME WIRING ONE LEVEL UP WAS ALREADY LIVE, which is what made this an
 * asymmetry the operator can feel rather than merely dead code: fold a GROUP,
 * reload, still folded (`Canvas.groups.test.tsx`); fold a PROJECT, reload, open
 * again. Two folds, drawn by the same list, in the same gesture, behaving
 * differently — with nothing on screen to say which is which.
 *
 * This is the second member of a family found by following the first
 * (`dismissedSessions`, retired in this same branch), and it is answered the
 * opposite way for a stated reason: there, NO surface existed and the stored
 * list was the only half ever built, so shipping it changed nothing an operator
 * could reach. Here the surface is complete and works — only its persistence
 * was unhooked — so the fix is to hook it up, not to delete it.
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
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1')] },
    { id: 'p2', name: 'beta', source: 'factory', sessions: [session('b1')] },
  ],
};

function seed(prefs: Record<string, unknown>) {
  localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
}

const rows = () => document.querySelectorAll('[data-session-row]').length;
const storedPrefs = () =>
  JSON.parse(localStorage.getItem('vam.prefs.v1') ?? '{}') as Record<string, unknown>;
const fold = (projectId: string) =>
  act(() => {
    document.querySelector<HTMLButtonElement>(`[data-project-collapse="${projectId}"]`)?.click();
  });

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

describe('a folded project is remembered, the way a folded group already was', () => {
  it('has an affordance to fold at all, or every assertion below is about nothing', () => {
    render(<Canvas model={MODEL} />);
    expect(rows()).toBe(2);
    expect(document.querySelector('[data-project-collapse="p1"]')).not.toBeNull();
  });

  it('writes the fold where a reload will find it, keyed by the project’s source', () => {
    render(<Canvas model={MODEL} />);
    fold('p1');
    // The fold happened on screen...
    expect(rows()).toBe(1);
    // ...and it reached the store, under the source the project came from --
    // a project id is unique only within its source.
    expect(storedPrefs().collapsedProjects).toEqual({ factory: ['p1'] });
  });

  it('honours a fold the store already holds, on the first paint', () => {
    seed({ collapsedProjects: { factory: ['p1'] } });
    render(<Canvas model={MODEL} />);
    expect(rows()).toBe(1);
  });

  it('unfolds back to nothing stored, leaving no residue to read back', () => {
    seed({ collapsedProjects: { factory: ['p1'] } });
    render(<Canvas model={MODEL} />);
    fold('p1');
    expect(rows()).toBe(2);
    // `withIdBySource` drops the source's bucket with its last id, so the
    // stored shape matches a fresh install exactly.
    expect(storedPrefs().collapsedProjects).toEqual({});
  });

  it('does not let one source’s fold close another source’s project of the same id', () => {
    seed({ collapsedProjects: {'some-other-source': ['p1'] } });
    render(<Canvas model={MODEL} />);
    expect(rows()).toBe(2);
  });
});
