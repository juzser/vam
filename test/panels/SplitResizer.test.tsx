// @vitest-environment happy-dom

/**
 * The drag handle between two panes of a SPLIT.
 *
 * happy-dom has no layout engine: `getBoundingClientRect` returns zeros, so a
 * handle that measures its neighbours would measure nothing and every drag
 * here would land on `dividerShare`'s degenerate 0.5 — a suite that passes
 * whatever the arithmetic does. Every test below therefore STUBS the two
 * slots' rects with real numbers, which is the only way this environment can
 * say anything about a resize at all.
 *
 * What is still not testable here, and is covered by `e2e/split-panes-shots.
 * mjs` in a real browser instead: pointer capture actually holding the gesture
 * outside the element, the computed `cursor`, that the pane really changes
 * width, and that nothing is left behind eating clicks afterwards.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dividerShare, MIN_PANE_PX } from '../../src/renderer/canvas/split.js';
import { SplitResizer } from '../../src/renderer/panels/SplitResizer.js';
import { PANE_RESIZE_STEP } from '../../src/renderer/prefs/panes.js';

afterEach(() => {
  cleanup();
});

const FIRST = 1200;
const SECOND = 800;
const PAIR = FIRST + SECOND;

function stubRect(element: Element, width: number, height: number) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 }),
  });
}

/**
 * The two flex slots `SplitLayout` draws, with the handle inside the leading
 * one exactly as it is in the real render — the handle finds its pair through
 * `parentElement`/`nextElementSibling`, so a harness that nested it any
 * differently would be testing a component that does not exist.
 */
function mount(
  props: Partial<React.ComponentProps<typeof SplitResizer>> = {},
  /** A pair with no room for two minimums — the four-panes-on-a-laptop case. */
  extents: { readonly first: number; readonly second: number } = {
    first: FIRST,
    second: SECOND,
  },
): {
  onResize: ReturnType<typeof vi.fn>;
  onRefuse: ReturnType<typeof vi.fn>;
  handle: HTMLElement;
  remeasure: () => void;
} {
  const onResize = vi.fn();
  const onRefuse = vi.fn();
  const orientation = props.orientation ?? 'row';
  const tree = () => (
    <div data-split>
      <div data-slot="first">
        <SplitResizer
          splitId="sp"
          at={0}
          orientation={orientation}
          ariaLabel="resize panes 1 and 2"
          share={FIRST / PAIR}
          onResize={onResize}
          onRefuse={onRefuse}
          {...props}
        />
      </div>
      <div data-slot="second" />
    </div>
  );
  const { rerender } = render(tree());
  const first = document.querySelector('[data-slot="first"]') as HTMLElement;
  const second = document.querySelector('[data-slot="second"]') as HTMLElement;
  // A row divides side by side, so the extent that matters is width; a column
  // stacks, so it is height. The other axis is given the WRONG number on
  // purpose, so a handle reading the wrong one cannot accidentally agree.
  if (orientation === 'row') {
    stubRect(first, extents.first, 77);
    stubRect(second, extents.second, 77);
  } else {
    stubRect(first, 77, extents.first);
    stubRect(second, 77, extents.second);
  }
  const handle = screen.getByRole('separator', { name: 'resize panes 1 and 2' });
  // happy-dom implements neither, and React's synthetic pointer events do not
  // supply them: without these the handlers throw before any arithmetic runs.
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  // The layout effect that fills in `aria-valuemin`/`max` ran against the
  // zeroed rects happy-dom hands out before the stubs above existed. A render
  // with the stubs in place is what a real browser's first paint would have
  // given it — without this the two aria bounds read 50/50 and any assertion
  // about them would be measuring the stub-less state, not the component.
  // A FRESH element each time: React bails out of reconciling a subtree whose
  // element is reference-identical to the last one, so re-rendering the very
  // same object would not re-run the effect at all.
  return { onResize, onRefuse, handle, remeasure: () => rerender(tree()) };
}

