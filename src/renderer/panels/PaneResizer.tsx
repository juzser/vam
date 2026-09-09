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
 *
 * Both of those decisions now live in `usePointerDrag` (`pane-drag.ts`),
 * shared with `SplitResizer`, the handle on a split's own dividers. They are
 * shared as CODE and not as prose: two handles that had each written the
 * gesture out would be two places for an overlay to reappear in. What is NOT
 * shared is the arithmetic below, which is specific to a two-column layout
 * whose second width is derived from the first.
 */

import { useCallback } from 'react';
import {
  DETAIL_MAX,
  DETAIL_MIN,
  layoutWidths,
  PANE_RESIZE_STEP,
  type Pane,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from '../prefs/panes.js';
import { usePointerDrag } from './pane-drag.js';

/** A Shift-held arrow press moves further than a bare one — the standard
 *  slider pattern (WAI-ARIA APG "Slider"), sized against the same step the
 *  bare press uses rather than an unrelated constant. */
const JUMP_MULTIPLIER = 4;

export type PaneResizerProps = {
  readonly pane: Pane;
  readonly ariaLabel: string;
  /**
   * Both stored widths — not this pane's rendered width and its sibling's.
   *
   * A drag is not "clamp this pane against a fixed sibling": the detail pane
   * is DERIVED from the sidebar, so a sibling held fixed for the drag is a
   * sidebar that cannot move. The resizer therefore proposes a stored width
   * and asks `layoutWidths` what would render — the same call the shell
   * itself makes, so the handle cannot disagree with the columns it moves.
   */
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
  const { pane, ariaLabel, stored, viewportWidth, onChange, onCommit } = props;
  const width = layoutWidths(stored, viewportWidth)[pane];
  const bounds = BOUNDS[pane];

  const proposedWidth = useCallback(
    (clientX: number, startX: number, startWidth: number) => {
      const delta = clientX - startX;
      // The sidebar's handle sits on its right edge, so dragging right grows
      // it; the detail pane's handle sits on its left edge, so dragging left
      // (a negative delta) is what grows it.
      const raw = pane === 'sidebar' ? startWidth + delta : startWidth - delta;
      return layoutWidths({ ...stored, [pane]: raw }, viewportWidth)[pane];
    },
    [pane, stored, viewportWidth],
  );

  // The gesture is `usePointerDrag`'s; what it measures at pointerdown is this
  // handle's own rendered width, and every callback is handed that width plus
  // how far the pointer has travelled — the same two numbers `proposedWidth`
  // has always taken, now supplied by one shared gesture rather than by three
  // hand-written handlers.
  const { dragging, handlers } = usePointerDrag<HTMLHRElement, number>({
    axis: 'x',
    onStart: () => width,
    onMove: (startWidth, delta) => onChange(pane, proposedWidth(delta, 0, startWidth)),
    onEnd: (startWidth, delta) => onCommit(pane, proposedWidth(delta, 0, startWidth)),
  });

  /**
   * The keyboard half of the ARIA contract this element already claims —
   * `aria-orientation="vertical"` plus `aria-valuenow`/min/max is a slider,
   * and a slider that Tab reaches and answers no key is a trap dressed as a
   * control.
   *
   * Arrow keys, because the handle's own orientation is vertical (a vertical
   * line moved horizontally) — the WAI-ARIA APG slider pattern's horizontal
   * arrows for a control oriented this way. Home/End jump to the two
   * extremes, also per that pattern. Shift is the "larger jump" modifier;
   * nothing here invents a step size of its own; `proposedWidth` is the exact
   * function a drag already calls, fed a synthetic `clientX - startX` equal
   * to the arrow's delta so an arrow press is arithmetic-for-arithmetic the
   * same computation a mouse drag performs, through the identical
   * `layoutWidths` clamp. `PANE_RESIZE_STEP` is the same constant `<`/`>`
   * multiplies by delta in `Canvas.tsx` — one step size, not two keyboard
   * routes to the same action disagreeing about how far a press moves.
   *
   * A key press COMMITS immediately, with no drag-shaped `onChange` phase:
   * there is nothing transient to preview, so the width is persisted the way
   * `onPointerUp` persists a drag's final position.
   *
   * Meta/Ctrl/Alt leave before the switch, because none of them is this
   * handle's key: its bindings are the bare arrows plus Home/End, with Shift
   * as the magnitude modifier and nothing else. Matching a modified arrow
   * against an unmodified case would not just resize by mistake — the
   * `preventDefault()` below is exactly what the keyboard grammar's window
   * handler tests (`Canvas.tsx`, `if (event.defaultPrevented) return`), which
   * is the mechanism by which a widget declines what it does not own so the
   * event still reaches whoever does. Claiming those keys would swallow them
   * for as long as focus sits here.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLHRElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault();
        const magnitude = PANE_RESIZE_STEP * (event.shiftKey ? JUMP_MULTIPLIER : 1);
        const delta = event.key === 'ArrowRight' ? magnitude : -magnitude;
        onCommit(pane, proposedWidth(delta, 0, width));
        return;
      }
      case 'Home':
        event.preventDefault();
        onCommit(pane, layoutWidths({ ...stored, [pane]: bounds.min }, viewportWidth)[pane]);
        return;
      case 'End':
        event.preventDefault();
        onCommit(pane, layoutWidths({ ...stored, [pane]: bounds.max }, viewportWidth)[pane]);
        return;
      default:
        return;
    }
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
      onKeyDown={onKeyDown}
      {...handlers}
    />
  );
}
