// @vitest-environment happy-dom

/**
 * JOINING A PANE BY DRAGGING — the drop that makes the layout SMALLER.
 *
 * The operator's report: "when the layout is split, if you want to drag a tab
 * back into a pane so it stops being split, you can't." Every drop called
 * `splitPane`, and `nearestEdge` names an edge for every point in a pane, so
 * there was no coordinate anywhere on screen that meant "put this tab in that
 * pane's strip". A drag could only ever ADD a pane.
 *
 * What is pinned here is the WIRING, the half `split.test.ts` cannot see: that
 * a real drop in the middle of a pane reaches `joinPane` rather than
 * `splitPane`, that the tab strip joins wherever it is hit, that the two
 * outcomes are distinguishable BEFORE the drop, and that every refusal
 * `onPaneDrop` already owed the split path is still owed — and paid — on the
 * join path. What jsdom cannot see is the geometry and the paint; that is
 * `e2e/split-panes-shots.mjs`'s.
 *
 * The drag mechanics are `Canvas.split.test.tsx`'s, for its reasons: happy-dom
 * carries no `DataTransfer` through a constructed `DragEvent` and no
 * coordinates through `fireEvent.dragOver`, so the dragged session travels in
 * React state and the coordinates arrive on a genuine `MouseEvent` typed
 * `"dragover"`/`"drop"`, dispatched directly.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';

function decision(id: string): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] };
}

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
    decisions: [decision(`d-${id}`)],
    ...over,
  };
}

/**
 * Three sessions in the first project, so a pane can still hold tabs after a
 * split has moved one out; a second project, so the cross-project refusal has
 * something to refuse.
 *
 * `a2` is the WAITING one and so ranks first in `orderedSessions` — which is
 * what makes "where does a joined tab land in the strip" a real question here
 * rather than one every order would answer the same way.
 */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1'), session('a2', { status: 'waiting' }), session('a3')],
    },
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

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const splitPanes = () => [...document.querySelectorAll('[data-split-pane]')];
const focusedPaneId = () =>
  document.querySelector('[data-split-focused="true"]')?.getAttribute('data-split-pane') ?? null;
const paneFor = (id: string) => document.querySelector(`[data-split-pane="${id}"]`) as HTMLElement;
const stripOf = (paneEl: Element) => paneEl.querySelector('[data-tab-strip-row]') as HTMLElement;
/** One pane's tab titles, in the order its strip DRAWS them. */
const tabsIn = (paneEl: Element) =>
  [...paneEl.querySelectorAll('[data-tab-select]')].map((el) => el.textContent ?? '');
/** The tab a pane has forward. */
const activeTabIn = (paneEl: Element) =>
  paneEl.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')?.textContent ??
  null;
/** A tab button by title, scoped to one pane's own strip — the same session
 *  can be a tab of more than one pane, so an unscoped lookup is ambiguous. */
const tabIn = (paneEl: Element, title: string) =>
  [...paneEl.querySelectorAll<HTMLButtonElement>('[data-tab-select]')].find(
    (el) => el.textContent === title,
  ) as HTMLButtonElement;
const sidebarRow = (id: string) =>
  document.querySelector(`[data-session-row="${id}"]`) as HTMLElement;
const dropIndicator = () => document.querySelector('[data-drop-zone]');

/** Gives an element a fixed, non-zero rect — happy-dom's own is always zeroed,
 *  so a drop's zone math needs a real one to test against. */
function stubRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }) as DOMRect;
}

function dragAt(el: Element, type: 'dragover' | 'drop', clientX: number, clientY: number) {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
}

/**
 * The two-pane shape every case below starts from: `pane-1` keeps `a1` and
 * `a3`, `pane-2` holds the split-out `a2` alone. A11.1 puts every session of
 * the project in the first pane on mount, and `zv` MOVES the focused tab out
 * — so this is the layout a single chord produces, and the one whose second
 * pane a join can genuinely empty.
 */
function splitInTwo() {
  render(<Canvas model={MODEL} />);
  act(() => sidebarRow('a2').click());
  pressChord('z', 'v');
  expect(splitPanes()).toHaveLength(2);
  const source = paneFor('pane-2');
  const target = paneFor('pane-1');
  stubRect(target, { left: 0, top: 0, width: 200, height: 100 });
  stubRect(source, { left: 200, top: 0, width: 200, height: 100 });
  return { source, target };
}

