// @vitest-environment happy-dom

/**
 * The focused pane can be CLOSED by a session ending, and the keyboard must
 * land somewhere real when it is.
 *
 * `pruneClosedTabs` drops every tab whose session is gone and closes a pane
 * emptied that way (`split.ts`). Nothing repaired `focusedPaneId` afterwards,
 * so closing the focused pane's last session left the id naming a leaf that
 * no longer existed, and every lookup keyed on it answered `null`: no pane
 * wears `data-split-focused="true"`, `focusedSessionId` is null so the chords
 * answer "pick a session first", and a sidebar click routes `setPaneSession`
 * at a pane nothing holds — which returns the tree unchanged and says
 * nothing, so the click does nothing at all. Only a mouse click inside a
 * surviving pane recovered it, which is not a recovery a keyboard-only
 * operator has.
 *
 * WHY THE SETUP IS LONGER THAN THE BUG. "Land focus on something real" masks
 * the stale id in the easy case: it re-picks the first candidate and
 * `paneHolding` moves the keyboard to whichever pane holds it. That rescue
 * only works when the candidate it picks IS held by a pane — when it is not
 * (a session in the sidebar that no pane has open, which is the ordinary
 * state once tabs are closed), `setFocusedSessionId` aims at the stale pane
 * id, finds no leaf, and the shell stays wedged. So the fixture arranges the
 * first sidebar session to be one no pane holds.
 *
 * `splitFocused`, `onPaneDrop` and `closePaneTab` each already guard this
 * same staleness by hand; this pins it at the one site that CREATES it.
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

const modelOf = (ids: readonly string[]): CanvasModel => ({
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: ids.map(session) }],
});

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
const focusedPane = () => document.querySelector('[data-split-focused="true"]');
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const sidebarRow = (at: number) =>
  [...document.querySelectorAll('[data-session-row]')][at] as HTMLElement;
const tabCloseFor = (title: string) =>
  [...document.querySelectorAll('[data-session-tab]')]
    .find((tab) => tab.querySelector('[data-tab-select]')?.textContent === title)
    ?.querySelector('[data-tab-close]');
const inBlockIn = (pane: Element | null | undefined) =>
  pane?.querySelector('[data-detail-scroll="in"]')?.textContent ?? '';

/**
 * Two panes — the focused one holding a3, the other a2 — and a1 open in
 * neither, so nothing rescues a stale focus by accident.
 */
function twoPanesWithA1Unheld() {
  const view = render(<Canvas model={modelOf(['a1', 'a2', 'a3'])} />);
  click(sidebarRow(1)); // a2 joins pane-1 and takes the front
  click(tabCloseFor('a1')); // a1 is now open in no pane at all
  pressChord('z', 'v'); // the new pane TAKES a2; the old one is left empty
  pressChord('z', 'w'); // back to the empty pane
  click(sidebarRow(2)); // which now holds a3, and has the keyboard
  expect(panes()).toHaveLength(2);
  expect(inBlockIn(focusedPane())).toContain('in-a3');
  return view;
}

describe('a prune that closes the focused pane moves the keyboard to a surviving one', () => {
  it('leaves a focused pane on screen', () => {
    const { rerender } = twoPanesWithA1Unheld();
    rerender(<Canvas model={modelOf(['a1', 'a2'])} />);
    expect(panes()).toHaveLength(1);
    expect(focusedPane()?.getAttribute('data-split-pane')).toBe(
      panes()[0]?.getAttribute('data-split-pane'),
    );
  });

  it('the keyboard still has a session, so the chords still act', () => {
    const { rerender } = twoPanesWithA1Unheld();
    rerender(<Canvas model={modelOf(['a1', 'a2'])} />);
    pressChord('z', 'v');
    expect(statusBar()).not.toContain('pick a session first');
    expect(panes()).toHaveLength(2);
  });

  it('a sidebar click lands in the surviving pane rather than doing nothing', () => {
    const { rerender } = twoPanesWithA1Unheld();
    rerender(<Canvas model={modelOf(['a1', 'a2'])} />);
    click(sidebarRow(0));
    expect(inBlockIn(focusedPane())).toContain('in-a1');
  });
});
