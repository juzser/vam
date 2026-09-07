// @vitest-environment happy-dom

/**
 * THE "AUTO-LAYOUT" CELL IS A STATUS, NOT A CONTROL.
 *
 * It used to be bordered and boxed exactly like the zoom/fit buttons beside
 * it, reading "auto-layout on" — a name plus a state, the shape of a toggle.
 * An operator pressed it expecting a rearrange. Nothing happened: it was a
 * `<span>` with no handler, and pressing it could never have done anything
 * observable, because `layoutCanvas` already recomputes positions from the
 * model on every render (`Canvas.tsx`'s own `initialNodes` effect) — there is
 * no drag, no pin, no stored position left to reconcile (2944843).
 *
 * This locks in the fix: the cell reads as a status (no button tag, no
 * `role="button"`, no pointer cursor) and its wording no longer implies an
 * "off" that cannot exist.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel } from '../../src/renderer/domain/model.js';

const MODEL: CanvasModel = { projects: [] };

const badge = () => document.querySelector('[data-auto-layout]') as HTMLElement;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

afterEach(() => cleanup());

describe('the auto-layout cell', () => {
  it('is not a button and carries no button role', () => {
    render(<Canvas model={MODEL} />);
    expect(badge().tagName).not.toBe('BUTTON');
    expect(badge().getAttribute('role')).not.toBe('button');
  });

  it('does not draw a pointer cursor: nothing here is pressable', () => {
    render(<Canvas model={MODEL} />);
    expect(badge().className).not.toMatch(/\bcursor-pointer\b/);
  });

  it('does not draw a bordered box: it should not look like the zoom/fit controls beside it', () => {
    render(<Canvas model={MODEL} />);
    expect(badge().className).not.toMatch(/\bborder\b/);
    expect(badge().className).not.toMatch(/\brounded-/);
  });

  it('does not word its state as a toggle currently "on"', () => {
    render(<Canvas model={MODEL} />);
    expect(badge().textContent).not.toMatch(/\bon\b/i);
  });

  it('names the invariant a click on it was really asking about', () => {
    render(<Canvas model={MODEL} />);
    // `Note` renders no visible text of its own until the tooltip opens, but
    // it stamps `data-note` on the trigger element it wraps — readable
    // without opening a portal.
    let node: HTMLElement | null = badge();
    let noted: string | null = null;
    while (node !== null) {
      const attr = node.getAttribute('data-note');
      if (attr !== null) {
        noted = attr;
        break;
      }
      node = node.parentElement;
    }
    expect(noted).toMatch(/cannot be dragged/i);
  });
});
