/**
 * The 4px hit zone that makes a pane edge draggable.
 *
 * Invisible until hover (epic.md §3, closed by the operator): transparent at
 * rest, tinted `bg-line-loudest` on hover and while dragging, `cursor-col-resize`.
 * Rendered inside its own pane, absolutely positioned so it straddles the
 * existing 1px border — the caller sits it at `-right-[2px]` for the sidebar
 * or `-left-[2px]` for the detail pane.
 *
 * The drag is held entirely by `setPointerCapture`/`releasePointerCapture` on
 * this element. There is no document-wide overlay: an overlay that outlives
 * its drag would silently eat every click in the app, which is the exact
 * failure AC-3(d) exists to exclude.
 *
 * Native browser drag/text-select is suppressed with `select-none` plus
 * `preventDefault()` on pointerdown, not a `draggable` attribute — a JSX
 * `draggable={false}` here would trip the repo-wide drag/residue scan
 * (`test/canvas/topology-constraints.test.ts`) even though it is a disabling
 * form, because that scan only allows two exact spellings and this is not
 * one of them.
 */

import { useCallback, useRef, useState } from 'react';
import {
  DETAIL_MAX,
  DETAIL_MIN,
  type Layout,
  layoutWidths,
  type Pane,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from '../prefs/panes.js';

export type PaneResizerProps = {
  readonly pane: Pane;
  readonly ariaLabel: string;
  /**
   * The layout being dragged in, and both stored widths — not this pane's
   * rendered width and its sibling's.
   *
   * A drag is not "clamp this pane against a fixed sibling": in every layout
   * where the canvas is not the main column the sibling is DERIVED from this
   * pane, so a sibling held fixed for the drag is a sidebar that cannot move.
   * The resizer therefore proposes a stored width and asks `layoutWidths` what
   * that layout would render — the same call the canvas itself makes, so the
   * handle cannot disagree with the columns it is moving.
   */
  readonly layout: Layout;
  readonly stored: { readonly sidebar: number; readonly detail: number };
  readonly viewportWidth: number;
  /** Fired on every pointermove while dragging, with the arithmetic result. */
  readonly onChange: (pane: Pane, width: number) => void;
  /** Fired once, on pointerup, with the final width to persist. */
  readonly onCommit: (pane: Pane, width: number) => void;
};

const BOUNDS: Readonly<Record<Pane, { readonly min: number; readonly max: number }>> = {
  sidebar: { min: SIDEBAR_MIN, max: SIDEBAR_MAX },
  detail: { min: DETAIL_MIN, max: DETAIL_MAX },
};

const SIDE: Readonly<Record<Pane, string>> = {
  sidebar: '-right-[2px]',
  detail: '-left-[2px]',
};

export function PaneResizer(props: PaneResizerProps) {
  const { pane, ariaLabel, layout, stored, viewportWidth, onChange, onCommit } = props;
  const width = layoutWidths(layout, stored, viewportWidth)[pane];
  const bounds = BOUNDS[pane];
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const proposedWidth = useCallback(
    (clientX: number, startX: number, startWidth: number) => {
      const delta = clientX - startX;
      // The sidebar's handle sits on its right edge, so dragging right grows
      // it; the detail pane's handle sits on its left edge, so dragging left
      // (a negative delta) is what grows it.
      const raw = pane === 'sidebar' ? startWidth + delta : startWidth - delta;
      return layoutWidths(layout, { ...stored, [pane]: raw }, viewportWidth)[pane];
    },
    [pane, layout, stored, viewportWidth],
  );

  function onPointerDown(event: React.PointerEvent<HTMLHRElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: width };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLHRElement>) {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }
    onChange(pane, proposedWidth(event.clientX, drag.startX, drag.startWidth));
  }

  function onPointerUp(event: React.PointerEvent<HTMLHRElement>) {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    const next = proposedWidth(event.clientX, drag.startX, drag.startWidth);
    dragRef.current = null;
    setDragging(false);
    onCommit(pane, next);
  }

  return (
    // A native <hr> already carries the `separator` role, which is what
    // biome's a11y/useSemanticElements rule asks for in place of a bare
    // `role="separator"` div — Tailwind's preflight zeroes its default
    // margin/border, so nothing here overrides that visually.
    <hr
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(width)}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      tabIndex={0}
      data-pane-resize-handle={pane}
      className={[
        'absolute top-0 z-10 h-full w-1 select-none',
        SIDE[pane],
        'cursor-col-resize',
        dragging ? 'bg-line-loudest' : 'bg-transparent hover:bg-line-loudest',
      ].join(' ')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
