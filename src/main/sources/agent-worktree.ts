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
import {
  AGENT_WORKTREE_PATH_SEGMENT,
  hasAgentWorktreeSegment,
  isAgentWorktreeBranch,
} from '../../shared/agent-worktree.js';

/**
 * THE PURE HALF -- `AGENT_WORKTREE_PATH_SEGMENT`, `hasAgentWorktreeSegment`,
 * `isAgentWorktreeBranch` -- now LIVES in `shared/agent-worktree.ts`, so the
 * renderer can filter an adopted worktree ROW by the same rule a session
 * already is, without dragging `node:fs/promises` into the web bundle
 * (`shared/worktree.ts`'s own "no node import, ever" rule). Re-exported here
 * unchanged so every existing importer of THIS module -- `claude-code/
 * source.ts`, `codex/source.ts`, this file's own test -- keeps working with
 * no import path to update.
 */
export { AGENT_WORKTREE_PATH_SEGMENT, hasAgentWorktreeSegment, isAgentWorktreeBranch };

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
