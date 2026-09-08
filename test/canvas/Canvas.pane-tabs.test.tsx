// @vitest-environment happy-dom

/**
 * A15.5 — every pane owns its OWN tab strip, VSCode's editor-group model.
 *
 * The operator's report: "when a tab is split, its tab must sit on the split
 * side too — right now the tabs are still side by side". One `TabStrip` was
 * mounted above the whole split layout, so splitting changed the panes and
 * left the one row of tabs untouched. The strip is now drawn INSIDE each
 * leaf, from that leaf's own `sessionIds` (`split.ts`), so the tabs move with
 * the pane they belong to.
 *
 * The second report, same family: "after splitting a tab, when I switch
 * project, the old tab still shows and is still split". Panes held session
 * ids and nothing reconciled them when the active project changed, so a
 * split kept drawing the previous project's sessions the strip no longer
 * listed. Switching project now collapses to a single pane holding the
 * session that was picked — see `Canvas.tsx`'s `setFocusedSessionId`.
 *
 * The pure mechanics (`setPaneSession`/`removeTab`/`pruneClosedTabs`) are
 * pinned in isolation at `test/canvas/split.test.ts`; this file proves the
 * wiring reaches the DOM. Ordering that React's eager-state path can hide
 * from happy-dom — the split chord's own pane-id read — is guarded in a real
 * browser instead, by `e2e/split-panes-shots.mjs`.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';

function decision(id: string): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] };
}

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
    decisions: [decision(`d-${id}`)],
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1'), session('a2'), session('a3')],
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

const splitPanes = () => [...document.querySelectorAll('[data-split-pane]')];
const strips = () => [...document.querySelectorAll('[data-tab-strip]')];
const paneFor = (id: string) => document.querySelector(`[data-split-pane="${id}"]`);
/** The tab titles one pane's own strip draws, in order. */
const tabsIn = (paneEl: Element | null | undefined) =>
  [...(paneEl?.querySelectorAll('[data-tab-select]') ?? [])].map((el) => el.textContent);
const tabIn = (paneEl: Element | null | undefined, title: string) =>
  [...(paneEl?.querySelectorAll<HTMLButtonElement>('[data-tab-select]') ?? [])].find(
    (el) => el.textContent === title,
  );
const activeTabIn = (paneEl: Element | null | undefined) =>
  paneEl?.querySelector('[data-session-tab][data-active="true"] [data-tab-select]')?.textContent ??
  null;
const inBlockIn = (paneEl: Element | null | undefined) =>
  paneEl?.querySelector('[data-detail-scroll="in"]')?.textContent ?? '';
/** The sidebar rows, in source order: a1, a2, a3, b1. */
const sidebarRow = (at: number) =>
  [...document.querySelectorAll('[data-session-row]')][at] as HTMLElement;

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

/** See `Canvas.split.test.tsx`'s header: happy-dom's `DragEvent` fallback
 *  carries no `clientX`/`clientY`, so a genuine `MouseEvent` typed
 *  `dragover`/`drop` is dispatched directly instead. */
function dragAt(el: Element, type: 'dragover' | 'drop', clientX: number, clientY: number) {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  act(() => {
    el.dispatchEvent(event);
  });
}

describe('each pane draws its own tab strip', () => {
  it('mounts the strip INSIDE the single pane before any split', () => {
    render(<Canvas model={MODEL} />);
    expect(strips()).toHaveLength(1);
    expect(strips()[0]?.closest('[data-split-pane]')).not.toBeNull();
  });

  it('gives a vertical split two strips — one per pane, not one shared row', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    expect(splitPanes()).toHaveLength(2);
    expect(strips()).toHaveLength(2);
    for (const strip of strips()) {
      expect(strip.closest('[data-split-pane]')).not.toBeNull();
    }
  });

  it('gives a horizontal split two strips too', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 's');
    expect(strips()).toHaveLength(2);
  });

  it('draws one strip per pane through a three-way split', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    pressChord('z', 's');
    expect(splitPanes()).toHaveLength(3);
    expect(strips()).toHaveLength(3);
  });

  it('takes the strips away with the pane when the split closes', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    pressChord('z', 'c');
    expect(strips()).toHaveLength(1);
  });
});

describe('a pane owns its tabs — a split does not hand over the source pane’s', () => {
  it('the new pane holds ONLY the session it was split from, and the source loses it', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // open a2 in pane-1 as well
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1', 'a2']);
    pressChord('z', 'v');
    // The source pane used to keep its copy of a2 -- the split mirrored. It
    // moves the tab now (see 'splitting MOVES the tab' below for the whole
    // rule); what this case still pins is that the new pane holds the ONE
    // session it was split from and none of the source pane's others.
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1']);
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a2']);
    expect(activeTabIn(paneFor('pane-2'))).toBe('a2');
  });

  it('opens a sidebar pick in the FOCUSED pane only', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2 -- a2 active
    pressChord('z', 'v'); // pane-1: a1 | pane-2: a2, focused
    act(() => sidebarRow(2).click()); // a3, which no pane holds
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1']);
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a2', 'a3']);
    expect(inBlockIn(paneFor('pane-2'))).toContain('in-d-a3');
  });

  it('activates a tab in the pane whose strip was clicked, leaving the other alone', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1 holds a1, a2 — a2 active
    pressChord('z', 'v'); // pane-1: a1 | pane-2: a2
    act(() => tabIn(paneFor('pane-1'), 'a1')?.click());
    expect(activeTabIn(paneFor('pane-1'))).toBe('a1');
    expect(activeTabIn(paneFor('pane-2'))).toBe('a2');
  });
});

