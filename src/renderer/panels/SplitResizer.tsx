/**
 * The drag handle on ONE divider of a split — the sibling of `PaneResizer`,
 * not a generalisation of it.
 *
 * WHY A SIBLING. `PaneResizer` is not specialised to the sidebar by accident:
 * its whole arithmetic is that vam draws exactly two columns whose widths are
 * DERIVED from one another, so it proposes a stored pixel width and asks
 * `layoutWidths` what would render (see its own note on why a sibling held
 * fixed for the drag is a sidebar that cannot move). A split has none of that
 * shape — N children, fractions rather than pixels, either axis, and the
 * clamp is against the neighbours' measured extents rather than against a
 * viewport. Parameterising `PaneResizer` over all of it would replace every
 * line that is not the gesture, and leave the sidebar's own bounds behind an
 * indirection that has exactly one other caller.
 *
 * What IS shared is the gesture, and it is shared as code rather than as
 * prose: both handles are built on `usePointerDrag` (`pane-drag.ts`), which
 * owns the pointer-capture discipline, the "no document overlay" rule and the
 * `preventDefault()`-not-`draggable` spelling. Those are the decisions that
 * were paid for; the arithmetic above them is not.
 *
 * MEASURED, NOT TOLD. The handle finds its pair through the DOM — its own
 * slot and the next one — instead of taking their pixel sizes as props. The
 * tree stores fractions and nothing above this knows what a fraction resolves
 * to in pixels, so a prop would mean `SplitLayout` measuring on every render
 * and handing down a number one frame stale. Reading the rects at pointerdown
 * (and at each key press) is the only measurement that is current at the
 * moment it is used.
 *
 * NO onChange/onCommit PAIR. `PaneResizer` has one because its final width is
 * WRITTEN to `localStorage`, so a write per animation frame had to be avoided.
 * A divider's position lives in the split tree, which is React state that is
 * already re-rendered per frame and is remembered per project in memory, so
 * there is nothing here that a commit phase would defer. One callback.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { canDivide, dividerShare, MIN_PANE_PX, type SplitOrientation } from '../canvas/split.js';
import { PANE_RESIZE_STEP } from '../prefs/panes.js';
import { usePointerDrag } from './pane-drag.js';

/** A Shift-held arrow moves further than a bare one — the WAI-ARIA APG slider
 *  pattern, and the same multiplier `PaneResizer` uses, so the two handles
 *  cannot drift into two answers for one gesture. */
const JUMP_MULTIPLIER = 4;

/** The pair this handle divides, as it is on screen right now: how big the
 *  leading pane is, and how big the two are together. `null` when there is no
 *  layout to read — an unmounted handle, or a split with nothing after it. */
type Pair = { readonly first: number; readonly pair: number };

function measurePair(handle: Element | null, orientation: SplitOrientation): Pair | null {
  const slot = handle?.parentElement ?? null;
  const next = slot?.nextElementSibling ?? null;
  if (slot === null || next === null) {
    return null;
  }
  const extent = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return orientation === 'row' ? rect.width : rect.height;
  };
  const first = extent(slot);
  return { first, pair: first + extent(next) };
}

export type SplitResizerProps = {
  /** The split whose divider this is, and which divider: the one between
   *  children `at` and `at + 1`. Handed straight back to `resizeSplit`. */
  readonly splitId: string;
  readonly at: number;
  /** The split's own axis: `row` panes sit side by side, so their divider is
   *  a VERTICAL line dragged sideways. */
  readonly orientation: SplitOrientation;
  readonly ariaLabel: string;
  /** Where the divider stands now — the leading pane's share of the pair.
   *  Read for `aria-valuenow` only; the drag measures its own pixels. */
  readonly share: number;
  readonly onResize: (splitId: string, at: number, share: number) => void;
  /**
   * Said OUT LOUD when the operator tries to move a divider that has nowhere
   * to go. Not an error channel: this is the only route by which "the panes
   * are already at their floor" reaches anyone, and it fires on the pointer
   * and the keyboard alike (see `refusal` below).
   */
  readonly onRefuse: (message: string) => void;
};

