/**
 * HALF A VIEWPORT, IN NUMBERS — the arithmetic behind `Mod-d` / `Mod-u`.
 *
 * Vim's `Ctrl-D` / `Ctrl-U` scroll half a window; the operator asked for those
 * two keys and that is what they get. This file owns the part of it that is
 * arithmetic, and it lives beside `isAtBottom` for the reason that module's
 * own comment gives: happy-dom reports every scroll metric as 0, so a test
 * driving the DOM would be asserting the environment's zeroes rather than the
 * rule. The DOM half — which element gets scrolled, and what a real layout
 * makes of `clientHeight` — is `e2e/half-page-shots.mjs`, in a real browser.
 *
 * IT LIVES IN `stick-to-bottom.ts` because the two questions share an answer:
 * `hasContentAbove` / `isAtBottom` are where "the end" is defined, and the
 * floating jump controls are drawn off exactly those. A second definition of
 * the same edge is how a key comes to refuse while the control beside it
 * offers the move.
 *
 * THE ENDS ARE THE POINT. A key that cannot be withdrawn has to say when it
 * cannot act, so this function answers `null` rather than returning the offset
 * it was handed — "nothing happened" and "it moved by zero" are one value and
 * two different things to tell the operator, and the caller can only refuse
 * aloud if the two are told apart here.
 */

import { describe, expect, it } from 'vitest';
import {
  BOTTOM_SLACK_PX,
  halfPageTarget,
  hasContentAbove,
  isAtBottom,
} from '../../src/renderer/panels/stick-to-bottom.js';

/** A column three screens long, resting at its bottom. */
const AT_BOTTOM = { scrollTop: 1200, scrollHeight: 1800, clientHeight: 600 };
/** The same column, resting at its top. */
const AT_TOP = { scrollTop: 0, scrollHeight: 1800, clientHeight: 600 };

describe('halfPageTarget', () => {
  it('moves down by half the viewport it is given, not by a fixed number of pixels', () => {
    expect(halfPageTarget({ scrollTop: 0, scrollHeight: 1800, clientHeight: 600 }, 1)).toBe(300);
    expect(halfPageTarget({ scrollTop: 0, scrollHeight: 1800, clientHeight: 900 }, 1)).toBe(450);
  });

  it('moves up by the same half', () => {
    expect(halfPageTarget({ scrollTop: 900, scrollHeight: 1800, clientHeight: 600 }, -1)).toBe(600);
    expect(halfPageTarget({ scrollTop: 900, scrollHeight: 1800, clientHeight: 900 }, -1)).toBe(450);
  });

  it('lands exactly on the bottom rather than overshooting it', () => {
    // 1100 + 300 would be 1400, past the 1200 this column can reach. Vim
    // clamps here too: `Ctrl-D` near the end scrolls to the end.
    expect(halfPageTarget({ scrollTop: 1100, scrollHeight: 1800, clientHeight: 600 }, 1)).toBe(1200);
  });

  it('lands exactly on the top rather than undershooting it', () => {
    expect(halfPageTarget({ scrollTop: 100, scrollHeight: 1800, clientHeight: 600 }, -1)).toBe(0);
  });

  it('answers null at the bottom, so the caller can refuse aloud', () => {
    expect(halfPageTarget(AT_BOTTOM, 1)).toBeNull();
  });

  it('answers null at the top', () => {
    expect(halfPageTarget(AT_TOP, -1)).toBeNull();
  });

  it('still moves the other way from either end', () => {
    expect(halfPageTarget(AT_BOTTOM, -1)).toBe(900);
    expect(halfPageTarget(AT_TOP, 1)).toBe(300);
  });

  it('answers null in both directions when there is nothing to scroll', () => {
    const short = { scrollTop: 0, scrollHeight: 400, clientHeight: 600 };
    expect(halfPageTarget(short, 1)).toBeNull();
    expect(halfPageTarget(short, -1)).toBeNull();
  });

  /**
   * THE SAME EDGES THE JUMP CONTROLS USE, and that is not a detail. The
   * floating "to top" / "to bottom" jumps are drawn only while
   * `hasContentAbove` / `hasContentBelow` say there is something on their
   * side; a key that refused on a different definition of "the end" would
   * refuse while a control beside it offered the move, or move while the
   * control had withdrawn itself.
   */
  it('refuses within the same slack the jump controls are withdrawn in', () => {
    const nearBottom = { scrollTop: 1200 - BOTTOM_SLACK_PX, scrollHeight: 1800, clientHeight: 600 };
    expect(isAtBottom(nearBottom)).toBe(true);
    expect(halfPageTarget(nearBottom, 1)).toBeNull();

    const nearTop = { scrollTop: BOTTOM_SLACK_PX, scrollHeight: 1800, clientHeight: 600 };
    expect(hasContentAbove(nearTop)).toBe(false);
    expect(halfPageTarget(nearTop, -1)).toBeNull();
  });

  /**
   * A pane can be one pixel tall for a frame while a split is being dragged,
   * and a step of zero would be a key that reports having scrolled and did
   * not — the exact silence the `null` above exists to avoid.
   */
  it('never steps by zero in a viewport too small to halve', () => {
    expect(halfPageTarget({ scrollTop: 0, scrollHeight: 100, clientHeight: 1 }, 1)).toBe(1);
  });
});
