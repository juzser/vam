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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderedWidth } from '../../src/prefs/panes.js';
import { PaneResizer } from '../../src/panels/PaneResizer.js';

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
        width={264}
        otherRendered={408}
        viewportWidth={1400}
        onChange={noop}
        onCommit={noop}
      />,
    );
    render(
      <PaneResizer
        pane="detail"
        ariaLabel="resize detail panel"
        width={408}
        otherRendered={264}
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
        width={264}
        otherRendered={408}
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
        width={408}
        otherRendered={264}
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
        width={264}
        otherRendered={408}
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
