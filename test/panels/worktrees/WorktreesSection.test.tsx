// @vitest-environment happy-dom

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEntry } from '../../../src/renderer/domain/selectors.js';
import { WorktreesSection } from '../../../src/renderer/panels/worktrees/WorktreesSection.js';
import type { WorktreeInfo } from '../../../src/shared/worktree.js';
import { makeProject, makeSession } from '../session-list-props.js';

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
        entries={[]}
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
        entries={[]}
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
        entries={[]}
        forceOpenCreate={true}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktrees-create-form]')).not.toBeNull(),
    );
  });

  it('draws rows once the api answers with worktrees, and shows a branch that differs from the name', async () => {
    installApi({
      worktrees: {
        // `branch` deliberately differs from the directory name ('feat')
        // here -- the default `worktree()` fixture no longer does (see the
        // dedup describe block below), and this test's own point is that a
        // REAL difference still draws.
        list: vi.fn().mockResolvedValue([worktree({ branch: 'feature/feat-2' })]),
        create: vi.fn(),
        remove: vi.fn(),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-row]')?.textContent).toContain('feat'),
    );
    expect(container.querySelector('[data-worktree-branch]')?.textContent).toBe('feature/feat-2');
  });
});

/**
 * THE OPERATOR'S OWN REPORT on PR 547's own screenshot
 * (`docs/pr-evidence/sidebar-worktree-filters-after-dark.png`): the branch
 * repeated the worktree's own name twice -- once as `data-worktree-name`,
 * once again one line down as `data-worktree-branch`, whenever the two
 * happen to be identical (the common case: `git worktree add <name>` names
 * the branch after the directory unless told otherwise). A nested SESSION
 * row repeated it a THIRD time, via its own `data-session-branch` chip --
 * that half is `SessionList.tsx`'s own `renderSessionRow` and is proven in
 * `Canvas.worktree-nested-rows.filtered.test.tsx` (a real render, unlike
 * this file's `fakeRenderSessionRow` stand-in); this describe block covers
 * only the WORKTREE ROW'S OWN two lines, and proves `renderRow` passes the
 * worktree's branch down as `suppressBranch` for the session-row half.
 */
describe('WorktreesSection — a worktree row never repeats its own name as its branch', () => {
  it('omits the branch line when it equals the worktree name (the default fixture, now)', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([worktree()]) },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktree-row]')).not.toBeNull());
    expect(container.querySelector('[data-worktree-name]')?.textContent).toBe('feat');
    expect(container.querySelector('[data-worktree-branch]')).toBeNull();
  });

  it('shows the branch line when it genuinely differs from the worktree name', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([worktree({ branch: 'feature/something-else' })]),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[data-worktree-branch]')?.textContent).toBe(
        'feature/something-else',
      ),
    );
  });

  it("passes the worktree's own branch to renderSessionRow as suppressBranch, for every nested session", async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([worktree({ branch: 'feature/x' })]) },
    });
    const received: (string | null | undefined)[] = [];
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[
          {
            project: makeProject({ id: 'claude-code:feat-00000000', name: 'feat' }),
            session: {
              id: 's1',
              title: 'a session in the worktree',
              epic: null,
              branch: 'feature/x',
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
        renderSessionRow={(entry, opts) => {
          received.push(opts?.suppressBranch);
          return fakeRenderSessionRow(entry);
        }}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-session-row="s1"]')).not.toBeNull());
    expect(received).toEqual(['feature/x']);
  });
});

describe('WorktreesSection — no header + button', () => {
  it('draws no "new worktree of" button in the section header', async () => {
    installApi({ worktrees: { list: vi.fn().mockResolvedValue([worktree()]) } });
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktrees-section]')).not.toBeNull());
    expect(container.querySelector('[aria-label^="new worktree of "]')).toBeNull();
    expect(container.querySelector('[data-worktrees-add]')).toBeNull();
  });
});

