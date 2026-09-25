// @vitest-environment happy-dom

/**
 * THE SIXTH FILTER ROW, end to end: Claude Code agent worktrees hidden by
 * default in the real sidebar, with the toggle that brings them back --
 * the operator's own report, "I see a worktree-agent showing when I press
 * New session. There should be a filter for it, hidden by default."
 *
 * `session-filter.agent-worktree.test.ts` already pins the predicate in
 * isolation, including why a `waiting` one is never actually hidden; this
 * file is the same proof `Canvas.filter-origin.test.tsx` gives its own two
 * toggles -- that the rule is really wired into the real component, not
 * merely defined.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'factory',
      sessions: [
        session('ordinary'),
        session('worktree-done', { isAgentWorktree: true }),
        session('worktree-waiting', { isAgentWorktree: true, status: 'waiting' }),
      ],
    },
  ],
};

const rowIds = () =>
  [...document.querySelectorAll('[data-session-row]')]
    .map((el) => el.getAttribute('data-session-row') ?? '')
    .sort();

const toggle = () =>
  document.querySelector<HTMLButtonElement>('[data-origin-toggle="agent-worktree"]');

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

describe('hiding a Claude Code agent worktree', () => {
  it('hides the done one by default, but keeps the ordinary and the waiting one', () => {
    render(<Canvas model={MODEL} />);
    expect(rowIds()).toEqual(['ordinary', 'worktree-waiting']);
  });

  it('brings the done one back when the toggle is turned off', () => {
    render(<Canvas model={MODEL} />);
    openMenu();
    const off = toggle();
    expect(off?.getAttribute('aria-checked')).toBe('true');
    if (off) fireEvent.click(off);

    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(rowIds()).toEqual(['ordinary', 'worktree-done', 'worktree-waiting']);
  });

  it('counts only what the rule actually holds back -- never the waiting one, which was never hidden', () => {
    render(<Canvas model={MODEL} />);
    openMenu();
    expect(toggle()?.textContent).toContain('1');
  });

  it('remembers the choice across a reload', () => {
    const first = render(<Canvas model={MODEL} />);
    openMenu();
    const off = toggle();
    if (off) fireEvent.click(off);
    first.unmount();

    render(<Canvas model={MODEL} />);
    openMenu();
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(rowIds()).toHaveLength(3);
  });
});
