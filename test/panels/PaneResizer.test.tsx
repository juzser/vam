// @vitest-environment happy-dom

/**
 * happy-dom has no layout engine: getBoundingClientRect returns zeros, there
 * is no hit testing, and Tailwind is not compiled during a vitest run, so
 * getComputedStyle cannot report a resolved `cursor`. This file therefore
 * asserts only what is real here: the handle's static attributes and
 * className tokens, and that a pointerdown/pointermove/pointerup sequence
 * calls the width callback with the arithmetic src/prefs/panes.ts exports.
 * Click-through and the computed cursor are task-4's, in a real browser.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { PaneResizer } from '../../src/renderer/panels/PaneResizer.js';
import {
  ALL_VISIBLE,
  DETAIL_MIN,
  LAYOUTS,
  type Layout,
  layoutWidths,
  renderedWidth,
  SIDEBAR_MAX,
} from '../../src/renderer/prefs/panes.js';
import {
  EMPTY_PREFS,
  readPrefs,
  type StorageLike,
  setPaneWidth,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

afterEach(() => {
  cleanup();
});

function noop() {}

describe('PaneResizer', () => {
  it('renders a handle for both panes with the required attributes', () => {
    render(
      <PaneResizer
        pane="sidebar"
        ariaLabel="resize sessions panel"
        layout={ALL_VISIBLE}
        stored={{ sidebar: 264, detail: 408 }}
        viewportWidth={1400}
        onChange={noop}
        onCommit={noop}
      />,
    );
    render(
      <PaneResizer
        pane="detail"
        ariaLabel="resize detail panel"
        layout={ALL_VISIBLE}
        stored={{ sidebar: 264, detail: 408 }}
        viewportWidth={1400}
        onChange={noop}
        onCommit={noop}
      />,
    );

    const sidebarHandle = screen.getByRole('separator', { name: 'resize sessions panel' });
    const detailHandle = screen.getByRole('separator', { name: 'resize detail panel' });

    expect(sidebarHandle.getAttribute('data-pane-resize-handle')).toBe('sidebar');
    expect(detailHandle.getAttribute('data-pane-resize-handle')).toBe('detail');
    expect(sidebarHandle.className).toMatch(/col-resize/);
    expect(sidebarHandle.className).toMatch(/line-loudest/);
    expect(detailHandle.className).toMatch(/col-resize/);
    expect(detailHandle.className).toMatch(/line-loudest/);
  });

  it('a pointerdown/pointermove/pointerup drag on the sidebar handle calls onChange and onCommit with panes.ts arithmetic', () => {
    const changes: number[] = [];
    const commits: number[] = [];

    render(
      <PaneResizer
        pane="sidebar"
        ariaLabel="resize sessions panel"
        layout={ALL_VISIBLE}
        stored={{ sidebar: 264, detail: 408 }}
        viewportWidth={1400}
        onChange={(_, w) => changes.push(w)}
        onCommit={(_, w) => commits.push(w)}
      />,
    );

    const handle = screen.getByRole('separator', { name: 'resize sessions panel' });
    Object.assign(handle, { setPointerCapture: noop, releasePointerCapture: noop });

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 140, pointerId: 1 });

    const expectedMove = renderedWidth('sidebar', 264 + 40, 408, 1400);
    expect(changes).toEqual([expectedMove]);

    fireEvent.pointerUp(handle, { clientX: 150, pointerId: 1 });

    const expectedEnd = renderedWidth('sidebar', 264 + 50, 408, 1400);
    expect(commits).toEqual([expectedEnd]);
  });

  it('a drag on the detail handle moves opposite the pointer (anchored on its left edge)', () => {
    const changes: number[] = [];

    render(
      <PaneResizer
        pane="detail"
        ariaLabel="resize detail panel"
        layout={ALL_VISIBLE}
        stored={{ sidebar: 264, detail: 408 }}
        viewportWidth={1400}
        onChange={(_, w) => changes.push(w)}
        onCommit={noop}
      />,
    );

    const handle = screen.getByRole('separator', { name: 'resize detail panel' });
    Object.assign(handle, { setPointerCapture: noop, releasePointerCapture: noop });

    fireEvent.pointerDown(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 160, pointerId: 1 });

    const expected = renderedWidth('detail', 408 + 40, 264, 1400);
    expect(changes).toEqual([expected]);
  });

  it('AC-3(d): no overlay element exists at rest or after a completed drag', () => {
    const { container } = render(
      <PaneResizer
        pane="sidebar"
        ariaLabel="resize sessions panel"
        layout={ALL_VISIBLE}
        stored={{ sidebar: 264, detail: 408 }}
        viewportWidth={1400}
        onChange={noop}
        onCommit={noop}
      />,
    );

    const countBefore = container.querySelectorAll('*').length;
    const handle = screen.getByRole('separator', { name: 'resize sessions panel' });
    Object.assign(handle, { setPointerCapture: noop, releasePointerCapture: noop });

    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 130, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 130, pointerId: 1 });

    const countAfter = container.querySelectorAll('*').length;
    expect(countAfter).toBe(countBefore);
    expect(container.querySelector('[data-pane-resize-overlay]')).toBeNull();
    expect(container.querySelector('[style*="position: fixed"]')).toBeNull();
  });
});

describe('PaneResizer source hygiene (AC-4)', () => {
  const NO_LITERAL_COLOUR = /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|oklch\(/;
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/renderer/panels/PaneResizer.tsx'),
    'utf8',
  );

  it('contains the literal tokens `line-loudest` and `col-resize`', () => {
    expect(source).toMatch(/line-loudest/);
    expect(source).toMatch(/col-resize/);
  });

  it('contains no literal colour', () => {
    expect(NO_LITERAL_COLOUR.test(source)).toBe(false);
  });

  it('non-vacuity: the same regex DOES match a fixture containing a literal hex', () => {
    expect(NO_LITERAL_COLOUR.test('background: #4a4a4a;')).toBe(true);
  });
});

describe('Canvas wiring (AC-2 integration — the real prefs.ts/panes.ts functions Canvas.tsx composes)', () => {
  function makeStorage(): { storage: StorageLike; setItemSpy: ReturnType<typeof vi.fn> } {
    const data = new Map<string, string>();
    const setItemSpy = vi.fn((key: string, value: string) => {
      data.set(key, value);
    });
    const storage: StorageLike = {
      getItem: (key) => data.get(key) ?? null,
      setItem: setItemSpy,
    };
    return { storage, setItemSpy };
  }

  it('an out-of-range stored width renders at MAX/MIN through renderedWidth, and reading it writes nothing', () => {
    const { storage, setItemSpy } = makeStorage();
    let prefs = { ...EMPTY_PREFS, panes: { sidebar: 1e9, detail: 0 } };
    writePrefs(storage, prefs);
    setItemSpy.mockClear();

    prefs = readPrefs(storage);
    expect(setItemSpy).not.toHaveBeenCalled();

    const sidebarRendered = renderedWidth('sidebar', prefs.panes.sidebar, prefs.panes.detail, 1400);
    const detailRendered = renderedWidth('detail', prefs.panes.detail, prefs.panes.sidebar, 1400);
    expect(sidebarRendered).toBe(SIDEBAR_MAX);
    expect(detailRendered).toBe(DETAIL_MIN);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('a simulated viewport change (wide -> 700 -> wide) writes nothing, byte-identical storage; one real drag-end write is exactly one call', () => {
    const { storage, setItemSpy } = makeStorage();
    let prefs = EMPTY_PREFS;
    writePrefs(storage, prefs);
    setItemSpy.mockClear();
    const before = storage.getItem('vam.prefs.v1');

    // Simulate re-render at a narrow, then wide, viewport: only renderedWidth
    // runs, never setPaneWidth/writePrefs.
    renderedWidth('sidebar', prefs.panes.sidebar, prefs.panes.detail, 700);
    renderedWidth('detail', prefs.panes.detail, prefs.panes.sidebar, 700);
    renderedWidth('sidebar', prefs.panes.sidebar, prefs.panes.detail, 1400);
    renderedWidth('detail', prefs.panes.detail, prefs.panes.sidebar, 1400);
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(storage.getItem('vam.prefs.v1')).toBe(before);

    // A real drag end: exactly one write.
    prefs = setPaneWidth(prefs, 'sidebar', 300);
    writePrefs(storage, prefs);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });
});

describe('DetailPanel active-pane signal survives with the handle mounted (AC-6 precondition)', () => {
  function detailPanelProps(active: boolean): DetailPanelProps {
    return {
      entry: null,
      decision: null,
      draft: '',
      onDraftChange: noop,
      onSubmit: noop,
      composing: false,
      onCompose: noop,
      onStopComposing: noop,
      active,
      actionIndex: 0,
      width: 408,
      resizeHandle: (
        <PaneResizer
          pane="detail"
          ariaLabel="resize detail panel"
          layout={ALL_VISIBLE}
          stored={{ sidebar: 264, detail: 408 }}
          viewportWidth={1400}
          onChange={noop}
          onCommit={noop}
        />
      ),
    };
  }

  it('carries border-l-2 and border-waiting when active, with the handle present', () => {
    const { container } = render(<DetailPanel {...detailPanelProps(true)} />);
    const aside = container.querySelector('[data-action-pane="active"]');
    expect(aside).not.toBeNull();
    expect(aside?.className).toMatch(/border-l-2/);
    expect(aside?.className).toMatch(/border-waiting/);
    expect(container.querySelector('[data-pane-resize-handle="detail"]')).not.toBeNull();
  });

  it('does not carry the active signal when idle', () => {
    const { container } = render(<DetailPanel {...detailPanelProps(false)} />);
    const aside = container.querySelector('[data-action-pane="idle"]');
    expect(aside?.className).not.toMatch(/border-l-2/);
  });
});

describe('PaneResizer defensive guards (branch coverage)', () => {
  it('a pointermove or pointerup with no prior pointerdown is a no-op', () => {
    const changes: number[] = [];
    const commits: number[] = [];

    render(
      <PaneResizer
        pane="sidebar"
        ariaLabel="resize sessions panel"
        layout={ALL_VISIBLE}
        stored={{ sidebar: 264, detail: 408 }}
        viewportWidth={1400}
        onChange={(_, w) => changes.push(w)}
        onCommit={(_, w) => commits.push(w)}
      />,
    );

    const handle = screen.getByRole('separator', { name: 'resize sessions panel' });
    Object.assign(handle, { setPointerCapture: noop, releasePointerCapture: noop });

    // No pointerdown preceded these — the drag ref is still null.
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 });

    expect(changes).toEqual([]);
    expect(commits).toEqual([]);
  });
});

/**
 * The seam between the resizer and the layout arithmetic.
 *
 * The ceiling a drag may reach has to reserve what the CURRENT layout reserves
 * for the canvas — `CANVAS_MIN` while the canvas is the main column, one strip
 * while it is demoted, nothing at all while it is hidden. A resizer that holds
 * its own opinion about that number over-constrains the sidebar and snaps it on
 * the first drag, which is what these assert did not happen.
 */
