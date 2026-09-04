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

/** What the operator chose, on its way to the picker. */
export type AnswerRequest = {
  /** The option LABELS, exactly as the tool recorded them. Never positions. */
  readonly labels: readonly string[];
  /** The tool's own `multiSelect`: it decides the shape of the delivery. */
  readonly multiSelect: boolean;
};

/**
 * What happened. SEVEN ANSWERS, and every one but `sent` means the picker was
 * left as it was found -- no Return was pressed on a row vam could not name.
 *
 * `sent` carries the answer AS CONFIRMED BY A READ-BACK, not as intended:
 * vam presses Return, reads the screen again and only then says the word.
 * `unconfirmed` is the other half of that same read -- the keys went in and
 * the screen does not agree, which is the one thing that must never be
 * swallowed. `unmatched` names the option that was nowhere on screen;
 * `not-live` is a picker that did not respond to the probe arrow, which is
 * exactly the state where a blind Return answers the wrong row.
 */
export type AnswerResult =
  | { readonly kind: 'sent'; readonly answer: string }
  | { readonly kind: 'unaimed' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'no-picker' }
  | { readonly kind: 'not-live' }
  | { readonly kind: 'unmatched'; readonly label: string }
  | { readonly kind: 'unconfirmed'; readonly label: string };

/**
 * The most options one answer may carry. A tool call offers a handful; the
 * bound is what stops a renderer that is no longer vam's from asking for a
 * thousand arrow presses into a running agent.
 */
export const MAX_ANSWER_LABELS = 12;

/** Whether a value off the bridge is an answer vam will attempt. */
export function isAnswerRequest(value: unknown): value is AnswerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as { labels?: unknown; multiSelect?: unknown };
  return (
    typeof request.multiSelect === 'boolean' &&
    Array.isArray(request.labels) &&
    request.labels.length > 0 &&
    request.labels.length <= MAX_ANSWER_LABELS &&
    request.labels.every((label) => typeof label === 'string' && label.length > 0) &&
    // A single-select question has exactly one answer. Sending two would step
    // the picker twice and commit the second, silently.
    (request.multiSelect || request.labels.length === 1)
  );
}
