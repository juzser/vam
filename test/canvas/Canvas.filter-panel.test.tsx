// @vitest-environment happy-dom

/**
 * The filter pills (All / Running / Needs you / Done) moved out of the
 * topbar onto the canvas as an `@xyflow/react` `<Panel position="top-left">`
 * (roadmap item `vam-filter-on-canvas`). Pan/zoom invariance needs a real
 * layout engine and is proved separately by a Playwright spec
 * (`e2e/filter-panel.pw.ts`) — happy-dom has none. This file covers what a
 * DOM-only test CAN answer: the pills render inside ReactFlow's own
 * transform-free panel container rather than the topbar, and clicking one
 * still narrows the sidebar, exactly as it did before the move.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/domain/model.js';

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

/** Two waiting, one running, one done — "Needs you" narrows 4 rows to 2. */
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

const rows = () => [...document.querySelectorAll('[data-session-row]')];
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

describe('the status pills, relocated onto the canvas', () => {
  it('render inside ReactFlow’s Panel container, not the topbar', () => {
    render(<Canvas model={MODEL} />);
    const all = pill('all');
    expect(all).toBeTruthy();
    // `Panel` renders a `.react-flow__panel` div inside `.react-flow`, outside
    // the pan/zoom transform. A pill still living in the topbar's header row
    // would not be a descendant of that container.
    expect(all?.closest('.react-flow__panel')).toBeTruthy();
    expect(all?.closest('.react-flow')).toBeTruthy();
    expect(all?.closest('[class*="border-b"]')).toBeFalsy();
  });

  it('still narrows the sidebar when clicked — 4 rows, then 2 under "Needs you"', () => {
    render(<Canvas model={MODEL} />);
    expect(rows()).toHaveLength(4);

    const waitingPill = pill('waiting');
    expect(waitingPill).toBeTruthy();
    if (waitingPill) fireEvent.click(waitingPill);

    expect(rows()).toHaveLength(2);
  });
});
