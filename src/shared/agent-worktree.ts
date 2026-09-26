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
 * Does this (already realpath'd, or raw when the caller has no realpath to
 * give) path carry a Claude Code agent worktree segment?
 *
 * THE CONSTANT'S OWN TRAILING SLASH is what keeps this from matching the
 * CONTAINER directory itself (`/repo/.claude/worktrees`, with nothing after
 * it): that path names where Claude Code keeps its worktrees, not a
 * worktree, and is not a row anything here would ever draw for.
 */
export function hasAgentWorktreeSegment(path: string): boolean {
  return path.includes(AGENT_WORKTREE_PATH_SEGMENT);
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
