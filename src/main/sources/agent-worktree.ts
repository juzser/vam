/**
 * A CLAUDE CODE AGENT WORKTREE, and vam's own rule for recognising one.
 *
 * THE OPERATOR'S REPORT: pressing "New session" (or simply scrolling the
 * sidebar) surfaces a project it has no business showing -- a temporary git
 * worktree the Claude Agent SDK minted for a subagent running with
 * `isolation: "worktree"`, at `<repo>/.claude/worktrees/agent-<id>`. Such a
 * worktree carries a real, live Claude Code session (the subagent's own),
 * so nothing upstream already knows to leave it out -- as far as
 * `loadClaudeCodeProjects` is concerned it is exactly as real a project as
 * the repo it was cut from.
 *
 * THIS IS NOT vam's OWN WORKTREE FEATURE (PR 496, `src/main/worktrees/`).
 * That one lays worktrees out SIDE BY SIDE with the repo, at
 * `<repoParent>/<repoName>-worktrees/<slug>` (`worktreesRootFor`) -- a
 * different literal string that the segment check below never matches, so
 * the two features cannot collide by construction, not by a special case.
 *
 * TWO SIGNALS, EITHER ONE ENOUGH:
 *
 *  - a REALPATH'd cwd carrying the literal segment `/.claude/worktrees/`.
 *    Realpath'd because a symlinked path could otherwise read as an
 *    ordinary directory while pointing straight into one.
 *  - a branch named `worktree-agent-*`, for a worktree whose path alone
 *    does not say (a caller that moved or renamed it, or is comparing a
 *    branch it already had in hand without paying for a second `realpath`).
 *
 * NO SUBPROCESS, NO NETWORK: `hasAgentWorktreeSegment` and
 * `isAgentWorktreeBranch` are plain string checks, and `isAgentWorktreeCwd`
 * costs exactly one `realpath` -- the same class of read `branchOf`
 * (`repo-branch.ts`) already pays per session, never a `git` spawn.
 */

import { realpath } from 'node:fs/promises';

/** The one literal `hasAgentWorktreeSegment` matches on. Exported so a
 *  caller that already has a realpath in hand (`isAgentWorktreeCwd`'s own
 *  second tier) never has to import a second copy of the string. */
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
 * worktree, and is not a row `loadClaudeCodeProjects` would ever draw a
 * project for -- every real session's cwd is a CHILD of that directory, so
 * its path always continues past the slash.
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

/** The slice of `node:fs/promises` this needs -- injectable so a test never
 *  resolves a real path on the machine running it. */
export type RealpathOf = (path: string) => Promise<string>;

/**
 * The one question `loadClaudeCodeProjects` and the Codex source both ask
 * per session: is this cwd an agent worktree?
 *
 * THE BRANCH IS CHECKED FIRST AND, WHEN IT ANSWERS, `realpath` IS NEVER
 * CALLED -- a caller that already resolved a session's branch for its own
 * reasons (`read.facts.branch` in `source.ts`) gets the cheap answer without
 * paying for a redundant filesystem round trip.
 *
 * REALPATH NEVER THROWS THIS FUNCTION DOWN: an unreadable or already-gone
 * directory (a worktree deleted between the listing and this check) falls
 * back to testing the RAW cwd rather than refusing to answer -- the same
 * "never let an IO failure blank a row" discipline `branchOf` and every
 * other per-session filesystem read in this source already keeps.
 */
export async function isAgentWorktreeCwd(
  cwd: string,
  branch: string | null,
  realpathFn: RealpathOf = (path) => realpath(path),
): Promise<boolean> {
  if (isAgentWorktreeBranch(branch)) return true;
  let real: string;
  try {
    real = await realpathFn(cwd);
  } catch {
    real = cwd;
  }
  return hasAgentWorktreeSegment(real);
}
