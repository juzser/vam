/**
 * THE VOCABULARY OF A PULL-REQUEST ACTION, in the one tree both processes
 * compile.
 *
 * `src/shared/link.ts` states the rule and it applies here for a second
 * reason as well. The renderer has to NAME an action to ask for one, main has
 * to RECOGNISE the name to run it, and the pane has to draw the outcome -- so
 * three places must agree about the same three shapes. Two copies of that
 * vocabulary is a pair that can drift, and the drift would be silent in the
 * worst direction: a renderer offering a way of merging main has never heard
 * of, drawn as a button that refuses only once it is pressed.
 *
 * WHAT IS EMPHATICALLY NOT HERE: the argv, the spawn, the validation and the
 * in-flight guard. They live in `src/main/sources/claude-code/pr-actions.ts`,
 * on main's side of the process boundary, because the renderer is this app's
 * least trusted process and a check it could reach is a check it could skip.
 * This file is data -- no import, nothing to execute -- exactly as
 * `src/main/ipc/channels.ts` is for channel names.
 */

/**
 * The strategies GitHub has, in the order the confirm dialog offers them.
 *
 * `squash` is FIRST because it is the one that leaves a base branch with one
 * commit per pull request -- but all three are here and none is implied. gh
 * spawned without a terminal and without a strategy flag does not choose one,
 * it PROMPTS, and with no stdin that is a hang rather than an answer. So
 * exactly one flag is always sent, and the operator is the one who chose it.
 *
 * WHAT IS NOT ON THIS LIST IS THE POINT OF IT BEING A LIST. `--admin`
 * overrides the repository's own branch protection; `--auto` reports success
 * now and merges later, unattended. Neither is a "way of merging" vam offers,
 * and because main resolves the method against THIS array rather than passing
 * a string through, neither is expressible from the renderer at all.
 */
export const MERGE_METHODS = ['squash', 'merge', 'rebase'] as const;

export type MergeMethod = (typeof MERGE_METHODS)[number];

/**
 * One act, fully described, as it crosses the bridge.
 *
 * NO DIRECTORY, and that absence is a guarantee rather than an omission: main
 * resolves where to act from the session id, so a pane cannot ask for a merge
 * in a repository its session is not standing in. `pull-requests.ts` refuses
 * `--repo` to keep exactly that invariant on the read side.
 */
export type PrAction =
  | { readonly kind: 'merge'; readonly number: number; readonly method: MergeMethod }
  | { readonly kind: 'delete-branch'; readonly branch: string };

/**
 * What an action answers with -- and it is DATA, never a throw.
 *
 * A rejection would reach the renderer as an electron-rewritten error with
 * gh's own sentence stripped out of it, and gh's own sentence ("the base
 * branch policy prohibits the merge") is the entire reason a failed merge is
 * worth surfacing at all. `src/main/link/ipc.ts` makes the same choice for the
 * same reason.
 */
export type PrActionOutcome =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly code: string; readonly message: string };