describe('SplitResizer — what it is, before what it does', () => {
  it('is a separator carrying the slider contract, on the axis it divides', () => {
    const { handle } = mount();
    expect(handle.tagName).toBe('HR');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('data-split-resize-handle')).toBe('sp:0');
    expect(handle.tabIndex).toBe(0);
    expect(handle.className).toMatch(/cursor-col-resize/);
    expect(handle.className).toMatch(/select-none/);
    // Transparent at rest, tinted on hover — the sidebar handle's own rule.
    expect(handle.className).toMatch(/bg-transparent/);
    expect(handle.className).toMatch(/hover:bg-line-loudest/);
  });

  it('a column split’s divider is a HORIZONTAL line, dragged up and down', () => {
    const { handle } = mount({ orientation: 'column' });
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.className).toMatch(/cursor-row-resize/);
    expect(handle.className).not.toMatch(/cursor-col-resize/);
  });

  it('says where the divider stands, as a percentage of the pair', () => {
    const { handle } = mount();
    expect(handle.getAttribute('aria-valuenow')).toBe('60');
  });

  /**
   * The two bounds are the ones a drag can really reach, not a decorative
   * 0..100: at a 1000px pair with a 176px minimum a screen reader is told
   * 18..82, which is exactly where Home and End land.
   */
  it('reports the reach the pixel minimum actually leaves', () => {
    const { handle, remeasure } = mount();
    remeasure();
    expect(handle.getAttribute('aria-valuemin')).toBe(
      String(Math.round((MIN_PANE_PX / PAIR) * 100)),
    );
    expect(handle.getAttribute('aria-valuemax')).toBe(
      String(Math.round((1 - MIN_PANE_PX / PAIR) * 100)),
    );
  });

  /**
   * Native drag/text-select is suppressed with `select-none` plus
   * `preventDefault()` on pointerdown, never a `draggable` attribute — the
   * spelling `PaneResizer` established and recorded its reasons for.
   */
  it('carries no draggable attribute', () => {
    const { handle } = mount();
    expect(handle.hasAttribute('draggable')).toBe(false);
  });
});

/**
 * A DIVIDER WITH NOWHERE TO GO. Four panes side by side on a 1280px screen
 * leave 508px between any adjacent two, and two panes need `MIN_PANE_PX`
 * each: the divider cannot move by a single pixel from where it stands.
 *
 * "Absent, not dimmed" — a control that cannot act is withdrawn or refuses
 * audibly, never sits there looking draggable and doing nothing. The same
 * family as `pull-requests.ts`'s rule that "No PRs" and "vam could not ask"
 * must never look alike: a handle that accepts a grab and answers with
 * silence teaches the operator that resizing is broken.
 *
 * The affordance goes (no resize cursor, no hover tint, `aria-disabled`, the
 * reason in the accessible name) AND a real attempt says it out loud. Both,
 * because either alone leaves one of the two routes uninformed.
 */
