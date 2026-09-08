// @vitest-environment happy-dom

/**
 * A pane's tab strip lists its tabs in the SIDEBAR's order.
 *
 * The operator's report: "the way tabs are arranged in the pane still isn't
 * right — when I focus a session in the sidebar, the tabs shown in the pane
 * get jumbled". The strip was drawn straight from `Leaf.sessionIds`, which is
 * insertion order: a session picked in the sidebar was appended at the end.
 * So the two surfaces showing the same sessions listed them two different
 * ways, and a pick landed nowhere near where the eye had just been.
 *
 * `sessionIds` is now MEMBERSHIP — which tabs this pane holds — and the order
 * is re-derived at render from `orderedPaneTabs` (`domain/selectors.ts`), the
 * same family the sidebar itself prints. Deriving rather than storing is the
 * point: the canonical order depends on session STATUS, so a stored order
 * would go stale the moment a session stopped, and the drift this file exists
 * to prevent would come back through a door nobody was watching.
 *
 * Sessions here are given deliberately mixed statuses, because a model of
 * uniformly-`done` sessions (what most pane tests use) has a canonical order
 * identical to its source order and cannot tell the two rules apart.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    decisions: [{ id: `d-${id}`, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] }],
  };
}

/**
 * Source order is `old`, `mid`, `new`; the sidebar prints `new` (waiting),
 * `mid` (running), `old` (done). Every expectation below is that second
 * sequence, never the first.
 */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('old', 'done'), session('mid', 'running'), session('new', 'waiting')],
    },
  ],
};

afterEach(cleanup);

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const paneFor = (id: string) => document.querySelector(`[data-split-pane="${id}"]`);
const tabsIn = (paneEl: Element | null | undefined) =>
  [...(paneEl?.querySelectorAll('[data-tab-select]') ?? [])].map((el) => el.textContent);
/** The sidebar's own printed order — the sequence a strip has to agree with. */
const sidebarOrder = () =>
  [...document.querySelectorAll('[data-session-row]')].map((row) =>
    row.getAttribute('data-session-row'),
  );
/** Pick a session in the sidebar BY NAME, never by index: the indices are the
 *  canonical order, and picking by one would beg the question. */
function pickInSidebar(title: string) {
  const row = document.querySelector<HTMLElement>(`[data-session-row="${title}"]`);
  act(() => row?.click());
}

describe('a pane lists its tabs the way the sidebar lists them', () => {
  it('the sidebar prints the canonical order, not the source order', () => {
    render(<Canvas model={MODEL} />);
    expect(sidebarOrder()).toEqual(['new', 'mid', 'old']);
  });

  it('re-orders a pick that was opened out of order', () => {
    render(<Canvas model={MODEL} />);
    // Opened deliberately "wrong": oldest first, newest last.
    pickInSidebar('old');
    pickInSidebar('mid');
    pickInSidebar('new');
    expect(tabsIn(paneFor('pane-1'))).toEqual(['new', 'mid', 'old']);
    expect(tabsIn(paneFor('pane-1'))).toEqual(sidebarOrder());
  });

  it('activates an already-open tab instead of duplicating it', () => {
    render(<Canvas model={MODEL} />);
    pickInSidebar('old');
    pickInSidebar('mid');
    pickInSidebar('old'); // already a tab here — this must activate, not add
    // `new` is the session the shell focused on load, so the pane holds all
    // three; what matters is that `old` is in the list ONCE.
    expect(tabsIn(paneFor('pane-1'))).toEqual(['new', 'mid', 'old']);
    expect(tabsIn(paneFor('pane-1')).filter((title) => title === 'old')).toHaveLength(1);
    expect(
      paneFor('pane-1')?.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')
        ?.textContent,
    ).toBe('old');
  });

  it('keeps each pane in canonical order after a split', () => {
    render(<Canvas model={MODEL} />);
    // pane-1 by arrival: new (the pre-focused one), old, mid.
    pickInSidebar('old');
    pickInSidebar('mid');
    press('z');
    press('v'); // pane-2 holds `mid` alone and takes the keyboard
    pickInSidebar('new'); // pane-2 by arrival: mid, new
    expect(tabsIn(paneFor('pane-1'))).toEqual(['new', 'mid', 'old']);
    expect(tabsIn(paneFor('pane-2'))).toEqual(['new', 'mid']);
  });
});

describe('moving a tab between panes leaves both panes in order', () => {
  it('re-reads the source pane’s remaining tabs rather than closing a gap', () => {
    render(<Canvas model={MODEL} />);
    // pane-1 by arrival: new, old, mid.
    pickInSidebar('old');
    pickInSidebar('mid');
    const source = paneFor('pane-1') as HTMLElement;
    source.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 100,
        right: 200,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const tab = [...source.querySelectorAll<HTMLButtonElement>('[data-tab-select]')].find(
      (el) => el.textContent === 'new',
    ) as HTMLButtonElement;
    fireEvent.dragStart(tab);
    for (const type of ['dragover', 'drop'] as const) {
      act(() => {
        source.dispatchEvent(
          new MouseEvent(type, { clientX: 190, clientY: 50, bubbles: true, cancelable: true }),
        );
      });
    }
    // `new` left for a pane of its own; what pane-1 keeps is `mid` then `old`,
    // the sidebar's order — not `old` then `mid`, the order they arrived in.
    expect(tabsIn(paneFor('pane-1'))).toEqual(['mid', 'old']);
    const panes = [...document.querySelectorAll('[data-split-pane]')].map((p) => tabsIn(p));
    expect(panes).toContainEqual(['new']);
  });
});
