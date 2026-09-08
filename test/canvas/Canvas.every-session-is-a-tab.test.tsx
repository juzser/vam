// @vitest-environment happy-dom

/**
 * A11.1, RESTORED: every session of the active project is a tab of exactly
 * one pane — never zero.
 *
 * The operator opened a project holding two sessions and saw one tab: "right
 * from the start, shouldn't it show both tabs of a project at once?" Asked
 * earlier in this epic how many of a project's sessions should be tabs, they
 * had answered "all of them, always", and that is A11.1. PR 263 built the
 * per-pane strips and, reasonably for the editor-group model it was
 * building, narrowed the rule to "every session the pane OPENED is a tab of
 * that pane" — which left the sidebar as the only route to a session no pane
 * had been pointed at, and left the shell opening on one tab.
 *
 * "Exactly one" is what makes the restored rule compatible with everything
 * built on top of it: PR 268's `zv`/`zs` MOVE a tab rather than cloning it,
 * so the invariant may only adopt sessions that NO pane holds
 * (`adoptOrphans`, pinned pure in `split.test.ts`). This file proves the
 * wiring reaches the DOM, and pins the four cases where the rule meets
 * something already built.
 */

import { act, cleanup, render } from '@testing-library/react';
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

function model(alpha: readonly string[], beta: readonly string[] = ['b1']): CanvasModel {
  return {
    projects: [
      {
        id: 'p1',
        name: 'alpha',
        source: 'claude-code',
        sessions: alpha.map(session),
      },
      { id: 'p2', name: 'beta', source: 'claude-code', sessions: beta.map(session) },
    ],
  };
}

afterEach(cleanup);

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const splitPanes = () => [...document.querySelectorAll('[data-split-pane]')];
const paneFor = (id: string) => document.querySelector(`[data-split-pane="${id}"]`);
const tabsIn = (paneEl: Element | null | undefined) =>
  [...(paneEl?.querySelectorAll('[data-tab-select]') ?? [])].map((el) => el.textContent);
const everyTab = () => splitPanes().flatMap((pane) => tabsIn(pane));
const sidebarRow = (at: number) =>
  [...document.querySelectorAll('[data-session-row]')][at] as HTMLElement;
const said = () => document.querySelector('[data-status-bar]')?.textContent ?? '';

describe('a project opens with every one of its sessions as a tab', () => {
  it('draws all three from the very first render, with nothing opened by hand', () => {
    render(<Canvas model={model(['a1', 'a2', 'a3'])} />);
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1', 'a2', 'a3']);
  });

  it('draws only the ACTIVE project’s — the strip is project-scoped', () => {
    render(<Canvas model={model(['a1', 'a2'])} />);
    expect(everyTab()).not.toContain('b1');
  });

  it('gives a project switched INTO all of its sessions too', () => {
    render(<Canvas model={model(['a1', 'a2'], ['b1', 'b2'])} />);
    act(() => sidebarRow(2).click()); // b1 — project beta
    expect(tabsIn(splitPanes()[0])).toEqual(['b1', 'b2']);
  });
});

describe('a session that turns up later gets a tab', () => {
  it('adopts one started outside vam into the focused pane', () => {
    const { rerender } = render(<Canvas model={model(['a1'])} />);
    expect(everyTab()).toEqual(['a1']);
    act(() => {
      rerender(<Canvas model={model(['a1', 'a2'])} />);
    });
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1', 'a2']);
  });

  it('adopts into the FOCUSED pane, leaving the other alone', () => {
    const { rerender } = render(<Canvas model={model(['a1', 'a2'])} />);
    press('z');
    press('v'); // pane-2 takes the active tab and has the keyboard
    const before = tabsIn(paneFor('pane-1'));
    act(() => {
      rerender(<Canvas model={model(['a1', 'a2', 'a3'])} />);
    });
    expect(tabsIn(paneFor('pane-1'))).toEqual(before);
    expect(tabsIn(paneFor('pane-2'))).toContain('a3');
    expect(everyTab().filter((title) => title === 'a3')).toHaveLength(1);
  });

  // Case 3: `allEntries` is empty BEFORE the first model arrives. That is not
  // "every session closed", and it is not a set of sessions to distribute
  // either — the same mistake the prune effect already guards against, made
  // in the opposite direction.
  it('does not invent tabs from an empty pre-load model', () => {
    const { rerender } = render(<Canvas model={{ projects: [] }} />);
    expect(everyTab()).toEqual([]);
    act(() => {
      rerender(<Canvas model={model(['a1', 'a2'])} />);
    });
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1', 'a2']);
  });
});