describe('a drop in the CENTRE of a pane joins it, and the layout un-splits', () => {
  it('moves the tab into the target pane and closes the one it emptied', () => {
    const { source, target } = splitInTwo();
    expect(tabsIn(target)).toEqual(['a1', 'a3']);
    fireEvent.dragStart(tabIn(source, 'a2'));
    dragAt(target, 'dragover', 100, 50);
    dragAt(target, 'drop', 100, 50);
    expect(splitPanes()).toHaveLength(1);
    expect(tabsIn(paneFor('pane-1'))).toContain('a2');
  });

  it('lands the joined tab where the STRIP orders it, not at the far end', () => {
    // `Leaf.sessionIds` appends, and `orderedPaneTabs` is what the strip
    // draws: `a2` is waiting, so it ranks first wherever it is a member.
    const { source, target } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));
    dragAt(target, 'dragover', 100, 50);
    dragAt(target, 'drop', 100, 50);
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a2', 'a1', 'a3']);
  });

  it('brings the joined tab forward and puts the keyboard in the pane it landed in', () => {
    const { source, target } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));
    dragAt(target, 'dragover', 100, 50);
    dragAt(target, 'drop', 100, 50);
    expect(focusedPaneId()).toBe('pane-1');
    expect(activeTabIn(paneFor('pane-1'))).toBe('a2');
  });

  it('moves the keyboard to the pane it landed in even when the source SURVIVES', () => {
    // The case the collapsing one cannot see. When the source pane empties
    // and closes, `setFocusedSessionId`'s own repair lands the keyboard in the
    // surviving pane whatever this handler does — so a join that forgot to
    // move the focus would look right. Here `pane-1` keeps `a3` and stays, and
    // nothing repairs anything: either the drop moves the keyboard or the
    // operator is left typing into the pane the tab has just left.
    const { source, target } = splitInTwo();
    pressChord('z', 'w'); // out of the split-out pane, into pane-1
    expect(focusedPaneId()).toBe('pane-1');
    fireEvent.dragStart(tabIn(target, 'a1'));
    dragAt(source, 'dragover', 300, 50);
    dragAt(source, 'drop', 300, 50);
    expect(splitPanes()).toHaveLength(2);
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a3']);
    expect(focusedPaneId()).toBe('pane-2');
    expect(activeTabIn(paneFor('pane-2'))).toBe('a1');
  });

  it('still SPLITS on the same pane when the drop lands near an edge', () => {
    // The same tab, the same target pane, 10px from its right edge instead of
    // its middle: the two outcomes are one coordinate apart and must stay so.
    const { source, target } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));
    dragAt(target, 'dragover', 195, 50);
    dragAt(target, 'drop', 195, 50);
    expect(splitPanes()).toHaveLength(2);
    expect(document.querySelector('[data-split]')?.getAttribute('data-split-orientation')).toBe(
      'row',
    );
  });

  it('refuses aloud when the tab is dropped into the pane it already lives in', () => {
    const { source } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));
    dragAt(source, 'dragover', 300, 50);
    dragAt(source, 'drop', 300, 50);
    expect(splitPanes()).toHaveLength(2);
    expect(statusBar()).toContain('already');
  });
});

describe('the tab strip is a join target, wherever in it the drop lands', () => {
  it('joins from a point the pane geometry would have called an edge', () => {
    const { source, target } = splitInTwo();
    // (2, 2) in the target pane's own box is deep in the LEFT band — a split
    // by every rule the pane itself applies. The strip is not part of that
    // geometry: a tab dropped on a strip becomes a tab of that strip.
    fireEvent.dragStart(tabIn(source, 'a2'));
    dragAt(stripOf(target), 'dragover', 2, 2);
    dragAt(stripOf(target), 'drop', 2, 2);
    expect(splitPanes()).toHaveLength(1);
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a2', 'a1', 'a3']);
  });

  it('shows the JOIN indicator while the drag is over a strip', () => {
    const { source, target } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));
    dragAt(stripOf(target), 'dragover', 2, 2);
    expect(dropIndicator()?.getAttribute('data-drop-zone')).toBe('centre');
  });
});

