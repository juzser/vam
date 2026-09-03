// @vitest-environment happy-dom

/**
 * "Các session tạo từ agent, worktree sẽ không hiển thị" — as two toggles in
 * the filter popover, never as a silent rule.
 *
 * Three properties are pinned here and each one is a way the feature could
 * quietly lose work:
 *
 *  - A session vam has NOT classified stays visible, under either toggle.
 *  - Both toggles narrow the canvas as well as the sidebar, because `Canvas`
 *    builds its layout from the filtered model — one navigable set, three
 *    views (`Canvas.filter-reach.test.tsx` is the general form of this).
 *  - Each toggle says how many sessions it takes away, so turning one on is
 *    never a disappearance you have to notice for yourself.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session, SessionOrigin } from '../../src/renderer/domain/model.js';

function session(id: string, origin: SessionOrigin): Session {
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
    origin,
  };
}

/** One of each case the two rules can meet. */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [
        session('spoken', { startedBy: 'human', promptCount: 2 }),
        session('silent', { startedBy: 'human', promptCount: 0 }),
        session('made-by-agent', { startedBy: 'agent', promptCount: 0 }),
        session('unclassified', { startedBy: 'unknown', promptCount: null }),
      ],
    },
  ],
};

const rowIds = () =>
  [...document.querySelectorAll('[data-session-row]')]
    .map((el) => el.getAttribute('data-session-row') ?? '')
    .sort();

const drawnIds = () =>
  [...document.querySelectorAll('.react-flow__node')]
    .map((el) => el.getAttribute('data-id') ?? '')
    .filter((id) => id.startsWith('info:'))
    .map((id) => id.slice('info:'.length))
    .sort();

const toggle = (key: string) =>
  document.querySelector<HTMLButtonElement>(`[data-origin-toggle="${key}"]`);

function openMenu() {
  const button = document.querySelector<HTMLButtonElement>('[data-filter-toggle]');
  if (button) fireEvent.click(button);
}

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

describe('hiding sessions nobody sat down to', () => {
  it('hides the agent-made one by default, on the canvas as well as the list', () => {
    render(<Canvas model={MODEL} />);
    expect(rowIds()).toEqual(['silent', 'spoken', 'unclassified']);
    expect(drawnIds()).toEqual(['silent', 'spoken', 'unclassified']);
  });

  it('brings it back when the toggle is turned off', () => {
    render(<Canvas model={MODEL} />);
    openMenu();
    const agent = toggle('agent');
    expect(agent?.getAttribute('aria-pressed')).toBe('true');
    if (agent) fireEvent.click(agent);

    expect(toggle('agent')?.getAttribute('aria-pressed')).toBe('false');
    expect(rowIds()).toEqual(['made-by-agent', 'silent', 'spoken', 'unclassified']);
    expect(drawnIds()).toEqual(['made-by-agent', 'silent', 'spoken', 'unclassified']);
  });

  it('narrows to what you have prompted — but keeps the unclassified one', () => {
    render(<Canvas model={MODEL} />);
    openMenu();
    const prompted = toggle('prompted');
    expect(prompted?.getAttribute('aria-pressed')).toBe('false');
    if (prompted) fireEvent.click(prompted);

    // `silent` goes (counted, zero). `unclassified` stays (never counted) —
    // the whole point: an unchecked session is not a hidden one.
    expect(rowIds()).toEqual(['spoken', 'unclassified']);
    expect(drawnIds()).toEqual(['spoken', 'unclassified']);
  });

  it('says how many each toggle takes away, over the whole workspace', () => {
    render(<Canvas model={MODEL} />);
    openMenu();
    // One agent-made session; two with a counted zero (`silent` and the
    // agent-made one). Counted over everything, not over what survived, so
    // the number does not move when you click it.
    expect(toggle('agent')?.textContent).toContain('1');
    expect(toggle('prompted')?.textContent).toContain('2');
  });

  it('remembers both toggles across a reload', () => {
    const first = render(<Canvas model={MODEL} />);
    openMenu();
    const agent = toggle('agent');
    if (agent) fireEvent.click(agent);
    first.unmount();

    render(<Canvas model={MODEL} />);
    openMenu();
    expect(toggle('agent')?.getAttribute('aria-pressed')).toBe('false');
    expect(rowIds()).toHaveLength(4);
  });
});
