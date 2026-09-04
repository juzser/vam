/**
 * Putting the operator back where they were.
 *
 * WHAT THE RELAUNCH ACTUALLY LOSES. The sessions come back on their own: vam
 * starts each one in a tmux session it owns, the tmux server is a process of
 * its own that vam's exit does not touch, and the project tag vam writes on
 * that session (`tmux/argv.ts`, the project option) is still readable
 * afterwards. `useSourceModel` re-reads the source on mount, so a relaunched
 * vam rediscovers the work without being asked. The cursor is the part that
 * does not survive -- focus is React state seeded to `null` -- so the operator
 * comes back to their sessions and not to their PLACE in them.
 *
 * WHY THIS IS NOT IN THE STORE MODULE. `prefs.ts` stores the pointer; this
 * turns it back into a node id, which is the canvas's question and needs
 * nothing from `localStorage`. Keeping them apart means the canvas can import
 * the resolver without importing the store, and the resolver is testable
 * against a plain array of candidates rather than a browser.
 */

import type { FocusChoice } from './prefs.js';

/** One thing focus could land on: the node, and the session it draws. */
export type FocusCandidate = {
  readonly nodeId: string;
  readonly source: string;
  readonly session: string;
};

/**
 * Which node the canvas should point at, given what was remembered.
 *
 * TOTAL, AND IT FALLS BACK RATHER THAN FAILING. The remembered session is the
 * one most likely to have ended while vam was closed -- that is the ordinary
 * case, not the edge -- and answering `null` for it would leave the canvas
 * pointing at nothing, which is exactly the state a remembered focus exists to
 * prevent: the first keypress would do nothing. So a pointer that no longer
 * names a candidate degrades to the first candidate, which is what an unseeded
 * launch already does. `null` comes back only when there is genuinely nothing
 * on screen to point at.
 *
 * Matched on source AND session because a session id is unique only within its
 * source -- the same reason `icons` and `renames` are keyed twice.
 */
export function resolveFocusNodeId(
  remembered: FocusChoice | null,
  candidates: readonly FocusCandidate[],
): string | null {
  const first = candidates[0] ?? null;
  if (remembered === null) {
    return first?.nodeId ?? null;
  }
  const hit = candidates.find(
    (c) => c.source === remembered.source && c.session === remembered.session,
  );
  return hit?.nodeId ?? first?.nodeId ?? null;
}
