/**
 * The confirm in front of deleting a worktree -- `ConfirmRemoveProject`'s own
 * idiom (scrim, shell, Cancel holds initial focus, every key but Escape is
 * swallowed), with one addition a project removal never needed: for a DIRTY
 * worktree the operator must retype its own name before the destructive
 * button enables at all. A checkbox is not proof anyone read what they were
 * about to discard -- the operator's own decision for this feature.
 *
 * `dirty` decides which of the two dialogs this draws; there is no third
 * prop that could put them out of sync with each other, because a single
 * component parameterised by `dirty` is what `ConfirmPrAction` already does
 * for its own two verbs, and the same shape holds here.
 */

import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type ConfirmDeleteWorktreeProps = {
  /** `basename(worktreeId)` -- what the operator must retype for a dirty tree. */
  readonly name: string;
  readonly branch: string | null;
  readonly dirty: boolean;
  /** `confirmName` is passed only for the dirty path; `undefined` for a clean one. */
  readonly onConfirm: (confirmName?: string) => void;
  readonly onCancel: () => void;
};

export function ConfirmDeleteWorktree({
  name,
  branch,
  dirty,
  onConfirm,
  onCancel,
}: ConfirmDeleteWorktreeProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  const matches = typed === name;

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      data-confirm-delete-worktree
      role="dialog"
      aria-modal="true"
      aria-label={`delete worktree ${name}`}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      className="fixed inset-0 z-40 flex items-start justify-center pt-[18vh]"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="cancel deleting the worktree"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-ground/70"
      />
      <div className="relative z-10 w-[320px] rounded-[var(--radius-lg)] border border-line-strong bg-panel p-3.5 shadow-[var(--shadow-node)]">
        <div className="flex items-center gap-2">
          <Trash2 size={13} strokeWidth={1.8} className="text-danger" />
          <span className="font-mono font-semibold text-body text-ink">Delete {name}?</span>
        </div>
        <p className="mt-2 text-control text-ink-faint">
          {branch !== null
            ? `Its branch (${branch}) is only deleted if it has no unmerged commits — an unmerged branch is kept.`
            : 'The worktree directory is removed from disk.'}
        </p>
        {dirty ? (
          <>
            <p className="mt-2 text-control text-ink-dim">
              This worktree has uncommitted changes. Type its name to confirm removing it anyway.
            </p>
            <input
              data-confirm-delete-worktree-name
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={name}
              autoComplete="off"
              spellCheck={false}
              className="mt-2 min-w-0 w-full rounded-[5px] border border-line-strong bg-card px-1.5 py-1 font-mono text-control text-ink outline-none focus:border-line-loud"
            />
          </>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            ref={cancelRef}
            data-confirm-delete-worktree-cancel
            onClick={onCancel}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-line px-2 py-1 text-control text-ink-dim hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            data-confirm-delete-worktree-go
            disabled={dirty && !matches}
            onClick={() => onConfirm(dirty ? typed : undefined)}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-danger px-2 py-1 text-control text-danger hover:bg-danger hover:text-ground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-danger"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