describe('dragging a tab MOVES it into the pane it is dropped on', () => {
  it('leaves the source pane without that tab', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2
    const source = paneFor('pane-1') as HTMLElement;
    stubRect(source, { left: 0, top: 0, width: 200, height: 100 });
    const tab = tabIn(source, 'a2') as HTMLButtonElement;
    fireEvent.dragStart(tab);
    dragAt(source, 'dragover', 190, 50);
    dragAt(source, 'drop', 190, 50);
    expect(splitPanes()).toHaveLength(2);
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1']);
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a2']);
  });

  it('closes a pane it emptied by moving its last tab out', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2
    pressChord('z', 'v'); // pane-2: a2 alone
    const target = paneFor('pane-1') as HTMLElement;
    stubRect(target, { left: 0, top: 0, width: 200, height: 100 });
    const tab = tabIn(paneFor('pane-2'), 'a2') as HTMLButtonElement;
    fireEvent.dragStart(tab);
    dragAt(target, 'dragover', 190, 50);
    dragAt(target, 'drop', 190, 50);
    // pane-2 gave up its only tab, so it goes; the drop's own new pane holds
    // it instead, and the layout is still exactly two panes.
    expect(splitPanes()).toHaveLength(2);
    expect(splitPanes().map((p) => p.getAttribute('data-split-pane'))).not.toContain('pane-2');
  });
});

describe('closing the last tab in a pane closes the pane', () => {
  it('drops the pane, and closes the tab rather than the session', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2 — a2 active
    act(() => sidebarRow(2).click()); // pane-1: a1, a2, a3 — a3 active
    pressChord('z', 'v'); // pane-1: a1, a2 | pane-2: a3 alone
    const close = paneFor('pane-2')?.querySelector<HTMLButtonElement>('[data-tab-close]');
    act(() => close?.click());
    expect(splitPanes()).toHaveLength(1);
    // A tab's `×` closes THE TAB in the pane that drew it, not the session:
    // a3 still has its sidebar row, and pane-1's own tabs are untouched.
    // (This case used to close a MIRRORED tab and check the source pane kept
    // its copy; a session lives in one pane now, so what is left to pin is
    // that the pane goes and the session does not.)
    expect(tabsIn(splitPanes()[0])).toEqual(['a1', 'a2']);
    expect(document.querySelectorAll('[data-session-row]')).toHaveLength(4);
  });

  it('closes one tab of several without touching the pane', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2
    const close = paneFor('pane-1')?.querySelectorAll<HTMLButtonElement>('[data-tab-close]')[0];
    act(() => close?.click());
    expect(splitPanes()).toHaveLength(1);
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a2']);
  });

  it('refuses aloud rather than emptying the shell on the last tab of the last pane', () => {
    render(<Canvas model={MODEL} />);
    const close = paneFor('pane-1')?.querySelector<HTMLButtonElement>('[data-tab-close]');
    act(() => close?.click());
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1']);
    expect(document.querySelector('[data-status-bar]')?.textContent ?? '').toContain(
      'that is the last tab',
    );
  });
});

/**
 * A15.7 — EVERY PROJECT REMEMBERS ITS OWN LAYOUT, and the operator's report
 * that reversed A15.5's answer: "when I split, switch to another project and
 * then come back, the split state is lost."
 *
 * A15.5 fixed a real bug (panes kept drawing the previous project's
 * sessions) with the smaller of two rules — collapse to one pane on every
 * project switch — and said so in its own comment. The operator has used it
 * and asked for the other one, VSCode's: a layout per workspace, reopened on
 * return. The invariant A15.5 established is what makes that safe, so it is
 * asserted here in the same breath as the restore: no pane ever draws a tab
 * for another project, and a stored tree is RECONCILED against what is still
 * open rather than trusted (`restoreLayout`, pinned directly in
 * `split.test.ts`).
 */
