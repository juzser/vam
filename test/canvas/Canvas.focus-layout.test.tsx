// @vitest-environment happy-dom

/**
 * The focus layout: the response in the middle, the canvas demoted to a strip.
 *
 * The two shipped layouts are subtractive — they hide a column and change
 * nothing else — and `panes.ts` said in as many words that a layout which
 * REORDERED the columns could not be expressed by a visibility record, because
 * the order lived in `Canvas.tsx`'s JSX. This file is the other half of that
 * sentence: a descriptor that carries an ORDER, and the assertions that make
 * the order observable rather than merely declared.
 *
 * Every order assertion here reads DOCUMENT ORDER. A test that only asked
 * whether all three columns exist would pass against the layout this file was
 * written to replace, which is another way of saying it would assert nothing.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import {
  ALL_VISIBLE,
  CANVAS_STRIP,
  DEFAULT_ORDER,
  DEFAULT_PANES,
  FOCUS_MIN_VIEWPORT,
  LAYOUTS,
  columnOrder as layoutColumnOrder,
  layoutWidths,
} from '../../src/renderer/prefs/panes.js';

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
    { id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1'), session('a2')] },
  ],
};

const PREFS_KEY = 'vam.prefs.v1';

function seed(payload: Record<string, unknown>) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
}

function stored(): Record<string, never> & {
  panes: { sidebar: number; detail: number };
  paneVisibility: { order?: string[]; sidebar: boolean; canvas: boolean; detail: boolean };
  theme?: string;
  focusViewportShare?: number;
} {
  return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
}

/**
 * The three columns in the order the DOM has them. One `querySelectorAll` over
 * all three selectors, because that returns document order — three separate
 * queries would only prove presence.
 */
const columnOrder = () =>
  [...document.querySelectorAll('[data-sidebar-pane],[data-canvas-pane],[data-action-pane]')].map(
    (el) =>
      el.hasAttribute('data-sidebar-pane')
        ? 'sidebar'
        : el.hasAttribute('data-canvas-pane')
          ? 'canvas'
          : 'detail',
  );

/** The session ids the canvas currently draws, deduplicated. */
const drawnSessions = () => [
  ...new Set(
    [...document.querySelectorAll('.react-flow__node')]
      .map((el) => (el.getAttribute('data-id') ?? '').split(':')[1] ?? '')
      .filter((id) => id !== ''),
  ),
];

const canvasPane = () => document.querySelector('[data-canvas-pane]') as HTMLElement | null;

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

// The same three shims `Canvas.pane-visibility.test.tsx` installs, for the same
// reason: ReactFlow measures, and this happy-dom has neither a layout engine nor
// a `localStorage`.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  globalThis.localStorage ??= (() => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    };
  })() as unknown as Storage;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the focus layout reorders the columns', () => {
  it('draws sidebar, then response, then canvas — in document order', () => {
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'detail', 'canvas']);
  });

  it('leaves the shipped layout in its shipped order', () => {
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'canvas', 'detail']);
  });

  it('gives the demoted canvas a strip, narrower than the response beside it', () => {
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    const strip = Number.parseFloat(canvasPane()?.style.width ?? 'NaN');
    const detail = Number.parseFloat(
      (document.querySelector('[data-action-pane]') as HTMLElement | null)?.style.width ?? 'NaN',
    );
    expect(strip).toBeGreaterThan(0);
    expect(strip).toBeLessThan(detail);
  });
});

describe('the demoted canvas draws the focused session and nothing else', () => {
  it('drops the other sessions from the strip', () => {
    render(<Canvas model={MODEL} />);
    expect(drawnSessions().sort()).toEqual(['a1', 'a2']);
    cleanup();

    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    expect(drawnSessions()).toEqual(['a1']);
  });

  it('follows the focus when it moves', () => {
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    press('j');
    expect(drawnSessions()).toEqual(['a2']);
  });
});

