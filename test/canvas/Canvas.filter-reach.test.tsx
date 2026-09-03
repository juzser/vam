// @vitest-environment happy-dom

/**
 * One set, three views.
 *
 * `Canvas.tsx` opens on "one focus, three views": the sidebar, the canvas and
 * the detail panel all read the same `focusedNodeId`. That rule was only ever
 * half kept. The canvas drew every session while the cursor was restricted to
 * whatever survived the filter, so a filtered canvas showed cards `j`/`k`
 * could not reach and the sidebar had no row for — visible, and untouchable.
 * That is what the operator reported as "some sessions do not show up on the
 * canvas and cannot be navigated to from the sidebar".
 *
 * The invariant this file pins is the other half: the three views agree on the
 * SET as well as on the cursor. What the canvas draws is exactly what the
 * sidebar lists, which is exactly what the cursor can land on.
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
      source: 'black-smith',
      sessions: [
        session('a1', 'waiting'),
        session('a2', 'waiting'),
        session('a3', 'running'),
        session('a4', 'done'),
      ],
    },
  ],
};

/** The session ids the sidebar lists. */
const rowIds = () =>
  [...document.querySelectorAll('[data-session-row]')].map(
    (el) => el.getAttribute('data-session-row') ?? '',
  );

/**
 * The session ids the canvas DRAWS, read off the info cards' node ids rather
 * than their text — a title is a label, an id is what the cursor moves over.
 */
const drawnIds = () =>
  [...document.querySelectorAll('.react-flow__node')]
    .map((el) => el.getAttribute('data-id') ?? '')
    .filter((id) => id.startsWith('info:'))
    .map((id) => id.slice('info:'.length));

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
  it('draws all four when nothing is filtered', () => {
    render(<Canvas model={MODEL} />);
    expect(drawnIds().sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(rowIds().sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('draws exactly the two the "Needs you" pill leaves navigable', () => {
    render(<Canvas model={MODEL} />);
    openMenu();
    const waiting = pill('waiting');
    if (waiting) fireEvent.click(waiting);

    expect(rowIds().sort()).toEqual(['a1', 'a2']);
    // The failing half before this fix: the canvas kept drawing a3 and a4,
    // which no keystroke and no sidebar row could then reach.
    expect(drawnIds().sort()).toEqual(['a1', 'a2']);
  });

  it('draws them all again when the filter is dropped', () => {
    render(<Canvas model={MODEL} />);
    openMenu();
    const waiting = pill('waiting');
    if (waiting) fireEvent.click(waiting);
    const all = pill('all');
    if (all) fireEvent.click(all);
    expect(drawnIds().sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

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
