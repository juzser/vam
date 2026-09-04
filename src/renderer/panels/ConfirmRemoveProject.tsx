/**
 * The confirm in front of removing a project.
 *
 * It exists to make a disclosure, not to add a click. Removal does two
 * different things to two different sets of sessions -- ends the ones vam
 * started, hides the ones it cannot end -- and the operator cannot see which
 * of their sessions is which. So the dialog states BOTH COUNTS, from
 * `removalPlan` over the project's real sessions, and says plainly that
 * nothing leaves the machine.
 *
 * Vam's existing overlay idiom, not a second one: the same scrim-plus-shell
 * as `IconPicker`, and the overlay rule the command palette established: an
 * open overlay owns the keyboard and hears only Escape, so every other key is
 * stopped here and a chord cannot fire at the canvas behind a modal question.
 * (PR numbers are spelled out in words in this file: a hash followed by
 * three digits is four hex characters, and constraint 13.1 reads it as a
 * literal colour.)
 *
 * THE DESTRUCTIVE BUTTON DOES NOT HOLD INITIAL FOCUS. Cancel does, so the
 * reflex Return that follows a surprise dialog is the harmless answer.
 */

import { Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { RemovalPlan } from './remove-project.js';

export type ConfirmRemoveProjectProps = {
  readonly projectName: string;
  readonly plan: RemovalPlan;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

/** "1 session", "2 sessions" -- a count that reads as English at every value. */
function sessions(count: number): string {
  return count === 1 ? '1 session' : `${count} sessions`;
}

export function ConfirmRemoveProject({
  projectName,
  plan,
  onConfirm,
  onCancel,
}: ConfirmRemoveProjectProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      data-confirm-remove
      role="dialog"
      aria-modal="true"
      aria-label={`remove ${projectName}`}
      onKeyDown={(event) => {
        // Everything is swallowed; only Escape does anything. See the header.
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
        aria-label="cancel removing the project"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-canvas/70"
      />
      <div className="relative z-10 w-[320px] rounded-[var(--radius-lg)] border border-line-strong bg-panel p-3.5 shadow-[var(--shadow-node)]">
        <div className="flex items-center gap-2">
          <Trash2 size={13} strokeWidth={1.8} className="text-danger" />
          <span className="font-mono font-semibold text-[12px] text-ink">
            Remove {projectName}?
          </span>
        </div>
        {/* The two numbers, each next to what it means. `data-*` so a test
            reads the COUNT rather than a sentence it could match by accident. */}
        <ul className="mt-2.5 flex flex-col gap-1 text-[11.5px] text-ink-dim">
          <li>
            vam will end <span data-confirm-end-count>{plan.end.length}</span>{' '}
            {sessions(plan.end.length)} it started.
          </li>
          <li>
            <span data-confirm-hide-count>{plan.hide.length}</span> {sessions(plan.hide.length)} vam
            did not start will keep running, and only stop being shown.
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-ink-faint">
          Nothing is deleted from this machine: the directory, its repository and every conversation
          stay exactly where they are. You can bring the project back from the list below the
          sidebar.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            ref={cancelRef}
            data-confirm-cancel
            onClick={onCancel}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-line px-2 py-1 text-[11.5px] text-ink-dim hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            data-confirm-remove-go
            onClick={onConfirm}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-danger px-2 py-1 text-[11.5px] text-danger hover:bg-danger hover:text-canvas"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
