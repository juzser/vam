// @vitest-environment happy-dom

/**
 * ============================================================================
 * THESE TWO TESTS ARE EXPECTED TO BE RED ON THIS BRANCH. THE SUITE IS NOT
 * BROKEN.
 * ============================================================================
 *
 * They are falsification targets, written on purpose for two CONFIRMED defects
 * in the session tab strip that shipped with the tab shell. Both come from the
 * same root cause -- focus and `openTabs` are coupled in a loop, and neither
 * side knows the other is mid-flight -- and both flip to GREEN, with no edit to
 * either of them, the moment that coupling is fixed. A fix that makes only one
 * of them pass has fixed only one direction of it.
 *
 * They are deliberately NOT `it.fails`, `it.skip` or `it.todo`. A test that
 * passes by announcing its own failure is a test that stops noticing when the
 * behaviour changes; the ask here was a red bar that goes green with the fix,
 * which is the only kind of target a fix can be measured against.
 *
 * F1 -- CLOSING THE LAST TAB REOPENS IT IMMEDIATELY.
 *   `closeTab` clears the pointer when nothing survives the close
 *   (`remaining[-1]` is `undefined`, so `setFocusedId(null)`), and the "land
 *   focus on something real" effect then re-resolves it: `resolveFocusNodeId`
 *   is total and answers with the FIRST candidate for any pointer while any
 *   candidate exists, so it hands focus straight back to the session just
 *   closed. The open-on-focus effect sees a new focused session and re-appends
 *   the tab. The empty-strip copy in `TabStrip` is therefore unreachable
 *   whenever the model holds a single session -- dead code guarding a state the
 *   component cannot enter.
 *
 * F2 -- A PERSISTED FILTER PERMANENTLY DELETES REMEMBERED TABS.
 *   The restore matches `prefs.openTabs` against `focusCandidates`, which is
 *   built from the FILTERED layout (hidden projects, origin filters). The
 *   persist effect matches the UNFILTERED entries and guards on length, so a
 *   restore pruned by a filter fails the guard and writes the pruned list back.
 *   Hiding a project is meant to be a view, and a view must not be able to
 *   destroy what it is a view OF: unhiding it afterwards does not bring the tab
 *   back, because the pointer is gone from storage.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

/** One project, one session: the only tab open is also the last one. */
const ONE_SESSION: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1')] }],
};

/** Two projects under two different sources, so one of them can be hidden --
 *  `hiddenProjects` is keyed by SOURCE, and a project keyed under the wrong
 *  one is not hidden at all. */
const TWO_PROJECTS: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1')] },
    { id: 'p2', name: 'beta', source: 'orca', sessions: [session('b1')] },
  ],
};

const PREFS_KEY = 'vam.prefs.v1';

function seed(payload: Record<string, unknown>) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
}

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
}

const tabs = () =>
  [...document.querySelectorAll('[data-session-tab] [data-tab-select]')].map(
    (el) => el.textContent ?? '',
  );

const stripText = () => document.querySelector('[data-tab-strip]')?.textContent ?? '';

function closeTab(title: string) {
  const tab = [...document.querySelectorAll('[data-session-tab]')].find(
    (el) => el.querySelector('[data-tab-select]')?.textContent === title,
  );
  if (tab === undefined) throw new Error(`no tab titled ${title}`);
  act(() => {
    tab.querySelector<HTMLElement>('[data-tab-close]')?.click();
  });
}

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

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the tab strip’s two known defects', () => {
  it('DEFECT F1: closing the last open tab leaves the strip empty and shows its empty copy', () => {
    render(<Canvas model={ONE_SESSION} />);
    expect(tabs()).toEqual(['a1']);

    closeTab('a1');

    // What the operator asked for: no tabs, and the strip saying so. What
    // happens today: the land-focus effect re-resolves focus onto `a1` and the
    // open-on-focus effect re-appends its tab, so the strip still reads
    // ['a1'] one commit later and this line is where it is caught.
    expect(tabs()).toEqual([]);
    expect(stripText()).toContain('no sessions open');
  });

  it('DEFECT F2: a hidden project does not delete its remembered tab from storage', () => {
    seed({
      openTabs: [
        { source: 'factory', session: 'a1' },
        { source: 'orca', session: 'b1' },
      ],
      lastFocus: { source: 'factory', session: 'a1' },
      // beta is hidden from the VIEW. Hiding is not closing, and it is
      // certainly not forgetting.
      hiddenProjects: { orca: ['p2'] },
    });
    render(<Canvas model={TWO_PROJECTS} />);

    // The strip only draws what the view has, which is correct on its own.
    expect(tabs()).toEqual(['a1']);

    // Storage must still remember both, so unhiding beta brings its tab back.
    // Today the persist effect writes the pruned list over the seeded one and
    // the `orca/b1` pointer is gone for good.
    expect(stored().openTabs).toEqual([
      { source: 'factory', session: 'a1' },
      { source: 'orca', session: 'b1' },
    ]);
  });
});