describe('z0 undoes it', () => {
  it('restores the shipped order and the stored widths', () => {
    seed({
      panes: { sidebar: 300, detail: 420 },
      paneVisibility: LAYOUTS.focusResponse,
    });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'detail', 'canvas']);
    // The reordering layout leaves the widths you dragged exactly where they
    // were: the sidebar still renders at its stored 300.
    const sidebar = document.querySelector('[data-sidebar-pane]') as HTMLElement | null;
    expect(Number.parseFloat(sidebar?.style.width ?? 'NaN')).toBe(300);
    expect(stored().panes).toEqual({ sidebar: 300, detail: 420 });

    press('z');
    press('0');

    expect(columnOrder()).toEqual(['sidebar', 'canvas', 'detail']);
    expect(stored().paneVisibility.order ?? DEFAULT_ORDER).toEqual([...DEFAULT_ORDER]);
    // `z0` has always restored the DEFAULT widths as well as the shipped
    // columns — one idea, not two, per the `resetPanes` handler — so the widths
    // that come back are those, not the 300/420 this test stored. The property
    // that matters for a reordering layout is the one asserted above it: going
    // into the focus layout does not touch the stored widths, so `z0` is
    // restoring from an unchanged store rather than from one this layout wrote.
    expect(stored().panes).toEqual(DEFAULT_PANES);
    const detail = document.querySelector('[data-action-pane]') as HTMLElement | null;
    // What reaches the DOM is the render-time clamp of those defaults against
    // this window, which is the shipped layout's own arithmetic and not this
    // layout's business — so it is asked for rather than hard-coded.
    expect(Number.parseFloat(detail?.style.width ?? 'NaN')).toBe(
      layoutWidths(ALL_VISIBLE, DEFAULT_PANES, window.innerWidth).detail,
    );
  });

  it('is reachable by its own chord', () => {
    render(<Canvas model={MODEL} />);
    press('z');
    press('f');
    expect(columnOrder()).toEqual(['sidebar', 'detail', 'canvas']);
  });
});

describe('the layouts that shipped are unchanged', () => {
  it('keeps both subtractive layouts in the shipped order', () => {
    for (const name of ['noCanvas', 'responseOnly'] as const) {
      // Through the same accessor the app uses, so "no order named" and "the
      // shipped order" are pinned as the one thing they have to be.
      expect(layoutColumnOrder(LAYOUTS[name])).toEqual([...DEFAULT_ORDER]);
    }
  });

  it('still hides the canvas for noCanvas and the sidebar for responseOnly', () => {
    seed({ paneVisibility: LAYOUTS.noCanvas });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'detail']);
    cleanup();

    seed({ paneVisibility: LAYOUTS.responseOnly });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['detail']);
  });
});

describe('a payload written before the descriptor existed', () => {
  it('loads in the shipped order and leaves unrelated settings alone', () => {
    seed({
      theme: 'light',
      focusViewportShare: 0.9,
      panes: { sidebar: 300, detail: 420 },
      paneVisibility: { sidebar: true, canvas: true, detail: true },
    });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'canvas', 'detail']);
    press('z');
    press('f');
    expect(stored().theme).toBe('light');
    expect(stored().focusViewportShare).toBe(0.9);
    expect(stored().panes).toEqual({ sidebar: 300, detail: 420 });
  });
});

