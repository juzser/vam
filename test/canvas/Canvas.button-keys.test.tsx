// @vitest-environment happy-dom

/**
 * A key aimed at a focused control belongs to the control.
 *
 * Audit F5: `ViewIcons`' own comment says "Enter and Space activate it", and
 * Enter did not — the window key handler resolves `Enter` as the `open`
 * chord and calls `preventDefault()`, which cancels the browser's activation
 * behaviour before the button ever sees it. Space survived only because no
 * chord is bound to it. The same swallow hit the tab strip's `×`: Space
 * closed the tab, Enter did nothing (audit F4).
 *
 * The rule this pins is deliberately about the TARGET, not about a list of
 * keys: if the keystroke landed on a button, the button's own activation
 * behaviour has first claim on it, exactly as the existing `typing` guard
 * already concedes every key to a focused text box. jsdom performs no
 * activation behaviour of its own, so what is measured here is the
 * mechanism — the event reaching the control unprevented; the browser guard
 * `e2e/tab-strip-shots.mjs` measures the outcome.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1'), session('a2')] },
  ],
};

/** Did the window grammar swallow this key on its way out of the control? */
function prevented(el: Element, key: string) {
  let seen: KeyboardEvent | null = null;
  const spy = (event: Event) => {
    seen = event as KeyboardEvent;
  };
  window.addEventListener('keydown', spy);
  act(() => {
    fireEvent.keyDown(el, { key, bubbles: true });
  });
  window.removeEventListener('keydown', spy);
  expect(seen, 'the key never reached the window listener').not.toBeNull();
  return (seen as unknown as KeyboardEvent).defaultPrevented;
}

afterEach(cleanup);

describe('the window grammar stands aside for a focused button', () => {
  it('lets Enter reach a view icon, which its own comment promises', () => {
    render(<Canvas model={MODEL} />);
    const icon = document.querySelector('[data-view-tabs] button') as HTMLElement;
    expect(icon).not.toBeNull();
    expect(prevented(icon, 'Enter')).toBe(false);
  });

  it('lets Enter reach a tab’s close control, not only Space', () => {
    render(<Canvas model={MODEL} />);
    const close = document.querySelector('[data-tab-close]') as HTMLElement;
    expect(close).not.toBeNull();
    expect(prevented(close, 'Enter')).toBe(false);
    expect(prevented(close, ' ')).toBe(false);
  });

  it('still owns the same key everywhere else on the canvas', () => {
    // The concession is to the CONTROL, not to the key: `Enter` outside a
    // button is still `open`, or the grammar would be handing away a chord
    // every time focus happened to rest somewhere harmless.
    render(<Canvas model={MODEL} />);
    const column = document.querySelector('[data-split-pane]') as HTMLElement;
    expect(column).not.toBeNull();
    expect(prevented(column, 'Enter')).toBe(true);
  });
});
