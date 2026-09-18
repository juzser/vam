/**
 * ONE FLAG: does vam ask the agent for a shorter, clearer answer.
 *
 * Operator, translated: "turn this ADHD skill into a setting that can be
 * toggled on and off in vam, so the output the agent returns is easier to
 * understand and more concise."
 *
 * ── A MODULE WITH NO STORE, WHICH IS WHY IT IS THREE LINES ────────────────
 * Every other file in this directory carries a store and a subscription,
 * because the thing it configures is drawn in the renderer and a React value
 * cannot reach it (`terminal-font.ts` and `view-width.ts` argue theirs at
 * length). THIS ONE HAS NO READER IN THE RENDERER AT ALL. Nothing on screen
 * changes when it is thrown: what changes is a decision made in MAIN, at the
 * seam where a prompt becomes keystrokes, and main is handed the value over
 * `window.api.prefs` by `activatePrefs`. See `main/terminal/concise.ts` for
 * what is done with it and for the limits that design has.
 *
 * It is a file of its own rather than two lines inside `prefs.ts` for the
 * reason `editor.ts` is: `prefs.ts` is a large store and the DEFAULT of a
 * setting is a decision worth finding by its own name.
 */

/**
 * OFF. Not a taste, and not caution for its own sake.
 *
 * Turning this on puts a paragraph vam wrote into the first prompt of every
 * session -- somebody else's context window and somebody else's bill. A
 * default of `true` would spend both without being asked, on every operator
 * who upgraded, and the first they would know of it is reading vam's words in
 * their own transcript.
 */
export const DEFAULT_CONCISE_OUTPUT = false;

/**
 * Total, and only a literal `true` is on.
 *
 * The direction matters more here than in any other reader in this directory:
 * an unreadable value read as ON would type vam's instructions into a running
 * agent on the strength of a hand-edited payload. Read as OFF it costs a
 * setting somebody has to throw again.
 */
export function readConciseOutput(raw: unknown): boolean {
  return raw === true;
}
