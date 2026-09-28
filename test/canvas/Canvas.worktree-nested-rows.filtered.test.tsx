// @vitest-environment happy-dom

/**
 * S2: A NESTED WORKTREE ROW MUST DRAW FROM THE SAME FILTERED SET EVERY OTHER
 * ROW DOES.
 *
 * `WorktreesSection.tsx`'s own `renderRow` used to read a worktree's sessions
 * off `allEntries` -- `SessionList.tsx`'s UNFILTERED prop, forwarded from
 * `Canvas.tsx`'s own `allEntries` -- rather than `entries`, the set that has
 * already been through search, the status pills and the origin rules
 * (`SessionListProps.entries`'s own header: "Everything this component DRAWS
 * comes from `entries`"). Two concrete, user-visible symptoms of that:
 *
 *   - an ENDED session stayed nested and visible even with `hideEnded` on
 *     (the shipped default) -- the one rule this whole file's sibling,
 *     `Canvas.worktree-nested-rows.test.tsx`, never exercises (every session
 *     there is `done`, plain status, never `ended: true`); and
 *   - a session a live SEARCH does not match stayed nested and visible too.
 *
 * Both also suppressed "Start a session here": `worktreeSessions.length ===
 * 0` read false off the unfiltered count, so the button that exists
 * specifically for "this worktree has no LIVE session to look at" never
 * drew, even though nothing about the worktree was visibly live any more.
 *
 * Same harness as `Canvas.worktree-nested-rows.test.tsx`: a real `<Canvas
 * model=.../>`, `window.api.worktrees` stubbed, DOM queries for the truth --
 * this file only adds the ONE variable that sibling file holds constant
 * (every session there is `done`, nothing `ended`, no search ever entered).
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import type { WorktreeInfo } from '../../src/shared/worktree.js';

function decision(id: string, over: Partial<Decision> = {}): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [], ...over };
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [decision(`d-${id}`)],
    ...over,
  };
}

const CHILD_PROJECT_ID = 'claude-code:feat-00000000';

function worktree(over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    worktreeId: '/repo-worktrees/feat',
    path: '/repo-worktrees/feat',
    branch: 'feat',
    projectId: CHILD_PROJECT_ID,
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    detached: false,
    external: false,
    ...over,
  };
}

function installApi() {
  const list = vi.fn(async (projectId: string) => (projectId === 'p1' ? [worktree()] : []));
  (window as unknown as { api: unknown }).api = {
    worktrees: { list, create: vi.fn(), remove: vi.fn(), status: vi.fn().mockResolvedValue([]) },
    createSessionIn: vi.fn(),
  };
  return { list };
}

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

afterEach(() => {
  cleanup();
  (window as unknown as { api: unknown }).api = undefined;
  vi.restoreAllMocks();
  localStorage.clear();
});

function openFilter(): HTMLInputElement {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  });
  const input = document.querySelector<HTMLInputElement>('input[aria-label="filter sessions"]');
  if (input === null) throw new Error('filter input not found after opening the filter');
  return input;
}

describe('a nested worktree row draws from the filtered set, not the unfiltered one', () => {
  it('hides an ENDED nested session when hideEnded is on (the shipped default), and offers "Start a session here" instead', async () => {
    installApi();
    const model: CanvasModel = {
      projects: [
        { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] },
        {
          id: CHILD_PROJECT_ID,
          name: 'feat',
          source: 'claude-code',
          sessions: [session('c1', { ended: true, status: 'done' })],
        },
      ],
    };
    render(<Canvas model={model} />);

    await waitFor(() =>
      expect(document.querySelector('[data-worktree-row="/repo-worktrees/feat"]')).not.toBeNull(),
    );

    // The ended session must not draw as a nested row -- `hideEnded` is on
    // by default and this worktree's ONLY session is one it hides.
    expect(document.querySelector('[data-session-row="c1"]')).toBeNull();
    // And with nothing live left to look at, "Start a session here" is the
    // affordance that must draw in its place.
    expect(
      document.querySelector('[data-worktree-start-here="/repo-worktrees/feat"]'),
    ).not.toBeNull();
  });

  it('hides a nested session a live search does not match, while its parent project keeps matching', async () => {
    installApi();
    // The QUERY matches `p1` (project name "alpha", session title
    // "alpha-only-here") but neither `c1`'s title, id nor its own project
    // name ("feat") -- so `p1`'s own section keeps drawing (its own search
    // match survives) and this test actually exercises `WorktreesSection`'s
    // OWN nested-row filtering, rather than the whole section vanishing
    // because NEITHER session matched.
    const model: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('a1', { title: 'alpha-only-here' })],
        },
        {
          id: CHILD_PROJECT_ID,
          name: 'feat',
          source: 'claude-code',
          sessions: [session('c1', { title: 'unrelated child session' })],
        },
      ],
    };
    render(<Canvas model={model} />);
    await waitFor(() => expect(document.querySelector('[data-session-row="c1"]')).not.toBeNull());

    const input = openFilter();
    act(() => {
      fireEvent.change(input, { target: { value: 'alpha-only-here' } });
    });

    // The parent's own row survives the search -- proof the SECTION itself
    // is still drawing, so a still-nested `c1` below is not merely explained
    // by the whole project having vanished.
    await waitFor(() => expect(document.querySelector('[data-session-row="a1"]')).not.toBeNull());
    // The nested row must disappear along with every other search miss --
    // never left behind because `WorktreesSection` read a broader list.
    expect(document.querySelector('[data-session-row="c1"]')).toBeNull();
    // And "Start a session here" is what should draw in its place.
    await waitFor(() =>
      expect(
        document.querySelector('[data-worktree-start-here="/repo-worktrees/feat"]'),
      ).not.toBeNull(),
    );
  });
});
