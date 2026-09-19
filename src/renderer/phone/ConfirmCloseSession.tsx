/**
 * The confirm in front of the phone app bar's `×`.
 *
 * WHY THIS EXISTS AT ALL, and it is a geometry argument before it is a
 * politeness one. `PhoneShell`'s close control sits at the right-hand end of a
 * 390px bar, and the Agents icon ends 8px before it starts: on a touchscreen
 * the tap that changes which facet of a session you are looking at and the tap
 * that STOPS it are neighbours. Closing a session ends a running agent and
 * nothing inside vam undoes it. A single tap is not an adequate amount of
 * intent for that, so the tap opens a question and the question is what acts --
 * the same rule `ConfirmForceClose` and `ConfirmPrAction` state in their own
 * headers.
 *
 * AND BECAUSE THE FILE CLAIMED THERE ALREADY WAS ONE. `PhoneShell` said the
 * `×` "goes through the same confirm the `x` chord does". There was no confirm
 * on either path -- `Canvas`'s `onSidebarClose` calls `closeSession` straight,
 * and `ConfirmForceClose` is only offered AFTER a close has already been
 * refused. Driven against a source that can close, one tap sent the write and
 * opened no dialog at all.
 *
 * THE PHONE ONLY, and that is a decision rather than an oversight. On a desktop
 * the same act is a deliberate chord or a menu item, aimed with a pointer that
 * has hover and a row that is 26px from its neighbour; here it is a finger on a
 * bar with no hover and no undo. Putting the question in front of the keyboard
 * route as well would tax the operator who typed it on purpose.
 *
 * Vam's existing overlay idiom, not a second one: the same scrim-plus-shell as
 * `ConfirmForceClose`, `ConfirmRemoveProject` and `ConfirmPrAction`, and the
 * same keyboard rule -- an open overlay owns the keyboard and hears only
 * Escape.
 *
 * NO `aria-label` STARTING WITH `close ` ON EITHER BUTTON, which is not a style
 * note: `styles.css` carries `[data-phone-shell] button[aria-label^='close ']
 * :not([data-phone-close]) { display: none }` to remove the row's hover-only
 * `x` from a phone, and this dialog renders INSIDE `[data-phone-shell]`. A
 * confirm whose confirming button named itself that way would be invisible and
 * the operator would be stuck in a dialog they could only cancel. The buttons
 * carry text and no label, so the rule cannot reach them.
 *
 * THE DESTRUCTIVE BUTTON DOES NOT HOLD INITIAL FOCUS, for the reason its three
 * neighbours give: Cancel does, so a reflex Return is the harmless answer.
 */

import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';

export type ConfirmCloseSessionProps = {
  /** The session, named the way the operator would name it. */
  readonly title: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export function ConfirmCloseSession({ title, onConfirm, onCancel }: ConfirmCloseSessionProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      data-confirm-close-session
      role="dialog"
      aria-modal="true"
      aria-label={`stop the session ${title}`}
      onKeyDown={(event) => {
        // Everything is swallowed; only Escape does anything. See the header.
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      className="fixed inset-0 z-40 flex items-center justify-center px-4"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="leave this session running"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-ground/70"
      />
      <div className="relative z-10 w-full max-w-[340px] rounded-[var(--radius-lg)] border border-line-strong bg-panel p-3.5 shadow-[var(--shadow-node)]">
        <div className="flex items-center gap-2">
          <TriangleAlert size={13} strokeWidth={1.8} className="flex-none text-danger" />
          <span className="min-w-0 font-mono font-semibold text-body text-ink">
            Close “{title}”?
          </span>
        </div>
        {/* WHAT IT WILL DO, not "are you sure". The agent is what is ended;
            the transcript is not deleted and saying so is what keeps the
            question answerable without a trip to the docs. */}
        <p className="mt-2.5 text-control text-ink-dim">
          This ends the agent running in it. Nothing in vam undoes that; the session’s transcript
          stays where it is.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            ref={cancelRef}
            data-confirm-close-session-cancel
            onClick={onCancel}
            className="vam-tap cursor-pointer rounded-[var(--radius-sm)] border border-line px-3 py-1 text-control text-ink-dim hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            data-confirm-close-session-go
            onClick={onConfirm}
            className="vam-tap cursor-pointer rounded-[var(--radius-sm)] border border-danger px-3 py-1 text-control text-danger hover:bg-danger hover:text-ground"
          >
            Close session
          </button>
        </div>
      </div>
    </div>
  );
}
