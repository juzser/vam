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

import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PaneResizer, type PaneResizerProps } from '../../src/renderer/panels/PaneResizer.js';
import {
  ALL_VISIBLE,
  PANE_RESIZE_STEP,
  type Pane,
  type PaneVisibility,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from '../../src/renderer/prefs/panes.js';

afterEach(cleanup);

function noop() {}

function renderHandle(
  pane: Pane,
  onCommit: PaneResizerProps['onCommit'],
  layout: PaneVisibility = ALL_VISIBLE,
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
      layout={ALL_VISIBLE}
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

  // A12.1: `pane="detail"` retired here, not rewritten. `layoutWidths`
  // (`panes.ts`) no longer reads `stored.detail` at all — the detail pane
  // fills everything to the sidebar's right, with no stored width of its
  // own to defend — so a proposed drag on this handle now commits the SAME
  // value (`viewport - sidebar`) whichever key or direction drove it. That
  // is dead behaviour to keep pinning: `Canvas.tsx` already stopped
  // mounting this handle for exactly this reason ("a handle that moves
  // nothing is worse than no handle"). `PaneResizer` itself stays generic
  // — `pane="detail"` still RENDERS with correct static attributes, still
  // covered by `PaneResizer.test.tsx`'s "renders a handle for both panes"
  // — only the behavioural claim retires.

  it('Shift+ArrowRight takes a larger jump than a bare ArrowRight', () => {
    const commits: number[] = [];
    const handle = renderHandle('sidebar', (_, w) => commits.push(w));
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(commits[0]).toBeGreaterThan(264 + PANE_RESIZE_STEP);
  });

  it('Home jumps to the pane minimum, End jumps to the pane maximum', () => {
    const commits: number[] = [];
    const handle = renderHandle('sidebar', (_, w) => commits.push(w));
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

/**
 * A modifier-carrying arrow belongs to whoever bound it, not to this handle.
 *
 * The keyboard grammar in `Canvas.tsx` reads `event.defaultPrevented` on the
 * window and returns early when it is set — that is how a sub-widget declines
 * a key without `stopPropagation`, so the keys it does NOT own remain the way
 * out of it. A handle that answers `Mod-Alt-Arrow` therefore does not merely
 * resize by mistake: it swallows the binding, silently, for as long as focus
 * sits on it.
 */
describe('PaneResizer declines keys it does not own', () => {
  const modified = [
    ['Cmd+Alt+ArrowLeft', { key: 'ArrowLeft', metaKey: true, altKey: true }],
    ['Ctrl+ArrowRight', { key: 'ArrowRight', ctrlKey: true }],
    ['Alt+ArrowLeft', { key: 'ArrowLeft', altKey: true }],
  ] as const;

  for (const [name, init] of modified) {
    it(`${name} neither resizes nor calls preventDefault`, () => {
      const commits: number[] = [];
      const handle = renderHandle('sidebar', (_, w) => commits.push(w));
      const event = createEvent.keyDown(handle, init);
      fireEvent(handle, event);
      expect(commits).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });
  }

  it('leaves the rendered width alone through the controlled loop', () => {
    render(<ControlledResizer />);
    const handle = screen.getByRole('separator', { name: 'resize sessions panel' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft', metaKey: true, altKey: true });
    expect(handle.getAttribute('aria-valuenow')).toBe('264');
  });

  it('still owns the bare and Shift-held arrows, and Home/End', () => {
    const commits: number[] = [];
    const handle = renderHandle('sidebar', (_, w) => commits.push(w));
    for (const init of [
      { key: 'ArrowRight' },
      { key: 'ArrowRight', shiftKey: true },
      { key: 'Home' },
      { key: 'End' },
    ]) {
      const event = createEvent.keyDown(handle, init);
      fireEvent(handle, event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(commits[0]).toBe(264 + PANE_RESIZE_STEP);
    expect(commits[1]).toBeGreaterThan(264 + PANE_RESIZE_STEP);
    expect(commits.slice(2)).toEqual([SIDEBAR_MIN, SIDEBAR_MAX]);
  });
});
