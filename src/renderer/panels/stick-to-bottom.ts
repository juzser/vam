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