describe('WorktreesSection — create', () => {
  it('the "+" opens the form, and Create calls api.create then reloads', async () => {
    const { list, create } = installApi();
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[]}
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
        entries={[]}
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
        entries={[]}
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
        entries={[]}
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

describe('WorktreesSection — delete a DETACHED worktree (S1 data-loss fix)', () => {
  it('passes detached through to the confirm dialog, described as detached rather than a branch', async () => {
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([worktree({ detached: true, branch: 'abc1234' })]),
        create: vi.fn(),
        remove: vi.fn(),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={HIDE_AGENT_WORKTREES}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktree-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-worktree-delete]') as HTMLButtonElement);
    const copy = await waitFor(() => {
      const el = document.querySelector('[data-confirm-delete-worktree-copy]');
      if (el === null) throw new Error('not yet');
      return el;
    });
    expect(copy.textContent).toContain('detached at abc1234');
    expect(copy.textContent).not.toContain('Its branch');
    // Close the dialog before this test ends -- this file's own convention
    // (nothing else here leaves a confirm-delete dialog open across a test
    // boundary; without an RTL `cleanup()` between tests in this file, a
    // dangling dialog is a REAL, later test-scoped element `document.
    // querySelector` could match instead of the next test's own).
    fireEvent.click(
      document.querySelector('[data-confirm-delete-worktree-cancel]') as HTMLButtonElement,
    );
  });

  it('shows the kept-ref name once removal reports one, after the dialog closes', async () => {
    const remove = vi.fn().mockResolvedValue({ preservedBranch: false, keptRef: 'vam-kept/feat' });
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([worktree({ detached: true, branch: 'abc1234' })]),
        create: vi.fn(),
        remove,
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={HIDE_AGENT_WORKTREES}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-worktree-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-worktree-delete]') as HTMLButtonElement);
    const go = document.querySelector('[data-confirm-delete-worktree-go]') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(go);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(container.querySelector('[data-worktrees-kept-ref]')?.textContent).toContain(
        'vam-kept/feat',
      ),
    );
  });

  it('shows no kept-ref message for a plain removal (keptRef: null)', async () => {
    const remove = vi.fn().mockResolvedValue({ preservedBranch: false, keptRef: null });
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([worktree()]), create: vi.fn(), remove },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[]}
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
    expect(container.querySelector('[data-worktrees-kept-ref]')).toBeNull();
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
        entries={[]}
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

  it('draws a nested row through renderSessionRow, once per session, when entries already has sessions for that worktree (UI1)', async () => {
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
        entries={[
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
        entries={[]}
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
        entries={[]}
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
        entries={[]}
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

  /**
   * S2, CROSS-PROVIDER REVIEW: `hasAgentWorktreeSegment` used to match ANY
   * path under `/.claude/worktrees/`, not only Claude Code's own
   * `agent-<id>` dirs -- so a worktree a person made by hand (or with
   * `claude --worktree <name>`) in that same container directory was hidden
   * right alongside a real agent one, with no way to get it back (the
   * default is ON). Both rows are listed together, the same "never just the
   * one row" shape this describe block's own header explains.
   */
  it('keeps a HUMAN-NAMED worktree under .claude/worktrees/ visible, while still hiding a real agent one', async () => {
    const humanWorktree = worktree({
      worktreeId: '/repo/.claude/worktrees/feature-x',
      path: '/repo/.claude/worktrees/feature-x',
      branch: 'feature-x',
      external: false,
    });
    installApi({
      worktrees: {
        list: vi.fn().mockResolvedValue([agentWorktree, humanWorktree]),
      },
    });
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        hideAgentWorktrees={true}
        hideExternalWorktrees={false}
      />,
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-worktree-row="/repo/.claude/worktrees/feature-x"]'),
      ).not.toBeNull(),
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
        entries={[]}
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
        entries={[]}
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
        entries={[]}
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
        entries={[]}
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
        entries={[]}
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
        entries={[]}
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
        entries={[]}
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

/**
 * S2, CROSS-PROVIDER REVIEW (PR 504's own rule, "stands down for a `waiting`
 * session ... must stay reachable regardless of the toggle"): a session
 * asking the operator something must never vanish from the sidebar
 * entirely. `session-filter.ts`'s own `isHiddenByAgentWorktreeFilter`
 * already stands down for `status === 'waiting'` -- but that is a SESSION-
 * level rule, and it never reaches the WORKTREE-ROW filters this file owns.
 * Before this fix, `hideAgentWorktrees` (agent dir/branch) and
 * `hideExternalWorktrees` (an agent worktree also counts as `external`,
 * `worktrees.ts`'s own rule) both dropped the ROW outright, with no waiting
 * exception of their own -- so the row a waiting session needed to nest
 * under was never drawn, and the session was reachable nowhere at all, even
 * though the session-level rule had already, correctly, decided to keep it.
 */
describe('WorktreesSection — the waiting exception carries to the row level', () => {
  const waitingChildProject = makeProject({
    id: 'claude-code:feat-00000000',
    name: 'feat',
  });

  /** A REAL agent worktree, per BOTH row-level filters at once -- the exact
   *  shape `main/worktrees/worktrees.ts` mints for one: an agent dir/branch
   *  (`hideAgentWorktrees`'s own subject) that is ALSO `external` (it does
   *  not live under vam's own `<repo>-worktrees` root, so `worktrees.ts`'s
   *  own `external: dirname(realPath) !== realWorktreesRoot` reads `true`
   *  for it) -- `hideExternalWorktrees`'s own subject too. */
  const agentAndExternalWorktree = worktree({
    worktreeId: '/repo/.claude/worktrees/agent-a1',
    path: '/repo/.claude/worktrees/agent-a1',
    branch: 'worktree-agent-a1',
    projectId: 'claude-code:feat-00000000',
    external: true,
  });

  it('draws the row exactly once, with the waiting session reachable, when BOTH filters are on (the shipped defaults)', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([agentAndExternalWorktree]) },
    });
    const waitingSession = makeSession({ id: 'w1', title: 'needs you', status: 'waiting' });
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[{ project: waitingChildProject, session: waitingSession }]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
        // NEITHER PROP GIVEN -- both filters default `true`, the shipped
        // configuration PR 504's own bug report was filed against.
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-session-row="w1"]')).not.toBeNull());
    // EXACTLY ONE ROW -- never double-drawn between the plain list and the
    // external/locked tree.
    expect(
      container.querySelectorAll('[data-worktree-row="/repo/.claude/worktrees/agent-a1"]'),
    ).toHaveLength(1);
    // The external group never even had to open for this -- proof the row
    // is reachable without the operator also having to toggle "Show
    // external worktrees" on.
    expect(container.querySelector('[data-worktrees-external-group]')).toBeNull();
  });

  it('keeps the SAME worktree hidden when its session is not waiting, with both filters on', async () => {
    installApi({
      worktrees: { list: vi.fn().mockResolvedValue([agentAndExternalWorktree]) },
    });
    const runningSession = makeSession({ id: 'r1', title: 'still working', status: 'running' });
    const { container } = render(
      <WorktreesSection
        project={project}
        entries={[{ project: waitingChildProject, session: runningSession }]}
        forceOpenCreate={false}
        onCloseCreate={vi.fn()}
        renderSessionRow={fakeRenderSessionRow}
      />,
    );
    // No `waitFor` to a positive assertion here on purpose -- there is
    // nothing that will ever appear to wait for. `useWorktrees`' own fetch
    // still has to resolve first, so give it a real macrotask before
    // asserting the negative -- the same pattern this file's own "never
    // calls status when there are zero worktrees to badge" test uses.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.querySelector('[data-session-row="r1"]')).toBeNull();
    expect(
      container.querySelector('[data-worktree-row="/repo/.claude/worktrees/agent-a1"]'),
    ).toBeNull();
  });
});
