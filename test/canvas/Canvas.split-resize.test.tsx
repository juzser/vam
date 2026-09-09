// @vitest-environment happy-dom

/**
 * PANE RESIZING WHEN SPLIT — the wiring, from `SplitLayout` down to the tree.
 *
 * The sizing rules themselves are pinned in isolation at
 * `test/canvas/split-sizes.test.ts`, and the handle's own gesture at
 * `test/panels/SplitResizer.test.tsx`. What is left, and only testable
 * through a rendered shell, is that the two are actually connected: a
 * divider exists between every adjacent pair and nowhere else, the fraction
 * the tree stores is the fraction the DOM lays out with, and a real key press
 * on a real handle moves a real pane.
 *
 * happy-dom has no layout engine, so every rect here is stubbed exactly as
 * `Canvas.split.test.tsx` already stubs them for the drop-edge arithmetic.
 * The load-bearing evidence for an actual DRAG is `e2e/split-panes-shots.mjs`,
 * in Chromium.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { MIN_PANE_PX } from '../../src/renderer/canvas/split.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import { PANE_RESIZE_STEP } from '../../src/renderer/prefs/panes.js';

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
  ],
};

afterEach(cleanup);

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function split(orientation: 'v' | 's') {
  press('z');
  press(orientation);
}

const handles = () => [...document.querySelectorAll<HTMLElement>('[data-split-resize-handle]')];
const slots = () => [...document.querySelectorAll<HTMLElement>('[data-split-slot]')];
const grows = () => slots().map((slot) => Number(slot.style.flexGrow));

/**
 * A real 1000px pair on the two slots either side of the first divider. Every
 * other rect stays zeroed, which is what happy-dom gives anyway.
 */
