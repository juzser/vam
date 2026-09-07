// @vitest-environment happy-dom

/**
 * The column count must depend on the pane's width alone, never on the live
 * zoom the operator is scrolling.
 *
 * `DEFAULT_VIEWPORT`'s own comment in `Canvas.tsx` already records the
 * mistake this guards against, in the OTHER direction: `fitView` used to pick
 * the opening zoom, which made the zoom depend on how much was on screen, and
 * it was deliberately removed for exactly that reason. Feeding the LIVE zoom
 * into `columnsForWidth` reintroduces the same coupling backwards — the
 * arrangement would depend on the zoom, so a scroll-wheel notch crossing the
 * threshold could rearrange every node mid-gesture. `Canvas.tsx` must pass
 * `columnsForWidth` the fixed `DEFAULT_VIEWPORT.zoom` (0.8), never the
 * `useStore((state) => state.transform[2])` subscription it reads for the
 * toolbar's zoom-percent readout.
 *
 * `@xyflow/react`'s `useStore` is mocked to a zoom (0.2) chosen so the two
 * outcomes are DISTINGUISHABLE: at 0.2 the two-column threshold in device
 * pixels is `1248 * 0.2 = 249.6`; at the real `DEFAULT_VIEWPORT.zoom` (0.8)
 * it is `1248 * 0.8 = 998.4`. A pane 700px wide sits between the two — one
 * column if `columns` reads the fixed reference (right), two columns if it
 * reads this mocked live value (the bug this file exists to catch).
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LIVE_ZOOM = 0.2;

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    useStore: (selector: (state: { transform: readonly [number, number, number] }) => unknown) =>
      selector({ transform: [0, 0, LIVE_ZOOM] }),
  };
});

const { Canvas } = await import('../../src/renderer/canvas/Canvas.js');
type CanvasModel = import('../../src/renderer/domain/model.js').CanvasModel;
type Decision = import('../../src/renderer/domain/model.js').Decision;
type Session = import('../../src/renderer/domain/model.js').Session;

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

// Both `done`, so declaration order holds: a1 in cell 0, a2 in cell 1.
const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'factory', sessions: [session('a1'), session('a2')] },
  ],
};

/** A pane between the two thresholds described above: one column at the
 *  real reference zoom, two at the mocked live one. */
const PANE_WIDTH = 700;

type FakeEntry = { target: Element; contentRect: { width: number; height: number } };

function entryFor(element: Element): FakeEntry {
  return { target: element, contentRect: element.getBoundingClientRect() };
}

/** Same idiom as `Canvas.canvas-columns.test.tsx` and
 *  `test/panels/TerminalTab.fit.test.tsx` — happy-dom will not run a real
 *  observer, so this one is fired by hand. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  constructor(readonly callback: (entries: readonly FakeEntry[]) => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
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

function nodePosition(id: string): { x: number; y: number } | null {
  const el = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null;
  const match = el?.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('columns ignore the live zoom', () => {
  it('stays at one column for a pane that would only fit two at the mocked live zoom', () => {
    render(<Canvas model={MODEL} />);
    resizeCanvasPane(PANE_WIDTH);

    expect(nodePosition('info:a1')).toEqual({ x: 16, y: 74 });
    // Second ROW, not second column — proof `columns` used the fixed
    // reference zoom (threshold 998.4px) and not the mocked live one
    // (threshold 249.6px), which would have put a2 at { x: 668, y: 74 }.
    expect(nodePosition('info:a2')).toEqual({ x: 16, y: 428 });
  });
});