describe('SplitResizer — a divider that cannot move at all', () => {
  const cramped = { first: 254, second: 254 };

  it('withdraws the affordance rather than promising a drag it cannot do', () => {
    const { handle, remeasure } = mount({}, cramped);
    remeasure();
    expect(handle.getAttribute('data-split-resize-inert')).toBe('true');
    expect(handle.getAttribute('aria-disabled')).toBe('true');
    expect(handle.className).toMatch(/cursor-not-allowed/);
    expect(handle.className).not.toMatch(/cursor-col-resize/);
    expect(handle.className).not.toMatch(/hover:bg-line-loudest/);
  });

  it('carries the reason in its accessible name, for a reader that never clicks', () => {
    const { handle, remeasure } = mount({}, cramped);
    remeasure();
    const name = handle.getAttribute('aria-label') ?? '';
    expect(name).toContain('resize panes 1 and 2');
    expect(name).toContain(String(MIN_PANE_PX));
    expect(name).toContain('508');
  });

  it('a pointer grab REFUSES ALOUD and starts no drag', () => {
    const { handle, onResize, onRefuse } = mount({}, cramped);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 254, clientY: 40 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500, clientY: 40 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500, clientY: 40 });
    expect(onResize).not.toHaveBeenCalled();
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(onRefuse.mock.calls[0]?.[0]).toContain(String(MIN_PANE_PX));
    // No capture taken: there is no gesture to hold.
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
  });

  it('an arrow key says the SAME sentence, and is not swallowed in silence', () => {
    const { handle, onResize, onRefuse } = mount({}, cramped);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 254, clientY: 40 });
    const fromPointer = onRefuse.mock.calls[0]?.[0];
    onRefuse.mockClear();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    handle.dispatchEvent(event);
    expect(onResize).not.toHaveBeenCalled();
    expect(onRefuse).toHaveBeenCalledTimes(1);
    // ONE sentence, not two that could drift: the keyboard route and the
    // pointer route are the same refusal or they are two different bugs.
    expect(onRefuse.mock.calls[0]?.[0]).toBe(fromPointer);
    // Claimed, so the window grammar does not also act on it.
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([['Home'], ['End'], ['ArrowLeft']])('%s refuses too — every key it owns', (key) => {
    const { handle, onResize, onRefuse } = mount({}, cramped);
    fireEvent.keyDown(handle, { key });
    expect(onResize).not.toHaveBeenCalled();
    expect(onRefuse).toHaveBeenCalledTimes(1);
  });

  it('a key it does NOT own stays silent — the refusal is not a catch-all', () => {
    const { handle, onRefuse } = mount({}, cramped);
    fireEvent.keyDown(handle, { key: 'a' });
    fireEvent.keyDown(handle, { key: 'ArrowRight', metaKey: true });
    expect(onRefuse).not.toHaveBeenCalled();
  });

  /**
   * THE NORMAL CASE STAYS QUIET. A divider that runs into the floor part-way
   * through a drag is ordinary and already correct; making that noisy would
   * turn every full-width drag into a refusal.
   */
  it('says nothing when a drag merely RUNS INTO the floor', () => {
    const { handle, onResize, onRefuse } = mount();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600, clientY: 40 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 9000, clientY: 40 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 9000, clientY: 40 });
    expect(onRefuse).not.toHaveBeenCalled();
    expect(PAIR * (onResize.mock.calls.at(-1)?.[2] as number)).toBeCloseTo(PAIR - MIN_PANE_PX, 6);
  });

  it('and an arrow key at the floor is silent for the same reason', () => {
    const { handle, onResize, onRefuse } = mount();
    fireEvent.keyDown(handle, { key: 'End' });
    fireEvent.keyDown(handle, { key: 'End' });
    expect(onRefuse).not.toHaveBeenCalled();
    expect(onResize).toHaveBeenCalledTimes(2);
  });

  it('a roomy divider is not marked inert', () => {
    const { handle, remeasure } = mount();
    remeasure();
    expect(handle.getAttribute('data-split-resize-inert')).toBe('false');
    expect(handle.getAttribute('aria-disabled')).toBe('false');
    expect(handle.className).toMatch(/cursor-col-resize/);
  });
});

describe('SplitResizer — the drag', () => {
  it('reports the pointer’s position as the leading pane’s share of the PAIR', () => {
    const { onResize, handle } = mount();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600, clientY: 40 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 750, clientY: 40 });
    expect(onResize).toHaveBeenCalledWith('sp', 0, dividerShare(FIRST + 150, PAIR, MIN_PANE_PX));
    // Written out, not derived: comparing against `dividerShare` of the same
    // inputs is a tautology, and 1350 of 2000 is what the pointer asked for.
    expect(onResize.mock.calls.at(-1)?.[2]).toBeCloseTo(0.675, 10);
  });

  it('reports again on pointerup, so a drag that ends off the last move still lands', () => {
    const { onResize, handle } = mount();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600, clientY: 40 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700, clientY: 40 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 820, clientY: 40 });
    expect(onResize.mock.calls.at(-1)).toEqual([
      'sp',
      0,
      dividerShare(FIRST + 220, PAIR, MIN_PANE_PX),
    ]);
  });

  it('a COLUMN divider reads the pointer’s Y, not its X', () => {
    const { onResize, handle } = mount({ orientation: 'column' });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 40, clientY: 600 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 999, clientY: 450 });
    // 150px UP from where it started, off the leading pane's own 1200px.
    expect(onResize.mock.calls.at(-1)?.[2]).toBeCloseTo((FIRST - 150) / PAIR, 10);
  });

  it('never drags the trailing pane below the pixel minimum', () => {
    const { onResize, handle } = mount();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600, clientY: 40 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 9000, clientY: 40 });
    const share = onResize.mock.calls.at(-1)?.[2] as number;
    expect(PAIR * (1 - share)).toBeCloseTo(MIN_PANE_PX, 6);
  });

  it('never drags the leading pane below it either', () => {
    const { onResize, handle } = mount();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600, clientY: 40 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -9000, clientY: 40 });
    expect(PAIR * (onResize.mock.calls.at(-1)?.[2] as number)).toBeCloseTo(MIN_PANE_PX, 6);
  });

  /**
   * The native browser drag and the text selection a drag across a pane would
   * otherwise start, suppressed the way `PaneResizer` established: by
   * cancelling the pointerdown, never by a `draggable` attribute.
   */
  it('cancels the pointerdown, which is what stops a native drag starting', () => {
    const { handle } = mount();
    const event = new PointerEvent('pointerdown', {
      pointerId: 1,
      clientX: 600,
      clientY: 40,
      bubbles: true,
      cancelable: true,
    });
    handle.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('holds the gesture with pointer capture on the handle, and releases it', () => {
    const { handle } = mount();
    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 600, clientY: 40 });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 600, clientY: 40 });
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  /**
   * AC-3(d)'s exclusion, restated for this handle: an overlay that outlives
   * its drag silently eats every click in the app. The gesture is held by
   * pointer capture alone, so nothing may be added to the document while it
   * runs — counted DURING the drag, because an overlay correctly torn down
   * would be invisible to a count taken afterwards.
   */
  it('adds nothing to the document while dragging — there is no overlay', () => {
    const { handle } = mount();
    const before = document.querySelectorAll('*').length;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600, clientY: 40 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700, clientY: 40 });
    expect(document.querySelectorAll('*').length).toBe(before);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 700, clientY: 40 });
    expect(document.querySelectorAll('*').length).toBe(before);
  });

  it('a move with no drag in progress reports nothing', () => {
    const { onResize, handle } = mount();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700, clientY: 40 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 700, clientY: 40 });
    expect(onResize).not.toHaveBeenCalled();
  });
});