function stubPair(first: number, second: number, axis: 'width' | 'height') {
  for (const [at, slot] of slots().entries()) {
    const extent = at === 0 ? first : at === 1 ? second : 0;
    slot.getBoundingClientRect = () =>
      ({
        width: axis === 'width' ? extent : 40,
        height: axis === 'height' ? extent : 40,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }
}

describe('the split layout draws a divider between every adjacent pair', () => {
  it('a single pane has no divider — there is nothing to divide', () => {
    render(<Canvas model={MODEL} />);
    expect(handles()).toHaveLength(0);
  });

  it('two panes have one divider, three have two', () => {
    render(<Canvas model={MODEL} />);
    split('v');
    expect(handles()).toHaveLength(1);
    split('v');
    expect(handles()).toHaveLength(2);
  });

  it('the divider names the split and which pair it sits between', () => {
    render(<Canvas model={MODEL} />);
    split('v');
    split('v');
    const named = handles().map((handle) => handle.dataset.splitResizeHandle ?? '');
    expect(named.map((name) => name.split(':')[1])).toEqual(['0', '1']);
    // Both dividers belong to the SAME split — three panes in one row, which
    // is what `splitPane` builds for a repeated same-axis split.
    expect(new Set(named.map((name) => name.split(':')[0])).size).toBe(1);
  });

  it('a column split’s divider is horizontal, and a row split’s is vertical', () => {
    render(<Canvas model={MODEL} />);
    split('s');
    expect(handles()[0]?.getAttribute('aria-orientation')).toBe('horizontal');
    cleanup();
    render(<Canvas model={MODEL} />);
    split('v');
    expect(handles()[0]?.getAttribute('aria-orientation')).toBe('vertical');
  });
});

describe('the fraction the tree stores is the fraction the DOM lays out with', () => {
  it('a fresh split is two even slots, laid out by flex-grow over a zero basis', () => {
    render(<Canvas model={MODEL} />);
    split('v');
    expect(grows()).toEqual([0.5, 0.5]);
    // A zero basis is what makes grow a RATIO rather than a share of leftover
    // room — without it two panes with different content would start at
    // different widths and the fractions would be a lie.
    expect(slots().map((slot) => slot.style.flexBasis)).toEqual(['0px', '0px']);
  });

  it('a third pane halves the pane it split, and the other slot does not move', () => {
    render(<Canvas model={MODEL} />);
    split('v');
    split('v');
    expect(grows()).toEqual([0.5, 0.25, 0.25]);
  });
});

describe('a key press on a divider moves a real pane', () => {
  it('an arrow grows the leading pane by one step and shrinks its neighbour', () => {
    render(<Canvas model={MODEL} />);
    split('v');
    stubPair(500, 500, 'width');
    fireEvent.keyDown(handles()[0] as HTMLElement, { key: 'ArrowRight' });
    const [first, second] = grows();
    expect(first).toBeCloseTo((500 + PANE_RESIZE_STEP) / 1000, 10);
    expect(second).toBeCloseTo((500 - PANE_RESIZE_STEP) / 1000, 10);
  });

  it('End drives the neighbour down to the pixel minimum and no further', () => {
    render(<Canvas model={MODEL} />);
    split('v');
    stubPair(500, 500, 'width');
    fireEvent.keyDown(handles()[0] as HTMLElement, { key: 'End' });
    fireEvent.keyDown(handles()[0] as HTMLElement, { key: 'End' });
    expect((grows()[1] ?? 0) * 1000).toBeCloseTo(MIN_PANE_PX, 6);
  });

  /**
   * A pane pinned at the minimum is still a pane: the operator has to be able
   * to see what is in it and get out of it again. Its strip is drawn, its
   * composer is drawn, and the divider that put it there is still reachable
   * and still says where it stands.
   */
  it('a pane at the minimum keeps its tab strip, its composer and its handle', () => {
    render(<Canvas model={MODEL} />);
    split('v');
    stubPair(500, 500, 'width');
    fireEvent.keyDown(handles()[0] as HTMLElement, { key: 'End' });
    const pinned = [...document.querySelectorAll('[data-split-pane]')][1] as HTMLElement;
    expect(pinned.querySelector('[data-tab-strip]')).not.toBeNull();
    expect(pinned.querySelector('textarea[aria-label="prompt to session"]')).not.toBeNull();
    expect(handles()).toHaveLength(1);
    expect(handles()[0]?.getAttribute('aria-valuenow')).toBe(
      String(Math.round((1 - MIN_PANE_PX / 1000) * 100)),
    );
  });

  it('a COLUMN divider is driven by Up and Down', () => {
    render(<Canvas model={MODEL} />);
    split('s');
    stubPair(400, 400, 'height');
    fireEvent.keyDown(handles()[0] as HTMLElement, { key: 'ArrowDown' });
    expect(grows()[0]).toBeCloseTo((400 + PANE_RESIZE_STEP) / 800, 10);
  });

  it('a divider inside a NESTED split moves only its own pair', () => {
    render(<Canvas model={MODEL} />);
    split('v');
    split('s');
    // p1 | (p2 / p3): one divider in the outer row, one in the nested column.
    // `grows()` is document order, so the four slots read: p1's, the nested
    // split's own slot in the outer row, then p2's and p3's inside it.
    expect(handles()).toHaveLength(2);
    const before = grows();
    expect(before).toHaveLength(4);
    const nested = handles().find(
      (handle) => handle.getAttribute('aria-orientation') === 'horizontal',
    ) as HTMLElement;
    for (const slot of [...(nested.parentElement?.parentElement?.children ?? [])]) {
      (slot as HTMLElement).getBoundingClientRect = () =>
        ({
          width: 40,
          height: 500,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    }
    fireEvent.keyDown(nested, { key: 'ArrowDown' });
    const after = grows();
    // THE OUTER ROW DOES NOT MOVE: dragging an inner divider must not reflow
    // the layout around the split it belongs to.
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]).toBeCloseTo((500 + PANE_RESIZE_STEP) / 1000, 10);
    expect(after[3]).toBeCloseTo((500 - PANE_RESIZE_STEP) / 1000, 10);
  });
});

describe('a resized layout survives leaving the project and coming back', () => {
  it('the divider comes back where it was left', () => {
    render(
      <Canvas
        model={{
          projects: [
            MODEL.projects[0] as CanvasModel['projects'][number],
            { id: 'p2', name: 'beta', source: 'claude-code', sessions: [session('b1')] },
          ],
        }}
      />,
    );
    split('v');
    stubPair(500, 500, 'width');
    fireEvent.keyDown(handles()[0] as HTMLElement, { key: 'ArrowRight' });
    fireEvent.keyDown(handles()[0] as HTMLElement, { key: 'ArrowRight' });
    const arranged = grows();
    expect(arranged[0]).toBeGreaterThan(0.5);

    const rows = [...document.querySelectorAll<HTMLElement>('[data-session-row]')];
    // Leave for the other project, then come back to the first one.
    act(() => {
      (rows.at(-1) as HTMLElement).click();
    });
    expect(handles()).toHaveLength(0);
    act(() => {
      (document.querySelectorAll<HTMLElement>('[data-session-row]')[0] as HTMLElement).click();
    });
    expect(grows()[0]).toBeCloseTo(arranged[0] ?? 0, 10);
  });
});
