// @vitest-environment happy-dom

/**
 * The pane-resize handle is a keyboard trap: focusable (`tabIndex={0}`),
 * carrying slider/separator ARIA semantics with `aria-valuenow` /
 * `aria-valuemin` / `aria-valuemax`, but wired to pointer events only. Tab
 * reaches it and no key does anything — worse than a plain divider, because
 * it promises assistive tech an adjustable control and does not keep the
 * promise.
 *
 * This asserts the width actually changes on a real keydown dispatched at
 * the handle (not that a handler merely exists), and that `aria-valuenow`
 * follows the value it reports — through the same `onChange`/`onCommit`
 * plumbing `Canvas.tsx` wires to `setPaneWidth`/`savePrefs`, the identical
 * path `<`/`>` already uses (`PANE_RESIZE_STEP`, shared rather than
 * reinvented).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PaneResizer, type PaneResizerProps } from '../../src/renderer/panels/PaneResizer.js';
import {
  ALL_VISIBLE,
  LAYOUTS,
  type Layout,
  PANE_RESIZE_STEP,
  type Pane,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from '../../src/renderer/prefs/panes.js';

afterEach(cleanup);

function noop() {}

function renderHandle(
  pane: Pane,
  onCommit: PaneResizerProps['onCommit'],
  layout: Layout = ALL_VISIBLE,
) {
  const label = pane === 'sidebar' ? 'resize sessions panel' : 'resize detail panel';
  render(
    <PaneResizer
      pane={pane}
      ariaLabel={label}
      layout={layout}
      stored={{ sidebar: 264, detail: 408 }}
      viewportWidth={1400}
      onChange={noop}
      onCommit={onCommit}
    />,
  );
  return screen.getByRole('separator', { name: label });
}

/** A minimal stand-in for `Canvas.tsx`'s own `stored`/`onCommit` wiring, so
 *  an aria-valuenow assertion exercises the real controlled-prop loop rather
 *  than a mock that always reports the same width. */
function ControlledResizer() {
  const [sidebar, setSidebar] = useState(264);
  return (
    <PaneResizer
      pane="sidebar"
      ariaLabel="resize sessions panel"
      layout={LAYOUTS.focusResponse}
      stored={{ sidebar, detail: 408 }}
      viewportWidth={1400}
      onChange={noop}
      onCommit={(_, width) => setSidebar(width)}
    />
  );
}

describe('PaneResizer keyboard support', () => {
  it('ArrowRight widens and ArrowLeft narrows the sidebar handle, by PANE_RESIZE_STEP', () => {
    const commits: number[] = [];
    const handle = renderHandle('sidebar', (_, w) => commits.push(w));
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(commits).toEqual([264 + PANE_RESIZE_STEP, 264 - PANE_RESIZE_STEP]);
  });

  it('the detail handle grows towards ArrowLeft (anchored on its left edge, like the drag)', () => {
    const commits: number[] = [];
    const handle = renderHandle('detail', (_, w) => commits.push(w));
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(commits).toEqual([408 + PANE_RESIZE_STEP]);
  });

  it('Shift+ArrowRight takes a larger jump than a bare ArrowRight', () => {
    const commits: number[] = [];
    const handle = renderHandle('sidebar', (_, w) => commits.push(w), LAYOUTS.focusResponse);
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(commits[0]).toBeGreaterThan(264 + PANE_RESIZE_STEP);
  });

  it('Home jumps to the pane minimum, End jumps to the pane maximum', () => {
    const commits: number[] = [];
    const handle = renderHandle('sidebar', (_, w) => commits.push(w), LAYOUTS.focusResponse);
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'End' });
    expect(commits).toEqual([SIDEBAR_MIN, SIDEBAR_MAX]);
  });

  it('aria-valuenow follows the width once the caller applies the commit', () => {
    render(<ControlledResizer />);
    const handle = screen.getByRole('separator', { name: 'resize sessions panel' });
    expect(handle.getAttribute('aria-valuenow')).toBe('264');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe(String(264 + PANE_RESIZE_STEP));
  });

  it('an unhandled key is a no-op', () => {
    const commits: number[] = [];
    const handle = renderHandle('sidebar', (_, w) => commits.push(w));
    fireEvent.keyDown(handle, { key: 'a' });
    expect(commits).toEqual([]);
  });
});
