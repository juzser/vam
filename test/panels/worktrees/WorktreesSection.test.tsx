// @vitest-environment happy-dom

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEntry } from '../../../src/renderer/domain/selectors.js';
import { WorktreesSection } from '../../../src/renderer/panels/worktrees/WorktreesSection.js';
import type { WorktreeInfo } from '../../../src/shared/worktree.js';
import { makeProject } from '../session-list-props.js';

/**
 * A STAND-IN for `SessionList.tsx`'s real `renderSessionRow` -- this file
 * tests `WorktreesSection` in isolation, so it injects a minimal row rather
 * than importing the real (unexported, closure-heavy) function. The real
 * function's OWN behaviour -- `rowRefs`, jump labels, the context menu, `j`/
 * `k` reachability -- is proven end to end against the genuine `SessionList`/
 * `Canvas` pairing in `test/canvas/Canvas.worktree-nested-rows.test.tsx`;
 * this stand-in only has to prove `WorktreesSection` CALLS the function it
 * was handed, once per nested session, with that session's own entry.
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

/** `WorktreesSection`'s default prop for the agent-worktree toggle in every
 *  test that does not care about it -- `false`, matching `hideAgentWorktrees`
 *  never being on unless a test says so, so an existing row is never
 *  silently filtered out by a prop these tests did not ask about. */
const HIDE_AGENT_WORKTREES = false;

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
        renderSessionRow={fakeRenderSessionRow}
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
        renderSessionRow={fakeRenderSessionRow}
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
        renderSessionRow={fakeRenderSessionRow}
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
        renderSessionRow={fakeRenderSessionRow}
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
        renderSessionRow={fakeRenderSessionRow}
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
        renderSessionRow={fakeRenderSessionRow}
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
        renderSessionRow={fakeRenderSessionRow}
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
        renderSessionRow={fakeRenderSessionRow}
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
        renderSessionRow={fakeRenderSessionRow}
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

  it('draws a nested row through renderSessionRow, once per session, when allEntries already has sessions for that worktree (UI1)', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([worktree()]),
        create: vi.fn(),
        remove: vi.fn(),
      },
    });
    const childProject = makeProject({ id: 'claude-code:feat-00000000', name: 'feat' });
    const rendered: string[] = [];
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
        renderSessionRow={(entry) => {
          rendered.push(entry.session.id);
          return fakeRenderSessionRow(entry);
        }}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-session-row="s1"]')).not.toBeNull());
    expect(container.querySelector('[data-session-row="s1"]')?.textContent).toContain(
      'a session in the worktree',
    );
    expect(rendered).toEqual(['s1']);
    // No count badge, and no "Start a session here" -- a live session means
    // the nested row IS the affordance now.
    expect(container.querySelector('[data-worktree-session-count]')).toBeNull();
    expect(container.querySelector('[data-worktree-start-here]')).toBeNull();
  });
});

describe('WorktreesSection — the agent-worktree filter (phase 2a)', () => {
  const agentWorktree = worktree({
    worktreeId: '/repo/.claude/worktrees/agent-a1',
    path: '/repo/.claude/worktrees/agent-a1',
    branch: 'worktree-agent-a1',
  });
  const normalWorktree = worktree({
    worktreeId: '/repo-worktrees/other',
    path: '/repo-worktrees/other',
    branch: 'other',
  });

  /**
   * BOTH TESTS LIST TWO WORKTREES, NEVER JUST THE AGENT ONE -- with only one
   * row, "the section shows nothing" is indistinguishable from "the list()
   * promise has not resolved yet" (`WorktreesSection` also draws nothing
   * while `worktrees.length === 0` during its OWN `'loading'` state), which
   * would make a `waitFor(() => expect(section).toBeNull())` assertion pass
   * trivially, before the filter this test means to exercise ever runs. A
   * second, always-visible row is what makes "one row is missing, the other
   * one is there" an assertion that can actually still be waited on.
   */
  it('hides an adopted Claude Code agent worktree when hideAgentWorktrees is true, keeping an ordinary one', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([agentWorktree, normalWorktree]) },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={true}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-row="/repo-worktrees/other"]')).not.toBeNull(),
    );
    expect(
      container.querySelector('[data-worktree-row="/repo/.claude/worktrees/agent-a1"]'),
    ).toBeNull();
    // The count badge next to "Worktrees" reads the FILTERED count too.
    expect(container.querySelector('[data-worktrees-section] .font-mono')?.textContent).toBe('1');
  });

  it('shows it once hideAgentWorktrees is false -- the operator’s own toggle, respected here too', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([agentWorktree, normalWorktree]) },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={false}
      />,
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-worktree-row="/repo/.claude/worktrees/agent-a1"]'),
      ).not.toBeNull(),
    );
  });

  it('defaults to hidden with no prop given at all', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([agentWorktree, normalWorktree]) },
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
      expect(container.querySelector('[data-worktree-row="/repo-worktrees/other"]')).not.toBeNull(),
    );
    expect(
      container.querySelector('[data-worktree-row="/repo/.claude/worktrees/agent-a1"]'),
    ).toBeNull();
  });
});

