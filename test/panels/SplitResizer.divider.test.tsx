// @vitest-environment happy-dom

/**
 * EC-45: the "pane divider" colour must paint between two panes AT REST, not
 * only while the 4px handle is hovered or dragged. A 1px seam child carries it,
 * on a divisible handle and on one that cannot divide (the panes still meet).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SplitResizer } from '../../src/renderer/panels/SplitResizer.js';

afterEach(cleanup);

function stubRect(element: Element, width: number, height: number) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 }),
  });
}

/** `extent` is each pane's size along the divided axis. */
function mount(orientation: 'row' | 'column', extent: number) {
  const tree = () => (
    <div data-split>
      <div data-slot="first">
        <SplitResizer
          splitId="sp"
          at={0}
          orientation={orientation}
          ariaLabel="resize panes 1 and 2"
          share={0.5}
          onResize={vi.fn()}
          onRefuse={vi.fn()}
        />
      </div>
      <div data-slot="second" />
    </div>
  );
  const { rerender } = render(tree());
  const first = document.querySelector('[data-slot="first"]') as HTMLElement;
  const second = document.querySelector('[data-slot="second"]') as HTMLElement;
  for (const slot of [first, second]) {
    if (orientation === 'row') {
      stubRect(slot, extent, 77);
    } else {
      stubRect(slot, 77, extent);
    }
  }
  // Re-run the layout effect against the stubbed rects.
  rerender(tree());
  const handle = screen.getByRole('separator');
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  return handle;
}

const seam = (handle: HTMLElement) => handle.querySelector<HTMLElement>('[data-pane-divider-seam]');

describe('the resting seam', () => {
  it('a row divider at rest holds a 1px pane-divider seam', () => {
    const handle = mount('row', 1000);
    expect(handle.getAttribute('data-split-resize-inert')).toBe('false');
    const s = seam(handle);
    expect(s).not.toBeNull();
    expect(s?.className).toContain('bg-pane-divider');
    expect(s?.className).toContain('w-px');
    expect(s?.getAttribute('aria-hidden')).toBe('true');
    // The handle itself stays transparent at rest and tints on hover.
    expect(handle.className).toContain('bg-transparent');
    expect(handle.className).toContain('hover:bg-pane-divider');
  });

  it('a column divider at rest holds a 1px pane-divider seam', () => {
    const s = seam(mount('column', 1000));
    expect(s).not.toBeNull();
    expect(s?.className).toContain('bg-pane-divider');
    expect(s?.className).toContain('h-px');
  });

  it('while dragging, bg-pane-divider still covers the handle', () => {
    const handle = mount('row', 1000);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600, clientY: 40 });
    expect(handle.className).toContain('bg-pane-divider');
    expect(handle.className).not.toContain('bg-transparent');
    expect(seam(handle)).not.toBeNull();
  });

  it.each(['row', 'column'] as const)(
    'a %s divider too narrow to divide keeps the seam, cursor-not-allowed and no hover tint',
    (orientation) => {
      const handle = mount(orientation, 254);
      expect(handle.getAttribute('data-split-resize-inert')).toBe('true');
      expect(handle.className).toContain('cursor-not-allowed');
      expect(handle.className).not.toContain('hover:bg-pane-divider');
      const s = seam(handle);
      expect(s).not.toBeNull();
      expect(s?.className).toContain('bg-pane-divider');
      expect(s?.className).toContain(orientation === 'row' ? 'w-px' : 'h-px');
    },
  );
});
