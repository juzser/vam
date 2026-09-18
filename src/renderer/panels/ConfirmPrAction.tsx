/**
 * The confirm in front of merging a pull request, or deleting its branch.
 *
 * WHY THIS EXISTS AT ALL, and it is `ConfirmForceClose`'s reason rather than a
 * politeness. Everything else the PRs tab does is a read: it asks GitHub what
 * is there and draws the answer. These two WRITE, to the operator's own
 * repositories, with the operator's own credentials, and nothing inside vam
 * can undo either of them. A single click from a side panel is not an adequate
 * amount of intent for that, so the click OPENS A QUESTION and the question is
 * what acts.
 *
 * THE WORDING NAMES THE THING, for `ConfirmForceClose`'s stated reason: a
 * generic "Are you sure?" is not adequate for something irreversible. The
 * number AND the title are both here -- the number is what GitHub calls it and
 * the title is what the operator recognises, and a dialog carrying only the
 * first is one digit away from merging the wrong branch.
 *
 * AND IT SHOWS THE COMMAND IT WILL RUN, verbatim, which `ConfirmForceClose`
 * does not have to: force-closing is one act with one meaning, while "merge"
 * is three different histories depending on a flag. An operator who squash-
 * merges everything and an operator who never does are both looking at the
 * same button, so the button does not get to keep its strategy private.
 * `command` is rendered as React TEXT and never as markup.
 *
 * Vam's existing overlay idiom, not a second one: the same scrim-plus-shell as
 * `ConfirmForceClose`, `ConfirmRemoveProject` and `IconPicker`, and the same
 * keyboard rule -- an open overlay owns the keyboard and hears only Escape.
 *
 * THE DESTRUCTIVE BUTTON DOES NOT HOLD INITIAL FOCUS, for the reason its two
 * neighbours give: Cancel does, so a reflex Return is the harmless answer.
 */

import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';

export type ConfirmPrActionProps = {
  /** "Merge" / "Delete branch" — the verb, for the heading and the button. */
  readonly verb: string;
  /** The pull request, named the way the operator would name it. */
  readonly number: number;
  readonly title: string;
  /** What this will do, in one sentence, including what it cannot undo. */
  readonly consequence: string;
  /** The exact command vam will run. Drawn verbatim, as text. */
  readonly command: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export function ConfirmPrAction({
  verb,
  number,
  title,
  consequence,
  command,
  onConfirm,
  onCancel,
}: ConfirmPrActionProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      data-confirm-pr-action
      role="dialog"
      aria-modal="true"
      aria-label={`${verb} pull request ${number}`}
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
        aria-label="cancel this pull request action"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-ground/70"
      />
      <div className="relative z-10 w-[360px] max-w-[92vw] rounded-[var(--radius-lg)] border border-line-strong bg-panel p-3.5 shadow-[var(--shadow-node)]">
        <div className="flex items-center gap-2">
          <TriangleAlert size={13} strokeWidth={1.8} className="flex-none text-danger" />
          <span className="min-w-0 font-mono font-semibold text-body text-ink">
            {`${verb} #${number}?`}
          </span>
        </div>
        {/* The title on its own line, unclipped by the heading's monospace
            run: it is the half of the identity a person actually recognises. */}
        <p data-confirm-pr-action-title className="mt-1.5 text-control text-ink">
          {title}
        </p>
        <p className="mt-2.5 text-control text-ink-dim">{consequence}</p>
        {/* WHAT WILL ACTUALLY RUN. Monospace because it is a command, and
            selectable because the operator may want to check it somewhere
            else before saying yes. */}
        <p
          data-confirm-pr-action-command
          className="mt-2.5 select-text break-all rounded-[var(--radius-sm)] border border-line bg-card px-2 py-1 font-mono text-ink-dim text-meta"
        >
          {command}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            ref={cancelRef}
            data-confirm-pr-action-cancel
            onClick={onCancel}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-line px-2 py-1 text-control text-ink-dim hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            data-confirm-pr-action-go
            onClick={onConfirm}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-danger px-2 py-1 text-control text-danger hover:bg-danger hover:text-ground"
          >
            {verb}
          </button>
        </div>
      </div>
    </div>
  );
}
