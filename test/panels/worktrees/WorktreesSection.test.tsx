// @vitest-environment happy-dom

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorktreesSection } from '../../../src/renderer/panels/worktrees/WorktreesSection.js';
import type { WorktreeInfo } from '../../../src/shared/worktree.js';
import { makeProject } from '../session-list-props.js';

function worktree(over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    worktreeId: '/repo-worktrees/feat',
    path: '/repo-worktrees/feat',
    branch: 'feat',
    projectId: 'claude-code:feat-00000000',
    locked: false,
    lockReason: null,
    prunable: false,
    ...over,
  };
}

function installApi(over: Partial<Record<string, unknown>> = {}) {
  const list = vi.fn().mockResolvedValue([]);
  const create = vi.fn().mockResolvedValue(worktree());
  const remove = vi.fn().mockResolvedValue({ preservedBranch: false });
  const createSessionIn = vi.fn().mockResolvedValue(undefined);
  const api = { worktrees: { list, create, remove }, createSessionIn, ...over };
  (window as unknown as { api: unknown }).api = api;
  return { list, create, remove, createSessionIn };
}

afterEach(() => {
  (window as unknown as { api: unknown }).api = undefined;
  vi.restoreAllMocks();
});

const project = makeProject({ id: 'claude-code:repo-11111111', name: 'repo' });

describe('WorktreesSection — visibility', () => {
  it('renders nothing when there is no window.api at all', () => {
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        onPickSession={vi.fn()}
        focusedSessionId={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a project with zero worktrees, not creating', async () => {
    installApi();
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        onPickSession={vi.fn()}
        focusedSessionId={null}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktrees-section]')).toBeNull());
  });

  it('forceOpenCreate draws the section (and its form) even with zero worktrees', async () => {
    installApi();
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={true}
        onCloseCreate={vi.fn()}
        onPickSession={vi.fn()}
        focusedSessionId={null}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktrees-create-form]')).not.toBeNull(),
    );
  });

  it('draws rows once the api answers with worktrees', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([worktree()]),
        create: vi.fn(),
        remove: vi.fn(),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        onPickSession={vi.fn()}
        focusedSessionId={null}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-row]')?.textContent).toContain('feat'),
    );
    expect(container.querySelector('[data-worktree-branch]')?.textContent).toBe('feat');
  });
});

describe('WorktreesSection — create', () => {
  it('the "+" opens the form, and Create calls api.create then reloads', async () => {
    const { list, create } = installApi();
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        // The entry point SessionList's own "New worktree…" menu item uses
        // for a project with no worktrees yet.
        forceOpenCreate={true}
        onCloseCreate={vi.fn()}
        onPickSession={vi.fn()}
        focusedSessionId={null}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktrees-create-form]')).not.toBeNull(),
    );

    const nameInput = container.querySelector('[data-worktrees-create-name]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'my feature' } });
    const submit = container.querySelector('[data-worktrees-create-submit]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });

    expect(create).toHaveBeenCalledWith({
      projectId: project.id,
      name: 'my feature',
      baseRef: undefined,
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2)); // initial + post-create reload
  });

  it('shows the refusal message and keeps the form open on failure', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([]),
        create: vi
          .fn()
          .mockRejectedValue({ kind: 'refused', code: 'branch-exists', message: 'nope' }),
        remove: vi.fn(),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={true}
        onCloseCreate={vi.fn()}
        onPickSession={vi.fn()}
        focusedSessionId={null}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktrees-create-form]')).not.toBeNull(),
    );
    const nameInput = container.querySelector('[data-worktrees-create-name]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'main' } });
    const submit = container.querySelector('[data-worktrees-create-submit]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(container.querySelector('[data-worktrees-create-error]')?.textContent).toBe('nope'),
    );
    // Still open -- a failure does not silently close the form.
    expect(container.querySelector('[data-worktrees-create-form]')).not.toBeNull();
  });
});

describe('WorktreesSection — delete', () => {
  it('a clean delete removes the row with one confirm', async () => {
    const remove = vi.fn().mockResolvedValue({ preservedBranch: false });
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([worktree()]), create: vi.fn(), remove },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        onPickSession={vi.fn()}
        focusedSessionId={null}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktree-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-worktree-delete]') as HTMLButtonElement);
    const go = document.querySelector('[data-confirm-delete-worktree-go]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(go);
      await Promise.resolve();
    });
    expect(remove).toHaveBeenCalledWith({
      projectId: project.id,
      worktreeId: '/repo-worktrees/feat',
      force: false,
      confirmName: undefined,
    });
  });

  it('a dirty refusal switches the SAME dialog to the typed-name path', async () => {
    const remove = vi
      .fn()
      .mockRejectedValueOnce({ kind: 'refused', code: 'dirty', message: 'dirty' })
      .mockResolvedValueOnce({ preservedBranch: true });
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([worktree()]), create: vi.fn(), remove },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        onPickSession={vi.fn()}
        focusedSessionId={null}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktree-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-worktree-delete]') as HTMLButtonElement);

    let go = document.querySelector('[data-confirm-delete-worktree-go]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(go);
      await Promise.resolve();
    });

    // Now dirty: the name field appears on the same dialog.
    const nameField = await waitFor(() => {
      const el = document.querySelector('[data-confirm-delete-worktree-name]');
      if (el === null) throw new Error('not yet');
      return el as HTMLInputElement;
    });
    fireEvent.change(nameField, { target: { value: 'feat' } });
    go = document.querySelector('[data-confirm-delete-worktree-go]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(go);
      await Promise.resolve();
    });

    expect(remove).toHaveBeenNthCalledWith(2, {
      projectId: project.id,
      worktreeId: '/repo-worktrees/feat',
      force: true,
      confirmName: 'feat',
    });
  });
});

describe('WorktreesSection — start a session here', () => {
  it('shows "Start a session here" for a worktree with no live sessions, and calls createSessionIn', async () => {
    const { createSessionIn } = installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([worktree()]),
        create: vi.fn(),
        remove: vi.fn(),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        onPickSession={vi.fn()}
        focusedSessionId={null}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-start-here]')).not.toBeNull(),
    );
    fireEvent.click(container.querySelector('[data-worktree-start-here]') as HTMLButtonElement);
    await waitFor(() =>
      expect(createSessionIn).toHaveBeenCalledWith('/repo-worktrees/feat', 'feat'),
    );
  });

  it('shows a nested, clickable session row instead, when allEntries already has sessions for that worktree (UI1)', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([worktree()]),
        create: vi.fn(),
        remove: vi.fn(),
      },
    });
    const childProject = makeProject({ id: 'claude-code:feat-00000000', name: 'feat' });
    const onPickSession = vi.fn();
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[
          {
            project: childProject,
            session: {
              id: 's1',
              title: 'a session in the worktree',
              epic: null,
              branch: 'feat',
              status: 'running',
              runningAgents: 0,
              activity: null,
              age: null,
              decisions: [],
            },
          },
        ]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        onPickSession={onPickSession}
        focusedSessionId={null}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-session-row="s1"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-worktree-session-row="s1"]')?.textContent).toContain(
      'a session in the worktree',
    );
    // No count badge, and no "Start a session here" -- a live session means
    // the nested row IS the affordance now.
    expect(container.querySelector('[data-worktree-session-count]')).toBeNull();
    expect(container.querySelector('[data-worktree-start-here]')).toBeNull();

    fireEvent.click(
      container.querySelector('[data-worktree-session-row="s1"]') as HTMLButtonElement,
    );
    expect(onPickSession).toHaveBeenCalledWith('s1');
  });
});
