// @vitest-environment happy-dom

/**
 * UI1 SUPPRESSES A WORKTREE'S OWN TOP-LEVEL SECTION; THIS FILE PROVES THE
 * NESTED ROW IT LEAVES BEHIND IS NOT A LESSER ROW.
 *
 * A second review of UI1's first cut found it wired the nested row as a
 * small standalone button -- reachable by click, but outside `rowRefs`, the
 * jump-label map (`Canvas.jump-labels.test.tsx`'s own subject) and the
 * context menu, so a session that used to answer `j`/`k`, a jump letter and
 * Enter stopped answering all three the moment its top-level row was
 * suppressed. vam is keyboard-first, so that was a regression, not a
 * follow-up.
 *
 * The fix, `SessionList.tsx`'s `renderSessionRow`: the SAME function draws a
 * top-level row and a nested one, so every property `Canvas.jump-labels
 * .test.tsx` already proves for a top-level row is either true here for the
 * identical reason (this IS that function), or -- for `j`/`k` and jump mode
 * specifically -- was NEVER actually broken, because `Canvas.tsx`'s own
 * walk over `entries` and its jump-label `Map` are both pure state, built
 * from `model`/`entries` directly and never from the DOM
 * (`worktrees.ts`/`WorktreesSection.tsx` never touch either). What COULD
 * break, and is what this file actually falsifies, is the VISIBLE half:
 * whether a row exists at all to receive the `data-row-cursor` highlight and
 * the `data-jump-label` badge once focus/a jump lands on a nested session.
 *
 * Same harness as `Canvas.jump-labels.test.tsx`: a real `<Canvas model=.../>`
 * a real `window.dispatchEvent(keydown)`, and DOM queries for the truth.
 * `window.api.worktrees` is stubbed here (that file needs none) because a
 * nested row exists only once `WorktreesSection` learns, from
 * `worktrees.list()`, that `feat`'s project is a worktree of `alpha`'s.
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [decision(`d-${id}`)],
    ...over,
  };
}

const CHILD_PROJECT_ID = 'claude-code:feat-00000000';

/** `alpha` (`p1`) is a live git repo with ONE session (`a1`) and ONE
 *  worktree, `feat`; `feat`'s own session (`c1`) lives under
 *  `CHILD_PROJECT_ID` -- the identity decision (`docs/design/worktrees.md`
 *  §4) means it can never share `p1`'s id. Every session `done`, the same
 *  trick `Canvas.jump-labels.test.tsx` uses, so status ranking cannot
 *  reorder them and the list is source order: a1, c1. */
const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] },
    { id: CHILD_PROJECT_ID, name: 'feat', source: 'claude-code', sessions: [session('c1')] },
  ],
};

function worktree(over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    worktreeId: '/repo-worktrees/feat',
    path: '/repo-worktrees/feat',
    branch: 'feat',
    projectId: CHILD_PROJECT_ID,
    locked: false,
    lockReason: null,
    prunable: false,
    ...over,
  };
}

function installApi() {
  const list = vi.fn(async (projectId: string) => (projectId === 'p1' ? [worktree()] : []));
  const create = vi.fn(async () =>
    worktree({
      worktreeId: '/repo-worktrees/feat2',
      path: '/repo-worktrees/feat2',
      branch: 'feat2',
      projectId: 'claude-code:feat2-00000000',
    }),
  );
  (window as unknown as { api: unknown }).api = {
    worktrees: { list, create, remove: vi.fn() },
    createSessionIn: vi.fn(),
  };
  return { list, create };
}

afterEach(() => {
  cleanup();
  (window as unknown as { api: unknown }).api = undefined;
  vi.restoreAllMocks();
});

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const badges = () => [...document.querySelectorAll('[data-jump-label]')];
const labelOn = (id: string) =>
  document
    .querySelector(`[data-session-row="${id}"] [data-jump-label]`)
    ?.getAttribute('data-jump-label') ?? null;
const focusedRow = () =>
  document
    .querySelector('[data-row-cursor]')
    ?.closest('[data-session-row]')
    ?.getAttribute('data-session-row') ?? null;

/** The nested row exists once `WorktreesSection`'s own fetch resolves. */
async function waitForNestedRow() {
  await waitFor(() => expect(document.querySelector('[data-session-row="c1"]')).not.toBeNull());
}

describe('a worktree session nested under "Worktrees" keeps the sidebar keyboard model', () => {
  it('j/k walks into and out of the nested row, in the same order as any other', async () => {
    installApi();
    render(<Canvas model={MODEL} />);
    await waitForNestedRow();
    expect(focusedRow()).toBe('a1');

    press('j');
    expect(focusedRow()).toBe('c1');

    press('k');
    expect(focusedRow()).toBe('a1');
  });

  it('a jump label reaches the nested row, read off the row exactly as Canvas.jump-labels.test.tsx does', async () => {
    installApi();
    render(<Canvas model={MODEL} />);
    await waitForNestedRow();

    press('f');
    expect([...badges()].length).toBeGreaterThan(0);
    const letter = labelOn('c1');
    expect(letter).not.toBeNull();

    press(letter as string);
    expect(focusedRow()).toBe('c1');
    expect(badges()).toHaveLength(0);
  });

  it("picking the nested row opens it -- the same onPick a top-level row's click already calls", async () => {
    installApi();
    render(<Canvas model={MODEL} />);
    await waitForNestedRow();
    expect(focusedRow()).toBe('a1');

    // The literal DOM effect a native Enter-press has on a focused `<button>`
    // is to fire its `click` handler -- `onSidebarPick`'s own header:
    // "every one of this function's callers already means 'look at this
    // session now'". There is no separate "open" step in this app's model
    // to press Enter INTO; focusing a row already is opening it.
    fireEvent.click(document.querySelector('[data-session-row="c1"]') as HTMLButtonElement);
    expect(focusedRow()).toBe('c1');
  });

  it('focus on the nested row survives the worktree list actually refreshing', async () => {
    const { list } = installApi();
    render(<Canvas model={MODEL} />);
    await waitForNestedRow();

    press('j');
    expect(focusedRow()).toBe('c1');

    // A REAL refresh: the "+" -> type a name -> Create round trip, which
    // is what makes `WorktreesSection`'s own `useWorktrees` call `list()`
    // again (`reload()`, its own header) -- not a synthetic re-render
    // standing in for one. The exact call COUNT is not the point (both
    // `useWorktrees` and `SessionList.tsx`'s own `useWorktreeParents` call
    // `list()` independently, so the baseline is already more than one) --
    // an INCREASE after Create is what proves a real refetch happened.
    const before = list.mock.calls.length;
    fireEvent.click(document.querySelector('[data-worktrees-add="p1"]') as HTMLButtonElement);
    const nameInput = await waitFor(() => {
      const el = document.querySelector('[data-worktrees-create-name]');
      if (el === null) throw new Error('create form not open yet');
      return el as HTMLInputElement;
    });
    fireEvent.change(nameInput, { target: { value: 'second-feat' } });
    await act(async () => {
      fireEvent.click(
        document.querySelector('[data-worktrees-create-submit]') as HTMLButtonElement,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));

    // The list refetched (a real network round trip in the real app); the
    // cursor is still on the same session, and its row still wears it.
    expect(focusedRow()).toBe('c1');
    await waitFor(() =>
      expect(document.querySelector('[data-session-row="c1"] [data-row-cursor]')).not.toBeNull(),
    );
  });
});
