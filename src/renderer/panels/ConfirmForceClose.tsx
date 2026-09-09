/**
 * The confirm in front of force-closing a session vam could not verify.
 *
 * WHY THIS EXISTS AT ALL. `stop.ts` refuses an interactive row it cannot
 * PROVE is one of vam's own tmux panes -- no runner, a failed listing, or a
 * pane it could not uniquely resolve. That refusal carries `forcible: true`
 * when a process id is actually available to act on, and this is the
 * deliberate SECOND step the operator has to take to use it: force is never
 * the default of the close key, only of a click here.
 *
 * THE WORDING SAYS EXACTLY WHAT WILL BE KILLED, because a generic "Are you
 * sure?" is not adequate for a raw signal to a process id -- there is no
 * tmux session to name, only the row itself, and it may be a real terminal
 * window the operator is sitting in. Nothing here claims otherwise; it says
 * so plainly, which is the whole reason this exists as a distinct step
 * rather than a retry with a flag flipped silently.
 *
 * Vam's existing overlay idiom, not a second one: the same scrim-plus-shell
 * as `ConfirmRemoveProject` and `IconPicker`, and the same keyboard rule --
 * an open overlay owns the keyboard and hears only Escape.
 *
 * THE DESTRUCTIVE BUTTON DOES NOT HOLD INITIAL FOCUS, for the same reason
 * `ConfirmRemoveProject` gives: Cancel does, so a reflex Return is the
 * harmless answer.
 */

import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';

export type ConfirmForceCloseProps = {
  readonly title: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export function ConfirmForceClose({ title, onConfirm, onCancel }: ConfirmForceCloseProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      data-confirm-force-close
      role="dialog"
      aria-modal="true"
      aria-label={`force close ${title}`}
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
        aria-label="cancel force-closing the session"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-ground/70"
      />
      <div className="relative z-10 w-[340px] rounded-[var(--radius-lg)] border border-line-strong bg-panel p-3.5 shadow-[var(--shadow-node)]">
        <div className="flex items-center gap-2">
          <TriangleAlert size={13} strokeWidth={1.8} className="text-danger" />
          <span className="font-mono font-semibold text-[12px] text-ink">
            Kill "{title}" anyway?
          </span>
        </div>
        <p className="mt-2.5 text-[11.5px] text-ink-dim">
          vam could not confirm this is one of its own sessions. Confirming sends a kill signal
          directly to its process -- not the normal, resumable stop. This may be a terminal window
          you are working in right now, and closing it this way cannot be undone.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            ref={cancelRef}
            data-confirm-force-close-cancel
            onClick={onCancel}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-line px-2 py-1 text-[11.5px] text-ink-dim hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            data-confirm-force-close-go
            onClick={onConfirm}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-danger px-2 py-1 text-[11.5px] text-danger hover:bg-danger hover:text-ground"
          >
            Kill anyway
          </button>
        </div>
      </div>
    </div>
  );
}