describe('the settings picker offers it', () => {
  it('lists the focus layout and applies it when picked', () => {
    render(<Canvas model={MODEL} />);
    press(',');
    const option = document.querySelector(
      '[data-layout-option="focusResponse"]',
    ) as HTMLElement | null;
    expect(option).not.toBeNull();
    fireEvent.click(option as HTMLElement);
    expect(columnOrder()).toEqual(['sidebar', 'detail', 'canvas']);
    expect(
      document.querySelector('[data-layout-option="focusResponse"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});

/**
 * A handle exists only where it moves something.
 *
 * The detail pane is resizable exactly while the canvas is the main column: it
 * is then a fixed pane with leftover room beside it, and its own edge is the
 * seam that moves it. In every other layout its width is DERIVED — from the
 * viewport, the sidebar and whatever the canvas reserves — so there is nothing
 * for a detail handle to drag, and the seam the operator can actually move is
 * the sidebar's. Drawing one anyway is what this branch shipped: a handle sat
 * on the wrong edge of the middle column and moved nothing at all, in the focus
 * layout and (since before this branch) in `noCanvas` too.
 */
const detailHandle = () => document.querySelector('[data-pane-resize-handle="detail"]');
const sidebarHandle = () => document.querySelector('[data-pane-resize-handle="sidebar"]');

describe('the detail pane has a handle only where one would move it', () => {
  it('draws it in the shipped layout, where the detail width is stored', () => {
    render(<Canvas model={MODEL} />);
    expect(detailHandle()).not.toBeNull();
    expect(sidebarHandle()).not.toBeNull();
  });

  it('omits it in the focus layout, and keeps the sidebar seam that does move', () => {
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    expect(detailHandle()).toBeNull();
    expect(sidebarHandle()).not.toBeNull();
  });

  it('omits it with the canvas hidden, where it was inert before this branch too', () => {
    seed({ paneVisibility: LAYOUTS.noCanvas });
    render(<Canvas model={MODEL} />);
    expect(detailHandle()).toBeNull();
    expect(sidebarHandle()).not.toBeNull();
  });

  it('omits it when the response is the only column left', () => {
    seed({ paneVisibility: LAYOUTS.responseOnly });
    render(<Canvas model={MODEL} />);
    expect(detailHandle()).toBeNull();
  });
});

/**
 * What a window too narrow for three fixed columns does.
 *
 * With the canvas demoted, none of the three columns flexes: the two panes have
 * floors and the strip is a constant, so below their sum (`FOCUS_MIN_VIEWPORT`,
 * 820) the layout cannot be drawn as asked. The decision, taken here rather
 * than left to whatever flexbox produces, is to DROP the strip — the column
 * already demoted to a glance — and render the layout as `noCanvas` until the
 * window is wide enough again. It is a render-time choice, so nothing is
 * stored and widening the window brings the strip back.
 */
describe('below the width three fixed columns need', () => {
  const realInnerWidth = window.innerWidth;
  afterEach(() => {
    window.innerWidth = realInnerWidth;
  });

  const paneWidth = (selector: string) =>
    Number.parseFloat(
      (document.querySelector(selector) as HTMLElement | null)?.style.width ?? 'NaN',
    );

  it('drops the strip and gives the two panes the whole window', () => {
    window.innerWidth = 800;
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'detail']);
    expect(paneWidth('[data-sidebar-pane]') + paneWidth('[data-action-pane]')).toBe(800);
  });

  it('keeps the strip at exactly the width it needs', () => {
    window.innerWidth = FOCUS_MIN_VIEWPORT;
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'detail', 'canvas']);
    expect(paneWidth('[data-sidebar-pane]') + paneWidth('[data-action-pane]')).toBe(
      FOCUS_MIN_VIEWPORT - CANVAS_STRIP,
    );
  });

  it('brings the strip back when the window widens again, without having stored anything', () => {
    window.innerWidth = 800;
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    expect(columnOrder()).toEqual(['sidebar', 'detail']);
    act(() => {
      window.innerWidth = 1200;
      window.dispatchEvent(new Event('resize'));
    });
    expect(columnOrder()).toEqual(['sidebar', 'detail', 'canvas']);
    expect(stored().paneVisibility.canvas).toBe(true);
  });
});

/**
 * The strip narrows what is DRAWN, never what the model holds.
 *
 * That is this branch's own rule, and `j`/`k`, `Cmd+number`, `gg`/`G`, search
 * and the palette all honour it by resolving through the unfiltered set.
 * `h`/`l` read ReactFlow's live nodes, which in the strip ARE the filter — so
 * walking right off the focused session's own chain answered "nothing lies
 * right" instead of arriving at the next cell.
 */
describe('h and l reach the whole model from inside the strip', () => {
  it('walks out of the focused cell into the session beside it', () => {
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    expect(drawnSessions()).toEqual(['a1']);
    press('l');
    press('l');
    expect(drawnSessions()).toEqual(['a2']);
  });

  it('and back again, so the strip is not a one-way door', () => {
    seed({ paneVisibility: LAYOUTS.focusResponse });
    render(<Canvas model={MODEL} />);
    press('l');
    press('l');
    // Asserted mid-walk: without it a test that never left a1 would pass by
    // standing still, which is exactly the behaviour it exists to exclude.
    expect(drawnSessions()).toEqual(['a2']);
    press('h');
    press('h');
    expect(drawnSessions()).toEqual(['a1']);
  });
});
