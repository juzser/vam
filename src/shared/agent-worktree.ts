/**
 * A CLAUDE CODE AGENT WORKTREE, and vam's own rule for recognising one --
 * the PURE half, shared between main and renderer.
 *
 * NO `node:*` IMPORT, EVER, IN THIS FILE. Same rule `shared/worktree.ts`
 * states for itself: this module is typechecked under `tsconfig.web.json` as
 * well as `tsconfig.node.json`, and it is imported directly by the renderer
 * (`WorktreesSection.tsx`, to filter an adopted worktree row the same way an
 * agent-worktree SESSION is already filtered) as well as by
 * `main/sources/agent-worktree.ts`, which re-exports these two symbols
 * unchanged so every existing importer of that module keeps working. The
 * REALPATH-dependent half (`isAgentWorktreeCwd`) stays main-only -- a
 * renderer has no `fs.realpath` to call and must not gain one through this
 * file.
 *
 * See `main/sources/agent-worktree.ts`'s own header for the two-signal rule
 * itself (path segment, or branch prefix) and why either alone is enough.
 */

/** The one literal `hasAgentWorktreeSegment` matches on. Exported so a
 *  caller that already has a realpath in hand never has to import a second
 *  copy of the string. */
export const AGENT_WORKTREE_PATH_SEGMENT = '/.claude/worktrees/';

/** What `isAgentWorktreeBranch` matches on -- Claude Code's own naming for
 *  the branch an `isolation: "worktree"` subagent runs on. */
const AGENT_WORKTREE_BRANCH_PREFIX = 'worktree-agent-';

/**
 * S2, CROSS-PROVIDER REVIEW: `hasAgentWorktreeSegment` used to be `path.
 * includes(AGENT_WORKTREE_PATH_SEGMENT)` -- true for ANY path under
 * `/.claude/worktrees/`, not only one of Claude Code's own `agent-<id>`
 * dirs (confirmed against real worktree admin directories on this machine:
 * `.git/worktrees/agent-<hex>`, each on a `worktree-agent-<hex>` branch).
 * `docs/design/workspace-options.md`'s own promise is narrower: only an
 * agent worktree is hidden. A worktree a PERSON makes in that same
 * container directory -- by hand, or with `claude --worktree <name>` --
 * carries no `agent-` prefix on its own dir name and must stay visible; the
 * old check hid it anyway, with `hideAgentWorktrees` on by default and no
 * way back.
 *
 * ONE REGEX, deliberately, rather than `indexOf`/`slice`/`split`/
 * `startsWith` chained by hand -- both read the same way ("the container,
 * then a dir literally starting `agent-`"), and `test/renderer/bundle-
 * budget.test.ts` holds the renderer's eager entry chunk to a byte budget
 * this file ships inside; the hand-chained version measured enough larger,
 * post-minification, to blow it. `[^/]*` is the first path segment after
 * the container; `(?:\/|$)` is what stops it matching a PREFIX of some
 * unrelated longer segment (`agent-worktrees-of-my-own` would not be one of
 * Claude Code's) while still allowing content nested deeper inside a real
 * agent worktree. No `.` inside `AGENT_WORKTREE_PATH_SEGMENT` is left
 * unescaped here (an unescaped `.` in a regex matches any character) --
 * this literal is typed out rather than built from that constant, which
 * exists for OTHER callers that want the plain string, not for this regex.
 */
const AGENT_WORKTREE_ROW_PATTERN = /\/\.claude\/worktrees\/agent-[^/]*(?:\/|$)/;

/** Does this (already realpath'd, or raw when the caller has no realpath to
 *  give) path carry a Claude Code agent worktree segment? See
 *  `AGENT_WORKTREE_ROW_PATTERN`'s own header for the rule and why it is one
 *  regex rather than several chained string calls. */
export function hasAgentWorktreeSegment(path: string): boolean {
  return AGENT_WORKTREE_ROW_PATTERN.test(path);
}

/** Does this branch name say "an isolated agent worktree", by Claude Code's
 *  own naming convention? `null` (branch unknown, or none) is false --
 *  absence is never evidence either way, the rule every optional fact in
 *  this source follows. */
export function isAgentWorktreeBranch(branch: string | null): boolean {
  // Not `branch?.startsWith(...)`: that widens the expression to `boolean |
  // undefined`, which this function's own `: boolean` return type refuses.
  // biome-ignore lint/complexity/useOptionalChain: see above.
  return branch !== null && branch.startsWith(AGENT_WORKTREE_BRANCH_PREFIX);
}
