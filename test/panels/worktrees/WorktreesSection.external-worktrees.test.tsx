// @vitest-environment happy-dom

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEntry } from '../../../src/renderer/domain/selectors.js';
import { WorktreesSection } from '../../../src/renderer/panels/worktrees/WorktreesSection.js';
import { setWorktreeTreeCollapsed } from '../../../src/renderer/panels/worktrees/worktree-tree-collapse.js';
import type { WorktreeInfo } from '../../../src/shared/worktree.js';
import { makeProject, makeSession } from '../session-list-props.js';

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

/**
 * THE COORDINATOR'S FOLLOW-UP: the tree must hang under the project's OWN
 * main-worktree session row -- the session running in the repo's main
 * checkout -- not merely somewhere inside the Worktrees section. REAL DOM
 * order, not a CSS `order` trick (that would leave keyboard/`Tab` and
 * screen-reader order pointing at the tree BEFORE the session, the opposite
 * of "hangs under"). `WorktreesSection` now draws `mainSessionEntries`
 * itself, between its own plain list and its own external/locked tree --
 * see its header and `mainSessionEntries`'s own prop doc for the mechanics.
 */
describe('WorktreesSection — the external tree hangs under the main session row', () => {
  const mainSession = makeSession({ id: 'main-1', title: 'main session' });

  it('draws the main session row BEFORE the external tree in real DOM order', async () => {
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
        mainSessionEntries={[{ project, session: mainSession }]}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktrees-external-group]')).not.toBeNull(),
    );
    const ordered = [
      ...container.querySelectorAll('[data-session-row], [data-worktrees-external-group]'),
    ];
    const kinds = ordered.map((el) =>
      el.hasAttribute('data-session-row') ? 'session' : 'external-group',
    );
    expect(kinds).toEqual(['session', 'external-group']);
  });

  it('draws the main session row BEFORE the plain worktrees block too', async () => {
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
        mainSessionEntries={[{ project, session: mainSession }]}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-session-row]')).not.toBeNull());
    // The PLAIN worktree ("wherever it is now") never moves -- it stays
    // ABOVE the session row, only the external/locked tree moves below it.
    const ordered = [...container.querySelectorAll('[data-session-row], [data-worktree-row]')];
    const kinds = ordered.map((el) => (el.hasAttribute('data-session-row') ? 'session' : 'row'));
    expect(kinds).toEqual(['row', 'session']);
  });

  it('falls back to the tree’s existing spot when the project has no main-worktree session', async () => {
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
        mainSessionEntries={[]}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktrees-external-group]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-session-row]')).toBeNull();
    // No session row to hang under -- the tree still draws, right after the
    // PLAIN row specifically (never a row nested inside the tree itself,
    // which also carries `data-worktree-row` and would otherwise make the
    // last match in a flat query the tree's OWN last row, not the tree).
    const plainRow = container.querySelector(
      `[data-worktree-row="${normalWorktree.worktreeId}"]`,
    ) as Element;
    const group = container.querySelector('[data-worktrees-external-group]') as Element;
    expect(plainRow.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  /**
   * THE REGRESSION `mainSessionEntries` EXISTS TO PREVENT: before phase 2b,
   * `state.kind === 'unavailable'` (no `window.api.worktrees` at all -- a
   * source with no worktrees bridge) made this component return `null`
   * OUTRIGHT. Now that it also owns rendering the project's own sessions,
   * doing that would have deleted every session row for every project under
   * such a source. Falsified by hand: reintroducing the old `if (state.kind
   * === 'unavailable') return null;` turns exactly this test red while
   * every other test in this file stays green.
   */
  it('still draws the project’s own sessions when there is no worktrees bridge at all', async () => {
    // No `installApi()` call -- `window.api` stays fully undefined.
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        mainSessionEntries={[{ project, session: mainSession }]}
      />,
    );
    expect(container.querySelector('[data-session-row="main-1"]')).not.toBeNull();
    expect(container.querySelector('[data-worktrees-section]')).toBeNull();
  });

  /**
   * THE OTHER REGRESSION: a project with ZERO worktrees used to return
   * `null` too (unless `creating`). Sessions must survive that as well.
   */
  it('still draws the project’s own sessions when the project has zero worktrees', async () => {
    installApi({ worktrees: { list: vi.fn().mockResolvedValue([]) } });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        mainSessionEntries={[{ project, session: mainSession }]}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-session-row="main-1"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-worktrees-section]')).toBeNull();
  });
});