export function SplitResizer(props: SplitResizerProps) {
  const { splitId, at, orientation, ariaLabel, share, onResize, onRefuse } = props;
  const row = orientation === 'row';
  const ref = useRef<HTMLHRElement>(null);

  /**
   * The two extremes a drag can actually reach, for `aria-valuemin`/`max`.
   *
   * They are a function of the pair's pixel size, so they cannot be known
   * during a render — hence a layout effect, which runs after the browser has
   * laid the slots out. It re-measures on every render the tree causes, which
   * includes every frame of a drag and every window resize, and writes only
   * when the numbers actually changed, so it cannot loop. Before the first
   * measurement the honest answer is the widest range there is.
   */
  const [reach, setReach] = useState<{
    readonly min: number;
    readonly max: number;
    readonly divisible: boolean;
    readonly pair: number;
  }>({ min: 0, max: 100, divisible: true, pair: 0 });
  useLayoutEffect(() => {
    const measured = measurePair(ref.current, orientation);
    // A pair of zero is "not laid out yet", never "too narrow to divide" —
    // the state before the first paint, and every render of a hidden split.
    // Treating it as inert would draw every divider refusing on its first
    // frame, which is a lie told once per mount.
    if (measured === null || measured.pair <= 0) {
      return;
    }
    const min = Math.round(dividerShare(0, measured.pair, MIN_PANE_PX) * 100);
    const max = Math.round(dividerShare(measured.pair, measured.pair, MIN_PANE_PX) * 100);
    const divisible = canDivide(measured.pair, MIN_PANE_PX);
    setReach((current) =>
      current.min === min &&
      current.max === max &&
      current.divisible === divisible &&
      current.pair === measured.pair
        ? current
        : { min, max, divisible, pair: measured.pair },
    );
  });

  /**
   * ONE SENTENCE for the one state this handle cannot act in, built from the
   * measurement rather than written twice: the pointer route and the keyboard
   * route say exactly this, and the accessible name wears it, so a reader who
   * never grabs anything hears the same reason a click does.
   *
   * SHORT ENOUGH TO SURVIVE THE STATUS BAR, which truncates at
   * `STATUS_MAX_CHARS` (72) and hangs the remainder on a tooltip. A refusal
   * whose measurement is the part that gets cut off has explained nothing —
   * the first draft of this sentence was 74 characters and lost its own
   * number. `Canvas.split-resize.test.tsx` asserts the whole thing reaches
   * the bar intact.
   */
  function refusal(pair: number): string {
    return `this divider cannot move — a pane needs ${MIN_PANE_PX}px, these two share ${Math.round(pair)}px`;
  }

  /** One arithmetic for every route in: a pointer's travel and an arrow key's
   *  step are the same number of pixels added to the same measured origin,
   *  through the same clamp. Two routes to one action must not become two
   *  answers about where the divider lands. */
  function report(measured: Pair | null, deltaPx: number) {
    // Deliberately NOT re-checking `canDivide` here. It was checked once, and
    // a mutation proved the second check dead: both routes into this function
    // refuse before they reach it, and a drag is handed the pair measured at
    // pointerdown, so a pair that cannot divide cannot arrive. A guard that
    // survives having its subject reverted is worse than none — this file
    // deletes such branches rather than keeping them as reassurance (the rule
    // `prefs/panes.ts` records for its own dead reservation math).
    if (measured === null) {
      return;
    }
    onResize(splitId, at, dividerShare(measured.first + deltaPx, measured.pair, MIN_PANE_PX));
  }

  /**
   * True when the attempt was refused (and said so), so the caller stops.
   *
   * THE ONLY PLACE the refusal is decided, and both routes go through it —
   * the pointer before any capture is taken, the keyboard before any step is
   * computed. Stopping here rather than downstream is also what keeps
   * `dividerShare`'s degenerate 0.5 from SNAPPING a 70/30 pair to even the
   * moment it is touched: an unasked-for change, and the loudest possible
   * version of the silence this state exists to end.
   */
  function refusedNow(measured: Pair | null): boolean {
    if (measured === null || canDivide(measured.pair, MIN_PANE_PX)) {
      return false;
    }
    onRefuse(refusal(measured.pair));
    return true;
  }

  const { dragging, handlers } = usePointerDrag<HTMLHRElement, Pair | null>({
    axis: row ? 'x' : 'y',
    onStart: (event) => measurePair(event.currentTarget, orientation),
    onMove: report,
    onEnd: report,
  });

  /**
   * The grab, or the refusal instead of one.
   *
   * Measured FRESH here rather than read off `reach`: the state exists to
   * shape the affordance a frame at a time, and what a gesture acts on has to
   * be the layout as it is at the moment of the gesture. The two agree in
   * practice; where they could not, the fresh one is the honest one.
   *
   * Refusing BEFORE `usePointerDrag` sees the event means no pointer capture
   * is taken at all — there is no gesture to hold, and a capture without one
   * is exactly the residue this whole handle is built to avoid.
   */
  function onPointerDown(event: React.PointerEvent<HTMLHRElement>) {
    const measured = measurePair(event.currentTarget, orientation);
    if (refusedNow(measured)) {
      event.preventDefault();
      return;
    }
    handlers.onPointerDown(event);
  }

  /**
   * The keyboard half of the slider contract this element claims. vam is
   * keyboard-first, and a handle that Tab reaches and no key answers is a trap
   * dressed as a control.
   *
   * The arrows that match the divider's OWN axis, because those are the only
   * two directions it can move; Home and End for the two extremes, per the
   * same APG pattern; Shift as the magnitude modifier. `PANE_RESIZE_STEP` is
   * the constant the sidebar handle and the `<`/`>` chords already share.
   *
   * NO NEW CHORD. Resizing a split is reachable from the keyboard by tabbing
   * to the divider, and this deliberately claims nothing at window level:
   * `chords.ts` is where vam's grammar lives, `z` already owns splits
   * (`zs`/`zv`/`zc`/`zw`/`z0`), and inventing a binding for it here would be
   * one file's opinion against the table that file does not own.
   *
   * Meta/Ctrl/Alt leave before the switch — none of them is this handle's key,
   * and the `preventDefault()` below is exactly what the window-level grammar
   * tests (`Canvas.tsx`: `if (event.defaultPrevented) return`) to know a
   * widget has claimed a key. Claiming a modified arrow would swallow it for
   * as long as focus sat here.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLHRElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const grow = row ? 'ArrowRight' : 'ArrowDown';
    const shrink = row ? 'ArrowLeft' : 'ArrowUp';
    const measured = () => measurePair(event.currentTarget, orientation);
    switch (event.key) {
      case grow:
      case shrink: {
        event.preventDefault();
        const pair = measured();
        if (refusedNow(pair)) {
          return;
        }
        const magnitude = PANE_RESIZE_STEP * (event.shiftKey ? JUMP_MULTIPLIER : 1);
        report(pair, event.key === grow ? magnitude : -magnitude);
        return;
      }
      case 'Home':
      case 'End': {
        event.preventDefault();
        const pair = measured();
        if (pair === null || refusedNow(pair)) {
          return;
        }
        // The extremes are where the PIXEL minimum stops the drag, not 0 and
        // 1: `dividerShare` clamps, so asking for beyond the end lands on the
        // end. Home shrinks the leading pane, End grows it — the reading
        // order of the axis, on both axes.
        report(pair, event.key === 'Home' ? -pair.pair : pair.pair);
        return;
      }
      default:
        return;
    }
  }

  return (
    // A native <hr> already carries the `separator` role, which is what
    // biome's a11y/useSemanticElements rule asks for in place of a bare
    // `role="separator"` div — the same element `PaneResizer` settled on.
    <hr
      ref={ref}
      aria-orientation={row ? 'vertical' : 'horizontal'}
      // The reason travels with the NAME, the way `NewTabButton` wears its
      // decline: a screen reader that never grabs anything still hears why
      // this one will not move.
      aria-label={reach.divisible ? ariaLabel : `${ariaLabel} — ${refusal(reach.pair)}`}
      aria-disabled={reach.divisible ? 'false' : 'true'}
      aria-valuenow={Math.round((Number.isFinite(share) ? share : 0.5) * 100)}
      aria-valuemin={reach.min}
      aria-valuemax={reach.max}
      tabIndex={0}
      data-split-resize-handle={`${splitId}:${at}`}
      data-split-resize-inert={reach.divisible ? 'false' : 'true'}
      className={[
        // Straddles the 1px `gap-px` seam `SplitLayout` draws between the
        // slots, the way the sidebar handle straddles its border.
        'absolute z-20 select-none',
        row ? 'top-0 h-full w-1 -right-[2px]' : 'left-0 w-full h-1 -bottom-[2px]',
        // The affordance IS the cursor and the hover tint. A divider that
        // cannot move keeps neither: one that went on promising a drag and
        // then did nothing is the failure this state exists to make legible.
        reach.divisible ? (row ? 'cursor-col-resize' : 'cursor-row-resize') : 'cursor-not-allowed',
        reach.divisible
          ? dragging
            ? 'bg-line-loudest'
            : 'bg-transparent hover:bg-line-loudest'
          : 'bg-transparent',
      ].join(' ')}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
    />
  );
}