describe('the drag says which of the two things the drop will do', () => {
  it('paints a different indicator, with a different word, for a join and a split', () => {
    const { source, target } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));

    dragAt(target, 'dragover', 100, 50);
    const joinZone = dropIndicator()?.getAttribute('data-drop-zone') ?? null;
    const joinSaid = dropIndicator()?.textContent ?? '';

    dragAt(target, 'dragover', 195, 50);
    const splitZone = dropIndicator()?.getAttribute('data-drop-zone') ?? null;
    const splitSaid = dropIndicator()?.textContent ?? '';

    expect(joinZone).toBe('centre');
    expect(splitZone).toBe('right');
    expect(joinSaid.length).toBeGreaterThan(0);
    expect(splitSaid.length).toBeGreaterThan(0);
    // Two outcomes must never look the same. The attribute is for the tests;
    // the WORD is what the operator has.
    expect(joinSaid).not.toBe(splitSaid);
  });

  it('promises nothing over the CENTRE of the pane the drag started in', () => {
    // That drop is refused — the tab is already there — so a join overlay
    // would be a promise the release does not keep. It is also the first
    // frame of every drag, which begins over the tab's own strip.
    const { source } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));
    dragAt(source, 'dragover', 300, 50);
    expect(dropIndicator()).toBeNull();
    dragAt(stripOf(source), 'dragover', 4, 4);
    expect(dropIndicator()).toBeNull();
    // Its EDGES still promise a split: splitting a pane with its own tab is
    // exactly what `zv` does, and it is not refused.
    dragAt(source, 'dragover', 395, 50);
    expect(dropIndicator()?.getAttribute('data-drop-zone')).toBe('right');
  });

  it('does not blink while the pointer crosses between one pane’s own children', () => {
    // `dragleave` fires per element and BUBBLES, so moving from the strip to
    // the transcript arrives at the pane as a departure it is not.
    const { source, target } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));
    dragAt(target, 'dragover', 100, 50);
    expect(dropIndicator()).not.toBeNull();
    act(() => {
      target.dispatchEvent(
        new MouseEvent('dragleave', { bubbles: true, relatedTarget: stripOf(target) }),
      );
    });
    expect(dropIndicator()).not.toBeNull();
    // Leaving the pane for good still takes it down.
    act(() => {
      target.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: null }));
    });
    expect(dropIndicator()).toBeNull();
  });

  it('takes the indicator down again when the drop is done', () => {
    const { source, target } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));
    dragAt(target, 'dragover', 100, 50);
    expect(dropIndicator()).not.toBeNull();
    dragAt(target, 'drop', 100, 50);
    expect(dropIndicator()).toBeNull();
  });
});

describe('the refusals the split path owed are still owed on the join path', () => {
  /**
   * The state the cross-project check was kept for: the drag payload and the
   * pane tree are written a GESTURE APART. Picking a session in another
   * project mid-drag collapses the layout onto that project (A15.5), and the
   * tab still under the pointer belongs to the one that just left the screen.
   */
  it('refuses a cross-project JOIN aloud, naming both projects', () => {
    const { source } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));
    act(() => sidebarRow('b1').click());
    const target = paneFor('pane-1') ?? splitPanes()[0];
    stubRect(target as Element, { left: 0, top: 0, width: 200, height: 100 });
    dragAt(target as Element, 'dragover', 100, 50);
    dragAt(target as Element, 'drop', 100, 50);
    // In the verb of the gesture that was actually made: this drop would have
    // MOVED a tab, and "can't split across projects" describes the other one.
    expect(statusBar()).toContain("can't move a tab across projects");
    expect(statusBar()).toContain('alpha');
    expect(statusBar()).toContain('beta');
    // And nothing moved: the pane still draws only the project it collapsed to.
    expect(tabsIn(target as Element)).toEqual(['b1']);
  });

  it('refuses aloud when the pane the tab came from has gone', () => {
    // The join equivalent of the silent-no-op trap: `joinPane` is total, so a
    // source id nothing holds gets the tree back untouched with nothing said.
    const { source } = splitInTwo();
    fireEvent.dragStart(tabIn(source, 'a2'));
    pressChord('z', 'c'); // closes the focused pane — the one the drag started in
    expect(splitPanes()).toHaveLength(1);
    const target = paneFor('pane-1');
    stubRect(target, { left: 0, top: 0, width: 200, height: 100 });
    dragAt(target, 'dragover', 100, 50);
    dragAt(target, 'drop', 100, 50);
    expect(statusBar()).toMatch(/gone|moved|already/);
    expect(splitPanes()).toHaveLength(1);
  });
});
