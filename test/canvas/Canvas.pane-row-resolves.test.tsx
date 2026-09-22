// @vitest-environment happy-dom

/**
 * THE ROW RESOLVES WHEN AN AGENT APPEARS, AND THE TAB STAYS PUT.
 *
 * `docs/design/vam-owns-the-session.md` §3 and Stage 2: a vam pane with
 * nothing in it is a row keyed by its tmux name; the moment an agent registers
 * there the source reports a row keyed by the AGENT, carrying the same
 * `Session.pane`. To the canvas that is one id gone and one id new -- and the
 * A15.5 prune would drop the tab the operator is looking at, then A11.1's
 * adoption would append the new row at the END of the strip. `renameTab`
 * (`split.ts`) is the step between the two models, and this is it measured on
 * the strip: same position, still in front, view carried across.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    source: 'claude-code',
    ...over,
  };
}

/** The empty pane, as `pane-row.ts` reports it. */
const EMPTY = session('pane:vam-alpha-aa11bb', {
  status: 'unstarted',
  vamControlled: true,
  pane: 'vam-alpha-aa11bb',
});
/** The same pane a poll later, with `claude` registered in it. */
const AGENT = session('sess-a#4242', {
  status: 'running',
  vamControlled: true,
  pane: 'vam-alpha-aa11bb',
  decisions: [{ id: 'd1', label: 'plan', input: 'hello', output: null, commands: [] }],
});

const model = (sessions: readonly Session[]): CanvasModel => ({
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions }],
});

const tabsIn = (paneId: string) => [
  ...(document
    .querySelector(`[data-split-pane="${paneId}"]`)
    ?.querySelectorAll('[data-tab-select]') ?? []),
];
const titles = (paneId: string) => tabsIn(paneId).map((el) => el.textContent);
const activeTitle = (paneId: string) =>
  document.querySelector(`[data-split-pane="${paneId}"] [data-session-tab][data-active="true"]`)
    ?.textContent ?? null;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

describe('a pane row whose agent has arrived', () => {
  /**
   * TWO PANES, BECAUSE ONE CANNOT TELL THE RENAME FROM PRUNE-AND-ADOPT.
   * Measured: with a single pane the strip is drawn from the ranked session
   * list and the adopted row lands in the only pane there is, so the tab
   * "stays" whether it was renamed or dropped and re-added. The difference is
   * WHICH pane it stays in. The empty row's tab is moved to pane-2 and the
   * keyboard sent back to pane-1: a prune would drop it from pane-2 and the
   * adoption would append it to the FOCUSED pane-1; the rename keeps it in
   * pane-2, where the operator put it. Falsified by disabling `renameTab` in
   * the effect: this assertion reddens, the single-pane one did not.
   */
  it('keeps its tab in the pane that held it, not the focused one -- under the new id', () => {
    const { rerender } = render(<Canvas model={model([session('s0'), EMPTY, session('s2')])} />);
    const at = titles('pane-1').indexOf('pane:vam-alpha-aa11bb');
    act(() => {
      (tabsIn('pane-1')[at] as HTMLElement).click();
    });
    press('z');
    press('v'); // pane-2 takes the empty row's tab and the keyboard
    expect(titles('pane-2')).toEqual(['pane:vam-alpha-aa11bb']);
    press('z');
    press('w'); // the keyboard steps back to pane-1
    expect(
      document.querySelector('[data-split-pane="pane-1"][data-split-focused="true"]'),
    ).not.toBeNull();

    act(() => {
      rerender(<Canvas model={model([session('s0'), AGENT, session('s2')])} />);
    });
    expect(titles('pane-2'), 'renamed in place, in the pane that held it').toEqual(['sess-a#4242']);
    expect(titles('pane-1')).not.toContain('sess-a#4242');
  });

  it('draws the start screen for the empty row, and the transcript once it resolves', () => {
    const { rerender } = render(<Canvas model={model([EMPTY])} />);
    expect(document.querySelector('[data-start-session]')).not.toBeNull();
    expect(document.querySelector('[data-start-session-button]')).not.toBeNull();
    act(() => {
      rerender(<Canvas model={model([AGENT])} />);
    });
    expect(document.querySelector('[data-start-session]')).toBeNull();
    expect(titles('pane-1')).toEqual(['sess-a#4242']);
  });

  it('closes the tab, not renames it, when the pane simply ended', () => {
    const { rerender } = render(<Canvas model={model([session('s0'), EMPTY])} />);
    act(() => {
      rerender(<Canvas model={model([session('s0')])} />);
    });
    expect(titles('pane-1')).toEqual(['s0']);
  });
});