describe('a drag obeys the layout it is dragging in', () => {
  const STORED = { sidebar: 264, detail: 408 };

  function dragSidebar(layout: Layout, viewportWidth: number, by: number): number[] {
    cleanup();
    const changes: number[] = [];
    render(
      <PaneResizer
        pane="sidebar"
        ariaLabel="resize sessions panel"
        layout={layout}
        stored={STORED}
        viewportWidth={viewportWidth}
        onChange={(_, w) => changes.push(w)}
        onCommit={noop}
      />,
    );
    const handle = screen.getByRole('separator', { name: 'resize sessions panel' });
    Object.assign(handle, { setPointerCapture: noop, releasePointerCapture: noop });
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 100 + by, pointerId: 1 });
    return changes;
  }

  it('lets the sidebar grow in the focus layout instead of snapping it back', () => {
    // 1400 - DETAIL_MIN - CANVAS_STRIP = 780 is the real ceiling here, so a
    // 40px drag is nowhere near it and must simply arrive.
    expect(dragSidebar(LAYOUTS.focusResponse, 1400, 40)).toEqual([304]);
    // And all the way to SIDEBAR_MAX, which the strip's reserve still clears.
    expect(dragSidebar(LAYOUTS.focusResponse, 1400, 400)).toEqual([SIDEBAR_MAX]);
  });

  it('lets the sidebar grow with the canvas hidden, where nothing is reserved', () => {
    expect(dragSidebar(LAYOUTS.noCanvas, 1400, 40)).toEqual([304]);
  });

  it('still reserves the main canvas in the shipped layout', () => {
    expect(dragSidebar(ALL_VISIBLE, 1400, 40)).toEqual([
      layoutWidths(ALL_VISIBLE, { ...STORED, sidebar: 304 }, 1400).sidebar,
    ]);
  });
});
