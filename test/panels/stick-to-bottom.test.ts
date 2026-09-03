/**
 * The `out` region's stick-to-bottom rule, tested where it is testable.
 *
 * The operator's request is "phần out scroll luôn xuống cuối" — the newest
 * output is the thing a decision is made from. The trap is the other half:
 * a viewer that yanks you back to the bottom while you are reading upwards is
 * worse than one that never scrolls at all. Both halves are decided here, on
 * plain numbers, because happy-dom reports every scroll metric as 0 and a test
 * driving the DOM effect would be asserting that instead.
 */

import { describe, expect, it } from 'vitest';
import {
  BOTTOM_SLACK_PX,
  isAtBottom,
  shouldStick,
} from '../../src/renderer/panels/stick-to-bottom.js';

describe('isAtBottom', () => {
  it('is true at the exact bottom and within the slack', () => {
    expect(isAtBottom({ scrollTop: 400, scrollHeight: 1000, clientHeight: 600 })).toBe(true);
    expect(
      isAtBottom({ scrollTop: 400 - BOTTOM_SLACK_PX, scrollHeight: 1000, clientHeight: 600 }),
    ).toBe(true);
  });

  it('is false once the user has scrolled a screenful up', () => {
    expect(isAtBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 600 })).toBe(false);
    expect(isAtBottom({ scrollTop: 200, scrollHeight: 1000, clientHeight: 600 })).toBe(false);
  });

  it('is true when there is nothing to scroll', () => {
    expect(isAtBottom({ scrollTop: 0, scrollHeight: 600, clientHeight: 600 })).toBe(true);
  });
});

describe('shouldStick', () => {
  it('pins when new output arrives and the reader is at the bottom', () => {
    expect(shouldStick({ stuck: true, focusChanged: false })).toBe(true);
  });

  it('leaves a reader who scrolled up exactly where they are', () => {
    expect(shouldStick({ stuck: false, focusChanged: false })).toBe(false);
  });

  it('sticks again on a focus change even for a reader who had scrolled up', () => {
    // A different session or step is a different document; inheriting the old
    // scroll position would open it half-read.
    expect(shouldStick({ stuck: false, focusChanged: true })).toBe(true);
  });

  it('stick agains once the reader returns to the bottom', () => {
    // The full loop the component runs: scrolled away, then back down.
    let stuck = isAtBottom({ scrollTop: 0, scrollHeight: 1000, clientHeight: 600 });
    expect(shouldStick({ stuck, focusChanged: false })).toBe(false);
    stuck = isAtBottom({ scrollTop: 400, scrollHeight: 1000, clientHeight: 600 });
    expect(shouldStick({ stuck, focusChanged: false })).toBe(true);
  });
});
