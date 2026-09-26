// @vitest-environment happy-dom

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEntry } from '../../../src/renderer/domain/selectors.js';
import { WorktreesSection } from '../../../src/renderer/panels/worktrees/WorktreesSection.js';
import { setWorktreeTreeCollapsed } from '../../../src/renderer/panels/worktrees/worktree-tree-collapse.js';
import type { WorktreeInfo } from '../../../src/shared/worktree.js';
import { makeProject } from '../session-list-props.js';

/**
 * THE NEW "Show external worktrees" FILTER (phase 2b) -- the operator's own
 * report opening the blacksmith project (the maestro repo): a lot of
 * worktrees that are not vam's, or are locked, with no way to hide or fold
 * them. Split into its own file, the same way `Canvas.worktree-nested-rows
 * .test.tsx` already split its own concern out of the bigger Canvas suite --
 * `WorktreesSection.test.tsx` is large enough already, and this feature's
 * own tests (filter default, tree rendering, collapse persistence, polling
 * exclusion) are a self-contained group.
 */

function fakeRenderSessionRow(entry: SessionEntry) {
  return (
    <button type="button" data-session-row={entry.session.id} key={entry.session.id}>
      {entry.session.title}
    </button>
  );
}

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

const normalWorktree = worktree();
const externalWorktree = worktree({
  worktreeId: '/elsewhere/manual',
  path: '/elsewhere/manual',
  branch: 'manual',
  external: true,
});
const lockedVamWorktree = worktree({
  worktreeId: '/repo-worktrees/held',
  path: '/repo-worktrees/held',
  branch: 'held',
  locked: true,
  lockReason: 'in review',
  external: false,
});

function installApi(over: Partial<Record<string, unknown>> = {}) {
  const list = vi.fn().mockResolvedValue([]);
  const create = vi.fn().mockResolvedValue(worktree());
  const remove = vi.fn().mockResolvedValue({ preservedBranch: false });
  const status = vi.fn().mockResolvedValue([]);
  const createSessionIn = vi.fn().mockResolvedValue(undefined);
  const api = { worktrees: { list, create, remove, status }, createSessionIn, ...over };
  (window as unknown as { api: unknown }).api = api;
  return { list, create, remove, status, createSessionIn };
}

afterEach(() => {
  (window as unknown as { api: unknown }).api = undefined;
  vi.restoreAllMocks();
});

const project = makeProject({ id: 'claude-code:repo-11111111', name: 'repo' });

describe('WorktreesSection — the external/locked filter defaults to hidden', () => {
  it('hides an external worktree with no prop given at all (the shipped default)', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([normalWorktree, externalWorktree]) },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-row="/repo-worktrees/feat"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-worktree-row="/elsewhere/manual"]')).toBeNull();
  });

  it('hides a LOCKED worktree by default even when vam made it (not external)', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([normalWorktree, lockedVamWorktree]) },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-row="/repo-worktrees/feat"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-worktree-row="/repo-worktrees/held"]')).toBeNull();
  });

  it('names a quiet count next to "Worktrees" when something is hidden by this rule', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([normalWorktree, externalWorktree, lockedVamWorktree]),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktrees-external-hidden-count]')?.textContent).toBe(
        '2 hidden',
      ),
    );
  });

  it('names no count at all when nothing is hidden by this rule', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([normalWorktree]) },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-row="/repo-worktrees/feat"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-worktrees-external-hidden-count]')).toBeNull();
  });
});

