// @vitest-environment happy-dom

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDeleteWorktree } from '../../../src/renderer/panels/worktrees/ConfirmDeleteWorktree.js';

describe('ConfirmDeleteWorktree — clean worktree', () => {
  it('enables Delete at once and confirms with no name', () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <ConfirmDeleteWorktree
        name="feat"
        branch="feat"
        dirty={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const go = container.querySelector('[data-confirm-delete-worktree-go]') as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    expect(onConfirm).toHaveBeenCalledWith(undefined);
    // No name field on the clean path.
    expect(container.querySelector('[data-confirm-delete-worktree-name]')).toBeNull();
  });

  it('Cancel holds initial focus, not the destructive button', () => {
    const { container } = render(
      <ConfirmDeleteWorktree
        name="feat"
        branch="feat"
        dirty={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const cancel = container.querySelector('[data-confirm-delete-worktree-cancel]');
    expect(document.activeElement).toBe(cancel);
  });

  it('Escape cancels; every other key is swallowed', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDeleteWorktree
        name="feat"
        branch="feat"
        dirty={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const dialog = container.querySelector('[data-confirm-delete-worktree]') as HTMLElement;
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clicking the scrim cancels', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDeleteWorktree
        name="feat"
        branch="feat"
        dirty={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const scrim = container.querySelector('button[aria-label="cancel deleting the worktree"]');
    fireEvent.click(scrim as HTMLButtonElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDeleteWorktree — dirty worktree', () => {
  it('disables Delete until the typed name matches exactly', () => {
    const onConfirm = vi.fn();
    const { container } = render(
      <ConfirmDeleteWorktree
        name="feat"
        branch="feat"
        dirty={true}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const input = container.querySelector(
      '[data-confirm-delete-worktree-name]',
    ) as HTMLInputElement;
    const go = container.querySelector('[data-confirm-delete-worktree-go]') as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'fea' } });
    expect(go.disabled).toBe(true);
    fireEvent.click(go);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'feat' } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    expect(onConfirm).toHaveBeenCalledWith('feat');
  });

  it('is case-sensitive: "Feat" does not match "feat"', () => {
    const { container } = render(
      <ConfirmDeleteWorktree
        name="feat"
        branch="feat"
        dirty={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = container.querySelector(
      '[data-confirm-delete-worktree-name]',
    ) as HTMLInputElement;
    const go = container.querySelector('[data-confirm-delete-worktree-go]') as HTMLButtonElement;
    fireEvent.change(input, { target: { value: 'Feat' } });
    expect(go.disabled).toBe(true);
  });
});
