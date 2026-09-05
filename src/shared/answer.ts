/**
 * Answering an `AskUserQuestion` picker in the session's own terminal, and
 * what became of the attempt.
 *
 * In `src/shared/` for the reason `terminal.ts` is: main performs it, the
 * preload forwards it and the renderer draws the outcome, so it belongs to
 * none of the three.
 *
 * WHY THIS IS NOT A `PaneKey`. The obvious answer -- type the option's text
 * and press Return -- was measured against a live picker and it is WRONG. The
 * literal characters were swallowed (the picker has no text buffer; the "type
 * something" row is a mode you select, not a field), and the Return then
 * committed whatever row the cursor happened to sit on. `Emerald` went in and
 * the transcript recorded `Crimson`. So an answer is not a keystroke: it is a
 * verified navigation, and it lives on its own channel with its own outcomes.
 */

/**
 * ONE question of the set, on its way to its own picker.
 *
 * `question` IS THE IDENTITY CHECK, and it is why a step carries the text and
 * not just the marks. One `AskUserQuestion` call can hold several questions,
 * and the CLI walks them one at a time -- so a Submit for the set is a LOOP,
 * and a loop is exactly where a label can be matched against the wrong
 * question. Measured, in a real two-question call: `Cobalt` was an option in
 * BOTH questions. Nothing may be matched on a screen that has not first been
 * shown to be the screen for this step.
 */
export type AnswerStep = {
  /** The tool's own question text, as it is printed above the options. */
  readonly question: string;
  /** The option LABELS the operator marked, in the order the card draws them. */
  readonly labels: readonly string[];
  /** The tool's own `multiSelect` for THIS question, not for the call. */
  readonly multiSelect: boolean;
};

/**
 * The whole set, answered in one go.
 *
 * A SET RATHER THAN A QUESTION, because that is what the tool call is and what
 * the CLI presents: a strip of tabs, one question at a time, and a single
 * review at the end. Submitting them one at a time is not on offer -- the
 * agent is waiting on the call, not on its first question.
 */
export type AnswerRequest = { readonly steps: readonly AnswerStep[] };

/**
 * What happened. ELEVEN ANSWERS: `sent`, and ten ways of stopping.
 *
 * WHAT STOPPING MEANS, and the sentence that stood here was false for any set
 * of more than one question: "every one but `sent` means the picker was left
 * as it was found". It is not. A single-select Return both ANSWERS and
 * ADVANCES, so a set walked as far as question two has already committed
 * question one into the running agent, and a refusal there is not "nothing was
 * sent" -- it is "this much was sent, and then it stopped". Every stop
 * therefore carries `committed`, and the surfaces read it rather than denying
 * a delivery that happened (`AnswerStop`).
 *
 * `sent` carries the answer AS CONFIRMED BY A READ-BACK, not as intended:
 * vam presses Return, reads the screen again and only then says the word.
 * `unconfirmed` is the other half of that same read -- the keys went in and
 * the screen does not agree, which is the one thing that must never be
 * swallowed. `unmatched` names the option that was nowhere on screen;
 * `not-live` is a picker that did not respond to the probe arrow, which is
 * exactly the state where a blind Return answers the wrong row.
 */
type AnswerStop =
  | { readonly kind: 'unaimed' }
  /**
   * THE LISTING ITSELF FAILED -- tmux is not on `PATH`, the call timed out, or
   * the failure did not classify. vam did not look, so it has no opinion about
   * pairings; `unaimed` said it had one, and sent the operator after a
   * duplicate or missing session that nothing had evidence for.
   */
  | { readonly kind: 'unavailable' }
  /**
   * The row published its own pane and vam rejected it. vam DID name a
   * session -- it refused the one it named -- which is the opposite of what
   * `unaimed` says. The read path has kept these apart since `PaneView` gained
   * its own `mispaired` arm; this is the same distinction on the write path,
   * in the same word.
   */
  | { readonly kind: 'mispaired' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'no-picker' }
  | { readonly kind: 'not-live' }
  | { readonly kind: 'unmatched'; readonly label: string }
  /**
   * The screen is not showing the question this step is about. The reason the
   * loop is safe: after each answer the CLI advances itself, and vam checks
   * WHERE IT LANDED before matching anything against it.
   */
  | { readonly kind: 'wrong-question'; readonly question: string }
  | { readonly kind: 'unconfirmed'; readonly label: string };

/**
 * `sent` for the whole set, or a stop that says how far it got.
 *
 * `committed` IS ABSENT RATHER THAN EMPTY when nothing went in, because the
 * two readings are different sentences and the absent one is the older,
 * commoner and simpler of them: nothing was sent. It holds the answers already
 * inside the agent, in asking order, one entry per question -- so its LENGTH
 * is the number of steps a retry must skip, which is what makes a part-sent
 * set finishable instead of a dead end.
 */
export type AnswerResult =
  | { readonly kind: 'sent'; readonly answer: string }
  | (AnswerStop & { readonly committed?: readonly string[] });

/**
 * The most options one answer may carry. A tool call offers a handful; the
 * bound is what stops a renderer that is no longer vam's from asking for a
 * thousand arrow presses into a running agent.
 */
export const MAX_ANSWER_LABELS = 12;

/** And the most questions one call may hold, bounding the loop for the same reason. */
export const MAX_ANSWER_STEPS = 8;

/**
 * The longest question text vam will carry across the bridge. It is used as a
 * `String.includes` needle against a captured screen, so it is bounded like
 * any other untrusted string that reaches a comparison.
 */
export const MAX_QUESTION_TEXT = 400;

/** Whether one step is one vam will attempt. */
function isAnswerStep(value: unknown): value is AnswerStep {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as { question?: unknown; labels?: unknown; multiSelect?: unknown };
  return (
    typeof step.question === 'string' &&
    step.question.length > 0 &&
    step.question.length <= MAX_QUESTION_TEXT &&
    typeof step.multiSelect === 'boolean' &&
    Array.isArray(step.labels) &&
    step.labels.length > 0 &&
    step.labels.length <= MAX_ANSWER_LABELS &&
    step.labels.every((label) => typeof label === 'string' && label.length > 0) &&
    // A single-select question has exactly one answer. Sending two would step
    // the picker twice and commit the second, silently.
    (step.multiSelect || step.labels.length === 1)
  );
}

/** Whether a value off the bridge is an answer vam will attempt. */
export function isAnswerRequest(value: unknown): value is AnswerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as { steps?: unknown };
  return (
    Array.isArray(request.steps) &&
    request.steps.length > 0 &&
    request.steps.length <= MAX_ANSWER_STEPS &&
    request.steps.every(isAnswerStep)
  );
}