describe('WorktreesSection — shown, as a compact nested tree', () => {
  it('draws external/locked rows nested, under their own group, once the toggle is off', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([normalWorktree, externalWorktree, lockedVamWorktree]),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideExternalWorktrees={false}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-row="/elsewhere/manual"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-worktree-row="/repo-worktrees/held"]')).not.toBeNull();
    const group = container.querySelector(`[data-worktrees-external-group="${project.id}"]`);
    expect(group).not.toBeNull();
    // BOTH external/locked rows live INSIDE that one group -- never mixed
    // into the plain list above it.
    expect(group?.querySelector('[data-worktree-row="/elsewhere/manual"]')).not.toBeNull();
    expect(group?.querySelector('[data-worktree-row="/repo-worktrees/held"]')).not.toBeNull();
    // The ordinary row is NEVER inside that group.
    expect(group?.querySelector('[data-worktree-row="/repo-worktrees/feat"]')).toBeNull();
  });

  it('collapses and expands on click, and remembers the fold per project', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([normalWorktree, externalWorktree]) },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideExternalWorktrees={false}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-row="/elsewhere/manual"]')).not.toBeNull(),
    );
    const toggle = container.querySelector(
      `[data-worktrees-external-toggle="${project.id}"]`,
    ) as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    act(() => {
      fireEvent.click(toggle);
    });
    expect(container.querySelector('[data-worktree-row="/elsewhere/manual"]')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('starts collapsed on a fresh mount if the operator folded it last time', async () => {
    setWorktreeTreeCollapsed(project.id, true);
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([normalWorktree, externalWorktree]) },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideExternalWorktrees={false}
      />,
    );
    await waitFor(() =>
      expect(
        container.querySelector(`[data-worktrees-external-toggle="${project.id}"]`),
      ).not.toBeNull(),
    );
    expect(container.querySelector('[data-worktree-row="/elsewhere/manual"]')).toBeNull();
  });

  /**
   * THE ACTUAL ROUND TRIP -- unlike the test above (which proves the READ
   * side alone, by calling `setWorktreeTreeCollapsed` directly), this one
   * clicks the real toggle, UNMOUNTS the component, and mounts a fresh one
   * -- proving the CLICK HANDLER ITSELF persists, not only that a value
   * `isWorktreeTreeCollapsed` already reads gets read correctly. Falsified
   * by hand: a click handler that only calls `setExternalCollapsed` (updates
   * the component's own state) and never `setWorktreeTreeCollapsed` (writes
   * to storage) leaves every assertion above this one green -- only THIS
   * test catches it.
   */
  it('a click on the toggle persists, and a remounted instance reads it back', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([normalWorktree, externalWorktree]) },
    });
    const first = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideExternalWorktrees={false}
      />,
    );
    await waitFor(() =>
      expect(
        first.container.querySelector('[data-worktree-row="/elsewhere/manual"]'),
      ).not.toBeNull(),
    );
    act(() => {
      fireEvent.click(
        first.container.querySelector(
          `[data-worktrees-external-toggle="${project.id}"]`,
        ) as Element,
      );
    });
    first.unmount();

    const second = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideExternalWorktrees={false}
      />,
    );
    await waitFor(() =>
      expect(
        second.container.querySelector(`[data-worktrees-external-toggle="${project.id}"]`),
      ).not.toBeNull(),
    );
    expect(second.container.querySelector('[data-worktree-row="/elsewhere/manual"]')).toBeNull();
  });
});

describe('WorktreesSection — the badge poll skips hidden/collapsed worktrees', () => {
  it('never asks status about a worktree the filter hides', async () => {
    const status = vi.fn().mockResolvedValue([]);
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([normalWorktree, externalWorktree]),
        status,
      },
    });
    render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    await waitFor(() => expect(status).toHaveBeenCalled());
    const ids =
      (status.mock.calls[0]?.[0] as { worktreeIds: readonly string[] } | undefined)?.worktreeIds ??
      [];
    expect(ids).toEqual(['/repo-worktrees/feat']);
  });

  it('never asks status about a worktree in a COLLAPSED tree, even though the filter shows it', async () => {
    setWorktreeTreeCollapsed(project.id, true);
    const status = vi.fn().mockResolvedValue([]);
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([normalWorktree, externalWorktree]),
        status,
      },
    });
    render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideExternalWorktrees={false}
      />,
    );
    await waitFor(() => expect(status).toHaveBeenCalled());
    const ids =
      (status.mock.calls[0]?.[0] as { worktreeIds: readonly string[] } | undefined)?.worktreeIds ??
      [];
    expect(ids).toEqual(['/repo-worktrees/feat']);
  });

  it('DOES ask status about an external worktree once shown AND expanded', async () => {
    const status = vi.fn().mockResolvedValue([]);
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([normalWorktree, externalWorktree]),
        status,
      },
    });
    render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideExternalWorktrees={false}
      />,
    );
    await waitFor(() => expect(status).toHaveBeenCalled());
    const ids =
      (status.mock.calls[0]?.[0] as { worktreeIds: readonly string[] } | undefined)?.worktreeIds ??
      [];
    expect([...ids].sort()).toEqual(['/elsewhere/manual', '/repo-worktrees/feat']);
  });
});
