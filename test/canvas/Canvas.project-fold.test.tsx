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

  /**
   * THE RELOAD, staged the only way happy-dom can stage one: unmount, then
   * mount again over the same storage. That distinction is the whole defect --
   * the fold worked across a re-render before this branch and died on a
   * reload, so an assertion that never unmounts would have passed straight
   * over the bug.
   */
  it('is still folded after the canvas is torn down and built again', () => {
    const { unmount } = render(<Canvas model={MODEL} />);
    fold('p1');
    unmount();
    render(<Canvas model={MODEL} />);
    expect(rows()).toBe(1);
    // The chevron agrees, and says so to a screen reader.
    expect(
      document.querySelector('[data-project-collapse="p1"]')?.getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('does not let one source’s fold close another source’s project of the same id', () => {
    seed({ collapsedProjects: { 'some-other-source': ['p1'] } });
    render(<Canvas model={MODEL} />);
    expect(rows()).toBe(2);
  });
});

/**
 * THE PROJECT WITH NO SOURCE, which is what makes the wiring above a trade
 * rather than a free win.
 *
 * `SessionList.collapsedProjects` is OPTIONAL with a fallback to component
 * state, and the fallback is all-or-nothing: passing the prop turns it off for
 * EVERY project at once. `prefs.collapsedProjects` is keyed by SOURCE -- the
 * two-level shape that stops one source's fold from closing another source's
 * project of the same id -- so a project carrying no source has no bucket to
 * key a fold under, and a canvas that passed only the keyed folds would leave
 * it holding a chevron that does nothing. THAT IS WORSE THAN WHAT WAS WRONG
 * BEFORE: a fold that cannot be MADE, rather than one that is not remembered.
 *
 * So it is kept for the run in `Canvas`'s own `collapsedSourceless` -- the
 * answer `setProjectRemoved` already gives the identical shape one gesture
 * over (`Canvas.remove-project.test.tsx`), for the reason stated there: three
 * options, and remembering it for the run is the weakest of them and the only
 * honest one.
 *
 * The model is hand-built rather than taken from `fixtures/demo.ts`, for that
 * file's own third rule -- nothing is invented that the sources cannot
 * produce, and every real source stamps a source on every project. A
 * sourceless project is the hand-built case, which is exactly where
 * `Canvas.remove-project.test.tsx` renders its own.
 */
describe('a project with no source keeps its fold for the run, instead of losing the control', () => {
  const NO_SOURCE: CanvasModel = {
    projects: [
      { id: 'p9', name: 'unsourced', sessions: [session('n1')] },
      { id: 'p2', name: 'beta', source: 'factory', sessions: [session('b1')] },
    ],
  };

  it('folds for real, stores nothing under a key that does not exist, and lets go on reload', () => {
    const { unmount } = render(<Canvas model={NO_SOURCE} />);
    expect(rows()).toBe(2);
    fold('p9');
    // THE CONTROL IS REAL. This is the assertion that goes red if the canvas
    // passes the keyed folds and drops the sourceless holder.
    expect(rows()).toBe(1);
    // And nothing was written under a key invented to hold it.
    expect(storedPrefs().collapsedProjects ?? {}).toEqual({});
    unmount();
    render(<Canvas model={NO_SOURCE} />);
    // Open again -- the documented outcome, not a leak.
    expect(rows()).toBe(2);
  });

  it('does not take its sourced neighbour\u2019s stored fold down with it', () => {
    render(<Canvas model={NO_SOURCE} />);
    fold('p9');
    fold('p2');
    expect(rows()).toBe(0);
    // One fold in state, one on disk, and the disk half is keyed exactly as it
    // would have been if the sourceless one had never been made.
    expect(storedPrefs().collapsedProjects).toEqual({ factory: ['p2'] });
  });
});
