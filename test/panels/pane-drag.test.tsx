// @vitest-environment happy-dom

/**
 * `usePointerDrag` — the gesture BOTH resize handles are built on, tested
 * where it lives rather than through either of them.
 *
 * Written because a mutation survived: deleting the "a move that followed no
 * down reports nothing" guard changed nothing visible through `SplitResizer`,
 * whose own arithmetic happens to refuse a null measurement anyway. A shared
 * contract that only one caller's accident enforces is not enforced — the
 * next caller inherits the hole. So the contract is asserted here, against a
 * caller with no defences of its own.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePointerDrag } from '../../src/renderer/panels/pane-drag.js';

afterEach(() => {
  cleanup();
});

function Harness(props: {
  readonly axis: 'x' | 'y';
  readonly onStart: () => string;
  readonly onMove: (start: string, delta: number) => void;
  readonly onEnd: (start: string, delta: number) => void;
}) {
  const { dragging, handlers } = usePointerDrag<HTMLButtonElement, string>({
    axis: props.axis,
    onStart: props.onStart,
    onMove: props.onMove,
    onEnd: props.onEnd,
  });
  return (
    <button type="button" data-dragging={dragging ? 'yes' : 'no'} {...handlers}>
      handle
    </button>
  );
}

function mount(axis: 'x' | 'y' = 'x') {
  const onStart = vi.fn(() => 'measured-once');
  const onMove = vi.fn();
  const onEnd = vi.fn();
  render(<Harness axis={axis} onStart={onStart} onMove={onMove} onEnd={onEnd} />);
  const handle = screen.getByRole('button');
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  return { handle, onStart, onMove, onEnd };
}

describe('usePointerDrag', () => {
  it('measures ONCE, at pointerdown, however many moves follow', () => {
    const { handle, onStart, onMove } = mount();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 140, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 190, clientY: 0 });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls).toEqual([
      ['measured-once', 40],
      ['measured-once', 90],
    ]);
  });

  /**
   * THE MUTATION THAT SURVIVED THROUGH `SplitResizer`. Pointer capture can
   * deliver a move or an up that this handle never saw the start of, and a
   * resize aimed from an origin that was never recorded is a pane jumping to
   * wherever the pointer happened to be.
   */
  it('reports nothing for a move or an up that followed no down', () => {
    const { handle, onMove, onEnd } = mount();
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500, clientY: 500 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500, clientY: 500 });
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(handle.releasePointerCapture).not.toHaveBeenCalled();
  });

  it('reports nothing for a SECOND up after the gesture has already ended', () => {
    const { handle, onEnd } = mount();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 0 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 160, clientY: 0 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 900, clientY: 0 });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith('measured-once', 60);
  });

  it('measures travel from the ORIGIN, not from the last move', () => {
    const { handle, onEnd } = mount();
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150, clientY: 0 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 220, clientY: 0 });
    expect(onEnd).toHaveBeenCalledWith('measured-once', 120);
  });

  it('reads the axis it was given, and only that one', () => {
    const { handle, onMove } = mount('y');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 10, clientY: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 9999, clientY: 260 });
    expect(onMove).toHaveBeenCalledWith('measured-once', -40);
  });

  it('says it is dragging only between the down and the up', () => {
    const { handle } = mount();
    expect(handle.dataset.dragging).toBe('no');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 0 });
    expect(handle.dataset.dragging).toBe('yes');
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100, clientY: 0 });
    expect(handle.dataset.dragging).toBe('no');
  });

  /** No document-wide overlay, ever — counted DURING the drag, because one
   *  torn down correctly would be invisible to a count taken afterwards. */
  it('puts nothing in the document while the gesture is held', () => {
    const { handle } = mount();
    const before = document.querySelectorAll('*').length;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200, clientY: 0 });
    expect(document.querySelectorAll('*').length).toBe(before);
  });
});
