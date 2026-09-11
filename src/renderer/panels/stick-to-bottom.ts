/**
 * Should the `out` region jump back to its newest line?
 *
 * The behaviour every log viewer has, and the reason it is a module of its own:
 * the DOM half of it is untestable here. happy-dom reports 0 for `scrollHeight`
 * and `clientHeight` on every element, so a test driving the effect would
 * assert the environment's zeroes rather than the rule. The rule lives here,
 * takes numbers, and is tested directly; the component below owns only the
 * wiring that reads those numbers off a real element.
 */

/** The three numbers a scroller reports, and nothing else. */
export type ScrollMetrics = {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
};

/**
 * How far off the bottom still counts as being at the bottom. Sub-pixel
 * layout, a fractional line height and a trackpad's momentum all leave a
 * scroller a pixel or two short of its own maximum, and treating that as "the
 * user scrolled away" would unstick the pane for someone who never touched it.
 */
export const BOTTOM_SLACK_PX = 24;

/** Is this scroller resting at (or within a hair of) its bottom? */
export function isAtBottom(m: ScrollMetrics, slack: number = BOTTOM_SLACK_PX): boolean {
  return m.scrollHeight - m.clientHeight - m.scrollTop <= slack;
}

/**
 * Whether to return to the bottom after something changed.
 *
 * `focusChanged` wins: a different session (or a different step) is a different
 * document, and carrying the previous one's scroll position into it would show
 * you the middle of something you have never read. Otherwise the user's own
 * position decides — stuck while they are at the bottom, left alone the moment
 * they scroll up, and stuck again as soon as they come back down.
 */
export function shouldStick(state: {
  readonly stuck: boolean;
  readonly focusChanged: boolean;
}): boolean {
  return state.focusChanged || state.stuck;
}

/**
 * Is there content above the viewport — i.e. would "to top" move anything?
 *
 * Same slack as the bottom rule, for the same reason: a scroller resting a
 * pixel or two off its own zero has nothing above it worth a control.
 */
export function hasContentAbove(m: ScrollMetrics, slack: number = BOTTOM_SLACK_PX): boolean {
  return m.scrollTop > slack;
}

/**
 * Is there content below the viewport — i.e. would "to bottom" move anything?
 *
 * Defined as the negation of `isAtBottom` on purpose: the control and the
 * stick rule must agree about where the bottom is, or the pane offers a jump
 * to a place it already considers itself to be.
 */
export function hasContentBelow(m: ScrollMetrics, slack: number = BOTTOM_SLACK_PX): boolean {
  return !isAtBottom(m, slack);
}

/**
 * WHERE `Mod-d` / `Mod-u` LAND: half a viewport from here, or `null` when the
 * scroller is already resting against that end.
 *
 * HALF THE SCROLLER'S OWN `clientHeight`, which is vim's rule read literally —
 * `Ctrl-D` scrolls half a WINDOW, and the window here is the column's visible
 * box. Not a line count (this column draws prose, not lines of one height),
 * not a fixed pixel figure (a pane can be dragged from its 320px floor to the
 * full width of the shell, and a constant would be a third of a screen in one
 * and three screens in the other), and not a proportion of the CONTENT, which
 * would make one press mean something different on a long session than on a
 * short one.
 *
 * CLAMPED, NOT REFUSED, WHEN IT WOULD OVERSHOOT. `Ctrl-D` two hundred pixels
 * from the end scrolls those two hundred pixels in vim too; refusing there
 * would leave the last half-screen of a transcript reachable only by the mouse.
 * The refusal is the OTHER case, and the two are worth keeping apart: `null`
 * means the scroller is already against that edge and nothing this key can do
 * will move it.
 *
 * `null` RATHER THAN "the offset it already had". A caller cannot tell a move
 * of zero from a move that did not happen, and this is precisely the key that
 * has to tell the operator which one it was — the house rule is that a control
 * which cannot act is withdrawn or says so, and a key cannot be withdrawn.
 *
 * THE EDGES ARE `hasContentAbove` / `hasContentBelow` and no new definition of
 * its own: those are what the floating jump controls are drawn off, so this key
 * refuses in exactly the states where the control beside it has withdrawn.
 */
export function halfPageTarget(m: ScrollMetrics, delta: 1 | -1): number | null {
  const canMove = delta === 1 ? hasContentBelow(m) : hasContentAbove(m);
  if (!canMove) {
    return null;
  }
  // At least one pixel: a pane half a pixel tall (mid-drag, mid-animation) must
  // not turn a press into a no-move that still reports having scrolled.
  const step = Math.max(1, m.clientHeight / 2);
  const furthest = Math.max(0, m.scrollHeight - m.clientHeight);
  return Math.min(furthest, Math.max(0, m.scrollTop + delta * step));
}
