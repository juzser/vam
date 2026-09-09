/**
 * The drag gesture both resize handles are built on, in ONE place.
 *
 * vam now has two of them — `PaneResizer` on the sidebar/detail boundary, and
 * `SplitResizer` on every divider inside a split — and they compute entirely
 * different things from a pointer. What they must NOT differ about is how the
 * pointer is held, because that is where the expensive mistakes live:
 *
 *   - the drag is held entirely by `setPointerCapture`/`releasePointerCapture`
 *     ON THE HANDLE ELEMENT. There is deliberately NO document-wide overlay:
 *     an overlay that outlives its drag silently eats every click in the app,
 *     which is the exact failure `PaneResizer`'s AC-3(d) exists to exclude.
 *     Nothing here touches `document`.
 *
 *   - native browser drag and text selection are suppressed with
 *     `preventDefault()` on pointerdown (plus `select-none` on the handle's
 *     own class list), never with a `draggable` attribute. That spelling was
 *     chosen against a repo-wide drag/residue scan and is kept for one
 *     vocabulary rather than two.
 *
 *   - a move or an up that did not follow a down on this handle reports
 *     NOTHING. Pointer capture can deliver events from before the gesture
 *     began, and a resize aimed from an origin that was never recorded is a
 *     pane jumping to wherever the mouse happened to be.
 *
 * `S` is whatever the handle measured when the gesture began — a width for
 * the sidebar, a pair of neighbouring extents for a split divider. It is
 * measured ONCE, at pointerdown, and handed back to every callback with how
 * far the pointer has travelled since, so neither handle re-measures a layout
 * that its own drag is changing underneath it.
 *
 * Nothing here is memoised, exactly as `PaneResizer`'s handlers never were:
 * these functions close over the caller's current props by construction, so
 * there is no dependency array to keep in step and no stale closure to find.
 *
 * THIS FILE HAS ITS OWN TESTS, AND THAT IS THE POINT. Deleting the
 * "a move that followed no down reports nothing" guard above was invisible
 * through `SplitResizer`, whose own arithmetic happens to refuse a null
 * measurement anyway — the mutation survived. A SHARED CONTRACT THAT ONLY ONE
 * CALLER'S ACCIDENT ENFORCES IS NOT ENFORCED: the next caller inherits the
 * hole, and nothing goes red when it does. Every rule this module claims is
 * asserted in `test/panels/pane-drag.test.tsx`, against a harness with no
 * defences of its own, and not through either handle.
 */

import { useRef, useState } from 'react';

export type PointerDragHandlers<E extends Element> = {
  readonly onPointerDown: (event: React.PointerEvent<E>) => void;
  readonly onPointerMove: (event: React.PointerEvent<E>) => void;
  readonly onPointerUp: (event: React.PointerEvent<E>) => void;
};

export type PointerDragOptions<E extends Element, S> = {
  /** Which coordinate the gesture reads: `x` for a vertical divider dragged
   *  sideways, `y` for a horizontal one dragged up and down. */
  readonly axis: 'x' | 'y';
  /** Measured once, at pointerdown, and handed to every callback below. */
  readonly onStart: (event: React.PointerEvent<E>) => S;
  /** Every move while the gesture is held. */
  readonly onMove: (start: S, delta: number) => void;
  /** Once, at pointerup, with the final travel. */
  readonly onEnd: (start: S, delta: number) => void;
};

export function usePointerDrag<E extends Element, S>(
  options: PointerDragOptions<E, S>,
): { readonly dragging: boolean; readonly handlers: PointerDragHandlers<E> } {
  const [dragging, setDragging] = useState(false);
  const held = useRef<{ readonly origin: number; readonly start: S } | null>(null);
  const coordinate = (event: React.PointerEvent<E>) =>
    options.axis === 'x' ? event.clientX : event.clientY;

  return {
    dragging,
    handlers: {
      onPointerDown(event) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        held.current = { origin: coordinate(event), start: options.onStart(event) };
        setDragging(true);
      },
      onPointerMove(event) {
        const drag = held.current;
        if (drag === null) {
          return;
        }
        options.onMove(drag.start, coordinate(event) - drag.origin);
      },
      onPointerUp(event) {
        const drag = held.current;
        if (drag === null) {
          return;
        }
        event.currentTarget.releasePointerCapture(event.pointerId);
        held.current = null;
        setDragging(false);
        options.onEnd(drag.start, coordinate(event) - drag.origin);
      },
    },
  };
}
