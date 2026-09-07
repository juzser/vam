// @vitest-environment happy-dom

/**
 * ============================================================================
 * TWO CONFIRMED DEFECTS, PINNED WITH `it.fails`. THE SUITE IS GREEN.
 * ============================================================================
 *
 * These are falsification targets, written on purpose for two CONFIRMED defects
 * in the session tab strip that shipped with the tab shell. Both come from the
 * same root cause -- focus and `openTabs` are coupled in a loop, and neither
 * side knows the other is mid-flight -- and a fix that makes only one of them
 * flip has fixed only one direction of it.
 *
 * WHY `it.fails` AND NOT A RED BAR. A red baseline is not a baseline: it trains
 * every later reader to skim failures, which is fatal on a migration whose
 * whole discipline is that a green suite which got SMALLER is not a pass. And
 * `it.fails` is self-enforcing in the direction we want -- vitest reports the
 * case as FAILING the moment its body starts passing, so when the coupling is
 * fixed these turn red until someone deliberately promotes them to `it`. They
 * cannot be quietly deleted, and they cannot rot into always-green.
 *
 * THE ONE WEAKNESS, AND HOW IT IS COVERED. `it.fails` is satisfied by ANY
 * throw, so on its own it would keep passing if this file broke for a reason
 * that has nothing to do with the defect -- a renamed selector, a changed
 * harness, a mount error. It would silently stop testing the defect while still
 * looking healthy. So each defect ships as a PAIR: an ordinary `it` asserting
 * the precondition, which must stay GREEN, plus the `it.fails` carrying the
 * defect assertion. If the harness breaks, the green half goes red and you find
 * out. Do not delete the green half -- it is what makes the `it.fails` half
 * trustworthy.
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
  // The green half of the F1 pair. It proves the harness still mounts and the
  // strip still reaches the state the defect case starts from. If this goes
  // red, the `it.fails` below has stopped testing what it claims and is
  // passing on an unrelated throw.
  it('F1 precondition: a one-session model draws exactly one tab', () => {
    render(<Canvas model={ONE_SESSION} />);
    expect(tabs()).toEqual(['a1']);
  });

  it.fails('DEFECT F1: closing the last open tab leaves the strip empty and shows its empty copy', () => {
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

  // The green half of the F2 pair, for the same reason: it pins the part of
  // F2's setup that is CORRECT today -- the strip drawing only what the view
  // holds -- so a harness break cannot masquerade as the defect below.
  it('F2 precondition: a hidden project is absent from the strip, which is correct', () => {
    seed({
      openTabs: [
        { source: 'factory', session: 'a1' },
        { source: 'orca', session: 'b1' },
      ],
      lastFocus: { source: 'factory', session: 'a1' },
      hiddenProjects: { orca: ['p2'] },
    });
    render(<Canvas model={TWO_PROJECTS} />);
    expect(tabs()).toEqual(['a1']);
  });

  it.fails('DEFECT F2: a hidden project does not delete its remembered tab from storage', () => {
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
