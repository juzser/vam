/**
 * The confirm every close route shows while the session it targets is
 * `running` -- DECISION 1 (`docs/design/vam-owns-the-session.md` §5,
 * "Confirm only when the agent is mid-turn"). Rendered once, by `Canvas.tsx`,
 * as a sibling of both the desktop columns and the phone shell, so the same
 * dialog answers the tab's `×`, the sidebar row's `×`, the `x` chord, the
 * tab's context menu, and the phone app bar's `×` alike. `closeSession` in
 * `Canvas.tsx` is the one place that decides whether to show it; nothing here
 * knows which device or which control raised the question.
 *
 * WHY IT EXISTS AT ALL. Closing a `running` session ends an agent mid-turn and
 * nothing inside vam undoes that — the work in flight is what the operator
 * cannot get back by reopening. A single tap or keypress is not an adequate
 * amount of intent for that, so the control opens a question and the question
 * is what acts — the same rule `ConfirmForceClose` and `ConfirmPrAction` state
 * in their own headers.
 *
 * THIS USED TO BE PHONE-ONLY, ASKED UNCONDITIONALLY, AND THAT HAS BEEN
 * SUPERSEDED. An earlier version of this file called "the phone only" a
 * decision: the same close on a desktop went straight through with no
 * question, on any status. The operator's own answer, asked directly, was
 * "ask for confirmation before closing a session ONLY while the agent is
 * running, on every device" — so the rule is now the STATUS that gates it,
 * not the DEVICE that shows it, and desktop and phone read the same
 * `session.status` through the same `closeSession`.
 *
 * `waiting` DOES NOT COUNT AS RUNNING. `domain/model.ts`'s own definition:
 * `waiting` means the session already finished its turn and the ball is with
 * the operator — closing it loses nothing in flight, so it closes exactly
 * like `idle`/`done`/`terminal` do, with no question, on every device
 * including the phone.
 *
 * Vam's existing overlay idiom, not a second one: the same scrim-plus-shell as
 * `ConfirmForceClose`, `ConfirmRemoveProject` and `ConfirmPrAction`, and the
 * same keyboard rule for Escape -- an open overlay owns the keyboard and it
 * cancels. UNLIKE THOSE THREE, Enter CONFIRMS here rather than doing nothing:
 * the operator's own requirement for this dialog specifically ("Enter
 * confirms, Esc cancels, and focus starts on Cancel to avoid accidental
 * kills"), because what it ends is resumable (`claude attach` brings the
 * conversation back) where a force-kill is not.
 *
 * NO `aria-label` STARTING WITH `close ` ON EITHER BUTTON, which is not a style
 * note: `styles.css` carries `[data-phone-shell] button[aria-label^='close ']
 * :not([data-swipe-trash]) { display: none }` to remove the row's hover-only
 * `x` from a phone, and this dialog renders INSIDE `[data-phone-shell]` when a
 * phone shows it. A confirming button named that way would be invisible and
 * the operator would be stuck in a dialog they could only cancel. The buttons
 * carry text and no label, so the rule cannot reach them.
 *
 * THE DESTRUCTIVE BUTTON DOES NOT HOLD INITIAL FOCUS -- Cancel does, so a tap
 * or an accidental Tab-then-Space lands on the harmless answer. Enter is
 * bound explicitly below rather than left to "whatever is focused activates",
 * which is what makes it confirm even though focus starts elsewhere.
 */

import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';

export type ConfirmCloseSessionProps = {
  /** The session, named the way the operator would name it. */
  readonly title: string;
  /**
   * The session's live background-agent count. Above zero the dialog says so
   * (closing ends them); zero keeps the plain "mid-turn" copy.
   */
  readonly runningAgents: number;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export function ConfirmCloseSession({
  title,
  runningAgents,
  onConfirm,
  onCancel,
}: ConfirmCloseSessionProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const agents = runningAgents > 0;

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
        // Everything is swallowed; only Escape and Enter do anything. See the
        // header for why this dialog binds Enter where its siblings do not.
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
          return;
        }
        if (event.key === 'Enter') {
          // `preventDefault` matters here specifically: focus starts on
          // Cancel, and without it the browser's own "Enter activates the
          // focused button" would fire Cancel's click right after this does,
          // cancelling the confirm it just sent.
          event.preventDefault();
          onConfirm();
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
            {agents ? 'Close session with background agents running?' : <>Close “{title}”?</>}
          </span>
        </div>
        {/* WHAT IT WILL DO, not "are you sure". The agent is what is ended;
            the transcript is not deleted and saying so is what keeps the
            question answerable without a trip to the docs. */}
        <p className="mt-2.5 text-control text-ink-dim">
          {agents
            ? `${runningAgents} background ${runningAgents === 1 ? 'agent' : 'agents'} still running. Closing the session ends them.`
            : 'This ends the agent running in it. Nothing in vam undoes that; the session’s transcript stays where it is.'}
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