describe('WorktreesSection — locked, prunable and detached markers', () => {
  it('never offers delete on a locked worktree', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([worktree({ locked: true, lockReason: 'held' })]),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={HIDE_AGENT_WORKTREES}
        // A locked worktree is hidden by the NEW `hideExternalWorktrees`
        // default too (`worktree-visibility.ts`'s own rule) -- opened here
        // so this test keeps proving its own, unrelated concern (no delete
        // button on a locked row) rather than proving nothing because the
        // row never drew at all. `WorktreesSection.external-worktrees.test
        // .tsx` is where the new default itself is proven.
        hideExternalWorktrees={false}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktree-row]')).not.toBeNull());
    expect(container.querySelector('[data-worktree-locked]')).not.toBeNull();
    expect(container.querySelector('[data-worktree-delete]')).toBeNull();
  });

  it('marks a prunable worktree', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([
          worktree({
            prunable: true,
            prunableReason: 'gitdir file points to non-existent location',
          }),
        ]),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={HIDE_AGENT_WORKTREES}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktree-prunable]')).not.toBeNull());
  });

  it('marks a DETACHED HEAD worktree', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([worktree({ detached: true, branch: 'abc1234' })]),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={HIDE_AGENT_WORKTREES}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktree-detached]')).not.toBeNull());
  });
});

describe('WorktreesSection — dirty / ahead-behind badges (phase 2a)', () => {
  it('shows a dirty dot when the status api reports dirty:true', async () => {
    const status = vi
      .fn()
      .mockResolvedValue([
        { worktreeId: '/repo-worktrees/feat', dirty: true, ahead: null, behind: null },
      ]);
    // `status` is named EXPLICITLY inside the `worktrees` override -- a
    // partial override REPLACES `installApi`'s own default `worktrees`
    // object wholesale (a shallow merge at the top level), so a test that
    // only names `list` there silently loses `status` too, and this poll
    // would never fire at all.
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([worktree()]), status },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={HIDE_AGENT_WORKTREES}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktree-dirty]')).not.toBeNull());
  });

  it('shows ahead/behind counts when the status api reports them, and neither when there is no upstream', async () => {
    const status = vi
      .fn()
      .mockResolvedValue([
        { worktreeId: '/repo-worktrees/feat', dirty: false, ahead: 2, behind: 1 },
      ]);
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([worktree()]), status },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={HIDE_AGENT_WORKTREES}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-ahead]')?.textContent).toBe('2'),
    );
    expect(container.querySelector('[data-worktree-behind]')?.textContent).toBe('1');
    expect(container.querySelector('[data-worktree-dirty]')).toBeNull();
  });

  it('shows neither ahead nor behind when the status api reports no upstream (null/null)', async () => {
    const status = vi
      .fn()
      .mockResolvedValue([
        { worktreeId: '/repo-worktrees/feat', dirty: false, ahead: null, behind: null },
      ]);
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([worktree()]), status },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={HIDE_AGENT_WORKTREES}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktree-row]')).not.toBeNull());
    expect(container.querySelector('[data-worktree-ahead]')).toBeNull();
    expect(container.querySelector('[data-worktree-behind]')).toBeNull();
  });

  it('never calls status when there are zero worktrees to badge', async () => {
    const status = vi.fn().mockResolvedValue([]);
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([]), status },
    });
    render(
      <WorktreesSection
        project={project}
        allEntries={[]}
        forceOpenCreate={true}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={HIDE_AGENT_WORKTREES}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(status).not.toHaveBeenCalled();
  });
});
