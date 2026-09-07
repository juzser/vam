// @vitest-environment happy-dom

/**
 * The canvas stacks its cells in one column when the pane is narrow.
 *
 * The operator's report: with the canvas laid out on the right (sidebar and
 * detail panel both open), the pane is narrow enough that a two-column grid
 * makes the sessions hard to see. `grid.ts`'s `columnsForWidth` and
 * `layout.ts`'s `layoutCanvas(model, columns)` are unit-tested in isolation
 * (`test/canvas/grid.test.ts`, `test/canvas/layout.test.ts`); this file is the
 * wiring proof — that `Canvas.tsx` actually measures the live pane and feeds
 * the result back into the layout, and that it does so again on a RESIZE, not
 * only on the first render.
 *
 * happy-dom does no layout, so `data-canvas-viewport`'s `clientWidth` is
 * written by the test, and its `ResizeObserver` is a fake fired by hand — the
 * same two idioms `test/panels/TerminalTab.fit.test.tsx` already uses for the
 * identical problem (a pane-resizer drag that a window `resize` listener
 * cannot see).
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { CELL, GRID } from '../../src/renderer/canvas/grid.js';
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

// Every session is `done`, so STATUS_RANK cannot reorder them and the canvas
// places them in declaration order: a1 in cell 0, a2 in cell 1.
const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1'), session('a2')] },
  ],
};

/** The two-column span in canvas units — the same arithmetic `grid.test.ts`
 *  pins for `columnsForWidth`. At the shipped default zoom (0.8, DEFAULT_VIEWPORT
 *  in Canvas.tsx) that is `TWO_COLUMN_SPAN * 0.8` device pixels. */
const TWO_COLUMN_SPAN =
  GRID.padding + GRID.columns * CELL.width + (GRID.columns - 1) * GRID.columnGap;
const DEFAULT_ZOOM = 0.8;
const WIDE = Math.ceil(TWO_COLUMN_SPAN * DEFAULT_ZOOM) + 100;
const NARROW = Math.floor(TWO_COLUMN_SPAN * DEFAULT_ZOOM) - 100;

type FakeEntry = { target: Element; contentRect: { width: number; height: number } };

function entryFor(element: Element): FakeEntry {
  return { target: element, contentRect: element.getBoundingClientRect() };
}

/**
 * The observer happy-dom will not run for us; fired by hand, same idiom as
 * `test/panels/TerminalTab.fit.test.tsx`'s `FakeResizeObserver`.
 *
 * `@xyflow/react` installs its OWN `ResizeObserver`s on the same global too —
 * one per pane, for its pan/zoom extent (`entries[0].contentRect`), and one
 * shared instance observing every drawn node, for its internal dimensions
 * (`entries[i].target`). `Canvas.tsx`'s own `measure` ignores the argument
 * entirely and reads `clientWidth` off the element directly. This fake has to
 * satisfy all three, so every entry it hands back carries both fields.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  constructor(readonly callback: (entries: readonly FakeEntry[]) => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
    // A real ResizeObserver delivers the element's initial size on `observe`.
    this.callback([entryFor(element)]);
  }
  unobserve(element: Element) {
    const i = this.observed.indexOf(element);
    if (i >= 0) this.observed.splice(i, 1);
  }
  disconnect() {
    this.observed.length = 0;
  }
}

const viewport = () => document.querySelector('[data-canvas-viewport]') as HTMLElement | null;

/** Writes the width happy-dom has no layout engine to produce, then fires
 *  every FakeResizeObserver instance currently watching it — a pane-resizer
 *  drag, reduced to its two observable effects. */
function resizeCanvasPane(width: number) {
  const el = viewport();
  if (el === null) throw new Error('the canvas viewport was not drawn');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  act(() => {
    for (const observer of FakeResizeObserver.instances) {
      if (observer.observed.includes(el)) {
        observer.callback([entryFor(el)]);
      }
    }
  });
}

/** `x`/`y` off a node's `transform: translate(Npx, Mpx)`, the same string
 *  `Canvas.keyboard.test.tsx`'s `drawnPositions` reads (verified against
 *  `@xyflow/react` 12.11.5's own node renderer). */
function nodePosition(id: string): { x: number; y: number } | null {
  const el = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
  const match = el?.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // ReactFlow measures with an API happy-dom does not implement — it only
  // needs to exist so the renderer does not throw (same shim
  // `Canvas.keyboard.test.tsx` installs).
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the canvas chooses its column count from the pane it is actually drawn into', () => {
  it('draws two columns once the pane is wide enough, at the default zoom', () => {
    render(<Canvas model={MODEL} />);
    resizeCanvasPane(WIDE);

    expect(nodePosition('info:a1')).toEqual({ x: 16, y: 74 });
    // Second column, same row: exactly `cellOrigin(1, 2)` from grid.test.ts.
    expect(nodePosition('info:a2')).toEqual({ x: 668, y: 74 });
  });

  it('stacks in one column once the pane is too narrow for two, at the default zoom', () => {
    render(<Canvas model={MODEL} />);
    resizeCanvasPane(NARROW);

    expect(nodePosition('info:a1')).toEqual({ x: 16, y: 74 });
    // Second row, not second column: exactly `cellOrigin(1, 1)` from grid.test.ts.
    expect(nodePosition('info:a2')).toEqual({ x: 16, y: 428 });
  });

  it('reacts to a pane resize after mount, not only to the first render', () => {
    render(<Canvas model={MODEL} />);
    resizeCanvasPane(WIDE);
    expect(nodePosition('info:a2')).toEqual({ x: 668, y: 74 });

    // The pane resizer, without a window resize event: the same drag
    // `panes.ts`'s widths and `TerminalTab.tsx`'s pane-size effect both
    // already react to.
    resizeCanvasPane(NARROW);
    expect(nodePosition('info:a2')).toEqual({ x: 16, y: 428 });

    // And back — this is not a one-way collapse.
    resizeCanvasPane(WIDE);
    expect(nodePosition('info:a2')).toEqual({ x: 668, y: 74 });
  });
});