describe('SplitResizer — the keyboard, because a mouse-only resize is half a feature', () => {
  it('an arrow moves the divider by exactly one PANE_RESIZE_STEP', () => {
    const { onResize, handle } = mount();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResize.mock.calls.at(-1)?.[2]).toBeCloseTo((FIRST + PANE_RESIZE_STEP) / PAIR, 10);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onResize.mock.calls.at(-1)?.[2]).toBeCloseTo((FIRST - PANE_RESIZE_STEP) / PAIR, 10);
  });

  it('Shift jumps four steps, the same multiplier the sidebar handle uses', () => {
    const { onResize, handle } = mount();
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(onResize.mock.calls.at(-1)?.[2]).toBeCloseTo((FIRST + PANE_RESIZE_STEP * 4) / PAIR, 10);
  });

  it('a COLUMN divider answers Up and Down, not Left and Right', () => {
    const { onResize, handle } = mount({ orientation: 'column' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onResize.mock.calls.at(-1)?.[2]).toBeCloseTo((FIRST + PANE_RESIZE_STEP) / PAIR, 10);
    onResize.mockClear();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResize).not.toHaveBeenCalled();
  });

  it('a ROW divider ignores Up and Down', () => {
    const { onResize, handle } = mount();
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onResize).not.toHaveBeenCalled();
  });

  it('Home and End go to the two extremes the pixel minimum allows', () => {
    const { onResize, handle } = mount();
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(PAIR * (onResize.mock.calls.at(-1)?.[2] as number)).toBeCloseTo(MIN_PANE_PX, 6);
    fireEvent.keyDown(handle, { key: 'End' });
    const share = onResize.mock.calls.at(-1)?.[2] as number;
    expect(PAIR * (1 - share)).toBeCloseTo(MIN_PANE_PX, 6);
  });

  /**
   * The mechanism by which a widget declines a key it does not own: leaving
   * `defaultPrevented` false is what the window-level chord grammar tests
   * (`Canvas.tsx`: `if (event.defaultPrevented) return`). Claiming `Mod-<arrow>`
   * here would swallow it for as long as focus sat on a divider.
   */
  it.each([['metaKey'], ['ctrlKey'], ['altKey']])('leaves a %s arrow to whoever owns it', (mod) => {
    const { onResize, handle } = mount();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
      [mod]: true,
    });
    handle.dispatchEvent(event);
    expect(onResize).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('claims the keys it DOES answer, so the grammar leaves them alone', () => {
    const { handle } = mount();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    handle.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a key that is none of its own', () => {
    const { onResize, handle } = mount();
    fireEvent.keyDown(handle, { key: 'a' });
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(onResize).not.toHaveBeenCalled();
  });
});
