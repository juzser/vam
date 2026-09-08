// @vitest-environment happy-dom

/**
 * A FILTER IS A VIEW OVER THE SIDEBAR — it must not decide what the panes
 * contain.
 *
 * A15.5's invariant is that every pane on screen holds sessions of the
 * project on screen, kept by collapsing (or restoring) the layout on a
 * project switch. `activeProjectId` was derived from the focused session's
 * entry in the FILTERED list, and the collapse branch requires a current
 * project — so a search or status pill that hid the focused session made
 * that id `null` and a genuine project switch quietly took the fallback
 * path: no collapse, no remembered layout.
 *
 * What that leaves on screen is two surfaces disagreeing. The panes still
 * hold the previous project's sessions while the strips, scoped to the
 * project now active, list none of them: a full `DetailPanel` under a strip
 * reading "no sessions open". And the layout the operator left behind was
 * never written down, so coming back restores nothing.
 *
 * The lookup is UNFILTERED now — the same rule `entriesById` already states
 * for every pane that is not the focused one — and falls back to the project
 * the PANES hold when no session is focused at all.
 *
 * WHICH CASE FALSIFIES WHICH. Only the first case below fails with the fix
 * reverted: the keyboard in a pane holding nothing (where `zv` then `zw`
 * leaves it since PR 268) is the one route that reaches a `null` project with
 * sessions still on screen and nothing to repair it. The two filter cases
 * pass either way TODAY, and are kept as pins on the invariant rather than
 * claimed as guards on this fix: measured on the head this fixes,
 * `setFocusedSessionId` reads `activeProjectIdRef`, which is written during
 * render and therefore still holds the PREVIOUS project when "land focus on
 * something real" fires in the same commit that hid the focused session. The
 * filter route survives on that one-render lag. Depending on it is the
 * fragility the unfiltered lookup removes.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string): Session {
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
    decisions: [{ id: `d-${id}`, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] }],
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
    { id: 'p2', name: 'beta', source: 'claude-code', sessions: [session('b1')] },
  ],
};

afterEach(cleanup);

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function pressChord(prefix: string, key: string) {
  press(prefix);
  press(key);
}

const click = (el: Element | null | undefined) => {
  act(() => {
    fireEvent.click(el as Element);
  });
};

const panes = () => [...document.querySelectorAll('[data-split-pane]')];
const rowFor = (id: string) => document.querySelector(`[data-session-row="${id}"]`);
const stripsSaying = (text: string) =>
  [...document.querySelectorAll('[data-tab-strip]')].filter((strip) =>
    (strip.textContent ?? '').includes(text),
  );
const detailPanels = () => [...document.querySelectorAll('[data-detail-scroll="in"]')];

/** Type into the sidebar's search box, which narrows the list live. */
function search(text: string) {
  // The box replaces the button once it is open, so a second search types
  // into the box that is already there rather than opening a new one.
  if (document.querySelector('[aria-label="filter sessions"]') === null) {
    click(document.querySelector('[aria-label="search sessions"]'));
  }
  const input = document.querySelector<HTMLInputElement>('[aria-label="filter sessions"]');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
      this: HTMLElement,
      v: string,
    ) => void;
    setter.call(input as HTMLInputElement, text);
    (input as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Two panes, each holding one of alpha's sessions. */
function splitOverAlpha() {
  const view = render(<Canvas model={MODEL} />);
  pressChord('z', 'v'); // the new pane TAKES a1
  pressChord('z', 'w'); // back to the pane it left empty
  click(rowFor('a2')); // which now holds a2
  expect(panes()).toHaveLength(2);
  return view;
}

describe('a project switch happens even when nothing in view is focused', () => {
  /**
   * THE PANE SPLIT OFF AND LEFT EMPTY. Since PR 268 `zv` MOVES the tab, so the
   * pane it came from holds nothing, and `zw` back into it is a state the
   * operator asks for deliberately — "land focus on something real" leaves
   * it alone for exactly that reason. `focusedSessionId` is `null` there, so
   * the project on screen had no name, and picking a session in ANOTHER
   * project took the fallback path: no collapse, and the pane still holding
   * alpha left under a strip scoped to beta, reading "no sessions open" over
   * a full panel.
   */
  it('collapses the split when the keyboard is in a pane holding nothing', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    pressChord('z', 'w');
    expect(panes()).toHaveLength(2);
    click(rowFor('b1'));
    expect(panes()).toHaveLength(1);
    expect(stripsSaying('no sessions open')).toHaveLength(0);
    expect(detailPanels()).toHaveLength(1);
  });

  it('collapses the split, so no pane is left holding the other project', () => {
    splitOverAlpha();
    search('b1'); // a1 and a2 are out of the list; the focused session with them
    click(rowFor('b1'));
    expect(panes()).toHaveLength(1);
    // The state this rules out: a strip scoped to beta over a panel still
    // drawing one of alpha's sessions.
    expect(stripsSaying('no sessions open')).toHaveLength(0);
    expect(detailPanels()).toHaveLength(1);
  });

  it('remembers the layout it left, so coming back restores it', () => {
    splitOverAlpha();
    search('b1');
    click(rowFor('b1'));
    search('a1');
    click(rowFor('a1'));
    expect(panes()).toHaveLength(2);
  });
});
