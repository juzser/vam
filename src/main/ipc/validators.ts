/**
 * The one place `MainSource` argument bounds and shape predicates live.
 *
 * Both the desktop IPC bridge (`handlers.ts`) and the network-facing HTTP/SSE
 * front door (`remote/server.ts`) validate the same writes -- `recordPrompt`,
 * `closeSession`, `createSession`, `createSessionInDirectory` and friends --
 * against the same untrusted-caller shape. A bound or a predicate declared
 * twice is a bound that can drift: raised in one front door and forgotten in
 * the other. This module is the single definition; both front doors import
 * it rather than keep a copy.
 */

/**
 * Session ids, titles and lesson/finding ids are short by construction --
 * they are UI-generated labels, never user-typed prose. 10,000 is far above
 * any of them; the bound exists only so a compromised renderer cannot park
 * a hundred-megabyte string on main's single event loop -- the process
 * hosting every window -- before validation has even finished looking at
 * the payload.
 */
export const MAX_TEXT_LENGTH = 10_000;
/**
 * The prompt BODY (`recordPrompt`'s second argument) is a different
 * population from an identifier: it is exactly the free text vam's prompt
 * box exists to record, and f-vam-electron-shell/task-4-load-ipc-c7bf7335
 * found that a shared 10,000-char bound refused legitimate input. Sized
 * from 2,900 real, typed Claude Code prompts (sidechains, tool results and
 * injected system-reminders excluded) as a proxy population -- vam's own
 * prompt box has no history yet:
 *
 *   median    968
 *   p90    36,424
 *   p99    60,268
 *   max   616,040
 *
 * A uniform 10,000-char bound refused 1,067 of 2,900 (36.8%) of them --
 * the distribution is bimodal (short interactive prompts plus routinely
 * pasted long ones), so the small median made the old bound feel safe
 * while it was wrong. 1,000,000 clears the observed max with headroom and
 * still refuses the half-gigabyte payload the original S3 finding was
 * about.
 */
export const MAX_PROMPT_LENGTH = 1_000_000;

/**
 * A waiver or lesson-transition list is a handful of finding ids; 1000 is
 * generous headroom while still keeping the array bounded BEFORE anything
 * walks it with `every`.
 */
export const MAX_LIST_LENGTH = 1_000;

export const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH;

export const isPromptText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_PROMPT_LENGTH;

export const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= MAX_LIST_LENGTH && value.every(isText);

/**
 * A directory to start a session in. ABSOLUTE, and with no NUL byte: the
 * renderer chose this string, and it becomes a process's cwd. `..` is not
 * rejected -- a path may legitimately contain one and main resolves nothing
 * here -- but a relative path would be resolved against main's own cwd, which
 * is a directory the operator never picked. Whether it exists is main's own
 * question, asked where the session is actually started.
 */
export const isDirectoryPath = (value: unknown): value is string =>
  isText(value) && value.startsWith('/') && !value.includes('\0');

/** `worktree:status`'s own `worktreeIds` -- the same `MAX_LIST_LENGTH`
 *  bound `isTextList` already enforces, applied to `isDirectoryPath`
 *  instead of `isText`: every element is a worktree's own realpath, not
 *  free text. */
export const isDirectoryPathList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= MAX_LIST_LENGTH && value.every(isDirectoryPath);

/**
 * The provider a new session should run, which the renderer may omit -- a
 * renderer that predates the setting, or one whose store could not be read,
 * sends nothing and main starts its default provider. Accepting `undefined` is
 * also what MARKS an argument optional below: a validator that admits
 * `undefined` cannot be a required argument, so the arity check reads the
 * minimum off the validators themselves rather than off a second list that
 * could disagree with them.
 */
export const isOptionalText = (value: unknown): value is string | undefined =>
  value === undefined || isText(value);

/**
 * `closeSession`'s second argument -- the confirmed kill-anyway. Same
 * "admits `undefined`" trick as `isOptionalText`: a renderer that predates
 * `force` sends nothing, and that is still a valid, non-forcing call.
 */
export const isOptionalBool = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === 'boolean';