describe('switching project reconciles the panes — no stale split, no stale tab', () => {
  it('restores the split, with its tabs, when the project comes back', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2 (alpha)
    pressChord('z', 'v');
    expect(splitPanes()).toHaveLength(2);
    const before = splitPanes().map(tabsIn);
    act(() => sidebarRow(3).click()); // b1 — project beta
    // The A15.5 guard, kept: a project never visited opens as ONE pane, and
    // not one tab of alpha's survives the switch.
    expect(splitPanes()).toHaveLength(1);
    expect(tabsIn(splitPanes()[0])).toEqual(['b1']);
    expect(inBlockIn(splitPanes()[0])).toContain('in-d-b1');
    act(() => sidebarRow(1).click()); // back to a2, in alpha
    expect(splitPanes()).toHaveLength(2);
    expect(splitPanes().map(tabsIn)).toEqual(before);
  });

  it('does not resurrect a session that ended while its project was off screen', () => {
    const { rerender } = render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click());
    pressChord('z', 'v'); // pane-2 holds a2 alone
    act(() => sidebarRow(3).click()); // beta
    const survived: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('a1'), session('a3')],
        },
        { id: 'p2', name: 'beta', source: 'claude-code', sessions: [session('b1')] },
      ],
    };
    act(() => {
      rerender(<Canvas model={survived} />);
    });
    act(() => sidebarRow(0).click()); // a1, back in alpha
    // a2 ended off screen: its tab is gone, and the pane that held nothing
    // else closed with it rather than standing empty.
    expect(splitPanes().flatMap((pane) => tabsIn(pane))).not.toContain('a2');
    expect(splitPanes()).toHaveLength(1);
    expect(tabsIn(splitPanes()[0])).toEqual(['a1']);
  });

  it('keeps the split when the pick stays inside the same project', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v');
    act(() => sidebarRow(2).click()); // a3, still alpha
    expect(splitPanes()).toHaveLength(2);
  });
});

/**
 * A SESSION LIVES IN EXACTLY ONE PANE.
 *
 * The operator: "when I split a tab, I still see that tab showing in both
 * panes." `zv`/`zs` used to open the new pane as a MIRROR of the one it came
 * from — vim's `:split` and VSCode's "Split Editor" both do that, and the
 * comment on `splitFocused` argued for it. Used, it turned out to contradict
 * the model the rest of this shell teaches: a tab belongs to a pane. Two panes
 * showing one session is not a split of anything, it is the same thing twice
 * over the half of the screen the split was made to gain.
 *
 * So the chord MOVES the active tab, which is what the drag gesture has always
 * done — one rule for where a tab lives, not two that disagree depending on
 * how you asked for it. The consequences pinned below are the whole of the
 * rule: the source keeps its other tabs and activates a neighbour by the
 * right-then-left rule closing already used; a source left with nothing stays
 * on screen saying so rather than vanishing; and picking a session in the
 * sidebar while another pane holds it moves the KEYBOARD there instead of
 * making a second copy — the same complaint through a different door.
 */
describe('splitting MOVES the tab — a session is never in two panes', () => {
  it('leaves the source pane without the tab the split took', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2 — a2 active
    pressChord('z', 'v');
    expect(splitPanes()).toHaveLength(2);
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1']);
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a2']);
    // The assertion that names the report: once on screen, not twice.
    const everywhere = splitPanes().flatMap((pane) => tabsIn(pane));
    expect(everywhere.filter((title) => title === 'a2')).toHaveLength(1);
  });

  it('activates the neighbour to the right in the pane it took the tab from', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // a2
    act(() => sidebarRow(2).click()); // a3 — pane-1: a1, a2, a3
    act(() => tabIn(paneFor('pane-1'), 'a2')?.click()); // a2 back in front
    pressChord('z', 'v');
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1', 'a3']);
    // Right-then-left, the rule `removeTab` already used for a close.
    expect(activeTabIn(paneFor('pane-1'))).toBe('a3');
  });

  it('keeps a pane it emptied on screen, saying what to do about it', () => {
    render(<Canvas model={MODEL} />);
    pressChord('z', 'v'); // pane-1 held a1 alone, and gives it up
    expect(splitPanes()).toHaveLength(2);
    const emptied = paneFor('pane-1');
    expect(tabsIn(emptied)).toEqual([]);
    // The strip's own empty state, drawn INSIDE the pane — the operator asked
    // for two panes and gets two, one of them honest about being empty.
    expect(emptied?.querySelector('[data-tab-strip]')?.textContent).toContain('no sessions open');
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a1']);
  });

  it('a horizontal split moves the tab the same way', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2 — a2 active
    pressChord('z', 's');
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1']);
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a2']);
  });
});

describe('picking a session the OTHER pane holds moves the keyboard, not the tab', () => {
  it('focuses the pane already holding it instead of opening a second copy', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2 — a2 active
    pressChord('z', 'v'); // pane-1: a1 | pane-2: a2, focused
    act(() => sidebarRow(0).click()); // a1 — which pane-1 already holds
    expect(paneFor('pane-1')?.getAttribute('data-split-focused')).toBe('true');
    expect(activeTabIn(paneFor('pane-1'))).toBe('a1');
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1']);
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a2']);
  });

  it('opens a session NO pane holds in the focused pane, as before', () => {
    render(<Canvas model={MODEL} />);
    act(() => sidebarRow(1).click()); // pane-1: a1, a2
    pressChord('z', 'v'); // pane-1: a1 | pane-2: a2, focused
    act(() => sidebarRow(2).click()); // a3 — nobody holds it
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a2', 'a3']);
    expect(paneFor('pane-2')?.getAttribute('data-split-focused')).toBe('true');
  });
});