/**
 * Case 4, the delicate one: a pane `zv` deliberately emptied.
 *
 * "Every session is a tab" and "an empty pane is a legitimate state" (PR
 * 268, and PR 271's withdrawn composer) can contradict. They do not, because
 * the split MOVES the tab: nothing is orphaned by it, so the invariant has
 * nothing to put back. Refilling here would repopulate the source pane the
 * instant the operator split it and undo the split.
 */
describe('the pane a split emptied stays empty', () => {
  it('does not refill the source pane of a single-tab split', () => {
    render(<Canvas model={model(['a1'])} />);
    press('z');
    press('v');
    expect(splitPanes()).toHaveLength(2);
    expect(tabsIn(paneFor('pane-1'))).toEqual([]);
    expect(tabsIn(paneFor('pane-2'))).toEqual(['a1']);
  });

  it('stays empty even while it is the pane the keyboard is in', () => {
    render(<Canvas model={model(['a1'])} />);
    press('z');
    press('v'); // pane-2 took a1; pane-1 is empty on purpose
    press('z');
    press('w'); // the keyboard goes back to the empty pane
    expect(paneFor('pane-1')?.getAttribute('data-split-focused')).toBe('true');
    expect(tabsIn(paneFor('pane-1'))).toEqual([]);
    expect(everyTab()).toEqual(['a1']);
  });

  it('still holds when the project has several sessions and the pane gives up its last', () => {
    render(<Canvas model={model(['a1', 'a2', 'a3'])} />);
    press('z');
    press('v'); // pane-2 takes the active tab
    press('z');
    press('v'); // pane-3 takes it from pane-2, which is now empty on purpose
    expect(tabsIn(paneFor('pane-2'))).toEqual([]);
    expect(everyTab().sort()).toEqual(['a1', 'a2', 'a3']);
  });
});

/**
 * Case 2: a layout remembered when the project held a different set of
 * sessions. `restoreLayout` already prunes the dead; the invariant is what
 * absorbs the ones born while the project was off screen.
 */
describe('a restored layout absorbs what was created while the project was away', () => {
  it('gives a session started off screen a tab on the way back', () => {
    const { rerender } = render(<Canvas model={model(['a1', 'a2'])} />);
    press('z');
    press('v');
    act(() => sidebarRow(2).click()); // b1 — leave alpha, layout remembered
    act(() => {
      rerender(<Canvas model={model(['a1', 'a2', 'a3'])} />);
    });
    act(() => sidebarRow(0).click()); // back to alpha
    expect(splitPanes()).toHaveLength(2);
    expect(everyTab().sort()).toEqual(['a1', 'a2', 'a3']);
    expect(everyTab().filter((title) => title === 'a3')).toHaveLength(1);
  });
});

/**
 * The consequence the invariant has for a tab's own `×`. Closing a tab used
 * to leave a live session with no tab anywhere, reachable only from the
 * sidebar — which is precisely the state A11.1 forbids, so the adoption
 * would put the tab straight back and the `×` would read as broken. It
 * refuses aloud instead, in the demo `+`'s idiom: a control that cannot do
 * the thing says why rather than doing nothing. Ending the session is still
 * one keystroke away, and stays where the destructive verb already lives.
 */
describe('a tab’s × cannot leave a live session without one', () => {
  it('refuses, naming the key that actually closes the session', () => {
    render(<Canvas model={model(['a1', 'a2'])} />);
    const close = paneFor('pane-1')?.querySelector<HTMLButtonElement>('[data-tab-close]');
    act(() => close?.click());
    expect(tabsIn(paneFor('pane-1'))).toEqual(['a1', 'a2']);
    expect(said()).toContain('close the session with x');
  });
});
