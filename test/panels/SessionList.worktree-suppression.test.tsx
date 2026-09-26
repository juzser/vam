// @vitest-environment happy-dom

/**
 * UI1: a worktree's session used to ALSO draw its own top-level project
 * section -- `docs/design/worktrees.md`'s identity decision means it has
 * its own, different `Project.id`, so nothing upstream already knew it was
 * "really" a worktree of another visible project without asking
 * `window.api.worktrees.list`. `useWorktreeParents.ts` is that ask;
 * this file is the suppression it drives, exercised through the real
 * `SessionList` component (not the hook alone -- `useWorktreeParents.test.ts`
 * already covers the hook's own fetch/aggregate behaviour).
 *
 * `window.api` is stubbed directly on `window` (never through a prop --
 * `SessionList.tsx`'s own header now documents why it reads
 * `window.api?.worktrees` itself, the same self-contained deviation
 * `WorktreesSection.tsx` already established).
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIEW_OPTIONS } from '../../src/renderer/domain/selectors.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import type { WorktreeInfo } from '../../src/shared/worktree.js';
import { baseProps, makeProject, makeSession } from './session-list-props.js';

function worktree(over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    worktreeId: '/repo-worktrees/feat',
    path: '/repo-worktrees/feat',
    branch: 'feat',
    projectId: 'claude-code:feat-00000000',
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    detached: false,
    external: false,
    ...over,
  };
}

function installApi(list: (projectId: string) => Promise<readonly WorktreeInfo[]>) {
  (window as unknown as { api: unknown }).api = {
    worktrees: { list, create: vi.fn(), remove: vi.fn() },
    createSessionIn: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  (window as unknown as { api: unknown }).api = undefined;
  vi.restoreAllMocks();
});

/** The parent (`p1`, a git repo with one worktree, `feat`) and the child --
 *  a session in that worktree's OWN, differently-id'd project. */
function parentAndChild() {
  const parent = makeProject({ id: 'p1', name: 'parent' }, []);
  const child = makeProject({ id: 'claude-code:feat-00000000', name: 'feat' }, []);
  return [
    { project: parent, session: makeSession({ id: 's-parent', title: 'parent session' }) },
    { project: child, session: makeSession({ id: 's-child', title: 'child session' }) },
  ];
}

describe('SessionList — UI1: a worktree does not also draw its own top-level section', () => {
  it('suppresses the child project heading once its parent lists it as a worktree', async () => {
    installApi(async (projectId) => (projectId === 'p1' ? [worktree()] : []));
    const { container } = render(<SessionList {...baseProps(parentAndChild())} />);

    await waitFor(() =>
      expect(
        container.querySelector(
          '[data-project-heading][data-project-id="claude-code:feat-00000000"]',
        ),
      ).toBeNull(),
    );
    // The parent's own heading is untouched.
    expect(container.querySelector('[data-project-heading][data-project-id="p1"]')).not.toBeNull();
    // The child's session still draws its row -- through the exact same
    // `renderSessionRow` a top-level row uses (`data-session-row`, `rowRefs`,
    // jump labels, the context menu all still apply, per the review that
    // asked for this) -- but NESTED under the parent's "Worktrees" row
    // rather than in its own top-level `data-project-rows` section.
    await waitFor(() =>
      expect(
        container.querySelector('[data-worktrees-section="p1"] [data-session-row="s-child"]'),
      ).not.toBeNull(),
    );
    expect(container.querySelector('[data-project-rows="claude-code:feat-00000000"]')).toBeNull();
  });

  it('does NOT suppress the child when its parent is hidden -- a session must stay reachable', async () => {
    installApi(async (projectId) => (projectId === 'p1' ? [worktree()] : []));
    const { container } = render(
      <SessionList {...baseProps(parentAndChild())} hiddenProjects={['p1']} />,
    );

    // Give the worktree-parents fetch a turn to resolve before asserting a
    // negative -- otherwise this could pass for the wrong reason (nothing
    // resolved yet) rather than the right one (resolved, and still shown).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      container.querySelector(
        '[data-project-heading][data-project-id="claude-code:feat-00000000"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector('[data-session-row="s-child"]')).not.toBeNull();
  });

  it('does NOT suppress anything under `Group by: Status` -- no "Worktrees" row exists there to nest under', async () => {
    installApi(async (projectId) => (projectId === 'p1' ? [worktree()] : []));
    const { container } = render(
      <SessionList
        {...baseProps(parentAndChild())}
        viewOptions={{ ...DEFAULT_VIEW_OPTIONS, groupBy: 'status' }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-session-row="s-child"]')).not.toBeNull();
    expect(container.querySelector('[data-session-row="s-parent"]')).not.toBeNull();
  });

  it('does NOT suppress anything under `Group by: None`', async () => {
    installApi(async (projectId) => (projectId === 'p1' ? [worktree()] : []));
    const { container } = render(
      <SessionList
        {...baseProps(parentAndChild())}
        viewOptions={{ ...DEFAULT_VIEW_OPTIONS, groupBy: 'none' }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-session-row="s-child"]')).not.toBeNull();
    expect(container.querySelector('[data-session-row="s-parent"]')).not.toBeNull();
  });

  /**
   * SECOND GUARD, exercised end to end through the real component: a
   * cross-provider review found that a linked worktree's own project could
   * report the main checkout as one of ITS children, on top of the main
   * checkout correctly reporting the linked worktree as one of its own --
   * closing a two-node cycle with no unsuppressed ancestor to stop at, and
   * hiding BOTH project headings at once. `useWorktreeParents.test.ts`
   * already falsifies this at the hook level in isolation; this test proves
   * the same fallback holds once wired through `SessionList`'s own
   * `isSuppressedWorktreeChild`, the actual code path an operator's sidebar
   * runs.
   */
  it('a mutual (cyclic) parent assignment suppresses NEITHER project -- both fall back to top level', async () => {
    installApi(async (projectId) => {
      if (projectId === 'p1') return [worktree({ projectId: 'claude-code:feat-00000000' })];
      if (projectId === 'claude-code:feat-00000000') return [worktree({ projectId: 'p1' })];
      return [];
    });
    const { container } = render(<SessionList {...baseProps(parentAndChild())} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-project-heading][data-project-id="p1"]')).not.toBeNull();
    expect(
      container.querySelector(
        '[data-project-heading][data-project-id="claude-code:feat-00000000"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector('[data-session-row="s-parent"]')).not.toBeNull();
    expect(container.querySelector('[data-session-row="s-child"]')).not.toBeNull();
  });

  it('with no window.api at all, nothing is suppressed (browser/demo build, #486 unaffected)', async () => {
    const { container } = render(<SessionList {...baseProps(parentAndChild())} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-session-row="s-child"]')).not.toBeNull();
  });
});
