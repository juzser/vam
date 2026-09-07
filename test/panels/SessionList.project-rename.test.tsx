// @vitest-environment happy-dom

/**
 * The project (repo) heading's own rename, through the project action menu.
 *
 * Deliberately "Rename repo", not "Rename project" -- the group menu already
 * uses "Rename project" for the group one level up (UI "project" is the
 * code's `Group`; see the vocabulary table in `domain/model.ts`), and PR #247
 * resolved the identical "project" collision on the two `+` buttons by using
 * "repo" for this exact layer rather than repeating a word two menus already
 * disagree about. See `session-list-props.ts` for `twoProjects` (`alpha`,
 * `beta`).
 *
 * The idiom is the group rename's, reused rather than reinvented: one inline
 * editor, `Enter` commits, `Escape` cancels, blur discards -- and the same
 * focus-restore guard PR #247 added for the group menu (`groupDraft ===
 * null`) is inherited here as `projectDraft === null`, alongside the
 * existing `confirming === null` guard for the remove-confirm dialog.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../src/renderer/domain/model.js';
import { SessionList, type SessionListProps } from '../../src/renderer/panels/SessionList.js';
import { baseProps, twoProjects } from './session-list-props.js';

afterEach(cleanup);

function mountWith(over: Partial<SessionListProps>) {
  return render(<SessionList {...baseProps(twoProjects())} {...over} />);
}

function openMenu(container: ParentNode, projectId = 'p1') {
  act(() => {
    (container.querySelector(`[data-project-menu="${projectId}"]`) as HTMLElement).click();
  });
}

describe('the project menu, with no caller wired for rename', () => {
  it('offers no rename item at all', () => {
    const { container } = mountWith({});
    openMenu(container);
    expect(container.querySelector('[data-project-menu-item="rename"]')).toBeNull();
  });
});

describe('renaming a repo, through the project menu', () => {
  it('opens an inline editor prefilled with the current name', () => {
    const { container } = mountWith({ onRenameProject: vi.fn() });
    openMenu(container);
    fireEvent.click(container.querySelector('[data-project-menu-item="rename"]') as Element);
    const input = container.querySelector('[data-project-draft]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('alpha');
    // No overlay: renaming a repo heading discloses nothing either.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('commits the new name on Enter, naming the same project the menu opened on', () => {
    const onRenameProject = vi.fn();
    const { container } = mountWith({ onRenameProject });
    openMenu(container);
    fireEvent.click(container.querySelector('[data-project-menu-item="rename"]') as Element);
    const input = container.querySelector('[data-project-draft]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'renamed-alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameProject).toHaveBeenCalledTimes(1);
    const [project, name] = onRenameProject.mock.calls[0] as [Project, string];
    expect(project.id).toBe('p1');
    expect(name).toBe('renamed-alpha');
    expect(container.querySelector('[data-project-draft]')).toBeNull();
  });

  it('clears the override on an empty commit rather than skipping it', () => {
    // Unlike the group editor -- a group has no derived name to fall back
    // to, so an empty commit there does nothing at all. A project's empty
    // commit is meaningful: it is the undo, restoring the source's own name.
    const onRenameProject = vi.fn();
    const { container } = mountWith({ onRenameProject });
    openMenu(container);
    fireEvent.click(container.querySelector('[data-project-menu-item="rename"]') as Element);
    const input = container.querySelector('[data-project-draft]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameProject).toHaveBeenCalledTimes(1);
    const [, name] = onRenameProject.mock.calls[0] as [Project, string];
    expect(name).toBe('');
  });

  it('cancels on Escape, taking no action and restoring the plain heading', () => {
    const onRenameProject = vi.fn();
    const { container } = mountWith({ onRenameProject });
    openMenu(container);
    fireEvent.click(container.querySelector('[data-project-menu-item="rename"]') as Element);
    const input = container.querySelector('[data-project-draft]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abandoned' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRenameProject).not.toHaveBeenCalled();
    expect(container.querySelector('[data-project-draft]')).toBeNull();
    expect(container.querySelector('[data-project-id="p1"]')?.textContent).toContain('alpha');
  });

  it('does not steal focus from the editor when opened from the menu', () => {
    // The PR #247 regression, one level down: the project menu's own
    // focus-restore effect closes `openMenu` the instant the rename item is
    // clicked (same click that opens the editor), and without a guard on
    // `projectDraft` it fires straight after and drags focus back to the
    // `...` toggle -- which blurs the editor and (via its `onBlur`) silently
    // discards the draft before a single key is typed.
    const { container } = mountWith({ onRenameProject: vi.fn() });
    openMenu(container);
    fireEvent.click(container.querySelector('[data-project-menu-item="rename"]') as Element);
    const input = container.querySelector('[data-project-draft]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
  });
});
