/**
 * WHO OWNS THE KEYBOARD. One fact, read off the DOM, and this is the rule.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 *   The cursor mode is INSERT exactly when DOM focus is inside an element
 *   marked `data-insert-scope`, and SELECT otherwise. Nothing stores it.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WHY IT IS DERIVED RATHER THAN HELD. It used to be a `useState<CursorMode>`
 * in `Canvas.tsx` that each handler set beside whatever it did — or did not do
 * — to DOM focus. That is two sources of truth about one thing, and an audit
 * found four separate leaks between them, every one of them the same defect:
 *
 *   - `Mod-0` set the flag to Select and moved no focus, so the status bar
 *     read Select while a now read-only textarea still held the keyboard and
 *     the window listener's typing guard swallowed every bare `j` and `k`.
 *     `Escape` in that same box blurred it explicitly; `focusList` did not.
 *   - `I` set the flag to Insert whether or not anything in the pane took the
 *     keyboard, so the mode could claim a cursor that did not exist — and
 *     `hjkl` then fell through to the canvas grammar under a pane being read.
 *
 * Both are unreachable now, not by a guard but by construction: there is no
 * second copy of the fact to drift. `focusList` RELEASES focus and the mode
 * follows; `focusAction` MOVES focus and the mode follows; a pane with nothing
 * to type into cannot be entered at all, and says so.
 *
 * AND THE KEY HANDLER ASKS THE DOM, NOT REACT. `Canvas.tsx` mirrors this into
 * state for the status bar, because a footer has to render from something —
 * but the keydown handler calls `cursorModeAt(document.activeElement)` at the
 * moment the key arrives. A React state read inside a listener is a snapshot
 * of the last render; the DOM is the present tense, and a keystroke is only
 * ever about the present tense.
 *
 * THE MARKS, and why there are two of them:
 *
 *   `data-insert-scope` — a REGION the keyboard can be inside: the question
 *   card, the composer, the terminal pane. Answers "which mode is this".
 *
 *   `data-insert-stop`  — a LANDING the keyboard can be sent to. Answers
 *   "where does `I` put it". Every stop is inside a scope; not every element
 *   inside a scope is a stop (the textarea is not — `I` lands on the prompt
 *   ROW, and `Enter` there opens the box for typing).
 *
 * A question's options need no `data-insert-stop`: they already carry
 * `data-question-option`, which four other readers match on, and giving them a
 * second attribute meaning the same thing is the duplication this module is
 * about. They are named in `STOP_SELECTOR` instead.
 */

import type { CursorMode } from './keysheet.js';

/** A region the keyboard can be INSIDE — see the module comment. */
export const INSERT_SCOPE = 'data-insert-scope';

/** A landing the keyboard can be SENT TO — see the module comment. */
export const INSERT_STOP = 'data-insert-stop';

const SCOPE_SELECTOR = `[${INSERT_SCOPE}]`;

/**
 * Where `I` lands, in DOCUMENT ORDER — which is the priority, not a second
 * list to keep in step with the first.
 *
 * A pane draws its question card ABOVE its composer, so a `querySelector`
 * over both returns the question's first option whenever a question is open
 * and the prompt row otherwise. That is exactly the rule `i` already follows
 * ("the prompt box, unless the session is asking something"), expressed as
 * the layout rather than as a second `if` that could disagree with it.
 */
const STOP_SELECTOR = `[data-question-option], [${INSERT_STOP}]`;

/** The insert region `node` sits in, or `null` when it is in none. */
export function insertScopeOf(node: unknown): HTMLElement | null {
  return node instanceof HTMLElement ? node.closest<HTMLElement>(SCOPE_SELECTOR) : null;
}

/**
 * THE MODE, derived. `document.activeElement` in, Select or Insert out.
 *
 * Total over anything: `null`, `document.body`, an element that has been
 * removed from the tree. A caller never has to decide what "focus is nowhere"
 * means, because the answer is always Select — the keyboard is on the shell,
 * which is what Select is.
 */
export function cursorModeAt(node: unknown): CursorMode {
  return insertScopeOf(node) === null ? 'select' : 'insert';
}

/**
 * Hand the keyboard back: blur `node` if it is inside an insert scope.
 *
 * Returns whether it released anything, so a caller can tell "I left Insert"
 * from "I was never in it" — two different facts, and a refusal that cannot
 * tell them apart says the wrong one half the time.
 *
 * It blurs rather than focusing something else on purpose. Select's cursor is
 * `focusedSessionId`, a canvas fact drawn as `data-row-cursor`; the sidebar
 * rows are not focusable and moving DOM focus onto one would invent a second
 * cursor in the list — the very duplication being removed here.
 */
export function releaseInsert(node: unknown): boolean {
  const host = insertScopeOf(node);
  if (host === null || !(node instanceof HTMLElement)) {
    return false;
  }
  node.blur();
  return true;
}

/**
 * Put the keyboard on `pane`'s first insert stop. Returns whether it landed.
 *
 * SCOPED TO ONE PANE, and the test that matters is the one that proves it does
 * not reach into another: every pane draws a question card and a composer of
 * its own, and a landing that searched the document would send the keyboard
 * into a pane the operator is not looking at.
 *
 * `false` is a real answer, not a failure — a pane showing a view with nothing
 * to type into has no stop, and the caller refuses out loud rather than
 * recording a mode nothing can act in.
 *
 * The activeElement check is what makes the `true` mean something: an element
 * that carries the mark but cannot take focus (no `tabindex`, `disabled`)
 * would otherwise report a landing that never happened.
 */
export function focusInsertStop(pane: Element | null | undefined): boolean {
  const stop = pane?.querySelector<HTMLElement>(STOP_SELECTOR) ?? null;
  if (stop === null) {
    return false;
  }
  stop.focus();
  return stop.ownerDocument.activeElement === stop;
}
