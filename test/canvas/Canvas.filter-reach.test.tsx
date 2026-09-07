// @vitest-environment happy-dom

/**
 * One set, three views.
 *
 * `Canvas.tsx` used to open on "one focus, three views": the sidebar, the
 * canvas and the detail panel all read the same `focusedNodeId`. That rule was
 * only ever half kept. The canvas drew every session while the cursor was
 * restricted to whatever survived the filter, so a filtered canvas showed
 * cards `j`/`k` could not reach and the sidebar had no row for — visible, and
 * untouchable. That is what the operator reported as "some sessions do not
 * show up on the canvas and cannot be navigated to from the sidebar".
 *
 * 0.2 migration, step 2: the second view is gone, not merely untestable. The
 * canvas used to draw its OWN pass over the model, independent of the
 * sidebar's — that independence is exactly what let the two disagree. The tab
 * strip that replaced it draws no such pass: it shows open tabs, a curated
 * subset the operator built by hand, not a re-derivation of "everything the
 * filter left". There is no longer a second, independently-computed rendering
 * of the filtered set for the sidebar's own list to drift from, so the three
 * tests that compared `rowIds()` against a `drawnIds()` read off
 * `.react-flow__node` die with the thing they were comparing against, not
 * merely with the selector. What survives is the property that has nothing to
 * do with a second view: the pill counts stay put across a click, over the
 * whole workspace rather than what a filter has already narrowed to.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, status: Session['status']): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'factory',
      sessions: [
        session('a1', 'waiting'),
        session('a2', 'waiting'),
        session('a3', 'running'),
        session('a4', 'done'),
      ],
    },
  ],
};

/** The pills live in the sidebar's filter popover now, so every test that
 * clicks one opens it first. */
const openMenu = () => {
  const button = document.querySelector<HTMLButtonElement>('[data-filter-toggle]');
  if (button) fireEvent.click(button);
};

const pill = (key: string) =>
  document.querySelector<HTMLButtonElement>(`[data-status-pill="${key}"]`);

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
        get length() {
          return map.size;
        },
      };
    })() as unknown as Storage,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a card on the canvas is a card the cursor can reach', () => {
  it('leaves the pill counts on the whole workspace, not on what survived', () => {
    render(<Canvas model={MODEL} />);
    openMenu();
    const waiting = pill('waiting');
    if (waiting) fireEvent.click(waiting);
    // A count that moved when you clicked it would be a count of your own click.
    expect(pill('all')?.textContent).toContain('4');
    expect(pill('done')?.textContent).toContain('1');
  });
});
